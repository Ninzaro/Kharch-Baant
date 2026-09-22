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

  if (status === 'connected') {
    return (
      <div 
        title="Data channels joined"
        className="fixed top-3.5 right-32 md:right-36 bg-success/20 text-success border border-success/30 px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] opacity-80 hover:opacity-100 transition-opacity cursor-default select-none pointer-events-none"
      >
        <div className="w-1.5 h-1.5 bg-success rounded-full animate-pulse"></div>
        Live
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div 
        title="Data channels not joined. Changes may require refresh."
        className="fixed top-3.5 right-32 md:right-36 bg-destructive/20 text-destructive border border-destructive/30 px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] pointer-events-none"
      >
        <div className="w-1.5 h-1.5 bg-destructive rounded-full"></div>
        Offline
      </div>
    );
  }

  return (
    <div 
      title="Connecting to Realtime..."
      className="fixed top-3.5 right-32 md:right-36 bg-warning/20 text-warning border border-warning/30 px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] pointer-events-none"
    >
      <div className="w-1.5 h-1.5 bg-warning rounded-full animate-spin"></div>
      Syncing
    </div>
  );
};
