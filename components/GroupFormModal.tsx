import React, { useState, useEffect } from 'react';
import { Group, Person, Currency, CURRENCIES, GroupType, GROUP_TYPES } from '../types';
import Avatar from './Avatar';
import { CloseIcon, PlusIcon, ShareIcon, CalendarIcon } from './icons/Icons';
import MemberInviteModal from './MemberInviteModal';
import BaseModal from './BaseModal';
import { createGroupInvite } from '../services/supabaseApiService';

interface GroupFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (group: Omit<Group, 'id'>) => void;
    group: Group | null;
    allPeople: Person[];
    currentUserId: string;
    currentUserName?: string;
    groupBalances?: Record<string, number>;
    allSettled?: boolean;
    userSettled?: boolean;
    isProcessingGroupAction?: boolean;
    onDeleteGroup?: () => void;
    onArchiveGroup?: () => void;
    onOpenPaymentSources?: () => void;
}

const GroupFormModal: React.FC<GroupFormModalProps> = ({
    isOpen,
    onClose,
    onSave,
    group,
    allPeople,
    currentUserId,
    currentUserName,
    groupBalances,
    allSettled,
    userSettled,
    isProcessingGroupAction,
    onDeleteGroup,
    onArchiveGroup,
    onOpenPaymentSources
}) => {
    const [name, setName] = useState('');
    const [members, setMembers] = useState<string[]>([currentUserId]);
    const [currency, setCurrency] = useState<Currency>('INR');
    const [groupType, setGroupType] = useState<GroupType>('other');
    const [tripStartDate, setTripStartDate] = useState('');
    const [tripEndDate, setTripEndDate] = useState('');
    const [enableCuteIcons, setEnableCuteIcons] = useState(true);
    const [showAddMemberModal, setShowAddMemberModal] = useState(false);
    // Local copy of people so we can optimistically add newly created person without parent refresh
    const [localPeople, setLocalPeople] = useState<Person[]>(allPeople);

    // Share modal state
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [shareData, setShareData] = useState<{ url: string; message: string; groupName: string } | null>(null);

    const requiresTripDates = (type: GroupType) => type === 'trip' || type === 'family_trip';

    useEffect(() => {
        console.log('GroupFormModal useEffect triggered with:', {
            group,
            isOpen,
            currentUserId,
            allPeopleCount: allPeople.length,
            localPeopleCount: localPeople.length
        });
        if (group) {
            console.log('Loading existing group data:', group);
            console.log('🔍 GroupFormModal - Received group update. Members:', group.members);
            setName(group.name);
            setMembers(group.members);
            setCurrency(group.currency);
            setGroupType(group.groupType);
            setTripStartDate(group.tripStartDate || '');
            setTripEndDate(group.tripEndDate || '');
            setEnableCuteIcons(group.enableCuteIcons !== false); // Default to true if undefined
        } else {
            console.log('Resetting form for new group, currentUserId:', currentUserId);
            setName('');
            setMembers([currentUserId]);
            setCurrency('INR');
            setGroupType('other');
            setTripStartDate('');
            setTripEndDate('');
            setEnableCuteIcons(true);
        }
    }, [group, currentUserId, isOpen]);

    // Keep local people in sync when upstream changes (except when we already added new ones locally)
    useEffect(() => {
        // naive merge by id to preserve any locally added entries
        setLocalPeople(prev => {
            const map = new Map(prev.map(p => [p.id, p]));
            for (const p of allPeople) map.set(p.id, p);

            // CRITICAL FIX: Ensure current user is always in localPeople
            // This fixes the issue where creator doesn't appear in members list
            const currentUserInMap = map.has(currentUserId);
            console.log('🔍 Current user in people map:', currentUserInMap, 'currentUserId:', currentUserId);

            if (!currentUserInMap && currentUserId) {
                // Find current user in allPeople or create a placeholder
                const currentUserFromAllPeople = allPeople.find(p => p.id === currentUserId);
                if (currentUserFromAllPeople) {
                    map.set(currentUserId, currentUserFromAllPeople);
                    console.log('✅ Added current user from allPeople to localPeople');
                } else {
                    console.warn('⚠️ Current user not found in allPeople, this might cause display issues');
                }
            }

            return Array.from(map.values());
        });
    }, [allPeople, currentUserId]);

    const handleGroupTypeChange = (value: GroupType) => {
        setGroupType(value);
        if (!requiresTripDates(value)) {
            setTripStartDate('');
            setTripEndDate('');
        }
    };

    const addMember = (personId: string) => {
        if (!members.includes(personId)) {
            setMembers(prev => [...prev, personId]);
        }
    };

    const removeMember = (personId: string) => {
        if (personId === currentUserId) return; // Cannot remove self
        setMembers(prev => prev.filter(id => id !== personId));
    };

    const handleSubmit = (e?: React.FormEvent | React.MouseEvent) => {
        e?.preventDefault();
        console.log('GroupFormModal handleSubmit called with:', { name, members, currency, groupType, tripStartDate, tripEndDate });

        if (!name || members.length === 0) {
            console.log('Validation failed: missing name or members');
            return;
        }

        if (requiresTripDates(groupType)) {
            if (!tripStartDate || !tripEndDate) {
                const today = new Date().toISOString().split('T')[0];
                if (!tripStartDate) {
                    console.log('Auto-setting trip start date to today');
                    setTripStartDate(today);
                }
                if (!tripEndDate) {
                    console.log('Auto-setting trip end date to today');
                    setTripEndDate(today);
                }
                alert('Trip dates were auto-set to today. Please adjust them as needed and save again.');
                return;
            }

            if (new Date(tripStartDate) > new Date(tripEndDate)) {
                alert('Trip start date cannot be after the end date.');
                return;
            }
        }

        const payload: Omit<Group, 'id'> = {
            name,
            members,
            currency,
            groupType,
            tripStartDate: requiresTripDates(groupType) ? tripStartDate : undefined,
            tripEndDate: requiresTripDates(groupType) ? tripEndDate : undefined,
            enableCuteIcons,
        };

        console.log('Calling onSave with payload:', payload);
        onSave(payload);
        // Don't call onClose() here - let the parent handle it after API success
    };

    const handleInvite = async () => {
        if (!group?.id) {
            alert('Please save the group first before creating an invite link.');
            return;
        }

        try {
            // Create a real invite link using the invite system
            const inviteResponse = await createGroupInvite({
                groupId: group.id,
                invitedBy: currentUserId,
                maxUses: null, // Unlimited uses
                expiresInDays: 30 // 30-day expiration
            });

            const inviteUrl = inviteResponse.inviteUrl;
            const message = `🎉 You're invited to join "${group.name}" on Kharch Baant!\n\nTrack and split expenses together easily. Click the link below to join:\n\n${inviteUrl}\n\n✨ New users can sign up instantly!\n⏰ Link expires in 30 days`;

            // Show share options modal
            setShareData({ url: inviteUrl, message, groupName: group.name });
            setIsShareModalOpen(true);
        } catch (error) {
            console.error('Failed to create invite link:', error);
            alert('Failed to create invite link. Please try again.');
        }
    };

    const handleWhatsAppShare = () => {
        if (!shareData) return;
        const encodedMessage = encodeURIComponent(shareData.message);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    };

    const handleSMSShare = () => {
        if (!shareData) return;
        const encodedMessage = encodeURIComponent(shareData.message);
        // For mobile devices, use sms: protocol
        window.location.href = `sms:?body=${encodedMessage}`;
    };

    const handleCopyLink = () => {
        if (!shareData) return;
        navigator.clipboard.writeText(shareData.message);
        alert('Invite message copied to clipboard!');
    };

    const handleNativeShare = async () => {
        if (!shareData) return;

        try {
            await navigator.share({
                title: 'Join my group on Kharch-Baant!',
                text: `Join "${shareData.groupName}" on Kharch-Baant to split expenses together.`,
                url: shareData.url
            });
        } catch (error) {
            // User cancelled or share not supported
            console.log('Share cancelled or not supported');
        }
    };

    if (!isOpen) return null;

    const peopleMap = new Map(localPeople.map(p => [p.id, p]));

    // CRITICAL FIX: Handle missing current user with fallback
    const currentMembers = members.map(id => {
        const person = peopleMap.get(id);
        if (!person && id === currentUserId) {
            const fallbackName = currentUserName || 'Me';
            return {
                id: currentUserId,
                name: fallbackName,
                avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(fallbackName)}&background=6366f1&color=ffffff`
            };
        }
        return person;
    }).filter(Boolean);

    const availableContacts = localPeople.filter(p => !members.includes(p.id));

    // Debug logging for member display issue
    console.log('🔍 GroupFormModal render debug:', {
        members,
        localPeople: localPeople.map(p => `${p.name} (${p.id})`),
        currentMembers: currentMembers.map(p => `${p.name} (${p.id})`),
        currentUserId,
        peopleMapSize: peopleMap.size
    });

    return (
        <>
            <BaseModal
                open={isOpen}
                onClose={onClose}
                title={group ? 'Group Settings' : 'Create Group'}
                size="md"
                description={<span className="text-slate-300 text-sm">Configure group details and manage members.</span>}
                footer={
                    <>
                        {/* Delete/Archive/Request Delete: only show if editing existing group */}
                        {group && (
                            <div className="flex flex-col gap-2 mb-2">
                                {group.createdBy === currentUserId ? (
                                    <button
                                        type="button"
                                        className="px-3 py-2 bg-red-600/90 hover:bg-red-500 text-white text-sm rounded-md disabled:opacity-50"
                                        disabled={!allSettled || isProcessingGroupAction}
                                        title={!allSettled ? 'All balances must be settled to delete the group.' : ''}
                                        onClick={onDeleteGroup}
                                    >
                                        {isProcessingGroupAction ? 'Deleting...' : 'Delete Group'}
                                    </button>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <button
                                            type="button"
                                            className="px-3 py-2 bg-rose-600/80 hover:bg-rose-500 text-white text-sm rounded-md disabled:opacity-50"
                                            disabled={!allSettled || isProcessingGroupAction}
                                            title={!allSettled ? 'All balances must be settled to request deletion.' : ''}
                                            onClick={onDeleteGroup}
                                        >
                                            {isProcessingGroupAction ? 'Requesting…' : 'Request Delete (ask admin)'}
                                        </button>
                                        <button
                                            type="button"
                                            className="px-3 py-2 bg-yellow-600/90 hover:bg-yellow-500 text-white text-sm rounded-md disabled:opacity-50"
                                            disabled={!userSettled || !allSettled || isProcessingGroupAction}
                                            title={!userSettled || !allSettled ? 'You must settle your balance and all balances must be settled to archive.' : ''}
                                            onClick={onArchiveGroup}
                                        >
                                            {isProcessingGroupAction ? 'Archiving...' : 'Archive Group'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-white/10 text-white rounded-md hover:bg-white/20">Cancel</button>
                        <button
                            type="submit"
                            form="group-form"
                            className="px-4 py-2 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-md hover:from-indigo-600 hover:to-purple-700"
                        >
                            Save Group
                        </button>
                    </>
                }
            >
                <form id="group-form" onSubmit={handleSubmit} className="flex-grow overflow-y-auto space-y-4 pr-2">
                    <div>
                        <label htmlFor="group-name" className="block text-sm font-medium text-slate-300 mb-1">Group Name</label>
                        <input
                            type="text"
                            id="group-name"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-600 text-white rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="currency" className="block text-sm font-medium text-slate-300 mb-1">Currency</label>
                        <select
                            id="currency"
                            value={currency}
                            onChange={e => setCurrency(e.target.value as Currency)}
                            className="w-full bg-slate-800 border border-slate-600 text-white rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.name} ({c.symbol})</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="group-type" className="block text-sm font-medium text-slate-300 mb-1">Group Type</label>
                        <select
                            id="group-type"
                            value={groupType}
                            onChange={e => handleGroupTypeChange(e.target.value as GroupType)}
                            className="w-full bg-slate-800 border border-slate-600 text-white rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                            {GROUP_TYPES.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>

                    {requiresTripDates(groupType) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="trip-start" className="block text-sm font-medium text-slate-300 mb-1">Trip Start Date</label>
                                <div className="relative">
                                    <input
                                        id="trip-start"
                                        type="date"
                                        value={tripStartDate}
                                        onChange={e => setTripStartDate(e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-600 text-white rounded-md p-2 pr-10 focus:ring-indigo-500 focus:border-indigo-500 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute"
                                    />
                                    <button type="button" className="absolute inset-y-0 right-0 flex items-center pr-3" onClick={() => (document.getElementById('trip-start') as HTMLInputElement)?.showPicker?.()}>
                                        <CalendarIcon className="h-5 w-5 text-slate-400" />
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label htmlFor="trip-end" className="block text-sm font-medium text-slate-300 mb-1">Trip End Date</label>
                                <div className="relative">
                                    <input
                                        id="trip-end"
                                        type="date"
                                        value={tripEndDate}
                                        onChange={e => setTripEndDate(e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-600 text-white rounded-md p-2 pr-10 focus:ring-indigo-500 focus:border-indigo-500 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute"
                                        min={tripStartDate || undefined}
                                    />
                                    <button type="button" className="absolute inset-y-0 right-0 flex items-center pr-3" onClick={() => (document.getElementById('trip-end') as HTMLInputElement)?.showPicker?.()}>
                                        <CalendarIcon className="h-5 w-5 text-slate-400" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between bg-black/20 p-3 rounded-md">
                        <div>
                            <label htmlFor="cute-icons-toggle" className="block text-sm font-medium text-slate-300">Cute Icons</label>
                            <p className="text-xs text-slate-500">Auto-add emojis to expenses (e.g., ✈️ for Travel)</p>
                        </div>
                        <button
                            type="button"
                            id="cute-icons-toggle"
                            onClick={() => setEnableCuteIcons(!enableCuteIcons)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${enableCuteIcons ? 'bg-indigo-600' : 'bg-slate-700'}`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enableCuteIcons ? 'translate-x-6' : 'translate-x-1'}`}
                            />
                        </button>
                    </div>

                    {/* Members Management */}
                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-slate-300">Members</label>

                        {/* Current Members List */}
                        <div className="space-y-2">
                            {currentMembers.map(p => (
                                <div key={p.id} className="flex items-center justify-between bg-white/5 p-2 rounded-md">
                                    <div className="flex items-center gap-3">
                                        <Avatar id={p.id} name={p.name} avatarUrl={p.avatarUrl} size="md" />
                                        <span className="font-medium">{p.name}</span>
                                    </div>
                                    {p.id !== currentUserId && (
                                        <button type="button" onClick={() => removeMember(p.id)} className="p-1 text-slate-400 hover:text-white hover:bg-rose-500/50 rounded-full">
                                            <CloseIcon />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <hr className="border-slate-600" />

                        {/* Invite & Add Section */}
                        <div className="space-y-3">
                            {/* Only show invite button for existing groups */}
                            {group && (
                                <button
                                    type="button"
                                    onClick={handleInvite}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-300 rounded-md hover:bg-emerald-600/40 transition-colors"
                                >
                                    <ShareIcon className="h-5 w-5" />
                                    <span>Invite with Link</span>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => setShowAddMemberModal(true)}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600/20 text-indigo-300 rounded-md hover:bg-indigo-600/40 transition-colors"
                            >
                                <PlusIcon className="h-5 w-5" />
                                <span>Add New Member</span>
                            </button>

                            <h4 className="text-sm font-medium text-slate-400 pt-2">Add from contacts</h4>
                            <div className="space-y-2">
                                {availableContacts.map(p => (
                                    <div key={p.id} className="flex items-center justify-between bg-white/5 p-2 rounded-md">
                                        <div className="flex items-center gap-3">
                                            <Avatar id={p.id} name={p.name} avatarUrl={p.avatarUrl} size="md" />
                                            <span className="font-medium">{p.name}</span>
                                        </div>
                                        <button type="button" onClick={() => addMember(p.id)} className="p-1 text-slate-400 hover:text-white hover:bg-indigo-500/50 rounded-full">
                                            <PlusIcon className="h-5 w-5" />
                                        </button>
                                    </div>
                                ))}
                                {availableContacts.length === 0 && <p className="text-xs text-slate-500 text-center py-2">All your contacts are in this group.</p>}
                            </div>
                        </div>

                    </div>
                </form>
            </BaseModal>
            <MemberInviteModal
                open={showAddMemberModal}
                groupId={group?.id}
                existingPeople={localPeople}
                onClose={() => setShowAddMemberModal(false)}
                onAdded={(person) => {
                    setLocalPeople(prev => [...prev, person]);
                    setMembers(prev => prev.includes(person.id) ? prev : [...prev, person.id]);
                    setShowAddMemberModal(false);
                    // Trigger a refresh in parent component to update modals
                    if (group?.id) {
                        // Force parent to refresh group data
                        setTimeout(() => {
                            window.dispatchEvent(new CustomEvent('groupMemberAdded', {
                                detail: { groupId: group.id, person }
                            }));
                        }, 100);
                    }
                }}
            />

            {/* Share Modal */}
            <BaseModal
                open={isShareModalOpen}
                onClose={() => {
                    setIsShareModalOpen(false);
                    setShareData(null);
                }}
                title="Share Invite Link"
                size="sm"
                description={<span className="text-slate-300 text-sm">Choose how to share the invite link</span>}
            >
                <div className="space-y-3 p-4">
                    {/* WhatsApp Button */}
                    <button
                        type="button"
                        onClick={handleWhatsAppShare}
                        className="w-full flex items-center gap-3 p-4 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                    >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                        </svg>
                        <span className="font-medium">Share via WhatsApp</span>
                    </button>

                    {/* SMS Button */}
                    <button
                        type="button"
                        onClick={handleSMSShare}
                        className="w-full flex items-center gap-3 p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                        <span className="font-medium">Share via SMS</span>
                    </button>

                    {/* Copy Link Button */}
                    <button
                        type="button"
                        onClick={handleCopyLink}
                        className="w-full flex items-center gap-3 p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        <span className="font-medium">Copy Link</span>
                    </button>

                    {/* Native Share Button (if supported) */}
                    {navigator.share && (
                        <button
                            type="button"
                            onClick={handleNativeShare}
                            className="w-full flex items-center gap-3 p-4 bg-slate-600 hover:bg-slate-700 text-white rounded-lg transition-colors"
                        >
                            <ShareIcon className="w-6 h-6" />
                            <span className="font-medium">More Options</span>
                        </button>
                    )}

                    {/* Link Preview */}
                    <div className="mt-4 p-3 bg-white/5 rounded-lg">
                        <p className="text-xs text-slate-400 mb-1">Invite Link:</p>
                        <p className="text-sm text-white break-all font-mono">{shareData?.url}</p>
                        <p className="text-xs text-slate-500 mt-2">Link expires in 30 days</p>
                    </div>
                </div>
            </BaseModal>
        </>
    );
};

export default GroupFormModal;
