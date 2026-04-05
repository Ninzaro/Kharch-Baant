import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

// This hook handles hardware back button (Android) and browser back gesture/button (PWA/Browser)
// It takes a callback that should return true if the back event was handled (e.g. a modal was closed)
// and false if the app should do its default behavior (exit/go back in history).
export function useBackButton(handler: () => boolean) {
  const handlerRef = useRef(handler);
  
  // Always keep ref in sync with latest handler
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    // 1. Capacitor Hardware Back Button
    let capListener: any;
    try {
      capListener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
        const handled = handlerRef.current();
        if (!handled && !canGoBack) {
          CapacitorApp.exitApp();
        } else if (!handled && canGoBack) {
          window.history.back();
        }
      });
    } catch (e) {
      console.warn("Capacitor App plugin not available", e);
    }

    // 2. Browser / PWA Back Gesture
    // To trap the physical back gesture in Chrome PWA without history routing,
    // we must ensure there is a forward state to pop.
    const pushDummyState = () => {
      // Use a hash to guarantee the browser treats it as a distinct history entry.
      // We check the actual hash to see if it's already pushed, avoiding a phantom `pushed` boolean 
      // getting out of sync if the browser blocks the history manipulation.
      if (window.location.hash !== '#app') {
        window.history.pushState({ isDummy: true }, '', window.location.pathname + window.location.search + '#app');
      }
    };

    // Browsers block pushState without user interaction sometimes. We bind to first click/touch.
    const onInteract = () => {
      pushDummyState();
      // Keep it listening because they might have popped it, and we want to ensure it gets re-pushed when they tap again
    };
    
    document.addEventListener('click', onInteract);
    document.addEventListener('touchstart', onInteract);

    // Also try immediately just in case interaction already happened
    pushDummyState();

    const handlePopState = (e: PopStateEvent) => {
      // We popped from '#app' back to ''
      const handled = handlerRef.current();
      
      if (handled) {
        // We handled the back action (e.g., closed modal).
        // Push the state again so next swipe back doesn't exit.
        pushDummyState();
      } else {
        // Let it exit/go back.
        // It's already popped from '#app', so the next natural swipe will exit.
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      if (capListener) {
        capListener.then((l: any) => l.remove());
      }
      document.removeEventListener('click', onInteract);
      document.removeEventListener('touchstart', onInteract);
      window.removeEventListener('popstate', handlePopState);
    };
  }, []); // Run setup once
}
