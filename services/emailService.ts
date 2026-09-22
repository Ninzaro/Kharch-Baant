/**
 * Client email façade — never holds MailerSend secrets.
 *
 * All sending goes through the Supabase Edge Function `send-email`, which
 * reads BREVO_API_KEY / BREVO_SENDER_EMAIL from function secrets only.
 */

import { supabase } from '../lib/supabase';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface GroupInviteEmailData {
  inviteeEmail: string;
  inviterName: string;
  groupName: string;
  inviteUrl: string;
  expiresInDays: number;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

type EmailType = 'group_invite';

export const PUBLIC_INVITE_ORIGIN = 'https://www.motamaati.in';

/** Link the edge function will accept. Local origins are rejected by send-email. */
export function inviteLink(token: string): string {
  return `${PUBLIC_INVITE_ORIGIN}/invite/${token}`;
}

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
      let message = error.message;
      try {
        const body = await (error as { context?: Response }).context?.clone().json();
        if (body && typeof body.error === 'string' && body.error) message = body.error;
      } catch {
        // The function body was not JSON.
      }
      console.warn('[email] Edge function error:', message);
      return { success: false, error: message };
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

export const sendGroupInviteEmail = async (data: GroupInviteEmailData): Promise<EmailResult> => {
  return invokeSendEmail('group_invite', data);
};
