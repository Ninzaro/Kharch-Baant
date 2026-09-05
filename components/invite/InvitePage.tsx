import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/SupabaseAuthContext';
import { SignIn } from '@clerk/clerk-react';
import { EMAIL_ONLY_CLERK_APPEARANCE } from '../auth/clerkAppearance';
import { validateInvite, acceptInvite } from '../../services/supabaseApiService';
import { supabase } from '../../lib/supabase';
import type { Group, Person } from '../../types';
import Avatar from '../Avatar';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '../../services/queries';
import { useAppStore } from '../../store/appStore';

type InviteStatus = 'loading' | 'invalid' | 'valid' | 'accepted' | 'error';

const InvitePage: React.FC = () => {
  const { user, person, isSyncing } = useAuth();
  const qc = useQueryClient();
  const setSelectedGroupId = useAppStore(s => s.setSelectedGroupId);

  const [status, setStatus] = useState<InviteStatus>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [token, setToken] = useState<string>('');
  const [group, setGroup] = useState<Group | null>(null);
  const [inviter, setInviter] = useState<Person | null>(null);
  const [members, setMembers] = useState<Person[]>([]);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ current: number; max: number | null } | null>(null);
  const [emailInvites, setEmailInvites] = useState<{ email: string }[]>([]);
  const [emailInvitesLoaded, setEmailInvitesLoaded] = useState(false);

  // Parse token from URL
  useEffect(() => {
    const m = window.location.pathname.match(/^\/invite\/(.+)$/);
    const t = m ? decodeURIComponent(m[1]) : '';
    setToken(t);
  }, []);

  // Validate invite and fetch preview data
  useEffect(() => {
    const run = async () => {
      if (!token) return;
      setStatus('loading');
      try {
        const result = await validateInvite(token);
        if (!result?.isValid || !result.group) {
          setStatus('invalid');
          setErrorMsg(result?.error || 'This invite link is invalid or expired.');
          return;
        }
        setGroup(result.group);
        // Metadata + inviter/emails come from get_invite_preview RPC (no open table SELECTs)
        const inviteAny = result.invite || null;
        if (inviteAny) {
          setExpiresAt(inviteAny.expiresAt || null);
          const currentUses = inviteAny.currentUses ?? null;
          const maxUses = inviteAny.maxUses ?? null;
          if (currentUses !== null || maxUses !== null) {
            setUsage({
              current: Number(currentUses || 0),
              max: maxUses === null || maxUses === undefined ? null : Number(maxUses),
            });
          }
        }
        if (result.inviter) {
          setInviter({
            id: result.inviter.id,
            name: result.inviter.name,
            avatarUrl: result.inviter.avatarUrl || '',
          });
        }
        setEmailInvites(result.emailInvites || []);
        setEmailInvitesLoaded(true);
        // Members preview (may be empty pre-auth under RLS — invite still valid)
        try {
          const { data: membersRows } = await supabase
            .from('group_members')
            .select('person_id, people:person_id ( id, name, avatar_url )')
            .eq('group_id', result.group.id);
          const people: Person[] = (membersRows || [])
            .filter((r: any) => r?.people?.id)
            .map((r: any) => ({
              id: r.people.id,
              name: r.people.name,
              avatarUrl: r.people.avatar_url,
            }));
          setMembers(people);
        } catch {
          setMembers([]);
        }
        setStatus('valid');
      } catch (e: any) {
        setStatus('error');
        setErrorMsg(e?.message || 'Failed to validate invite.');
      }
    };
    run();
  }, [token]);

  // Determine if logged-in user's email matches any targeted email invites
  const emailMatch = useMemo(() => {
    const userEmail = user?.email?.toLowerCase().trim();
    if (!userEmail) return false;
    if (!emailInvitesLoaded) return false;
    if (emailInvites.length === 0) return false; // Only auto-join when specific emails were invited
    return emailInvites.some(e => e.email === userEmail);
  }, [user, emailInvites, emailInvitesLoaded]);

  // Auto-accept only if email matches a targeted email invite
  useEffect(() => {
    const acceptIfReady = async () => {
      if (!token || status !== 'valid') return;
      if (!user || !person || isSyncing) return;
      if (!emailInvitesLoaded || !emailMatch) return; // Gate auto-join
      try {
        // Also leave a breadcrumb for legacy flow
        localStorage.setItem('pendingInviteToken', token);
        const res = await acceptInvite({ inviteToken: token, personId: person.id });
        if (res.success) {
          toast.success(`Joined group "${res.group?.name || group?.name || ''}"`);
          // Refresh groups and select joined group
          await qc.invalidateQueries({ queryKey: qk.groups(person.id) });
          const gid = res.group?.id || group?.id;
          if (gid) setSelectedGroupId(gid);
          setStatus('accepted');
          // Clean URL
          window.history.replaceState({}, '', '/');
        } else {
          toast.error(res.error || 'Failed to join group');
        }
      } catch (e: any) {
        toast.error(e?.message || 'Failed to accept invite');
      }
    };
    acceptIfReady();
  }, [user, person, isSyncing, status, token, qc, group, setSelectedGroupId, emailMatch, emailInvitesLoaded]);

  const expiresText = useMemo(() => {
    if (!expiresAt) return null;
    const now = new Date();
    const exp = new Date(expiresAt);
    const diffMs = exp.getTime() - now.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffMs <= 0) return 'Expired';
    return `Expires in ${days} day${days === 1 ? '' : 's'}`;
  }, [expiresAt]);

  const usageText = useMemo(() => {
    if (!usage) return null;
    if (usage.max === null) return `Uses: ${usage.current} / ∞`;
    return `Uses: ${usage.current} / ${usage.max}`;
  }, [usage]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/40 to-background flex items-center justify-center p-4">
      <div className="bg-foreground/10 backdrop-blur-md p-6 md:p-8 rounded-2xl shadow-xl border border-border max-w-3xl w-full">
        {status === 'loading' && (
          <div className="text-center text-muted-foreground">Validating invite...</div>
        )}

        {(status === 'invalid' || status === 'error') && (
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-2">Invite Link Problem</h1>
            <p className="text-muted-foreground mb-4">{errorMsg}</p>
            <button
              onClick={() => (window.location.href = '/')}
              className="px-4 py-2 bg-foreground/10 hover:bg-foreground/20 border border-border rounded-lg text-foreground"
            >
              Go to Home
            </button>
          </div>
        )}

        {status !== 'loading' && status !== 'invalid' && status !== 'error' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Preview */}
            <div>
              <h2 className="text-xl font-bold text-foreground mb-1">You're invited</h2>
              <p className="text-muted-foreground mb-4">Join group{group ? ` "${group.name}"` : ''}</p>

              <div className="bg-overlay/20 border border-border rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-muted-foreground text-sm">Group</span>
                  <span className="text-foreground font-semibold">{group?.name || '—'}</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-muted-foreground text-sm">Currency</span>
                  <span className="text-foreground">{group?.currency || '—'}</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-muted-foreground text-sm">Type</span>
                  <span className="text-foreground">{group?.groupType || '—'}</span>
                </div>
                <div className="mb-3">
                  <div className="text-muted-foreground text-sm mb-2">Members</div>
                  <div className="flex -space-x-2">
                    {members.slice(0, 8).map(m => (
                      <Avatar key={m.id} id={m.id} name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                    ))}
                    {members.length > 8 && (
                      <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground ring-2 ring-border">
                        +{members.length - 8}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {expiresText && (
                    <span className="px-2 py-1 rounded-full bg-foreground/5 border border-border text-muted-foreground">{expiresText}</span>
                  )}
                  {usageText && (
                    <span className="px-2 py-1 rounded-full bg-foreground/5 border border-border text-muted-foreground">{usageText}</span>
                  )}
                </div>
                {inviter && (
                  <div className="mt-3 text-muted-foreground text-sm">Invited by <span className="text-foreground font-medium">{inviter.name}</span></div>
                )}
              </div>

              {status === 'accepted' && (
                <div className="mt-2 text-success text-sm">You have joined this group.</div>
              )}
            </div>

            {/* Auth / Join */}
            <div>
              {!user ? (
                <div>
                  <div className="bg-overlay/20 border border-border rounded-xl p-4 flex flex-col items-center">
                    <SignIn
                      routing="virtual"
                      fallbackRedirectUrl={window.location.href}
                      signUpFallbackRedirectUrl={window.location.href}
                      appearance={EMAIL_ONLY_CLERK_APPEARANCE}
                    />
                  </div>
                </div>
              ) : (

                <div className="bg-overlay/20 border border-border rounded-xl p-4">
                  <div className="text-muted-foreground mb-3">Signed in as <span className="text-foreground font-medium">{user?.email || 'you'}</span></div>
                  {emailInvitesLoaded && emailInvites.length > 0 && emailMatch && status !== 'accepted' && (
                    <div className="text-xs text-success mb-3">Your email matches this invite. Joining automatically...</div>
                  )}
                  {emailInvitesLoaded && emailInvites.length > 0 && !emailMatch && status !== 'accepted' && (
                    <div className="text-xs text-amber-300 mb-3">This link was sent to specific emails; your email is not on the list. You can still request to join using the button below.</div>
                  )}
                  {!emailMatch && (
                    <button
                      disabled={status !== 'valid' || status === 'accepted'}
                      onClick={async () => {
                        if (!person || !token) return;
                        try {
                          const res = await acceptInvite({ inviteToken: token, personId: person.id });
                          if (res.success) {
                            toast.success('Joined group');
                            await qc.invalidateQueries({ queryKey: qk.groups(person.id) });
                            const gid = res.group?.id || group?.id;
                            if (gid) setSelectedGroupId(gid);
                            setStatus('accepted');
                            window.history.replaceState({}, '', '/');
                          } else {
                            toast.error(res.error || 'Failed to join');
                          }
                        } catch (e: any) {
                          toast.error(e?.message || 'Failed to join');
                        }
                      }}
                      className="w-full px-4 py-2 bg-gradient-to-br from-success to-success hover:from-success/90 hover:to-success/80 text-success-foreground rounded-lg font-medium"
                    >
                      {status === 'accepted' ? 'Joined' : 'Join Group'}
                    </button>
                  )}
                  {emailMatch && status === 'accepted' && (
                    <div className="text-xs text-success">Successfully joined.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvitePage;
