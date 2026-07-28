'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js. Renders nothing.
 *
 * Chrome will not offer a real "Install app" — a WebAPK that opens fullscreen — until a
 * service worker with a fetch handler is registered; without one it offers a bookmark
 * shortcut that opens in a tab with an address bar. See the header of public/sw.js for why
 * that worker caches nothing.
 *
 * Production only. In dev this would sit between the browser and Next's HMR for no benefit,
 * and a stray worker registered against localhost outlives the dev server that installed it —
 * it then answers for every other project served from the same port.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) {
      return;
    }

    // After load: registration competes with the page's own requests for bandwidth, and the
    // first paint of a voice app matters more than how quickly it becomes installable.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        // A failed registration costs the install prompt, nothing else — the site keeps
        // working exactly as it does in any browser that has no service workers at all.
        console.error('service worker registration failed', error);
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
