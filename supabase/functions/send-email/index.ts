/**
 * Supabase Edge Function: Send Email
 *
 * MailerSend API key lives only in function secrets (MAILERSEND_API_KEY).
 * Never expose that key to the browser or mobile app.
 *
 * Deploy:
 *   supabase secrets set MAILERSEND_API_KEY=mlsn.... MAILERSEND_FROM_EMAIL=noreply@...
 *   supabase functions deploy send-email
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Require a bearer token (Clerk JWT via Supabase client). Prevents anonymous spam.
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 20) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { type, data }: EmailRequest = await req.json();

    const mailersendApiKey = Deno.env.get('MAILERSEND_API_KEY');
    const fromEmail = Deno.env.get('MAILERSEND_FROM_EMAIL');

    if (!mailersendApiKey || !fromEmail) {
      return json({ error: 'MailerSend not configured on server' }, 503);
    }

    if (!type || !data || typeof data !== 'object') {
      return json({ error: 'Invalid payload' }, 400);
    }

    let emailPayload: Record<string, unknown> | null = null;

    switch (type) {
      case 'welcome': {
        const userName = escapeHtml(data.userName);
        const userEmail = String(data.userEmail || '');
        const appUrl = escapeHtml(data.appUrl || 'https://kharchbaant.com');
        if (!userEmail) return json({ error: 'userEmail required' }, 400);
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: [{ email: userEmail, name: String(data.userName || '') }],
          subject: 'Welcome to Kharch Baant! 🎉',
          html: `<p>Hi ${userName},</p><p>Thanks for joining Kharch Baant!</p><p><a href="${appUrl}">Open the app</a></p>`,
          text: `Hi ${data.userName}, thanks for joining Kharch Baant! ${data.appUrl || ''}`,
        };
        break;
      }

      case 'group_invite': {
        const inviteeEmail = String(data.inviteeEmail || '');
        const inviterName = escapeHtml(data.inviterName);
        const groupName = escapeHtml(data.groupName);
        const inviteUrl = escapeHtml(data.inviteUrl);
        const expiresInDays = Number(data.expiresInDays ?? 30);
        if (!inviteeEmail || !data.inviteUrl) return json({ error: 'invite fields required' }, 400);
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: [{ email: inviteeEmail }],
          subject: `${String(data.inviterName)} invited you to join "${String(data.groupName)}" on Kharch Baant`,
          html: `
            <p><strong>${inviterName}</strong> invited you to <strong>"${groupName}"</strong>.</p>
            <p><a href="${inviteUrl}">Join group</a></p>
            <p style="color:#666;font-size:14px">Invite expires in ${expiresInDays} days.</p>
          `,
          text: `${data.inviterName} invited you to "${data.groupName}". Join: ${data.inviteUrl}`,
        };
        break;
      }

      case 'member_added': {
        const memberEmail = String(data.memberEmail || '');
        if (!memberEmail) return json({ error: 'memberEmail required' }, 400);
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: [{ email: memberEmail, name: String(data.memberName || '') }],
          subject: `You've been added to "${String(data.groupName)}" on Kharch Baant`,
          html: `
            <p>Hi ${escapeHtml(data.memberName)},</p>
            <p><strong>${escapeHtml(data.addedByName)}</strong> added you to
            <strong>"${escapeHtml(data.groupName)}"</strong>.</p>
            <p><a href="${escapeHtml(data.groupUrl)}">View group</a></p>
          `,
          text: `${data.addedByName} added you to "${data.groupName}". ${data.groupUrl || ''}`,
        };
        break;
      }

      case 'settle_up': {
        const payerEmail = String(data.payerEmail || '');
        const receiverEmail = String(data.receiverEmail || '');
        const amount = Number(data.amount || 0);
        const currency = String(data.currency || '');
        const formatAmount = `${currency} ${amount.toFixed(2)}`;
        if (!payerEmail || !receiverEmail) return json({ error: 'payer/receiver email required' }, 400);

        // Send two messages sequentially (MailerSend one-to-many is awkward for different subjects)
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
              html: `<p>${body}</p>`,
              text: body,
            }),
          });
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText);
          }
          return res.json().catch(() => ({}));
        };

        const payerBody = `You paid ${formatAmount} to ${data.receiverName} in "${data.groupName}" (recorded by ${data.settledByName}).`;
        const receiverBody = `You received ${formatAmount} from ${data.payerName} in "${data.groupName}" (recorded by ${data.settledByName}).`;

        const [a, b] = await Promise.all([
          sendOne(payerEmail, String(data.payerName || ''), `Settlement: you paid ${formatAmount}`, payerBody),
          sendOne(
            receiverEmail,
            String(data.receiverName || ''),
            `Settlement: you received ${formatAmount}`,
            receiverBody
          ),
        ]);

        return json({
          success: true,
          messageId: [a?.id, b?.id].filter(Boolean).join(',') || undefined,
        });
      }

      case 'new_expense': {
        const emails = Array.isArray(data.memberEmails)
          ? (data.memberEmails as string[]).filter(Boolean)
          : [];
        if (emails.length === 0) return json({ error: 'memberEmails required' }, 400);
        const amount = Number(data.amount || 0);
        const currency = String(data.currency || '');
        const formatAmount = `${currency} ${amount.toFixed(2)}`;
        const splitWith = Array.isArray(data.splitWithNames)
          ? (data.splitWithNames as string[]).join(', ')
          : '';
        emailPayload = {
          from: { email: fromEmail, name: 'Kharch Baant' },
          to: emails.map((email) => ({ email })),
          subject: `New expense in "${String(data.groupName)}": ${String(data.description)}`,
          html: `
            <p>New expense in <strong>${escapeHtml(data.groupName)}</strong></p>
            <p><strong>${escapeHtml(formatAmount)}</strong> — ${escapeHtml(data.description)}</p>
            <p>Paid by: ${escapeHtml(data.paidByName)} · Split with: ${escapeHtml(splitWith)}</p>
            <p><a href="${escapeHtml(data.expenseUrl)}">View details</a></p>
          `,
          text: `New expense in ${data.groupName}: ${formatAmount} ${data.description}. Paid by ${data.paidByName}.`,
        };
        break;
      }

      default:
        return json({ error: 'Unsupported email type' }, 400);
    }

    if (!emailPayload) {
      return json({ error: 'No payload' }, 400);
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
      return json({ error: 'Failed to send email', details: errorText }, 502);
    }

    const result = await response.json().catch(() => ({}));
    return json({ success: true, messageId: result.id });
  } catch (error) {
    console.error('Email function error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return json({ error: 'Internal server error', details: message }, 500);
  }
});
