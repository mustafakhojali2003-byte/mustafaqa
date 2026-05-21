import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'qa.mustafa.security',
  appName: 'MUSTAFA.QA',
  webDir: 'dist',
  server: {
    // Use live URL so always up to date
    url: 'https://mustafaqa.vercel.app',
    cleartext: false,
  },
  android: {
    buildOptions: {
      keystoreAlias: 'mustafaqa',
    },
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
