// SUPABASE-ONLY SERVICE EXPORTS
// This file now acts as a thin facade over the Supabase implementation to keep existing imports stable.
// All mock/in-memory logic has been removed as we are migrating fully to persistent storage.

import { Group, Transaction, PaymentSource, Person } from '../types';
import { supabase } from '../lib/supabase';
import * as supabaseApi from './supabaseApiService';

// GROUPS
export const getGroups = async (personId?: string): Promise<Group[]> => supabaseApi.getGroups(personId);
export const addGroup = async (groupData: Omit<Group, 'id'>, personId?: string): Promise<Group> => supabaseApi.addGroup(groupData, personId);
export const updateGroup = async (groupId: string, groupData: Omit<Group, 'id'>): Promise<Group> => supabaseApi.updateGroup(groupId, groupData);
export const subscribeToGroups = (personId: string, callback: (payload: any) => void) => supabaseApi.subscribeToGroups(personId, callback);
export const subscribeToTransactions = (personId: string, callback: (payload: any) => void) => supabaseApi.subscribeToTransactions(personId, callback);
export const subscribeToPaymentSources = (personId: string, callback: (payload: any) => void) => supabaseApi.subscribeToPaymentSources(personId, callback);
export const subscribeToPeople = (personId: string, callback: (payload: any) => void) => supabaseApi.subscribeToPeople(personId, callback);
export const subscribeToGroupMembers = (personId: string, callback: (payload: any) => void) => supabaseApi.subscribeToGroupMembers(personId, callback);

// TRANSACTIONS
export const getTransactions = async (personId?: string): Promise<Transaction[]> => supabaseApi.getTransactions(personId);
export const addTransaction = async (groupId: string, transactionData: Omit<Transaction, 'id' | 'groupId'>): Promise<Transaction> => supabaseApi.addTransaction(groupId, transactionData);
export const updateTransaction = async (transactionId: string, transactionData: Partial<Omit<Transaction, 'id' | 'groupId'>>): Promise<Transaction> => supabaseApi.updateTransaction(transactionId, transactionData);
export const deleteTransaction = async (transactionId: string): Promise<{ success: boolean }> => supabaseApi.deleteTransaction(transactionId);

// PAYMENT SOURCES
export const getPaymentSources = async (personId?: string): Promise<PaymentSource[]> => supabaseApi.getPaymentSources(personId);
export const addPaymentSource = async (sourceData: Omit<PaymentSource, 'id'>, personId?: string): Promise<PaymentSource> => supabaseApi.addPaymentSource(sourceData, personId);
export const deletePaymentSource = async (paymentSourceId: string): Promise<{ success: boolean }> => supabaseApi.deletePaymentSource(paymentSourceId);
export const archivePaymentSource = async (paymentSourceId: string): Promise<{ success: boolean }> => supabaseApi.archivePaymentSource(paymentSourceId);

// PEOPLE
export const getPeople = async (personId?: string): Promise<Person[]> => supabaseApi.getPeople(personId);
export const addPerson = async (personData: Omit<Person, 'id'>): Promise<Person> => supabaseApi.addPerson(personData);
export { findPersonByEmail } from './supabaseApiService';

// USER MANAGEMENT
export const ensureUserExists = async (userId: string, userName: string, userEmail: string): Promise<Person> => supabaseApi.ensureUserExists(userId, userName, userEmail);

// MEMBERSHIP HELPERS
// Create a person and link them to a group (group_members). Avatar uses deterministic placeholder.
export const addPersonToGroup = async (groupId: string, data: { name: string; avatarUrl?: string }): Promise<Person> => {
  const person = await addPerson({ name: data.name, avatarUrl: data.avatarUrl || `https://i.pravatar.cc/150?u=${encodeURIComponent(data.name)}` });
  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, person_id: person.id });
  if (error) throw error;
  return person;
};

// Utility: simple health check (returns true if groups query works)
export const checkConnection = async (): Promise<boolean> => {
  try {
    await supabaseApi.getGroups();
    return true;
  } catch {
    return false;
  }
};

// Warning helper: can be invoked at app bootstrap to ensure envs are present.
export const assertSupabaseEnvironment = () => {
  const missing: string[] = [];
  if (!import.meta.env.VITE_SUPABASE_URL && !process.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY && !process.env.VITE_SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY');
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.warn('[Supabase] Missing environment variables:', missing.join(', '));
  }
};
