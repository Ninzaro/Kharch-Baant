import type { CapacitorConfig } from '@capacitor/cli';

// Set CAPACITOR_DEV_SERVER_URL in your shell or .env.local for live-reload
// during development (e.g. http://192.168.1.10:3000).
// Leave it unset for production / release builds — Capacitor will serve
// the bundled dist/ files natively instead.
const devServerUrl = process.env.CAPACITOR_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.kharchbaant.app',
  appName: 'Kharch Baant',
  webDir: 'dist',

  server: {
    androidScheme: 'https',
    hostname: 'motamaati.in',
    allowNavigation: [
      'accounts.google.com',
      '*.google.com',
      '*.clerk.accounts.dev',
      '*.clerk.com',
      'motamaati.in',
      '*.motamaati.in',
      'clerk.motamaati.in',
      '*.clerk.motamaati.in'
    ],
    ...(devServerUrl
      ? { url: devServerUrl, cleartext: true }
      : {}),
  },

  android: {
    buildOptions: {
      releaseType: 'AAB'
    }
  },

  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1e293b',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#1e293b'
    }
  }
};

export default config;
