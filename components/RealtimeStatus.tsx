import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const DATA_TOPIC_FRAGMENTS = [
  'public:groups',
  'public:transactions',
  'public:payment_sources',
  'public:people',
  'public:group_members',
];

export function dataChannelsStatus(
  channels: { topic?: string; state?: string }[],
  seenDataChannel: boolean,
): { status: 'connecting' | 'connected' | 'disconnected'; sawDataChannel: boolean } {
  const data = DATA_TOPIC_FRAGMENTS.map((frag) =>
    channels.find((c) => (c.topic || '').includes(frag))
  );
  const sawDataChannel = seenDataChannel || data.some((c) => !!c);
  if (data.every((c) => c?.state === 'joined')) {
    return { status: 'connected', sawDataChannel };
  }
  if (data.some((c) => c?.state === 'joining' || c?.state === 'leaving')) {
    return { status: 'connecting', sawDataChannel };
  }
  if (!sawDataChannel) return { status: 'connecting', sawDataChannel };
  return { status: 'disconnected', sawDataChannel };
}

export const RealtimeStatus: React.FC = () => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    let seen = false;
    const tick = () => {
      const next = dataChannelsStatus(supabase.getChannels(), seen);
      seen = next.sawDataChannel;
      setStatus(next.status);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (status === 'connected') return null;

  const offline = status === 'disconnected' && !browserOnline;
  const label = offline ? 'Offline' : status === 'disconnected' ? 'Not live' : 'Syncing';
  const tone = offline
    ? 'bg-destructive/15 text-destructive border-destructive/30'
    : 'bg-card/90 text-muted-foreground border-border';

  return (
    <div
      title={offline ? 'No network. Changes may not save.' : 'Live updates are not connected. Your expenses still load.'}
      className={`fixed bottom-4 right-4 z-30 px-2 py-0.5 rounded-full border shadow-sm flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider pointer-events-none ${tone}`}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${offline ? 'bg-destructive' : 'bg-muted-foreground'}`}></div>
      {label}
    </div>
  );
};
