// Unarchive a group (set is_archived to false)
export const unarchiveGroup = async (groupId: string): Promise<{ success: boolean }> => {
  const { error } = await supabase.from('groups').update({ is_archived: false }).eq('id', groupId);
  if (error) throw error;
  return { success: true };
};
// Delete a group (only by owner, only if all balances settled)
export const deleteGroup = async (groupId: string, userId: string, isOwner: boolean, allSettled: boolean): Promise<{ success: boolean }> => {
  if (!isOwner) throw new Error('Only the group owner can delete the group.');
  if (!allSettled) throw new Error('All balances must be settled before deleting the group.');
  // Delete group_members first (due to FK)
  await supabase.from('group_members').delete().eq('group_id', groupId);
  // Delete transactions
  await supabase.from('transactions').delete().eq('group_id', groupId);
  // Delete group
  const { error } = await supabase.from('groups').delete().eq('id', groupId);
  if (error) throw error;
  return { success: true };
};

// Archive a group (for non-owners, only if their balance is zero and all settled)
export const archiveGroup = async (groupId: string, userId: string, isOwner: boolean, userSettled: boolean, allSettled: boolean): Promise<{ success: boolean }> => {
  if (isOwner) throw new Error('Owner cannot archive, only delete.');
  if (!userSettled) throw new Error('You must settle your balance before archiving.');
  if (!allSettled) throw new Error('All balances must be settled before archiving.');
  // Mark group as archived for this user (add to archived_groups table or set is_archived for user)
  // For simplicity, set is_archived true on group (if all members archive, owner can delete)
  const { error } = await supabase.from('groups').update({ is_archived: true }).eq('id', groupId);
  if (error) throw error;
  return { success: true };
};

// Fetch archived groups for settings (only groups where user is a member)
export const getArchivedGroups = async (userId: string): Promise<Group[]> => {
  const { data, error } = await supabase
    .from('groups')
    .select(`
      *,
      group_members!inner(person_id)
    `)
    .eq('is_archived', true)
    .eq('group_members.person_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const groups = await Promise.all((data || []).map(dbGroup => transformDbGroupToAppGroup(dbGroup)));
  return groups;
};
import { supabase } from '../lib/supabase';
import { Group, Transaction, PaymentSource, Person, GroupType, SplitParticipant, Payer } from '../types';
import type { DbGroup, DbTransaction, DbPaymentSource, DbPerson } from '../lib/supabase';
import * as emailService from './emailService';

// Helper function to transform database group to app group
const transformDbGroupToAppGroup = async (dbGroup: DbGroup): Promise<Group> => {
  // Get group members
  const { data: memberData, error } = await supabase
    .from('group_members')
    .select('person_id')
    .eq('group_id', dbGroup.id);

  if (error) throw error;

  return {
    id: dbGroup.id,
    name: dbGroup.name,
    currency: dbGroup.currency,
    members: memberData?.map(m => m.person_id) || [],
    groupType: dbGroup.group_type as GroupType,
    tripStartDate: dbGroup.trip_start_date || undefined,
    tripEndDate: dbGroup.trip_end_date || undefined,
    isArchived: dbGroup.is_archived || false,
    createdBy: dbGroup.created_by || undefined,
  };
};

// Helper function to transform database transaction to app transaction
const transformDbTransactionToAppTransaction = (dbTransaction: DbTransaction): Transaction => {
  const participants = (dbTransaction.split_participants as unknown as SplitParticipant[]) || [];
  const payers = (dbTransaction as any).payers as Payer[] | undefined;

  // Transform payers if they exist
  let appPayers: Payer[] | undefined = undefined;
  if (Array.isArray(payers) && payers.length > 0) {
    appPayers = payers.map(p => ({
      personId: p.personId,
      amount: Number(p.amount)
    }));
  }

  return {
    id: dbTransaction.id,
    groupId: dbTransaction.group_id,
    description: dbTransaction.description,
    amount: Number(dbTransaction.amount),
    paidById: dbTransaction.paid_by_id, // Primary payer for BC
    payers: appPayers,
    date: dbTransaction.date,
    tag: dbTransaction.tag as Transaction['tag'],
    paymentSourceId: dbTransaction.payment_source_id ?? undefined,
    comment: dbTransaction.comment ?? undefined,
    type: (dbTransaction.type as Transaction['type']) || 'expense',
    split: {
      mode: dbTransaction.split_mode as Transaction['split']['mode'],
      participants,
    },
  };
};

// Helper function to transform database payment source to app payment source
const transformDbPaymentSourceToAppPaymentSource = (dbPaymentSource: DbPaymentSource): PaymentSource => {
  return {
    id: dbPaymentSource.id,
    name: dbPaymentSource.name,
    type: dbPaymentSource.type as PaymentSource['type'],
    details: (dbPaymentSource.details as unknown as PaymentSource['details']) || undefined,
    isActive: dbPaymentSource.is_active ?? true,
  };
};

// Helper function to transform database person to app person
const transformDbPersonToAppPerson = (dbPerson: DbPerson): Person => {
  const authUserId = (dbPerson as any)?.auth_user_id ?? (dbPerson as any)?.clerk_user_id ?? null;
  return {
    id: dbPerson.id,
    name: (dbPerson as any).name,
    avatarUrl: (dbPerson as any).avatar_url,
    email: (dbPerson as any).email ?? undefined,
    authUserId: authUserId || undefined,
    isClaimed: (dbPerson as any).is_claimed ?? false,
    source: (dbPerson as any).source ?? 'manual',
  };
};

// GROUPS API
export const getGroups = async (personId?: string): Promise<Group[]> => {
  let query = supabase
    .from('groups')
    .select('*')
    .order('created_at', { ascending: false });

  // If personId is provided, only return groups where the person is a member
  if (personId) {
    query = supabase
      .from('groups')
      .select(`
        *,
        group_members!inner(person_id)
      `)
      .eq('group_members.person_id', personId)
      .order('created_at', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;

  // Transform each group and get its members
  const groups = await Promise.all(
    (data || []).map(async dbGroup => {
      const g = await transformDbGroupToAppGroup(dbGroup);
      if (dbGroup.name === 'Trip 2025' || dbGroup.id === '308ca153-61f0-4127-bad0-766ed1572551') {
        console.log('🔍 getGroups - Transformed group:', g.name, 'Members:', g.members);
      }
      return g;
    })
  );

  return groups;
};

export const addGroup = async (groupData: Omit<Group, 'id'>, personId?: string): Promise<Group> => {
  // Insert the group; set created_by to the creator if available
  const insertPayload: any = {
    name: groupData.name,
    currency: groupData.currency,
    group_type: groupData.groupType,
    trip_start_date: groupData.tripStartDate || null,
    trip_end_date: groupData.tripEndDate || null,
  };
  if (personId) insertPayload.created_by = personId;

  const { data: groupResult, error: groupError } = await supabase
    .from('groups')
    .insert(insertPayload)
    .select()
    .single();

  if (groupError) throw groupError;

  // Include the creator as a member and other members
  const membersToAdd = [...groupData.members];
  if (personId && !membersToAdd.includes(personId)) {
    membersToAdd.push(personId);
  }

  console.log('🔍 addGroup - Members to add:', membersToAdd);
  console.log('🔍 addGroup - Creator personId:', personId);
  console.log('🔍 addGroup - groupData.members:', groupData.members);

  // Insert group members - Filter out empty/invalid UUIDs
  const validMembers = membersToAdd.filter(memberId => memberId && memberId.trim() !== '');
  console.log('🔍 Valid members after filtering:', validMembers);

  if (validMembers.length > 0) {
    const { error: membersError } = await supabase
      .from('group_members')
      .insert(
        validMembers.map(memberId => ({
          group_id: groupResult.id,
          person_id: memberId,
        }))
      );

    if (membersError) {
      console.error('❌ Failed to add group members:', membersError);
      throw membersError;
    }
    console.log('✅ Successfully added members to group');
  } else {
    console.warn('⚠️ No members to add to group!');
  }

  return await transformDbGroupToAppGroup(groupResult);
};

// Request group deletion (for non-admins). Creates/updates a pending request.
export const requestGroupDeletion = async (
  groupId: string,
  requestedBy: string
): Promise<{ success: boolean; requestId?: string; message?: string }> => {
  // If a pending request exists, just return it
  const { data: existing } = await (supabase as any)
    .from('group_deletion_requests')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) {
    return { success: true, requestId: existing.id, message: 'A deletion request is already pending for this group.' };
  }

  const { data, error } = await (supabase as any)
    .from('group_deletion_requests')
    .insert({ group_id: groupId, requested_by: requestedBy, status: 'pending' })
    .select()
    .single();
  if (error) throw error;
  return { success: true, requestId: data.id };
};

// Approve a deletion request (admin only) and delete the group
export const approveGroupDeletion = async (
  requestId: string,
  approverId: string,
  allSettled: boolean
): Promise<{ success: boolean; message?: string }> => {
  // Load request and group
  const { data: req, error: reqErr } = await (supabase as any)
    .from('group_deletion_requests')
    .select('*, groups:group_id ( id, created_by )')
    .eq('id', requestId)
    .single();
  if (reqErr || !req) throw reqErr || new Error('Request not found');

  const group = (req as any).groups;
  if (!group) throw new Error('Group not found for request');
  if (group.created_by !== approverId) throw new Error('Only the admin can approve deletion');
  if (!allSettled) throw new Error('All balances must be settled before deleting the group.');

  // Perform deletion (same sequence as deleteGroup)
  await supabase.from('group_members').delete().eq('group_id', group.id);
  await supabase.from('transactions').delete().eq('group_id', group.id);
  const { error: delErr } = await supabase.from('groups').delete().eq('id', group.id);
  if (delErr) throw delErr;

  // Mark request approved
  const { error: updErr } = await (supabase as any)
    .from('group_deletion_requests')
    .update({ status: 'approved', approved_by: approverId, approved_at: new Date().toISOString() })
    .eq('id', requestId);
  if (updErr) throw updErr;

  return { success: true };
};

// Get all pending deletion requests for groups where the user is admin
export const getPendingDeletionRequests = async (userId: string): Promise<any[]> => {
  const { data, error } = await (supabase as any)
    .from('group_deletion_requests')
    .select(`
      *,
      groups:group_id ( id, name, created_by ),
      people:requested_by ( id, name, avatar_url )
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;

  // Filter to only groups where userId is the admin (created_by)
  const filtered = (data || []).filter((req: any) => req.groups?.created_by === userId);

  // Transform to a more friendly format
  return filtered.map((req: any) => ({
    id: req.id,
    group_id: req.group_id,
    requested_by: req.requested_by,
    status: req.status,
    created_at: req.created_at,
    group: req.groups ? {
      id: req.groups.id,
      name: req.groups.name,
      createdBy: req.groups.created_by,
    } : undefined,
    requester: req.people ? {
      id: req.people.id,
      name: req.people.name,
      avatarUrl: req.people.avatar_url,
    } : undefined,
  }));
};

// Reject a deletion request (admin only)
export const rejectGroupDeletion = async (requestId: string): Promise<{ success: boolean }> => {
  const { error } = await (supabase as any)
    .from('group_deletion_requests')
    .update({ status: 'rejected' })
    .eq('id', requestId);
  if (error) throw error;
  return { success: true };
};

export const updateGroup = async (groupId: string, groupData: Omit<Group, 'id'>): Promise<Group> => {
  console.log('updateGroup called with:', { groupId, groupData });

  // First, test basic connectivity and check table structure
  try {
    const { data: testData, error: testError } = await supabase
      .from('groups')
      .select('*')
      .limit(1);
    console.log('Table structure test:', { testData, testError });
    if (testData && testData.length > 0) {
      console.log('Available columns:', Object.keys(testData[0]));
    }
  } catch (connError) {
    console.error('Connectivity test failed:', connError);
  }

  // Update the group with all fields
  const updateData: any = {
    name: groupData.name,
    currency: groupData.currency,
    group_type: groupData.groupType,
    trip_start_date: groupData.tripStartDate || null,
    trip_end_date: groupData.tripEndDate || null,
  };

  console.log('Attempting to update with data:', updateData);

  const { data: groupResult, error: groupError } = await supabase
    .from('groups')
    .update(updateData)
    .eq('id', groupId)
    .select()
    .single();

  console.log('Group update result:', { groupResult, groupError });

  if (groupError) {
    console.error('Detailed error:', groupError);
    throw new Error(`Database error: ${groupError.message}`);
  }

  // Delete existing members
  const { error: deleteError } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId);

  console.log('Delete members result:', { deleteError });

  if (deleteError) throw deleteError;

  // Insert new members
  if (groupData.members.length > 0) {
    const { error: membersError } = await supabase
      .from('group_members')
      .insert(
        groupData.members.map(memberId => ({
          group_id: groupId,
          person_id: memberId,
        }))
      );

    console.log('Insert members result:', { membersError });

    if (membersError) throw membersError;
  }

  const finalResult = await transformDbGroupToAppGroup(groupResult);
  console.log('Final transformed result:', finalResult);

  return finalResult;
};

// Lightweight mapper for groups used in realtime (avoid extra DB queries to keep latency low)
const mapDbGroupRowBasic = (dbGroup: any) => ({
  id: dbGroup.id,
  name: dbGroup.name,
  currency: dbGroup.currency,
  groupType: dbGroup.group_type,
  tripStartDate: dbGroup.trip_start_date || undefined,
  tripEndDate: dbGroup.trip_end_date || undefined,
  isArchived: dbGroup.is_archived || false,
  createdBy: dbGroup.created_by || undefined,
  members: [], // Default empty array - will be populated by full query or transformDbGroupToAppGroup
});

export const subscribeToGroups = (personId: string, callback: (payload: any) => void) => {
  console.log('🔌 Subscribing to groups realtime for person:', personId);
  const channel = supabase.channel('public:groups')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, (payload) => {
      console.log('📡 Raw groups payload received:', payload);
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const basic = mapDbGroupRowBasic(payload.new);
        callback({ ...payload, new: basic });
      } else {
        callback(payload);
      }
    })
    .subscribe((status) => {
      console.log('🔌 Groups subscription status:', status);
    });
  return channel;
};

// Realtime: Transactions
export const subscribeToTransactions = (personId: string, callback: (payload: any) => void) => {
  console.log('🔌 Subscribing to transactions realtime for person:', personId);
  const channel = supabase
    .channel('public:transactions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, (payload) => {
      console.log('📡 Raw transactions payload received:', payload);
      // Transform the database record to app format
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const transformedTransaction = transformDbTransactionToAppTransaction(payload.new as DbTransaction);
        callback({ ...payload, new: transformedTransaction });
      } else {
        callback(payload);
      }
    })
    .subscribe((status) => {
      console.log('🔌 Transactions subscription status:', status);
    });
  return channel;
};

// Realtime: Payment Sources
export const subscribeToPaymentSources = (personId: string, callback: (payload: any) => void) => {
  console.log('🔌 Subscribing to payment sources realtime for person:', personId);
  const channel = supabase
    .channel('public:payment_sources')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_sources' }, (payload) => {
      console.log('📡 Raw payment sources payload received:', payload);
      // Transform the database record to app format
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const transformedPaymentSource = transformDbPaymentSourceToAppPaymentSource(payload.new as DbPaymentSource);
        callback({ ...payload, new: transformedPaymentSource });
      } else {
        callback(payload);
      }
    })
    .subscribe((status) => {
      console.log('🔌 Payment sources subscription status:', status);
    });
  return channel;
};

// Realtime: People
export const subscribeToPeople = (personId: string, callback: (payload: any) => void) => {
  console.log('🔌 Subscribing to people realtime for person:', personId);
  const channel = supabase
    .channel('public:people')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, (payload) => {
      console.log('📡 Raw people payload received:', payload);
      // Transform the database record to app format
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const transformedPerson = transformDbPersonToAppPerson(payload.new as DbPerson);
        callback({ ...payload, new: transformedPerson });
      } else {
        callback(payload);
      }
    })
    .subscribe((status) => {
      console.log('🔌 People subscription status:', status);
    });
  return channel;
};

// Realtime: Group Members (to reflect membership changes in UI)
export const subscribeToGroupMembers = (personId: string, callback: (payload: any) => void) => {
  console.log('🔌 Subscribing to group members realtime for person:', personId);
  const channel = supabase
    .channel('public:group_members')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, (payload) => {
      console.log('📡 Raw group members payload received:', payload);
      callback(payload);
    })
    .subscribe((status) => {
      console.log('🔌 Group members subscription status:', status);
    });
  return channel;
};

// TRANSACTIONS API
export const getTransactions = async (personId?: string): Promise<Transaction[]> => {
  let query = supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false });

  // If personId provided, only get transactions from groups where person is a member
  if (personId) {
    query = supabase
      .from('transactions')
      .select(`
        *,
        groups!inner(
          id,
          group_members!inner(person_id)
        )
      `)
      .eq('groups.group_members.person_id', personId)
      .order('date', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(transformDbTransactionToAppTransaction);
};

export const addTransaction = async (
  groupId: string,
  transactionData: Omit<Transaction, 'id' | 'groupId'>
): Promise<Transaction> => {
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      group_id: groupId,
      description: transactionData.description,
      amount: transactionData.amount,
      paid_by_id: transactionData.paidById, // Still required for FK
      payers: transactionData.payers, // New JSONB column
      date: transactionData.date,
      tag: transactionData.tag,
      payment_source_id: transactionData.paymentSourceId || null,
      comment: transactionData.comment || null,
      type: transactionData.type ?? 'expense',
      split_mode: transactionData.split.mode,
      split_participants: transactionData.split.participants,
    })
    .select()
    .single();

  if (error) throw error;

  const transaction = transformDbTransactionToAppTransaction(data);

  // Send email notifications (async, don't block)
  if (emailService.isEmailServiceEnabled()) {
    // Get group info
    const { data: groupData } = await supabase
      .from('groups')
      .select('name, currency')
      .eq('id', groupId)
      .single();

    // Get payer info
    const { data: payerData } = await supabase
      .from('people')
      .select('name, email, clerk_user_id')
      .eq('id', transactionData.paidById)
      .single();

    if (groupData && payerData) {
      // Handle settlement email (type='settlement')
      if (transactionData.type === 'settlement' && transactionData.split.participants.length > 0) {
        const receiverId = transactionData.split.participants[0].personId;
        const { data: receiverData } = await supabase
          .from('people')
          .select('name, email, clerk_user_id')
          .eq('id', receiverId)
          .single();

        if (receiverData) {
          console.log('📧 Settlement recorded:', {
            payer: payerData.name,
            receiver: receiverData.name,
            amount: transactionData.amount,
            group: groupData.name
          });

          // Note: Email addresses are now available in the people table
          // Can send emails using payerData.email and receiverData.email
          // emailService.sendSettleUpEmail({...})
        }
      }

      // Handle expense email (type='expense')
      if (transactionData.type === 'expense') {
        // Get all participant info
        const participantIds = transactionData.split.participants.map(p => p.personId);
        const { data: participantsData } = await supabase
          .from('people')
          .select('name, email, clerk_user_id')
          .in('id', participantIds);

        if (participantsData && participantsData.length > 0) {
          const splitWithNames = participantsData.map(p => p.name);
          const expenseUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}`;

          console.log('📧 New expense added:', {
            description: transactionData.description,
            amount: transactionData.amount,
            paidBy: payerData.name,
            splitWith: splitWithNames,
            group: groupData.name
          });

          // Note: Email addresses are now available in the people table
          // Can send emails using participantsData[].email
          // emailService.sendNewExpenseEmail({...})
        }
      }
    }
  }

  return transaction;
};

export const updateTransaction = async (
  transactionId: string,
  transactionData: Partial<Omit<Transaction, 'id' | 'groupId'>>
): Promise<Transaction> => {
  const updateData: any = {};

  if (transactionData.description !== undefined) updateData.description = transactionData.description;
  if (transactionData.amount !== undefined) updateData.amount = transactionData.amount;
  if (transactionData.paidById !== undefined) updateData.paid_by_id = transactionData.paidById;
  if (transactionData.payers !== undefined) updateData.payers = transactionData.payers; // New JSONB update
  if (transactionData.date !== undefined) updateData.date = transactionData.date;
  if (transactionData.tag !== undefined) updateData.tag = transactionData.tag;
  if (transactionData.paymentSourceId !== undefined) {
    updateData.payment_source_id = transactionData.paymentSourceId || null;
  }
  if (transactionData.comment !== undefined) updateData.comment = transactionData.comment;
  if (transactionData.type !== undefined) updateData.type = transactionData.type;
  if (transactionData.split !== undefined) {
    updateData.split_mode = transactionData.split.mode;
    updateData.split_participants = transactionData.split.participants;
  }

  const { data, error } = await supabase
    .from('transactions')
    .update(updateData)
    .eq('id', transactionId)
    .select()
    .single();

  if (error) throw error;

  return transformDbTransactionToAppTransaction(data);
};

export const deleteTransaction = async (transactionId: string): Promise<{ success: boolean }> => {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', transactionId);

  if (error) throw error;

  return { success: true };
};

// PAYMENT SOURCES API
export const getPaymentSources = async (personId?: string): Promise<PaymentSource[]> => {
  let query = supabase
    .from('payment_sources')
    .select('*')
    .order('created_at', { ascending: false });

  // If personId is provided, filter payment sources by user
  if (personId) {
    query = query.eq('user_id', personId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(transformDbPaymentSourceToAppPaymentSource);
};

export const addPaymentSource = async (
  sourceData: Omit<PaymentSource, 'id'>,
  personId?: string
): Promise<PaymentSource> => {
  const { data, error } = await supabase
    .from('payment_sources')
    .insert({
      name: sourceData.name,
      type: sourceData.type,
      details: sourceData.details ? JSON.parse(JSON.stringify(sourceData.details)) : null,
      user_id: personId || null,
    })
    .select()
    .single();

  if (error) throw error;

  return transformDbPaymentSourceToAppPaymentSource(data);
};

export const deletePaymentSource = async (paymentSourceId: string): Promise<{ success: boolean }> => {
  const { error } = await supabase
    .from('payment_sources')
    .delete()
    .eq('id', paymentSourceId);

  if (error) throw error;

  return { success: true };
};

export const archivePaymentSource = async (paymentSourceId: string): Promise<{ success: boolean }> => {
  const { error } = await supabase
    .from('payment_sources')
    .update({ is_active: false })
    .eq('id', paymentSourceId);

  if (error) throw error;

  return { success: true };
};

// PEOPLE API (bonus - you might want to manage people)
export const getPeople = async (personId?: string): Promise<Person[]> => {
  // If no personId provided, return empty array
  if (!personId) {
    return [];
  }

  // SIMPLIFIED APPROACH: Get all group IDs where the current user is a member
  const { data: myGroups, error: groupError } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('person_id', personId);

  if (groupError) {
    console.error('Error fetching user groups:', groupError);
    return [];
  }

  // If user is not in any groups, return empty array
  if (!myGroups || myGroups.length === 0) {
    return [];
  }

  const groupIds = myGroups.map(g => g.group_id);

  // Get all people who are members of those groups
  const { data: groupMembersData, error: membersError } = await supabase
    .from('group_members')
    .select('person_id')
    .in('group_id', groupIds);

  if (membersError) {
    console.error('Error fetching group members:', membersError);
    return [];
  }

  // Get unique person IDs
  const uniquePersonIds = [...new Set(groupMembersData?.map(m => m.person_id) || [])];

  // If no other people in any groups, return empty array
  if (uniquePersonIds.length === 0) {
    return [];
  }

  // Fetch all those people's details
  const { data: peopleData, error: peopleError } = await supabase
    .from('people')
    .select('*')
    .in('id', uniquePersonIds);

  if (peopleError) {
    console.error('Error fetching people details:', peopleError);
    return [];
  }

  const people = (peopleData || []).map(transformDbPersonToAppPerson);
  console.log(`🔍 getPeople - Found ${people.length} people for user ${personId}:`, people.map(p => p.name));
  return people;
};

export const addPerson = async (personData: Omit<Person, 'id'>): Promise<Person> => {
  const { data, error } = await supabase
    .from('people')
    .insert({
      name: personData.name,
      avatar_url: personData.avatarUrl,
      email: personData.email ?? null,
      is_claimed: false,
      source: personData.source ?? 'manual',
    })
    .select()
    .single();

  if (error) throw error;
  return transformDbPersonToAppPerson(data);
};

export const findPersonByEmail = async (email: string): Promise<Person | null> => {
  const { data, error } = await supabase
    .from('people')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return transformDbPersonToAppPerson(data);
};

// USER MANAGEMENT
export const ensureUserExists = async (authUserId: string, userName: string, userEmail: string): Promise<Person> => {
  // Fast path: user already claimed their record
  const { data: byAuthId, error: authIdError } = await supabase
    .from('people')
    .select('*')
    .eq('clerk_user_id', authUserId)
    .maybeSingle();

  if (authIdError) console.warn('⚠️ Error checking clerk_user_id:', authIdError);
  if (byAuthId) return transformDbPersonToAppPerson(byAuthId);

  // Claim path: unclaimed dummy with matching email
  if (userEmail) {
    const { data: dummy, error: emailError } = await supabase
      .from('people')
      .select('*')
      .eq('email', userEmail)
      .eq('is_claimed', false)
      .maybeSingle();

    if (emailError) console.warn('⚠️ Error checking email claim:', emailError);

    if (dummy) {
      const { data: claimed, error: claimError } = await supabase
        .from('people')
        .update({
          clerk_user_id: authUserId,
          auth_user_id: authUserId,
          name: userName || userEmail.split('@')[0],
          is_claimed: true,
          source: 'self',
        })
        .eq('id', dummy.id)
        .select()
        .single();

      if (claimError) throw claimError;
      return transformDbPersonToAppPerson(claimed);
    }
  }

  // New user: create fresh record
  const { data, error } = await supabase
    .from('people')
    .insert({
      name: userName || userEmail.split('@')[0],
      clerk_user_id: authUserId,
      auth_user_id: authUserId,
      avatar_url: `https://i.pravatar.cc/150?u=${authUserId}`,
      email: userEmail || null,
      is_claimed: true,
      source: 'self',
    })
    .select()
    .single();

  if (error) {
    // Race condition: another request created the row between our check and insert
    if (error.code === '23505') {
      const { data: retry } = await supabase
        .from('people')
        .select('*')
        .eq('clerk_user_id', authUserId)
        .maybeSingle();
      if (retry) return transformDbPersonToAppPerson(retry);
    }
    throw error;
  }

  return transformDbPersonToAppPerson(data);
};

// ============================================================================
// INVITE SYSTEM API FUNCTIONS - NOW ENABLED
// ============================================================================
// TypeScript types have been regenerated and include group_invites and email_invites tables

import {
  GroupInvite,
  EmailInvite,
  CreateInviteRequest,
  CreateInviteResponse,
  ValidateInviteResponse,
  AcceptInviteRequest,
  AcceptInviteResponse
} from '../types';

// Helper function to generate secure random invite token
const generateInviteToken = (): string => {
  // Generate 32-character URL-safe token
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

// Transform database invite to app invite
const transformDbInviteToAppInvite = (dbInvite: any): GroupInvite => ({
  id: dbInvite.id,
  groupId: dbInvite.group_id,
  inviteToken: dbInvite.invite_token,
  invitedBy: dbInvite.invited_by,
  expiresAt: dbInvite.expires_at,
  maxUses: dbInvite.max_uses,
  currentUses: dbInvite.current_uses,
  isActive: dbInvite.is_active,
  createdAt: dbInvite.created_at,
  updatedAt: dbInvite.updated_at,
});

// Transform database email invite to app email invite
const transformDbEmailInviteToAppEmailInvite = (dbEmailInvite: any): EmailInvite => ({
  id: dbEmailInvite.id,
  groupId: dbEmailInvite.group_id,
  groupInviteId: dbEmailInvite.group_invite_id,
  email: dbEmailInvite.email,
  invitedBy: dbEmailInvite.invited_by,
  sentAt: dbEmailInvite.sent_at,
  mailersendMessageId: dbEmailInvite.mailersend_message_id,
  mailersendStatus: dbEmailInvite.mailersend_status,
  status: dbEmailInvite.status,
  acceptedAt: dbEmailInvite.accepted_at,
  acceptedBy: dbEmailInvite.accepted_by,
  createdAt: dbEmailInvite.created_at,
});

/**
 * Create a new invite link for a group
 */
export const createGroupInvite = async (request: CreateInviteRequest & { invitedBy: string }): Promise<CreateInviteResponse> => {
  const { groupId, emails, maxUses, expiresInDays = 30, invitedBy } = request;

  // Check if user has permission to create invite (must be group member)
  const { data: membership } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('person_id', invitedBy)
    .single();

  if (!membership) {
    throw new Error('You must be a group member to create invites');
  }

  // Generate unique invite token
  const inviteToken = generateInviteToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  // Create group invite
  const { data: inviteData, error: inviteError } = await supabase
    .from('group_invites')
    .insert({
      group_id: groupId,
      invite_token: inviteToken,
      invited_by: invitedBy,
      expires_at: expiresAt.toISOString(),
      max_uses: maxUses,
      current_uses: 0,
      is_active: true,
    })
    .select()
    .single();

  if (inviteError) throw inviteError;

  const invite = transformDbInviteToAppInvite(inviteData);
  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/invite/${inviteToken}`;

  // If emails provided, create email invites and send emails
  let emailInvites: EmailInvite[] = [];
  if (emails && emails.length > 0) {
    // Get group and inviter info for email
    const { data: groupData } = await supabase
      .from('groups')
      .select('name')
      .eq('id', groupId)
      .single();

    const { data: inviterData } = await supabase
      .from('people')
      .select('name')
      .eq('id', invitedBy)
      .single();

    const emailInvitePromises = emails.map(async (email) => {
      const { data: emailInviteData, error: emailError } = await supabase
        .from('email_invites')
        .insert({
          group_id: groupId,
          group_invite_id: invite.id,
          email: email.toLowerCase().trim(),
          invited_by: invitedBy,
        })
        .select()
        .single();

      if (emailError) throw emailError;

      // Send email invitation
      if (emailService.isEmailServiceEnabled() && groupData && inviterData) {
        console.log('📧 Sending group invite email to:', email);
        emailService.sendGroupInviteEmail({
          inviteeEmail: email,
          inviterName: inviterData.name,
          groupName: groupData.name,
          inviteUrl,
          expiresInDays,
        }).then(result => {
          if (result.success) {
            console.log('✅ Group invite email sent to:', email);
          } else {
            console.warn('⚠️ Group invite email failed:', result.error);
          }
        }).catch(err => {
          console.error('❌ Group invite email error:', err);
        });
      }

      return transformDbEmailInviteToAppEmailInvite(emailInviteData);
    });

    emailInvites = await Promise.all(emailInvitePromises);
  }

  return {
    invite,
    inviteUrl,
    emailInvites: emailInvites.length > 0 ? emailInvites : undefined,
  };
};

/**
 * Validate an invite token
 */
export const validateInvite = async (inviteToken: string): Promise<ValidateInviteResponse> => {
  // Get invite with group info
  const { data: inviteData, error } = await supabase
    .from('group_invites')
    .select(`
      *,
      groups (
        id,
        name,
        currency,
        group_type,
        trip_start_date,
        trip_end_date,
        created_by,
        is_archived
      )
    `)
    .eq('invite_token', inviteToken)
    .eq('is_active', true)
    .single();

  if (error || !inviteData) {
    return {
      isValid: false,
      error: 'Invite not found or expired',
    };
  }

  // Check if expired
  const now = new Date();
  const expiresAt = new Date(inviteData.expires_at);
  if (now > expiresAt) {
    // Deactivate expired invite
    await supabase
      .from('group_invites')
      .update({ is_active: false })
      .eq('id', inviteData.id);

    return {
      isValid: false,
      error: 'Invite has expired',
    };
  }

  // Check usage limits
  if (inviteData.max_uses !== null && inviteData.current_uses >= inviteData.max_uses) {
    return {
      isValid: false,
      error: 'Invite has reached maximum usage limit',
    };
  }

  const invite = transformDbInviteToAppInvite(inviteData);

  // Transform the joined group data to the expected format
  const groupData = inviteData.groups;
  const group: Group = {
    id: groupData.id,
    name: groupData.name,
    currency: groupData.currency,
    groupType: groupData.group_type as GroupType,
    tripStartDate: groupData.trip_start_date || undefined,
    tripEndDate: groupData.trip_end_date || undefined,
    createdBy: groupData.created_by || undefined,
    isArchived: groupData.is_archived || false,
    members: [] // Will be populated by transformDbGroupToAppGroup if needed
  };

  return {
    isValid: true,
    invite,
    group,
  };
};

/**
 * Accept an invite and join the group
 */
export const acceptInvite = async (request: AcceptInviteRequest): Promise<AcceptInviteResponse> => {
  const { inviteToken, personId } = request;

  // First validate the invite
  const validation = await validateInvite(inviteToken);
  if (!validation.isValid || !validation.invite || !validation.group) {
    return {
      success: false,
      error: validation.error || 'Invalid invite',
    };
  }

  // Check if user is already a member
  const { data: existingMember } = await supabase
    .from('group_members')
    .select('id')
    .eq('group_id', validation.group.id)
    .eq('person_id', personId)
    .single();

  if (existingMember) {
    return {
      success: false,
      error: 'You are already a member of this group',
    };
  }

  // Add user to group
  const { error: memberError } = await supabase
    .from('group_members')
    .insert({
      group_id: validation.group.id,
      person_id: personId,
    });

  if (memberError) {
    return {
      success: false,
      error: 'Failed to join group',
    };
  }

  // Update invite usage count
  const { error: updateError } = await supabase
    .from('group_invites')
    .update({
      current_uses: validation.invite.currentUses + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', validation.invite.id);

  if (updateError) {
    console.error('Failed to update invite usage count:', updateError);
  }

  // Update email invite status if this person accepted via email
  await supabase
    .from('email_invites')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      accepted_by: personId,
    })
    .eq('group_invite_id', validation.invite.id)
    .eq('status', 'pending');

  // Send email notification to new member (async, don't wait)
  if (emailService.isEmailServiceEnabled()) {
    // Get new member info
    const { data: newMemberData } = await supabase
      .from('people')
      .select('name, email, clerk_user_id')
      .eq('id', personId)
      .single();

    // Get inviter info
    const { data: inviterData } = await supabase
      .from('people')
      .select('name')
      .eq('id', validation.invite.invitedBy)
      .single();

    if (newMemberData && inviterData) {
      const groupUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}`;

      console.log('📧 New member added to group:', {
        member: newMemberData.name,
        email: newMemberData.email,
        group: validation.group.name,
        addedBy: inviterData.name
      });

      // Note: Email address is now available in newMemberData.email
      // Can send welcome email using emailService
      // emailService.sendWelcomeToGroupEmail({...})
    }
  }

  return {
    success: true,
    group: validation.group,
  };
};

/**
 * Get all invites for a group (for management purposes)
 */
export const getGroupInvites = async (groupId: string): Promise<GroupInvite[]> => {
  const { data, error } = await supabase
    .from('group_invites')
    .select('*')
    .eq('group_id', groupId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(transformDbInviteToAppInvite);
};

/**
 * Deactivate an invite
 */
export const deactivateInvite = async (inviteId: string): Promise<{ success: boolean }> => {
  const { error } = await supabase
    .from('group_invites')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', inviteId);

  if (error) throw error;
  return { success: true };
};

/**
 * Clean up expired invites (utility function)
 */
export const cleanupExpiredInvites = async (): Promise<number> => {
  const { data, error } = await supabase.rpc('cleanup_expired_invites');
  if (error) throw error;
  return data || 0;
};

// Update user avatar
export const updateUserAvatar = async (personId: string, avatarUrl: string | null): Promise<{ success: boolean }> => {
  const { error } = await supabase
    .from('people')
    .update({ avatar_url: avatarUrl })
    .eq('id', personId);

  if (error) {
    console.error('Error updating avatar:', error);
    throw error;
  }
  return { success: true };
};

// Update person details (name)
export const updatePerson = async (personId: string, updates: Partial<Person>): Promise<{ success: boolean }> => {
    // Basic mapping for now
    const dbUpdates: any = {};
    if (updates.name) dbUpdates.name = updates.name;
    // avatar_url handled by separate function usually, but could be here too

    const { error } = await supabase
      .from('people')
      .update(dbUpdates)
      .eq('id', personId);

    if (error) throw error;
    return { success: true };
};

