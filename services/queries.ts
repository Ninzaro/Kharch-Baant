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
        console.log('🔑 Realtime auth token set');
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
    console.log('🔌 Setting up groups realtime bridge for:', personId)
    const sub = api.subscribeToGroups(personId, (payload: any) => {
      console.log('📡 Groups bridge received:', payload.eventType, payload)
      qc.setQueryData<Group[]>(qk.groups(personId), (current = []) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT') {
          const newGroup = newRow as Group
          // Prevent duplicate: check if ID already exists
          if (current.some(g => g.id === newGroup.id)) {
            console.log('⚠️ Skipping duplicate INSERT for group:', newGroup.id)
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
      console.log('🔌 Unsubscribing groups realtime bridge for:', personId)
      sub.unsubscribe()
    }
  }, [personId, qc])
}

// Helper: realtime bridge for Transactions
export const useRealtimeTransactionsBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    console.log('🔌 Setting up transaction realtime bridge for:', personId)
    const sub = api.subscribeToTransactions(personId, (payload: any) => {
      console.log('📡 Transaction bridge received:', payload.eventType, payload)
      qc.setQueryData<Transaction[]>(qk.transactions(personId), (current = []) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT') {
          const newTx = newRow as Transaction
          // Prevent duplicate: check if ID already exists
          if (current.some(t => t.id === newTx.id)) {
            console.log('⚠️ Skipping duplicate INSERT for transaction:', newTx.id)
            return current
          }
          return [newTx, ...current]
        }
        if (eventType === 'UPDATE') return current.map(t => t.id === (newRow as Transaction).id ? (newRow as Transaction) : t)
        if (eventType === 'DELETE') return current.filter(t => t.id !== (oldRow as any).id)
        return current
      })
    })
    return () => {
      console.log('🔌 Unsubscribing transaction realtime bridge for:', personId)
      sub.unsubscribe()
    }
  }, [personId, qc])
}

// Helper: realtime bridge for Payment Sources
export const useRealtimePaymentSourcesBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    console.log('🔌 Setting up payment sources realtime bridge for:', personId)
    const sub = api.subscribeToPaymentSources(personId, (payload: any) => {
      console.log('📡 Payment sources bridge received:', payload.eventType, payload)
      qc.setQueryData<PaymentSource[]>(qk.paymentSources(personId), (current = []) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT') {
          const newPS = newRow as PaymentSource
          // Prevent duplicate: check if ID already exists
          if (current.some(ps => ps.id === newPS.id)) {
            console.log('⚠️ Skipping duplicate INSERT for payment source:', newPS.id)
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
      console.log('🔌 Unsubscribing payment sources realtime bridge for:', personId)
      sub.unsubscribe()
    }
  }, [personId, qc])
}

// Helper: realtime bridge for People
export const useRealtimePeopleBridge = (personId?: string) => {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!personId) return
    console.log('🔌 Setting up people realtime bridge for:', personId)
    const sub = api.subscribeToPeople(personId, (payload: any) => {
      console.log('📡 People bridge received:', payload.eventType, payload)
      qc.setQueryData<Person[]>(qk.people(personId), (current = []) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT') {
          const newPerson = newRow as Person
          // Prevent duplicate: check if ID already exists
          if (current.some(p => p.id === newPerson.id)) {
            console.log('⚠️ Skipping duplicate INSERT for person:', newPerson.id)
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
      console.log('🔌 Unsubscribing people realtime bridge for:', personId)
      sub.unsubscribe()
    }
  }, [personId, qc])
}
