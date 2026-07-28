/*
 * The service worker — registered so Chrome will offer "Install app".
 *
 * WHAT IT DOES NOT DO: cache anything.
 *
 * That is the whole design. This app is a live voice call and a database-backed dashboard, so
 * there is nothing useful to serve offline, and a cached HTML shell would only ever be a stale
 * one — served to a signed-in learner whose session or dashboard had already moved on. Offline
 * support here would be a bug wearing a feature's clothes.
 *
 * It exists purely to satisfy Chrome's installability check, which wants a registered worker
 * with a fetch handler before it will offer a real PWA install (a WebAPK that opens fullscreen)
 * rather than a bookmark shortcut that opens in a tab with an address bar. iOS needs none of
 * this — Safari installs from the manifest and the apple-* meta tags alone.
 *
 * The handler only intercepts NAVIGATIONS, and forwards them untouched. Passing every request
 * through respondWith() would put this worker in the path of the token POST, the avatar upload
 * and the progress API for no benefit at all; letting them fall through means the browser
 * handles them exactly as if no worker were installed.
 */

self.addEventListener('install', () => {
  // Take over immediately instead of waiting for every existing tab to close. A worker stuck
  // in "waiting" while an old one serves the page is the classic PWA bug, and there is no
  // cache here whose warmth would justify the caution.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
  }
});
