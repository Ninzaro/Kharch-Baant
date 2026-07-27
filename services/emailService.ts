/**
 * Client email façade — never holds MailerSend secrets.
 *
 * All sending goes through the Supabase Edge Function `send-email`, which
 * reads MAILERSEND_API_KEY / MAILERSEND_FROM_EMAIL from function secrets only.
 */

import { supabase } from '../lib/supabase';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface WelcomeEmailData {
  userName: string;
  userEmail: string;
  loginMethod: 'email' | 'google' | 'other';
  appUrl?: string;
}

export interface GroupInviteEmailData {
  inviteeEmail: string;
  inviterName: string;
  groupName: string;
  inviteUrl: string;
  expiresInDays: number;
}

export interface MemberAddedEmailData {
  memberEmail: string;
  memberName: string;
  groupName: string;
  addedByName: string;
  groupUrl: string;
}

export interface SettleUpEmailData {
  payerEmail: string;
  payerName: string;
  receiverEmail: string;
  receiverName: string;
  amount: number;
  currency: string;
  groupName: string;
  settledByName: string;
}

export interface NewExpenseEmailData {
  memberEmails: string[];
  groupName: string;
  description: string;
  amount: number;
  currency: string;
  paidByName: string;
  splitWithNames: string[];
  expenseUrl: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

type EmailType = 'welcome' | 'group_invite' | 'member_added' | 'settle_up' | 'new_expense';

// ============================================================================
// CORE
// ============================================================================

/**
 * Email is "enabled" when Supabase is configured. The Edge Function decides
 * whether MailerSend secrets exist — the browser never sees those keys.
 */
export const isEmailServiceEnabled = (): boolean => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  return typeof url === 'string' && url.length > 0;
};

async function invokeSendEmail(type: EmailType, data: unknown): Promise<EmailResult> {
  if (!isEmailServiceEnabled()) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { data: result, error } = await supabase.functions.invoke('send-email', {
      body: { type, data },
    });

    if (error) {
      console.warn('[email] Edge function error:', error.message);
      return { success: false, error: error.message };
    }

    if (result?.error) {
      console.warn('[email] Send failed:', result.error);
      return { success: false, error: String(result.error) };
    }

    return {
      success: true,
      messageId: result?.messageId ? String(result.messageId) : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Email invoke failed';
    console.warn('[email]', message);
    return { success: false, error: message };
  }
}

// ============================================================================
// PUBLIC SENDERS
// ============================================================================

export const sendWelcomeEmail = async (data: WelcomeEmailData): Promise<EmailResult> => {
  return invokeSendEmail('welcome', {
    ...data,
    appUrl: data.appUrl || (typeof window !== 'undefined' ? window.location.origin : undefined),
  });
};

export const sendGroupInviteEmail = async (data: GroupInviteEmailData): Promise<EmailResult> => {
  return invokeSendEmail('group_invite', data);
};

export const sendMemberAddedEmail = async (data: MemberAddedEmailData): Promise<EmailResult> => {
  return invokeSendEmail('member_added', data);
};

export const sendSettleUpEmail = async (data: SettleUpEmailData): Promise<EmailResult> => {
  return invokeSendEmail('settle_up', data);
};

export const sendNewExpenseEmail = async (data: NewExpenseEmailData): Promise<EmailResult> => {
  return invokeSendEmail('new_expense', data);
};
