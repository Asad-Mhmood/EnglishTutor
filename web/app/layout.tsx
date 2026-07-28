import type { Viewport } from 'next';
import { Public_Sans } from 'next/font/google';
import localFont from 'next/font/local';
import { headers } from 'next/headers';
import { ServiceWorker } from '@/components/app/service-worker';
import { ThemeProvider } from '@/components/app/theme-provider';
import { ThemeToggle } from '@/components/app/theme-toggle';
import { cn } from '@/lib/shadcn/utils';
import { getAppConfig, getStyles } from '@/lib/utils';
import '@/styles/globals.css';

const publicSans = Public_Sans({
  variable: '--font-public-sans',
  subsets: ['latin'],
});

const commitMono = localFont({
  display: 'swap',
  variable: '--font-commit-mono',
  src: [
    {
      path: '../fonts/CommitMono-400-Regular.otf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../fonts/CommitMono-700-Regular.otf',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../fonts/CommitMono-400-Italic.otf',
      weight: '400',
      style: 'italic',
    },
    {
      path: '../fonts/CommitMono-700-Italic.otf',
      weight: '700',
      style: 'italic',
    },
  ],
});

/**
 * Next emits the width=device-width viewport meta on its own; this export exists for
 * `themeColor`, which paints the phone's status bar (and, on Android, the task-switcher card)
 * to match the app instead of leaving a browser-white strip above a dark screen.
 *
 * Two entries rather than the manifest's single `theme_color`, because a <meta> can carry a
 * media query and the manifest cannot. The values are the light and dark `--background` from
 * styles/globals.css — oklch(1 0 0) and oklch(0.145 0 0) — so the bar is the same colour as
 * whatever the page paints under it.
 *
 * `viewportFit` is deliberately left at its default. Setting it to 'cover' would let the page
 * run under the notch and home indicator, which then needs env(safe-area-inset-*) padding on
 * every fixed element to stay legible — a real change to every screen, not a metadata tweak.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const hdrs = await headers();
  const appConfig = await getAppConfig(hdrs);
  const styles = getStyles(appConfig);
  const { pageTitle, pageDescription } = appConfig;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        publicSans.variable,
        commitMono.variable,
        'scroll-smooth font-sans antialiased'
      )}
    >
      <head>
        {styles && <style>{styles}</style>}
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />

        {/*
          Installed-app tags. The manifest (app/manifest.ts) covers Android on its own — Next
          injects its <link rel="manifest"> — but iOS reads none of it for Add to Home Screen
          and needs these three by hand:

            apple-touch-icon          the home-screen icon; without it iOS screenshots the page
            apple-mobile-web-app-capable   launch fullscreen instead of in a Safari tab
            ...-status-bar-style      'default' keeps the status bar opaque and ABOVE the page.
                                      'black-translucent' would overlay it, hiding the top of
                                      every screen behind the clock until safe-area padding
                                      exists to push it back down.

          mobile-web-app-capable is the standardized spelling of the second one; both ship
          because iOS still only honours the apple- prefix.
        */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="English Tutor" />
      </head>
      <body className="overflow-x-hidden">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ServiceWorker />
          {/*
            The template's fixed "Built with LiveKit Agents" header used to live here. It was
            removed when the app grew real pages: /home and /progress carry their own header
            (components/layout/app-shell.tsx), and a second fixed bar on top of it was two
            headers arguing about the same corner of the screen.
          */}
          {children}
          <div className="group fixed bottom-0 left-1/2 z-50 mb-2 -translate-x-1/2">
            <ThemeToggle className="translate-y-20 transition-transform delay-150 duration-300 group-hover:translate-y-0" />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
