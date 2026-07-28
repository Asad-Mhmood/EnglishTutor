import type { MetadataRoute } from 'next';
import { APP_CONFIG_DEFAULTS } from '@/app-config';

/**
 * The web app manifest — what turns the site into something installable on a phone.
 *
 * Next serves this at /manifest.webmanifest and injects the <link rel="manifest"> itself, so
 * there is nothing to wire up in layout.tsx beyond the Apple-specific tags iOS still wants.
 *
 * The strings come from APP_CONFIG_DEFAULTS rather than being retyped, so the name on a home
 * screen cannot drift from the name in the <title>. Note the manifest is STATIC: unlike the
 * layout it cannot read per-request headers, so it always describes the default config. That
 * is correct here — an installed app is a fixed thing, and a manifest that changed per request
 * would mean the icon and name silently differed between installs.
 *
 * `start_url: '/'` deliberately points at the signpost route, not at /home. `/` already knows
 * how to send a signed-in learner to the hub and everyone else to /login, so launching from
 * the home screen after the 30-day cookie expires lands on the login form instead of a
 * redirect chain from a page the learner cannot see.
 *
 * There IS a service worker (public/sw.js), and it caches nothing. Chrome would not offer a
 * real install without one — only a bookmark shortcut that opens in a tab with an address bar
 * — so it exists to satisfy that check and for no other reason. Do not grow it into an
 * offline cache: this app is a live voice call and a database-backed dashboard, so a cached
 * HTML shell would only ever be a stale one served to a signed-in learner. iOS ignores all of
 * this and installs from this manifest and the apple-* meta tags alone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_CONFIG_DEFAULTS.pageTitle,
    short_name: APP_CONFIG_DEFAULTS.companyName,
    description: APP_CONFIG_DEFAULTS.pageDescription,
    lang: 'en',
    categories: ['education'],

    start_url: '/',
    scope: '/',
    display: 'standalone',

    // The splash screen behind the icon while the app boots. White matches the light theme's
    // --background; a dark-theme learner sees one pale frame before the app paints, which is
    // the lesser evil — a manifest carries exactly one background_color and cannot follow the
    // system theme. (theme_color CAN, via the <meta> in layout.tsx.)
    background_color: '#ffffff',
    theme_color: '#2f6f4e',

    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops icons to whatever shape the launcher uses. The maskable variant carries
      // the same mark pulled into the inner safe circle so a round launcher cannot clip the
      // speech bubble's tail off.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
