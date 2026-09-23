import type { CapacitorConfig } from '@capacitor/cli';

// The iOS and Android shells. They load the game bundle from `npm run build:app` (vite build
// --mode app): the game page at the root of dist-app, no landing site, no service worker.
// Signing is left to the developer account and is not configured here.
const config: CapacitorConfig = {
  appId: 'xyz.hundredstories.app',
  appName: 'Hundred Stories',
  webDir: 'dist-app',
  // Dark steel behind the WebView, so there is no white flash between the splash and the first frame.
  backgroundColor: '#1c232e',
  server: {
    // Android serves the bundle from https://localhost. iOS keeps Capacitor's own capacitor://
    // scheme: WKWebView reserves http and https and will not let an app serve its bundle on them.
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      // The native splash (dark steel, the amber wordmark) is written by scripts/make-icons.mjs.
      backgroundColor: '#1c232e',
      launchShowDuration: 500,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      // DARK is Capacitor's style for dark backgrounds: light status bar text over the dark steel.
      style: 'DARK',
      backgroundColor: '#1c232e',
      overlaysWebView: false,
    },
  },
};

export default config;
