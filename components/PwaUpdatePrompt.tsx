import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';

/**
 * Prompt-based PWA update (D-13 B). Does not skipWaiting/clientsClaim automatically.
 * Refresh must call updateSW(true) so the waiting worker skipWaiting then reloads.
 * Native Capacitor builds do not register a service worker.
 */
const PwaUpdatePrompt: React.FC = () => {
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return undefined;

    let registration: ServiceWorkerRegistration | undefined;

    const updateSW = registerSW({
      onNeedRefresh() {
        toast(
          (t) => (
            <div className="flex items-center gap-3 font-sans">
              <span>New version available</span>
              <button
                type="button"
                className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                onClick={() => {
                  void updateSW(true);
                  toast.dismiss(t.id);
                }}
              >
                Refresh
              </button>
            </div>
          ),
          { id: 'pwa-update', duration: Infinity }
        );
      },
      onRegisteredSW(_url, reg) {
        registration = reg;
      },
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void registration?.update();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
};

export default PwaUpdatePrompt;
