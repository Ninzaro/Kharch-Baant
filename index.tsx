import React from 'react';
import './index.css';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import AppWithAuth from './App';
import { SupabaseAuthProvider } from './contexts/SupabaseAuthContext';
import ToastProvider from './components/ToastProvider';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

import { ClerkProvider } from '@clerk/clerk-react';
import ErrorBoundary from './components/ErrorBoundary';

Sentry.init({
  dsn: 'https://241dafbc0787e2e71906ec5aaff9a3f9@o4511203625795584.ingest.us.sentry.io/4511203644342272',
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 0.2,       // 20% of transactions for performance monitoring
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% of sessions with errors
  sendDefaultPii: true,
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD, // only send events in production builds
});

const initCapacitor = async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      // Configure Status Bar
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#1e293b' });
      
      // Hide splash screen after app is ready
      await SplashScreen.hide();
      
      // Handle app state changes
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        console.log('App state changed. Is active?', isActive);
      });
      
      const handleAppUrl = (rawUrl: string) => {
        // Invite deep link
        const inviteMatch = rawUrl.match(/invite\/([^/?#]+)/i);
        if (inviteMatch) {
          const token = decodeURIComponent(inviteMatch[1]);
          const next = `/invite/${token}`;
          if (window.location.pathname !== next) {
            window.history.replaceState({}, '', next);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
          return;
        }

        // SSO callback (kharchbaant://sso-callback?... or https://.../sso-callback?...)
        if (rawUrl.includes('sso-callback') || rawUrl.includes('__clerk_status')) {
          try {
            void Browser.close().catch(() => {});
            const q = rawUrl.includes('?') ? rawUrl.substring(rawUrl.indexOf('?')) : '';
            const hashOnly = !q.includes('#') && rawUrl.includes('#')
              ? rawUrl.substring(rawUrl.indexOf('#'))
              : '';
            const next = `/sso-callback${q}${hashOnly}`;
            window.history.replaceState({}, '', next);
            window.dispatchEvent(new PopStateEvent('popstate'));
          } catch (err) {
            console.error('Error handling SSO callback deep link:', err);
          }
        }
      };

      CapacitorApp.addListener('appUrlOpen', ({ url }) => {
        handleAppUrl(url);
      });
      const launchUrl = await CapacitorApp.getLaunchUrl();
      if (launchUrl?.url) {
        handleAppUrl(launchUrl.url);
      }
    } catch (error) {
      console.error('Error initializing Capacitor plugins:', error);
    }
  }
};

// Initialize Capacitor before rendering
initCapacitor();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const root = ReactDOM.createRoot(rootElement);

if (!PUBLISHABLE_KEY) {
  root.render(
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6 text-center">
      <div className="max-w-md p-6 bg-card border border-destructive rounded-2xl shadow-lg">
        <h2 className="text-xl font-bold text-destructive mb-2">Configuration Error</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Missing VITE_CLERK_PUBLISHABLE_KEY in the build environment. Please ensure the GitHub secret is configured.
        </p>
      </div>
    </div>
  );
} else {
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
          <QueryClientProvider client={queryClient}>
            <SupabaseAuthProvider>
              <ToastProvider>
                <AppWithAuth />
              </ToastProvider>
            </SupabaseAuthProvider>
          </QueryClientProvider>
        </ClerkProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
