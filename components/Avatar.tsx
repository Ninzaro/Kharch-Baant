import React, { useState, useEffect } from 'react';

interface AvatarProps {
    person?: { id: string; name: string; avatarUrl?: string | null };
    id?: string;
    name?: string;
    avatarUrl?: string | null;
    size?: 'xs' | 'sm' | 'md' | 'lg';
}

const colors = [
    'bg-rose-500', 'bg-amber-500', 'bg-emerald-500',
    'bg-sky-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500'
];

/** Stock / generated face hosts we never display — treat as empty (initials). */
const STOCK_AVATAR_HOST_MARKERS = [
    'pravatar.cc',
    'ui-avatars.com',
];

export function isStockAvatarUrl(url: string | null | undefined): boolean {
    if (!url || url.trim() === '') return false;
    const lower = url.toLowerCase();
    // Real user uploads are data URLs
    if (lower.startsWith('data:')) return false;
    return STOCK_AVATAR_HOST_MARKERS.some((marker) => lower.includes(marker));
}

// Simple hash function to get a consistent color from the person's ID
const getColorForId = (id: string | undefined) => {
    if (typeof id !== 'string' || id.length === 0) {
        return colors[0];
    }
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash % colors.length);
    return colors[index];
};

export const getInitials = (name: string | undefined): string => {
    if (typeof name !== 'string' || name.length === 0) {
        return '?';
    }

    const cleanName = name.trim();
    const names = cleanName.split(/\s+/).filter(n => n.length > 0);

    if (names.length >= 2) {
        return `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase();
    } else if (names.length === 1) {
        const singleName = names[0];
        if (singleName.length >= 2) {
            return singleName.substring(0, 2).toUpperCase();
        }
        return singleName.charAt(0).toUpperCase();
    }

    return '?';
};

/** Fixed box dimensions — always applied on the outer shell so photos cannot overflow. */
const sizeBoxMap: Record<NonNullable<AvatarProps['size']>, string> = {
    xs: 'h-5 w-5 min-h-[1.25rem] min-w-[1.25rem] text-[10px]',
    sm: 'h-6 w-6 min-h-[1.5rem] min-w-[1.5rem] text-xs',
    md: 'h-8 w-8 min-h-[2rem] min-w-[2rem] text-sm',
    lg: 'h-10 w-10 min-h-[2.5rem] min-w-[2.5rem] text-base',
};

const Avatar: React.FC<AvatarProps> = ({ person, id, name, avatarUrl, size = 'md' }) => {
    const finalId = person?.id || id;
    const finalName = person?.name || name || '?';
    const rawAvatarUrl = person?.avatarUrl || avatarUrl;
    const usableUrl =
        rawAvatarUrl &&
        rawAvatarUrl.trim() !== '' &&
        !isStockAvatarUrl(rawAvatarUrl)
            ? rawAvatarUrl.trim()
            : null;

    const [imageFailed, setImageFailed] = useState(false);

    // Reset error state when the URL changes
    useEffect(() => {
        setImageFailed(false);
    }, [usableUrl]);

    const boxClasses = sizeBoxMap[size] ?? sizeBoxMap.md;
    const showImage = Boolean(usableUrl) && !imageFailed;
    const color = getColorForId(finalId);
    const initials = getInitials(finalName);

    // Outer shell always clamps size (shrink-0 + overflow) so large photos
    // cannot blow out flex/grid rows.
    return (
        <div
            className={`
                ${boxClasses}
                shrink-0 grow-0 overflow-hidden rounded-full
                flex items-center justify-center
                ${showImage ? 'bg-slate-700' : `${color} font-bold text-white`}
            `}
            title={finalName}
            aria-label={finalName}
        >
            {showImage && usableUrl ? (
                <img
                    src={usableUrl}
                    alt=""
                    className="block h-full w-full max-h-full max-w-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={() => setImageFailed(true)}
                />
            ) : (
                initials
            )}
        </div>
    );
};

export default Avatar;
