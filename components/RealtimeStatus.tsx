import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export const RealtimeStatus: React.FC = () => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastEvent, setLastEvent] = useState<string>('');

  useEffect(() => {
    // Monitor connection status
    const channel = supabase.channel('heartbeat')
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setStatus('disconnected');
        }
      });

    return () => {
      channel.unsubscribe();
    };
  }, []);

  if (status === 'connected') {
    return (
      <div className="fixed top-3.5 right-32 md:right-36 bg-green-500 text-white px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] opacity-80 hover:opacity-100 transition-opacity cursor-default select-none pointer-events-none">
        <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></div>
        Live
        {lastEvent && <span className="opacity-75 hidden sm:inline normal-case font-normal">• {lastEvent}</span>}
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div className="fixed top-3.5 right-32 md:right-36 bg-red-500 text-white px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] pointer-events-none">
        <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
        Offline
      </div>
    );
  }

  return (
    <div className="fixed top-3.5 right-32 md:right-36 bg-yellow-500 text-white px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] pointer-events-none">
      <div className="w-1.5 h-1.5 bg-white rounded-full animate-spin"></div>
      Connecting
    </div>
  );
};
