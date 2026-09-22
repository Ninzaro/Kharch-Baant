/**
 * Supabase Edge Function: Send Email
 *
 * Brevo API key lives only in function secrets (BREVO_API_KEY).
 * Never expose that key to the browser or mobile app.
 *
 * Deploy:
 *   supabase secrets set BREVO_API_KEY=xkeysib-... BREVO_SENDER_EMAIL=noreply@...
 *   supabase functions deploy send-email
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import {
  corsHeadersFor,
  isValidEmail,
  jsonResponse,
  rateLimit,
  requireAuthSub,
} from '../_shared/auth.ts';

interface EmailRequest {
  type: 'group_invite';
  data: Record<string, unknown>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MAX_STRING = 500;
const APPROVED_INVITE_URL_PREFIXES = [
  'https://www.motamaati.in/',
  'https://motamaati.in/',
];

function clip(value: unknown, max = MAX_STRING): string {
  return String(value ?? '').slice(0, max);
}

serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const sub = await requireAuthSub(req);
  if (!sub) {
    return jsonResponse({ error: 'Unauthorized' }, 401, cors);
  }

  if (!(await rateLimit('email', sub, 20, 60_000))) {
    return jsonResponse({ error: 'Rate limit exceeded' }, 429, cors);
  }

  try {
    const { type, data }: EmailRequest = await req.json();

    const brevoApiKey = Deno.env.get('BREVO_API_KEY') || '';
    const fromEmail = Deno.env.get('BREVO_SENDER_EMAIL') || '';

    if (!brevoApiKey.startsWith('xkeysib-') || !isValidEmail(fromEmail)) {
      return jsonResponse({ error: 'Email is not configured on server' }, 503, cors);
    }

    if (!type || !data || typeof data !== 'object') {
      return jsonResponse({ error: 'Invalid payload' }, 400, cors);
    }

    let emailPayload: Record<string, unknown> | null = null;

    switch (type) {
      case 'group_invite': {
        const inviteeEmail = String(data.inviteeEmail || '').trim();
        const inviterName = escapeHtml(clip(data.inviterName, 120));
        const groupName = escapeHtml(clip(data.groupName, 120));
        const rawInviteUrl = String(data.inviteUrl || '').trim();
        const inviteUrl = escapeHtml(clip(rawInviteUrl, 500));
        const expiresInDays = Number(data.expiresInDays ?? 30);
        if (
          !isValidEmail(inviteeEmail) ||
          !APPROVED_INVITE_URL_PREFIXES.some(prefix => rawInviteUrl.startsWith(prefix))
        ) {
          return jsonResponse({ error: 'invite fields required' }, 400, cors);
        }
        emailPayload = {
          sender: { email: fromEmail, name: 'Kharch Baant' },
          to: [{ email: inviteeEmail }],
          subject: `${clip(data.inviterName, 80)} invited you to join "${clip(data.groupName, 80)}" on Kharch Baant`,
          htmlContent: `<p><strong>${inviterName}</strong> invited you to <strong>"${groupName}"</strong>.</p><p><a href="${inviteUrl}">Join group</a></p><p style="color:#666;font-size:14px">Invite expires in ${expiresInDays} days.</p>`,
          textContent: `${clip(data.inviterName)} invited you to "${clip(data.groupName)}". Join: ${clip(data.inviteUrl)}`,
        };
        break;
      }

      default:
        return jsonResponse({ error: 'Unsupported email type' }, 400, cors);
    }

    if (!emailPayload) {
      return jsonResponse({ error: 'No payload' }, 400, cors);
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      console.error('Brevo API error status:', response.status);
      return jsonResponse({ error: 'Failed to send email' }, 502, cors);
    }

    const result = await response.json().catch(() => ({}));
    return jsonResponse({ success: true, messageId: result.messageId }, 200, cors);
  } catch (error) {
    console.error('Email function error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500, cors);
  }
});
