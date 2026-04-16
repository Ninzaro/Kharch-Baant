import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from './apiService'
import type { Group, Transaction, PaymentSource, Person } from '../types'
import { supabase, getClerkSupabaseToken } from '../lib/supabase'

// Query Keys
export const qk = {
  groups: (personId?: string) => ['groups', personId] as const,
  transactions: (personId?: string) => ['transactions', personId] as const,
  paymentSources: (personId?: string) => ['paymentSources', personId] as const,
  people: (personId?: string) => ['people', personId] as const,
}

// Hook to prime the Realtime connection with the Clerk JWT before any bridges subscribe.
// Supabase Realtime authenticates at WS connect time, so we must set the token first.
export const useRealtimeConnection = (personId?: string) => {
  React.useEffect(() => {
    if (!personId) return;

    let cancelled = false;

    const connectWithToken = async () => {
      const token = await getClerkSupabaseToken();
      if (cancelled) return;

      // Set the access token on the realtime client so WS upgrade carries it
      if (token) {
        (supabase.realtime as any).setAuth(token);
      }
    };

    connectWithToken();

    return () => {
      cancelled = true;
    };
  }, [personId]);
};

// Groups
export const useGroupsQuery = (personId?: string) =>
  useQuery({
    queryKey: qk.groups(personId),
    queryFn: () => api.getGroups(personId),
  })

// Transactions
export const useTransactionsQuery = (personId?: string) =>
  useQuery({
    queryKey: qk.transactions(personId),
    queryFn: () => api.getTransactions(personId),
  })

// Payment Sources
export const usePaymentSourcesQuery = (personId?: string) =>
  useQuery({
    queryKey: qk.paymentSources(personId),
    queryFn: () => api.getPaymentSources(personId),
  })

// People
export const usePeopleQuery = (personId?: string) =>
  useQuery({
    queryKey: qk.people(personId),
    queryFn: () => api.getPeople(personId),
    enabled: !!personId,
  })

// Helper: integrate Supabase realtime with cache updates
export const useRealtimeGroupsBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    const sub = api.subscribeToGroups(personId, (payload: any) => {
      qc.setQueryData<Group[]>(qk.groups(personId), (current = []) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT') {
          const newGroup = newRow as Group
          // Prevent duplicate: check if ID already exists
          if (current.some(g => g.id === newGroup.id)) {
            return current
          }
          return [...current, newGroup]
        }
        if (eventType === 'UPDATE') {
          return current.map(g => {
            if (g.id === (newRow as Group).id) {
              // Preserve members from existing group since realtime payload has empty members
              // Realtime updates to 'groups' table don't contain member info
              const updatedGroup = newRow as Group;
              return {
                ...updatedGroup,
                members: g.members // Keep existing members
              };
            }
            return g;
          })
        }
        if (eventType === 'DELETE') return current.filter(g => g.id !== (oldRow as any).id)
        return current
      })
    })
    return () => {
      sub.unsubscribe()
    }
  }, [personId, qc])
}

// Helper: realtime bridge for Transactions
export const useRealtimeTransactionsBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    const pgSub = api.subscribeToTransactions(
      personId,
      (payload: any) => {
        qc.setQueryData<Transaction[]>(qk.transactions(personId), (current = []) => {
          const { eventType, new: newRow, old: oldRow } = payload
          if (eventType === 'INSERT') {
            const newTx = newRow as Transaction
            if (current.some(t => t.id === newTx.id)) return current
            return [newTx, ...current]
          }
          if (eventType === 'UPDATE') return current.map(t => t.id === (newRow as Transaction).id ? (newRow as Transaction) : t)
          if (eventType === 'DELETE') return current.filter(t => t.id !== (oldRow as any).id)
          return current
        })
      },
      (_groupId: string) => {
        qc.invalidateQueries({ queryKey: qk.transactions(personId) })
      },
    )

    return () => {
      pgSub.unsubscribe()
    }
  }, [personId, qc])
}

// Helper: realtime bridge for Payment Sources
export const useRealtimePaymentSourcesBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    const sub = api.subscribeToPaymentSources(personId, (payload: any) => {
      qc.setQueryData<PaymentSource[]>(qk.paymentSources(personId), (current = []) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT') {
          const newPS = newRow as PaymentSource
          // Prevent duplicate: check if ID already exists
          if (current.some(ps => ps.id === newPS.id)) {
            return current
          }
          return [newPS, ...current]
        }
        if (eventType === 'UPDATE') return current.map(ps => ps.id === (newRow as PaymentSource).id ? (newRow as PaymentSource) : ps)
        if (eventType === 'DELETE') return current.filter(ps => ps.id !== (oldRow as any).id)
        return current
      })
    })
    return () => {
      sub.unsubscribe()
    }
  }, [personId, qc])
}

// Helper: realtime bridge for People
export const useRealtimePeopleBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    const sub = api.subscribeToPeople(personId, (payload: any) => {
      qc.setQueryData<Person[]>(qk.people(personId), (current = []) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT') {
          const newPerson = newRow as Person
          // Prevent duplicate: check if ID already exists
          if (current.some(p => p.id === newPerson.id)) {
            return current
          }
          return [...current, newPerson]
        }
        if (eventType === 'UPDATE') return current.map(p => p.id === (newRow as Person).id ? (newRow as Person) : p)
        if (eventType === 'DELETE') return current.filter(p => p.id !== (oldRow as any).id)
        return current
      })
    })
    return () => {
      sub.unsubscribe()
    }
  }, [personId, qc])
}


// Helper: realtime bridge for Group Members
// When the current user is added/removed from a group, invalidate groups so the
// new group appears (or disappears) immediately without a manual refresh.
// When any member is added/removed from one of the user's groups, also invalidate
// so the group's member list stays current for all participants.
export const useRealtimeGroupMembersBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    const sub = api.subscribeToGroupMembers(personId, (payload: any) => {
      const { eventType, new: newRow, old: oldRow } = payload
      const row = newRow || oldRow

      if (eventType === 'INSERT' && newRow?.person_id === personId) {
        // Current user was added to a new group — refetch groups AND transactions
        // (transactions are filtered by group membership, so they need a refresh too)
        qc.invalidateQueries({ queryKey: qk.groups(personId) })
        qc.invalidateQueries({ queryKey: qk.transactions(personId) })
        return
      }

      if (eventType === 'DELETE' && oldRow?.person_id === personId) {
        // Current user was removed from a group — remove group from cache immediately,
        // and drop transactions that belonged to that group
        const removedGroupId = row?.group_id
        qc.setQueryData<Group[]>(qk.groups(personId), (current = []) =>
          current.filter(g => g.id !== removedGroupId)
        )
        qc.setQueryData<Transaction[]>(qk.transactions(personId), (current = []) =>
          current.filter(t => t.groupId !== removedGroupId)
        )
        return
      }

      // Another member was added/removed from one of our groups — refresh so
      // member lists stay in sync for all participants in the group.
      const currentGroups = qc.getQueryData<Group[]>(qk.groups(personId)) ?? []
      const affectedGroupId = row?.group_id
      if (affectedGroupId && currentGroups.some(g => g.id === affectedGroupId)) {
        qc.invalidateQueries({ queryKey: qk.groups(personId) })
      }
    })
    return () => { sub.unsubscribe() }
  }, [personId, qc])
}
