import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const DATA_TOPIC_FRAGMENTS = [
  'public:groups',
  'public:transactions',
  'public:payment_sources',
  'public:people',
  'public:group_members',
];

function dataChannelsStatus(): 'connecting' | 'connected' | 'disconnected' {
  const channels = supabase.getChannels();
  const data = DATA_TOPIC_FRAGMENTS.map((frag) =>
    channels.find((c) => (c.topic || '').includes(frag))
  );
  if (data.some((c) => !c)) return 'connecting';
  if (data.every((c) => c && c.state === 'joined')) return 'connected';
  return 'disconnected';
}

export const RealtimeStatus: React.FC = () => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    const tick = () => setStatus(dataChannelsStatus());
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
