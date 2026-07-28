import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cloudworkz.continueapp',
  appName: 'Continue?',
  // Vite's build output. `cap sync` copies this into the native project.
  webDir: 'dist',
  android: {
    // Keep the webview background dark so the splash -> app transition
    // doesn't flash white on launch.
    backgroundColor: '#0b0b0d',
  },
};

export default config;
