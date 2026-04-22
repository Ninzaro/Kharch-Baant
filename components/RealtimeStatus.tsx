import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export const RealtimeStatus: React.FC = () => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastEvent, setLastEvent] = useState<string>('');

  useEffect(() => {
    console.log('🔌 Initializing Realtime connection monitor...');
    
    // Monitor connection status
    const channel = supabase.channel('heartbeat')
      .subscribe((status, err) => {
        console.log(`🔌 Realtime status change: ${status}`, err || '');
        
        if (status === 'SUBSCRIBED') {
          setStatus('connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Realtime Channel Error. This often means the table is not in the supabase_realtime publication or RLS is blocking the connection.');
          setStatus('disconnected');
        } else if (status === 'TIMED_OUT') {
          console.error('❌ Realtime Timeout. Check your internet connection or if the Supabase project is paused.');
          setStatus('disconnected');
        } else if (status === 'CLOSED') {
          setStatus('disconnected');
        }
      });

    return () => {
      console.log('🔌 Unsubscribing from Realtime monitor');
      channel.unsubscribe();
    };
  }, []);

  if (status === 'connected') {
    return (
      <div 
        title="Realtime connected"
        className="fixed top-3.5 right-32 md:right-36 bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] opacity-80 hover:opacity-100 transition-opacity cursor-default select-none pointer-events-none"
      >
        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
        Live
      </div>
    );
  }

  if (status === 'disconnected') {
    return (
      <div 
        title="Realtime disconnected. Changes will require refresh."
        className="fixed top-3.5 right-32 md:right-36 bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] pointer-events-none"
      >
        <div className="w-1.5 h-1.5 bg-red-400 rounded-full"></div>
        Offline
      </div>
    );
  }

  return (
    <div 
      title="Connecting to Realtime..."
      className="fixed top-3.5 right-32 md:right-36 bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider z-[60] pointer-events-none"
    >
      <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-spin"></div>
      Syncing
    </div>
  );
};
