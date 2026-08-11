/**
 * Supabase Edge Function: Send Email
 *
 * MailerSend API key lives only in function secrets (MAILERSEND_API_KEY).
 * Never expose that key to the browser or mobile app.
 *
 * Deploy:
 *   supabase secrets set MAILERSEND_API_KEY=mlsn.... MAILERSEND_FROM_EMAIL=noreply@...
 *   # production:
 *   supabase secrets set ALLOWED_ORIGINS=https://your-domain.com
 *   # optional HS256 fallback for Clerk JWT:
 *   supabase secrets set SUPABASE_JWT_SECRET=your-jwt-secret
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
  type: 'welcome' | 'group_invite' | 'member_added' | 'settle_up' | 'new_expense';
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

const MAX_RECIPIENTS = 25;
const MAX_STRING = 500;

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

  // Per-user abuse cap (per isolate; still blocks naive spam loops)
  if (!rateLimit(`email:${sub}`, 20, 60_000)) {
    return jsonResponse({ error: 'Rate limit exceeded' }, 429, cors);
  }

  try {
    const { type, data }: EmailRequest = await req.json();

    const mailersendApiKey = Deno.env.get('MAILERSEND_API_KEY');
    const fromEmail = Deno.env.get('MAILERSEND_FROM_EMAIL');

    if (!mailersendApiKey || !fromEmail) {
      return jsonResponse({ error: 'MailerSend not configured on server' }, 503, cors);
    }

    if (!type || !data || typeof data !== 'object') {
      return jsonResponse({ error: 'Invalid payload' }, 400, cors);
    }

    let emailPayload: Record<string, unknown> | null = null;

    switch (type) {
      case 'welcome': {
        const userName = escapeHtml(clip(data.userName, 120));
        const userEmail = String(data.userEmail || '').trim();
        const appUrl = escapeHtml(clip(data.appUrl || 'https://kharchbaant.com', 300));
        if (!isValidEmail(userEmail)) return jsonResponse({ error: 'userEmail required' }, 400, cors);
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: [{ email: userEmail, name: clip(data.userName, 120) }],
          subject: 'Welcome to Kharch Baant! 🎉',
          html: `<p>Hi ${userName},</p><p>Thanks for joining Kharch Baant!</p><p><a href="${appUrl}">Open the app</a></p>`,
          text: `Hi ${clip(data.userName)}, thanks for joining Kharch Baant! ${clip(data.appUrl || '')}`,
        };
        break;
      }

      case 'group_invite': {
        const inviteeEmail = String(data.inviteeEmail || '').trim();
        const inviterName = escapeHtml(clip(data.inviterName, 120));
        const groupName = escapeHtml(clip(data.groupName, 120));
        const inviteUrl = escapeHtml(clip(data.inviteUrl, 500));
        const expiresInDays = Number(data.expiresInDays ?? 30);
        if (!isValidEmail(inviteeEmail) || !data.inviteUrl) {
          return jsonResponse({ error: 'invite fields required' }, 400, cors);
        }
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: [{ email: inviteeEmail }],
          subject: `${clip(data.inviterName, 80)} invited you to join "${clip(data.groupName, 80)}" on Kharch Baant`,
          html: `
            <p><strong>${inviterName}</strong> invited you to <strong>"${groupName}"</strong>.</p>
            <p><a href="${inviteUrl}">Join group</a></p>
            <p style="color:#666;font-size:14px">Invite expires in ${expiresInDays} days.</p>
          `,
          text: `${clip(data.inviterName)} invited you to "${clip(data.groupName)}". Join: ${clip(data.inviteUrl)}`,
        };
        break;
      }

      case 'member_added': {
        const memberEmail = String(data.memberEmail || '').trim();
        if (!isValidEmail(memberEmail)) {
          return jsonResponse({ error: 'memberEmail required' }, 400, cors);
        }
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: [{ email: memberEmail, name: clip(data.memberName, 120) }],
          subject: `You've been added to "${clip(data.groupName, 80)}" on Kharch Baant`,
          html: `
            <p>Hi ${escapeHtml(clip(data.memberName, 120))},</p>
            <p><strong>${escapeHtml(clip(data.addedByName, 120))}</strong> added you to
            <strong>"${escapeHtml(clip(data.groupName, 120))}"</strong>.</p>
            <p><a href="${escapeHtml(clip(data.groupUrl, 500))}">View group</a></p>
          `,
          text: `${clip(data.addedByName)} added you to "${clip(data.groupName)}". ${clip(data.groupUrl || '')}`,
        };
        break;
      }

      case 'settle_up': {
        const payerEmail = String(data.payerEmail || '').trim();
        const receiverEmail = String(data.receiverEmail || '').trim();
        const amount = Number(data.amount || 0);
        const currency = clip(data.currency || '', 12);
        const formatAmount = `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
        if (!isValidEmail(payerEmail) || !isValidEmail(receiverEmail)) {
          return jsonResponse({ error: 'payer/receiver email required' }, 400, cors);
        }

        const sendOne = async (to: string, toName: string, subject: string, body: string) => {
          const res = await fetch('https://api.mailersend.com/v1/email', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${mailersendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: { email: fromEmail, name: 'Kharch Baant' },
              to: [{ email: to, name: toName }],
              subject,
              html: `<p>${escapeHtml(body)}</p>`,
              text: body,
            }),
          });
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText);
          }
          return res.json().catch(() => ({}));
        };

        const payerBody = `You paid ${formatAmount} to ${clip(data.receiverName)} in "${clip(data.groupName)}" (recorded by ${clip(data.settledByName)}).`;
        const receiverBody = `You received ${formatAmount} from ${clip(data.payerName)} in "${clip(data.groupName)}" (recorded by ${clip(data.settledByName)}).`;

        const [a, b] = await Promise.all([
          sendOne(payerEmail, clip(data.payerName, 120), `Settlement: you paid ${formatAmount}`, payerBody),
          sendOne(
            receiverEmail,
            clip(data.receiverName, 120),
            `Settlement: you received ${formatAmount}`,
            receiverBody
          ),
        ]);

        return jsonResponse(
          {
            success: true,
            messageId: [a?.id, b?.id].filter(Boolean).join(',') || undefined,
          },
          200,
          cors
        );
      }

      case 'new_expense': {
        const emails = Array.isArray(data.memberEmails)
          ? (data.memberEmails as string[])
              .map((e) => String(e || '').trim())
              .filter((e) => isValidEmail(e))
              .slice(0, MAX_RECIPIENTS)
          : [];
        if (emails.length === 0) {
          return jsonResponse({ error: 'memberEmails required' }, 400, cors);
        }
        const amount = Number(data.amount || 0);
        const currency = clip(data.currency || '', 12);
        const formatAmount = `${currency} ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
        const splitWith = Array.isArray(data.splitWithNames)
          ? (data.splitWithNames as string[]).map((n) => clip(n, 80)).join(', ')
          : '';
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: emails.map((email) => ({ email })),
          subject: `New expense in "${clip(data.groupName, 80)}": ${clip(data.description, 80)}`,
          html: `
            <p>New expense in <strong>${escapeHtml(clip(data.groupName, 120))}</strong></p>
            <p><strong>${escapeHtml(formatAmount)}</strong> — ${escapeHtml(clip(data.description, 200))}</p>
            <p>Paid by: ${escapeHtml(clip(data.paidByName, 120))} · Split with: ${escapeHtml(splitWith)}</p>
            <p><a href="${escapeHtml(clip(data.expenseUrl, 500))}">View details</a></p>
          `,
          text: `New expense in ${clip(data.groupName)}: ${formatAmount} ${clip(data.description)}. Paid by ${clip(data.paidByName)}.`,
        };
        break;
      }

      default:
        return jsonResponse({ error: 'Unsupported email type' }, 400, cors);
    }

    if (!emailPayload) {
      return jsonResponse({ error: 'No payload' }, 400, cors);
    }

    const response = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mailersendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('MailerSend API error:', errorText);
      return jsonResponse({ error: 'Failed to send email' }, 502, cors);
    }

    const result = await response.json().catch(() => ({}));
    return jsonResponse({ success: true, messageId: result.id }, 200, cors);
  } catch (error) {
    console.error('Email function error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500, cors);
  }
});
