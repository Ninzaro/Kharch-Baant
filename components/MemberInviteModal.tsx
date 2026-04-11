import React, { useState, useRef, useEffect, useCallback } from 'react';
import BaseModal from './BaseModal';
import { Person } from '../types';
import { addPersonToGroup, addPerson, findPersonByEmail } from '../services/apiService';

export interface MemberInviteModalProps {
  open: boolean;
  groupId?: string;
  existingPeople: Person[];
  onClose(): void;
  onAdded(person: Person): void;
}

const MemberInviteModal: React.FC<MemberInviteModalProps> = ({ open, groupId, existingPeople, onClose, onAdded }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [matchedPerson, setMatchedPerson] = useState<Person | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setMatchedPerson(null);
      setError(null);
    }
  }, [open]);

  const handleEmailChange = useCallback((value: string) => {
    setEmail(value);
    setMatchedPerson(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (!value || !value.includes('@')) return;

    lookupTimer.current = setTimeout(async () => {
      setLookingUp(true);
      try {
        const found = await findPersonByEmail(value.trim().toLowerCase());
        setMatchedPerson(found);
      } catch {
        // Lookup failure is non-critical; continue as new person
      } finally {
        setLookingUp(false);
      }
    }, 300);
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!matchedPerson && !name.trim()) {
      setError('Name is required');
      return;
    }

    const alreadyInGroup = matchedPerson && existingPeople.some(p => p.id === matchedPerson.id);
    if (alreadyInGroup) {
      setError('This person is already in the group.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let person: Person;
      if (groupId) {
        person = await addPersonToGroup(groupId, {
          name: matchedPerson ? matchedPerson.name : name.trim(),
          email: email.trim().toLowerCase() || undefined,
        });
      } else {
        person = matchedPerson ?? await addPerson({
          name: name.trim(),
          email: email.trim().toLowerCase() || undefined,
          avatarUrl: `https://i.pravatar.cc/150?u=${encodeURIComponent(name.trim())}`,
          source: 'manual',
        });
      }
      onAdded(person);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add member');
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      <button
        type="button"
        onClick={onClose}
        className="px-4 py-2 rounded-md bg-white/10 text-slate-200 hover:bg-white/20 disabled:opacity-50"
        disabled={submitting}
      >
        Cancel
      </button>
      <button
        type="submit"
        form="member-invite-form"
        className="px-4 py-2 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 flex items-center gap-2"
        disabled={submitting || (!matchedPerson && !name.trim())}
      >
        {submitting && <span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />}
        Add Member
      </button>
    </>
  );

  return (
    <BaseModal
      open={open}
      onClose={() => { if (!submitting) onClose(); }}
      title="Add Member"
      size="sm"
      initialFocusRef={inputRef}
      description={<span className="text-sm text-slate-300">Add a person to this group.</span>}
      footer={footer}
    >
      <form id="member-invite-form" onSubmit={handleSubmit} className="space-y-5" autoComplete="off">
        {/* Email first — drives the lookup */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Email (optional)</label>
          <input
            type="email"
            value={email}
            onChange={e => handleEmailChange(e.target.value)}
            placeholder="rahul@example.com"
            className="w-full bg-black/30 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500"
          />
          {lookingUp && (
            <p className="mt-1 text-xs text-slate-400">Checking...</p>
          )}
          {matchedPerson?.isClaimed && (
            <div className="mt-2 flex items-center gap-2 bg-emerald-900/30 border border-emerald-700/40 rounded-md px-3 py-2">
              <span className="text-emerald-400 text-xs font-medium">✓ Already on Kharch Baant</span>
              <span className="text-slate-300 text-xs">{matchedPerson.name} will be added directly.</span>
            </div>
          )}
          {matchedPerson && !matchedPerson.isClaimed && (
            <div className="mt-2 flex items-center gap-2 bg-amber-900/30 border border-amber-700/40 rounded-md px-3 py-2">
              <span className="text-amber-400 text-xs font-medium">Already a contact</span>
              <span className="text-slate-300 text-xs">{matchedPerson.name} — they'll be invited to this group.</span>
            </div>
          )}
          {!matchedPerson && email && !lookingUp && email.includes('@') && (
            <p className="mt-1 text-xs text-slate-500">Not found — a new contact will be created.</p>
          )}
        </div>

        {/* Name field: hidden when a matched person exists */}
        {!matchedPerson && (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Priya"
              className="w-full bg-black/30 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-500 focus:ring-indigo-500 focus:border-indigo-500"
              required={!matchedPerson}
            />
          </div>
        )}

        {error && (
          <div className="text-sm text-rose-400 bg-rose-900/30 border border-rose-700/40 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </form>
    </BaseModal>
  );
};

export default MemberInviteModal;
