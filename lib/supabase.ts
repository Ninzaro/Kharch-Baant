import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'
import { getEnvValue } from '../utils/env'

const supabaseUrl = getEnvValue('VITE_SUPABASE_URL', 'REACT_APP_SUPABASE_URL')
const supabaseAnonKey = getEnvValue('VITE_SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY')

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase credentials are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or their REACT_APP_ equivalents).')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    accessToken: async () => {
        const clerk = (window as any).Clerk;
        if (clerk && clerk.session) {
            try {
                const token = await clerk.session.getToken({ template: 'supabase' });
                return token || '';
            } catch (e) {
                console.error('Failed to get Clerk Supabase token for realtime', e);
            }
        }
        return '';
    }
})

// Types for our database
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Inserts<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type Updates<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']

// Specific table types
export type DbGroup = Tables<'groups'>
export type DbTransaction = Tables<'transactions'>
export type DbPaymentSource = Tables<'payment_sources'>
export type DbPerson = Tables<'people'>
export type DbGroupMember = Tables<'group_members'>
