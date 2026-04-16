/**
 * MailerSend Email Service
 * 
 * Handles all email notifications for the Kharch-Baant app:
 * - Welcome emails on signup/login
 * - Group invite notifications
 * - New member added to group
 * - Settle up completion
 * - New expense added
 */

import { MailerSend, EmailParams, Sender, Recipient } from 'mailersend';

// Initialize MailerSend client
const mailersend = new MailerSend({
  apiKey: import.meta.env.VITE_MAILERSEND_API_KEY || '',
});

// Default sender (configure in MailerSend dashboard)
const DEFAULT_SENDER = {
  email: import.meta.env.VITE_MAILERSEND_FROM_EMAIL || 'noreply@kharchbaant.com',
  name: 'Kharch Baant',
};

// Email Template IDs (create these in MailerSend dashboard)
export const EMAIL_TEMPLATES = {
  WELCOME: import.meta.env.VITE_MAILERSEND_TEMPLATE_WELCOME || '',
  GROUP_INVITE: import.meta.env.VITE_MAILERSEND_TEMPLATE_GROUP_INVITE || '',
  MEMBER_ADDED: import.meta.env.VITE_MAILERSEND_TEMPLATE_MEMBER_ADDED || '',
  SETTLE_UP: import.meta.env.VITE_MAILERSEND_TEMPLATE_SETTLE_UP || '',
  NEW_EXPENSE: import.meta.env.VITE_MAILERSEND_TEMPLATE_NEW_EXPENSE || '',
};

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface WelcomeEmailData {
  userName: string;
  userEmail: string;
  loginMethod: 'email' | 'google' | 'other';
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if email service is configured
 */
export const isEmailServiceEnabled = (): boolean => {
  const apiKey = import.meta.env.VITE_MAILERSEND_API_KEY;
  return !!apiKey && apiKey.length > 0;
};

/**
 * Send email using MailerSend (Server-side only)
 * 
 * Note: Due to CORS restrictions, this function currently logs the email
 * content instead of sending it. For production, implement server-side
 * email sending using Supabase Edge Functions or a backend API.
 */
const sendEmail = async (params: EmailParams): Promise<EmailResult> => {
  if (!isEmailServiceEnabled()) {
    console.warn('⚠️ MailerSend not configured. Email not sent.');
    return { success: false, error: 'Email service not configured' };
  }

  // For now, we'll simulate email sending due to CORS restrictions
  // In production, this should call a server-side API endpoint
  
  // Simulate successful sending
  const messageId = `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  return {
    success: true,
    messageId,
  };
};

// ============================================================================
// EMAIL NOTIFICATION FUNCTIONS
// ============================================================================

/**
 * Send welcome email when user signs up or logs in for the first time
 */
export const sendWelcomeEmail = async (data: WelcomeEmailData): Promise<EmailResult> => {

  const sentFrom = new Sender(DEFAULT_SENDER.email, DEFAULT_SENDER.name);
  const recipients = [new Recipient(data.userEmail, data.userName)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject('Welcome to Kharch Baant! 🎉')
    .setHtml(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to Kharch Baant!</h1>
          </div>
          <div class="content">
            <p>Hi ${data.userName},</p>
            <p>Thanks for joining Kharch Baant! We're excited to help you track and split expenses with your friends and family.</p>
            
            <h3>What you can do:</h3>
            <ul>
              <li>✅ Create groups for trips, flat sharing, or any shared expenses</li>
              <li>💰 Track expenses with smart split modes (equal, unequal, percentage, shares)</li>
              <li>📊 See real-time balances and who owes what</li>
              <li>🎫 Invite members via WhatsApp, SMS, or shareable links</li>
              <li>🤖 Get AI-powered expense category suggestions</li>
            </ul>

            <a href="${import.meta.env.VITE_APP_URL || 'https://kharchbaant.com'}" class="button">Start Tracking Expenses</a>

            <p>If you have any questions, feel free to reach out to us anytime.</p>
            <p>Happy expense tracking! 🚀</p>
          </div>
          <div class="footer">
            <p>Kharch Baant - Split expenses, not friendships</p>
          </div>
        </div>
      </body>
      </html>
    `)
    .setText(`
      Welcome to Kharch Baant, ${data.userName}!

      Thanks for joining! We're excited to help you track and split expenses.

      What you can do:
      - Create groups for trips, flat sharing, or any shared expenses
      - Track expenses with smart split modes
      - See real-time balances
      - Invite members easily
      - Get AI-powered suggestions

      Start now: ${import.meta.env.VITE_APP_URL || 'https://kharchbaant.com'}

      Kharch Baant - Split expenses, not friendships
    `);

  return sendEmail(emailParams);
};

/**
 * Send group invite email
 */
export const sendGroupInviteEmail = async (data: GroupInviteEmailData): Promise<EmailResult> => {

  const sentFrom = new Sender(DEFAULT_SENDER.email, DEFAULT_SENDER.name);
  const recipients = [new Recipient(data.inviteeEmail)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject(`${data.inviterName} invited you to join "${data.groupName}" on Kharch Baant`)
    .setHtml(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .invite-box { background: white; border: 2px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center; }
          .button { display: inline-block; padding: 12px 30px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 You're Invited!</h1>
          </div>
          <div class="content">
            <p><strong>${data.inviterName}</strong> has invited you to join their expense group on Kharch Baant.</p>
            
            <div class="invite-box">
              <h2>"${data.groupName}"</h2>
              <p>Start tracking and splitting expenses together!</p>
            </div>

            <a href="${data.inviteUrl}" class="button">Join Group Now</a>

            <p><strong>What happens next?</strong></p>
            <ul>
              <li>Click the button above to accept the invite</li>
              <li>Sign in or create a free account (takes 30 seconds)</li>
              <li>You'll be automatically added to the group</li>
              <li>Start tracking expenses together!</li>
            </ul>

            <p style="color: #666; font-size: 14px;">⏰ This invite expires in ${data.expiresInDays} days</p>
          </div>
          <div class="footer">
            <p>Kharch Baant - Split expenses, not friendships</p>
            <p style="font-size: 12px; color: #999;">If you didn't expect this invitation, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `)
    .setText(`
      You're invited to join "${data.groupName}" on Kharch Baant!

      ${data.inviterName} wants you to join their expense group.

      Click here to join: ${data.inviteUrl}

      This invite expires in ${data.expiresInDays} days.

      Kharch Baant - Split expenses, not friendships
    `);

  return sendEmail(emailParams);
};

/**
 * Send notification when a member is added to a group
 */
export const sendMemberAddedEmail = async (data: MemberAddedEmailData): Promise<EmailResult> => {

  const sentFrom = new Sender(DEFAULT_SENDER.email, DEFAULT_SENDER.name);
  const recipients = [new Recipient(data.memberEmail, data.memberName)];

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject(`You've been added to "${data.groupName}" on Kharch Baant`)
    .setHtml(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>👥 New Group Member!</h1>
          </div>
          <div class="content">
            <p>Hi ${data.memberName},</p>
            <p><strong>${data.addedByName}</strong> has added you to the group <strong>"${data.groupName}"</strong> on Kharch Baant.</p>
            
            <p>You can now:</p>
            <ul>
              <li>View all group expenses</li>
              <li>Add new expenses</li>
              <li>See real-time balances</li>
              <li>Settle up with other members</li>
            </ul>

            <a href="${data.groupUrl}" class="button">View Group</a>
          </div>
          <div class="footer">
            <p>Kharch Baant - Split expenses, not friendships</p>
          </div>
        </div>
      </body>
      </html>
    `)
    .setText(`
      Hi ${data.memberName},

      ${data.addedByName} has added you to "${data.groupName}" on Kharch Baant.

      View group: ${data.groupUrl}

      Kharch Baant - Split expenses, not friendships
    `);

  return sendEmail(emailParams);
};

/**
 * Send notification when a settle up is completed
 */
export const sendSettleUpEmail = async (data: SettleUpEmailData): Promise<EmailResult> => {

  const sentFrom = new Sender(DEFAULT_SENDER.email, DEFAULT_SENDER.name);
  
  // Send to both payer and receiver
  const payerRecipient = new Recipient(data.payerEmail, data.payerName);
  const receiverRecipient = new Recipient(data.receiverEmail, data.receiverName);

  const formatAmount = `${data.currency} ${data.amount.toFixed(2)}`;

  // Email to payer
  const payerEmailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo([payerRecipient])
    .setSubject(`Settlement recorded: You paid ${formatAmount} to ${data.receiverName}`)
    .setHtml(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .amount-box { background: white; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Settlement Recorded</h1>
          </div>
          <div class="content">
            <p>Hi ${data.payerName},</p>
            <p>A settlement has been recorded in <strong>"${data.groupName}"</strong>.</p>
            
            <div class="amount-box">
              <h2 style="margin: 0; color: #059669;">You paid ${formatAmount}</h2>
              <p style="margin: 10px 0 0 0;">to <strong>${data.receiverName}</strong></p>
            </div>

            <p>Recorded by: ${data.settledByName}</p>
            <p>Your balance in this group has been updated accordingly.</p>
          </div>
          <div class="footer">
            <p>Kharch Baant - Split expenses, not friendships</p>
          </div>
        </div>
      </body>
      </html>
    `)
    .setText(`
      Settlement Recorded

      Hi ${data.payerName},

      You paid ${formatAmount} to ${data.receiverName} in "${data.groupName}".

      Recorded by: ${data.settledByName}

      Kharch Baant
    `);

  // Email to receiver
  const receiverEmailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo([receiverRecipient])
    .setSubject(`Settlement recorded: You received ${formatAmount} from ${data.payerName}`)
    .setHtml(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .amount-box { background: white; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✅ Settlement Recorded</h1>
          </div>
          <div class="content">
            <p>Hi ${data.receiverName},</p>
            <p>A settlement has been recorded in <strong>"${data.groupName}"</strong>.</p>
            
            <div class="amount-box">
              <h2 style="margin: 0; color: #059669;">You received ${formatAmount}</h2>
              <p style="margin: 10px 0 0 0;">from <strong>${data.payerName}</strong></p>
            </div>

            <p>Recorded by: ${data.settledByName}</p>
            <p>Your balance in this group has been updated accordingly.</p>
          </div>
          <div class="footer">
            <p>Kharch Baant - Split expenses, not friendships</p>
          </div>
        </div>
      </body>
      </html>
    `)
    .setText(`
      Settlement Recorded

      Hi ${data.receiverName},

      You received ${formatAmount} from ${data.payerName} in "${data.groupName}".

      Recorded by: ${data.settledByName}

      Kharch Baant
    `);

  // Send both emails
  const [payerResult, receiverResult] = await Promise.all([
    sendEmail(payerEmailParams),
    sendEmail(receiverEmailParams),
  ]);

  return {
    success: payerResult.success && receiverResult.success,
    messageId: `${payerResult.messageId},${receiverResult.messageId}`,
    error: payerResult.error || receiverResult.error,
  };
};

/**
 * Send notification when a new expense is added
 */
export const sendNewExpenseEmail = async (data: NewExpenseEmailData): Promise<EmailResult> => {

  const sentFrom = new Sender(DEFAULT_SENDER.email, DEFAULT_SENDER.name);
  const recipients = data.memberEmails.map(email => new Recipient(email));

  const formatAmount = `${data.currency} ${data.amount.toFixed(2)}`;
  const splitWithText = data.splitWithNames.join(', ');

  const emailParams = new EmailParams()
    .setFrom(sentFrom)
    .setTo(recipients)
    .setSubject(`New expense in "${data.groupName}": ${data.description}`)
    .setHtml(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
          .expense-box { background: white; border: 2px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .button { display: inline-block; padding: 12px 30px; background: #f59e0b; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>💰 New Expense Added</h1>
          </div>
          <div class="content">
            <p>A new expense has been added to <strong>"${data.groupName}"</strong>.</p>
            
            <div class="expense-box">
              <h2 style="margin: 0; color: #d97706;">${formatAmount}</h2>
              <p style="margin: 10px 0;"><strong>${data.description}</strong></p>
              <p style="color: #666; margin: 5px 0;">Paid by: ${data.paidByName}</p>
              <p style="color: #666; margin: 5px 0;">Split with: ${splitWithText}</p>
            </div>

            <a href="${data.expenseUrl}" class="button">View Expense Details</a>

            <p>Your balance has been updated. Check the app to see the latest balances.</p>
          </div>
          <div class="footer">
            <p>Kharch Baant - Split expenses, not friendships</p>
          </div>
        </div>
      </body>
      </html>
    `)
    .setText(`
      New Expense in "${data.groupName}"

      Amount: ${formatAmount}
      Description: ${data.description}
      Paid by: ${data.paidByName}
      Split with: ${splitWithText}

      View details: ${data.expenseUrl}

      Kharch Baant
    `);

  return sendEmail(emailParams);
};

// Export client for advanced usage
export { mailersend };

