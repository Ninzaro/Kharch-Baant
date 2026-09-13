function assertAffected(data: unknown[] | null, message: string): void {
  if (!data || data.length === 0) {
    throw new Error(message);
  }
}

// Unarchive a group (set is_archived to false)
export const unarchiveGroup = async (groupId: string): Promise<{ success: boolean }> => {
  const { data, error } = await supabase
    .from('groups')
    .update({ is_archived: false })
    .eq('id', groupId)
    .select('id');
  if (error) throw error;
  assertAffected(data, 'Could not unarchive this group.');
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
  const { data, error } = await supabase.from('groups').delete().eq('id', groupId).select('id');
  if (error) throw error;
  assertAffected(data, 'Could not delete this group.');
  return { success: true };
};

// Archive a group (for non-owners, only if their balance is zero and all settled)
export const archiveGroup = async (groupId: string, userId: string, isOwner: boolean, userSettled: boolean, allSettled: boolean): Promise<{ success: boolean }> => {
  if (isOwner) throw new Error('Owner cannot archive, only delete.');
  if (!userSettled) throw new Error('You must settle your balance before archiving.');
  if (!allSettled) throw new Error('All balances must be settled before archiving.');
  // Mark group as archived for this user (add to archived_groups table or set is_archived for user)
  // For simplicity, set is_archived true on group (if all members archive, owner can delete)
  const { data, error } = await supabase
    .from('groups')
    .update({ is_archived: true })
    .eq('id', groupId)
    .select('id');
  if (error) throw error;
  assertAffected(data, 'Could not archive this group.');
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
import { roundMoneyFields, roundToCents } from '../utils/money';

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
    enableCuteIcons: (dbGroup as any).enable_cute_icons ?? true,
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
    updatedAt: dbTransaction.updated_at ?? undefined,
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
      return g;
    })
  );

  return groups;
};

export const addGroup = async (groupData: Omit<Group, 'id'>, personId?: string): Promise<Group> => {
  if (!personId) {
    throw new Error('Cannot create a group without a creator person id.');
  }

  const { data: groupResult, error: groupError } = await supabase.rpc('create_my_group', {
    p_name: groupData.name,
    p_currency: groupData.currency,
    p_group_type: groupData.groupType,
    p_trip_start: groupData.tripStartDate || null,
    p_trip_end: groupData.tripEndDate || null,
    p_enable_cute_icons: groupData.enableCuteIcons ?? true,
  });

  if (groupError) throw groupError;
  const created = Array.isArray(groupResult) ? groupResult[0] : groupResult;
  if (!created?.id) {
    throw new Error('Group was not created.');
  }

  // Include the creator as a member and other members
  const membersToAdd = [...groupData.members];
  if (personId && !membersToAdd.includes(personId)) {
    membersToAdd.push(personId);
  }

  // Insert group members - Filter out empty/invalid UUIDs
  const validMembers = membersToAdd.filter(
    memberId => memberId && memberId.trim() !== '' && memberId !== personId
  );

  if (validMembers.length > 0) {
    const { error: membersError } = await supabase
      .from('group_members')
      .insert(
        validMembers.map(memberId => ({
          group_id: created.id,
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

  return await transformDbGroupToAppGroup(created);
};

export const updateGroup = async (
  groupId: string,
  groupData: Omit<Group, 'id'>,
  loadedMembers: string[] = groupData.members,
): Promise<Group> => {
  const updateData: any = {
    name: groupData.name,
    currency: groupData.currency,
    group_type: groupData.groupType,
    trip_start_date: groupData.tripStartDate || null,
    trip_end_date: groupData.tripEndDate || null,
    enable_cute_icons: groupData.enableCuteIcons ?? true,
  };

  const { data: groupResult, error: groupError } = await supabase
    .from('groups')
    .update(updateData)
    .eq('id', groupId)
    .select()
    .single();

  if (groupError) {
    console.error('Detailed error:', groupError);
    throw new Error(`Database error: ${groupError.message}`);
  }

  const desired = Array.from(new Set((groupData.members || []).filter(Boolean)));
  if (desired.length === 0) {
    throw new Error('A group must have at least one member.');
  }

  const { data: memberRows, error: memberReadError } = await supabase
    .from('group_members')
    .select('person_id')
    .eq('group_id', groupId);
  if (memberReadError) throw memberReadError;

  const current = new Set((memberRows || []).map((r: { person_id: string }) => r.person_id));
  const loaded = new Set((loadedMembers || []).filter(Boolean));
  const desiredSet = new Set(desired);
  const toAdd = desired.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => loaded.has(id) && !desiredSet.has(id));

  if (toAdd.length > 0) {
    const { error: membersError } = await supabase
      .from('group_members')
      .insert(toAdd.map((personId) => ({ group_id: groupId, person_id: personId })));
    if (membersError) throw membersError;
  }

  if (toRemove.length > 0) {
    const { error: deleteError } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .in('person_id', toRemove);
    if (deleteError) throw deleteError;
  }

  const finalResult = await transformDbGroupToAppGroup(groupResult);
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
  enableCuteIcons: dbGroup.enable_cute_icons ?? true,
  members: [], // Default empty array - will be populated by full query or transformDbGroupToAppGroup
});

export const subscribeToGroups = (personId: string, callback: (payload: any) => void) => {
  const onRow = (payload: any) => {
    const basic = mapDbGroupRowBasic(payload.new);
    callback({ ...payload, new: basic });
  };
  const channel = supabase.channel('public:groups')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'groups' }, onRow)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups' }, onRow)
    .subscribe();
  return channel;
};

// Realtime: Transactions
export const subscribeToTransactions = (
  personId: string,
  callback: (payload: any) => void,
) => {
  const onRow = (payload: any) => {
    const transformedTransaction = transformDbTransactionToAppTransaction(payload.new as DbTransaction);
    callback({ ...payload, new: transformedTransaction });
  };
  const channel = supabase
    .channel('public:transactions')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, onRow)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions' }, onRow)
    .subscribe();
  return channel;
};

// Realtime: Payment Sources
export const subscribeToPaymentSources = (personId: string, callback: (payload: any) => void) => {
  const onRow = (payload: any) => {
    const transformedPaymentSource = transformDbPaymentSourceToAppPaymentSource(payload.new as DbPaymentSource);
    callback({ ...payload, new: transformedPaymentSource });
  };
  const channel = supabase
    .channel('public:payment_sources')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'payment_sources' }, onRow)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payment_sources' }, onRow)
    .subscribe();
  return channel;
};

// Realtime: People
export const subscribeToPeople = (personId: string, callback: (payload: any) => void) => {
  const onRow = (payload: any) => {
    const transformedPerson = transformDbPersonToAppPerson(payload.new as DbPerson);
    callback({ ...payload, new: transformedPerson });
  };
  const channel = supabase
    .channel('public:people')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'people' }, onRow)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'people' }, onRow)
    .subscribe();
  return channel;
};

// Realtime: Group Members (to reflect membership changes in UI)
export const subscribeToGroupMembers = (personId: string, callback: (payload: any) => void) => {
  const channel = supabase
    .channel('public:group_members')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_members' }, (payload) => {
      callback(payload);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_members' }, (payload) => {
      callback(payload);
    })
    .subscribe();
  return channel;
};

// TRANSACTIONS API
export const getTransactions = async (personId?: string): Promise<Transaction[]> => {
  // If no personId provided, we can't filter by membership reliably
  if (!personId) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false });
    if (error) throw error;
    return (data || []).map(transformDbTransactionToAppTransaction);
  }

  // 1. Get all group IDs where this person is a member
  const { data: memberRows, error: memberError } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('person_id', personId);

  if (memberError) {
    console.warn('⚠️ Error fetching group memberships for transactions:', memberError);
    return [];
  }

  if (!memberRows || memberRows.length === 0) {
    console.log('📊 No group memberships found for transactions');
    return [];
  }

  const groupIds = memberRows.map(row => row.group_id);
  console.log('📊 Fetching transactions for groups:', groupIds);

  // 2. Get all transactions for those groups
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .in('group_id', groupIds)
    .order('date', { ascending: false });

  if (error) {
    console.error('❌ Error fetching transactions for groups:', error);
    throw error;
  }
  
  console.log(`📊 Fetched ${data?.length || 0} transactions from DB`);

  return (data || []).map(transformDbTransactionToAppTransaction);
};

export const addTransaction = async (
  groupId: string,
  transactionData: Omit<Transaction, 'id' | 'groupId'>
): Promise<Transaction> => {
  const { amount, payers } = roundMoneyFields(transactionData.amount, transactionData.payers);
  if (!(amount > 0)) {
    throw new Error('Amount must be at least 0.01 after rounding to cents.');
  }
  const { data, error } = await supabase
    .from('transactions')
    .insert({
      group_id: groupId,
      description: transactionData.description,
      amount,
      paid_by_id: transactionData.paidById, // Still required for FK
      payers, // New JSONB column
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

  return transaction;
};

export const updateTransaction = async (
  transactionId: string,
  transactionData: Partial<Omit<Transaction, 'id' | 'groupId'>>
): Promise<Transaction> => {
  const updateData: any = {};

  if (transactionData.description !== undefined) updateData.description = transactionData.description;
  if (transactionData.amount !== undefined && transactionData.payers !== undefined) {
    const { amount, payers } = roundMoneyFields(transactionData.amount, transactionData.payers);
    if (!(amount > 0)) {
      throw new Error('Amount must be at least 0.01 after rounding to cents.');
    }
    updateData.amount = amount;
    updateData.payers = payers;
  } else if (transactionData.amount !== undefined) {
    const amount = roundToCents(transactionData.amount);
    if (!(amount > 0)) {
      throw new Error('Amount must be at least 0.01 after rounding to cents.');
    }
    updateData.amount = amount;
  } else if (transactionData.payers !== undefined) {
    updateData.payers = transactionData.payers.map((p) => ({
      ...p,
      amount: roundToCents(p.amount),
    }));
  }
  if (transactionData.paidById !== undefined) updateData.paid_by_id = transactionData.paidById;
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

  let query = supabase
    .from('transactions')
    .update(updateData)
    .eq('id', transactionId);
  if (transactionData.updatedAt) {
    query = query.eq('updated_at', transactionData.updatedAt);
  }
  const { data, error } = await query.select().single();

  if (error || !data) {
    const { data: still } = await supabase
      .from('transactions')
      .select('id')
      .eq('id', transactionId)
      .maybeSingle();
    if (still) {
      throw new Error('This expense was changed by someone else. Reload and try again.');
    }
    throw new Error('This expense is no longer available.');
  }

  const updated = transformDbTransactionToAppTransaction(data);
  return updated;
};

const TAG_EMOJIS: Record<string, string> = {
  Food: '🍔', Groceries: '🛒', Transport: '🚕', Travel: '✈️',
  Housing: '🏠', Utilities: '💡', Entertainment: '🎬',
  Shopping: '🛍️', Health: '💊', Other: '📝',
};

export const batchApplyEmojisToGroupTransactions = async (groupId: string): Promise<void> => {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, description, tag')
    .eq('group_id', groupId);
  if (error) throw error;

  const toUpdate = (data || []).filter(t => !/\p{Emoji}/u.test(t.description ?? ''));

  for (const t of toUpdate) {
    const icon = TAG_EMOJIS[t.tag] ?? '📝';
    const { error: upErr } = await supabase
      .from('transactions')
      .update({ description: `${t.description} ${icon}` })
      .eq('id', t.id);
    if (upErr) throw upErr;
  }
};

export const deleteTransaction = async (transactionId: string, groupId?: string): Promise<{ success: boolean }> => {
  const { data, error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', transactionId)
    .select('id');

  if (error) throw error;
  // 0 rows: already gone (idempotent). RLS-blocked deletes look the same at SQL level.

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
  return people;
};

export const addPerson = async (personData: Omit<Person, 'id'>): Promise<Person> => {
  // SECURITY DEFINER RPC — INSERT ... RETURNING is blocked by people SELECT RLS
  // (i_can_see_person does not include a brand-new unclaimed row).
  const avatarUrl = (personData.avatarUrl ?? '').trim();
  const { data, error } = await supabase.rpc('create_unclaimed_person', {
    p_name: personData.name,
    p_email: personData.email ?? null,
    p_avatar_url: avatarUrl,
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Failed to create person');
  return transformDbPersonToAppPerson(row);
};

export const findPersonByEmail = async (email: string): Promise<Person | null> => {
  // SECURITY DEFINER RPC — exact email match only (no full-table people SELECT)
  const { data, error } = await supabase.rpc('find_person_by_email', {
    p_email: email.toLowerCase().trim(),
  });

  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return transformDbPersonToAppPerson(row);
};

// USER MANAGEMENT
export const ensureUserExists = async (authUserId: string, userName: string, userEmail: string): Promise<Person> => {
  // Identity is taken from the JWT inside the RPC (authUserId is not trusted).
  const { data, error } = await supabase.rpc('ensure_my_person', {
    p_name: userName || (userEmail ? userEmail.split('@')[0] : 'User'),
    p_email: userEmail ? userEmail.trim().toLowerCase() : null,
  });

  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row) return transformDbPersonToAppPerson(row);
  } else {
    console.warn('ensure_my_person failed, falling back:', error.message);
  }

  // Fast path if RPC is not deployed yet
  const { data: byAuthId, error: authIdError } = await supabase
    .from('people')
    .select('*')
    .eq('clerk_user_id', authUserId)
    .maybeSingle();

  if (authIdError) console.warn('⚠️ Error checking clerk_user_id:', authIdError);
  if (byAuthId) return transformDbPersonToAppPerson(byAuthId);

  if (userEmail) {
    const { data: claimedRows, error: claimError } = await supabase
      .rpc('claim_person_by_email', {
        p_email:    userEmail.trim().toLowerCase(),
        p_clerk_id: authUserId,
        p_name:     userName || userEmail.split('@')[0],
      });

    if (claimError) console.warn('⚠️ Error in claim_person_by_email:', claimError);
    else if (claimedRows && claimedRows.length > 0) {
      return transformDbPersonToAppPerson(claimedRows[0]);
    }
  }

  // Do not write clerk text ids into auth_user_id (uuid) — that insert fails
  const { data: inserted, error: insertError } = await supabase
    .from('people')
    .insert({
      name: userName || userEmail.split('@')[0],
      clerk_user_id: authUserId,
      user_id: authUserId,
      avatar_url: '',
      email: userEmail ? userEmail.trim().toLowerCase() : null,
      is_claimed: true,
      source: 'self',
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: retry } = await supabase
        .from('people')
        .select('*')
        .eq('clerk_user_id', authUserId)
        .maybeSingle();
      if (retry) return transformDbPersonToAppPerson(retry);
    }
    throw insertError;
  }

  return transformDbPersonToAppPerson(inserted);
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
        emailService.sendGroupInviteEmail({
          inviteeEmail: email,
          inviterName: inviterData.name,
          groupName: groupData.name,
          inviteUrl,
          expiresInDays,
        }).then(result => {
          if (!result.success) {
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
 * Validate an invite token via SECURITY DEFINER RPC (exact token match).
 * Works for anon (pre-auth invite landing) without open SELECT on group_invites.
 */
export const validateInvite = async (inviteToken: string): Promise<ValidateInviteResponse> => {
  const { data, error } = await supabase.rpc('get_invite_preview', {
    p_token: inviteToken,
  });

  if (error) {
    console.warn('get_invite_preview failed:', error.message);
    return { isValid: false, error: 'Invite not found or expired' };
  }

  const payload = (typeof data === 'string' ? JSON.parse(data) : data) as {
    is_valid?: boolean;
    error?: string;
    invite?: Record<string, unknown>;
    group?: Record<string, unknown>;
    inviter?: { id?: string; name?: string; avatar_url?: string } | null;
    email_invites?: { email?: string }[];
  } | null;

  if (!payload?.is_valid || !payload.invite || !payload.group) {
    return {
      isValid: false,
      error: payload?.error || 'Invite not found or expired',
    };
  }

  const invite = transformDbInviteToAppInvite(payload.invite);
  const g = payload.group;
  const group: Group = {
    id: String(g.id),
    name: String(g.name ?? ''),
    currency: (g.currency as Group['currency']) ?? undefined,
    groupType: (g.group_type as GroupType) || undefined,
    tripStartDate: (g.trip_start_date as string) || undefined,
    tripEndDate: (g.trip_end_date as string) || undefined,
    createdBy: (g.created_by as string) || undefined,
    isArchived: Boolean(g.is_archived),
    members: [],
  };

  const inviter = payload.inviter?.id
    ? {
        id: String(payload.inviter.id),
        name: String(payload.inviter.name || ''),
        avatarUrl: String(payload.inviter.avatar_url || ''),
      }
    : undefined;

  const emailInvites = Array.isArray(payload.email_invites)
    ? payload.email_invites
        .map((e) => ({ email: String(e?.email || '').toLowerCase().trim() }))
        .filter((e) => e.email)
    : [];

  return {
    isValid: true,
    invite,
    group,
    inviter,
    emailInvites,
  };
};

/**
 * Accept an invite via SECURITY DEFINER RPC.
 * Membership is bound to the JWT subject (not client-supplied personId alone).
 */
export const acceptInvite = async (request: AcceptInviteRequest): Promise<AcceptInviteResponse> => {
  const { inviteToken } = request;

  const { data, error } = await supabase.rpc('accept_group_invite', {
    p_token: inviteToken,
  });

  if (error) {
    console.warn('accept_group_invite failed:', error.message);
    return { success: false, error: error.message || 'Failed to join group' };
  }

  const payload = (typeof data === 'string' ? JSON.parse(data) : data) as {
    success?: boolean;
    error?: string;
    group_id?: string;
    group_name?: string;
    already_member?: boolean;
  } | null;

  if (!payload?.success) {
    return {
      success: false,
      error: payload?.error || 'Failed to join group',
    };
  }

  // After accept, multi-use invites may still preview; maxed invites may not.
  // Always prefer RPC group_id so success is not lost when the link deactivates.
  if (payload.group_id) {
    const preview = await validateInvite(inviteToken);
    if (preview.isValid && preview.group) {
      return { success: true, group: preview.group };
    }
    return {
      success: true,
      group: {
        id: payload.group_id,
        name: payload.group_name || '',
        members: [],
      } as Group,
    };
  }

  return { success: true };
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

// Update user avatar
export const updateUserAvatar = async (personId: string, avatarUrl: string | null): Promise<{ success: boolean }> => {
  const { error } = await supabase
    .from('people')
    .update({ avatar_url: avatarUrl ?? '' }) // null → '' to satisfy NOT NULL constraint; Avatar component shows initials for empty string
    .eq('id', personId);

  if (error) {
    console.error('Error updating avatar:', error);
    throw error;
  }
  return { success: true };
};

// Update person details (name, email)
export const updatePerson = async (personId: string, updates: Partial<Person>): Promise<Person> => {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.email !== undefined) dbUpdates.email = updates.email || null;

  const { data, error } = await supabase
    .from('people')
    .update(dbUpdates)
    .eq('id', personId)
    .select()
    .single();

  if (error) throw error;
  return transformDbPersonToAppPerson(data);
};

/** Strip identity from the signed-in people row. Clerk user delete is separate. */
export const anonymizeMyAccount = async (): Promise<{ success: boolean; error?: string }> => {
  const { data, error } = await supabase.rpc('anonymize_my_account');
  if (error) {
    return { success: false, error: error.message };
  }
  const payload = (typeof data === 'string' ? JSON.parse(data) : data) as {
    success?: boolean;
    error?: string;
  } | null;
  if (!payload?.success) {
    return { success: false, error: payload?.error || 'Failed to delete account data' };
  }
  return { success: true };
};

