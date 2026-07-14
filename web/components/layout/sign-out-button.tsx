'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SignOutIcon } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';

/**
 * Signing out drops the cookie and nothing else. The learner's history is keyed to their
 * username, not to this browser, so signing back in — here or on any other device — returns
 * them to exactly where they were.
 */
export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch {
      // The cookie may or may not have been cleared. Send them to /login either way: if it
      // survived, the login page will bounce them straight back to /home, which is the truth.
    }
    // refresh() discards the cached server-rendered pages of the learner who just left, so the
    // next person to sign in on this browser cannot see their name flash up.
    router.push('/login');
    router.refresh();
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={signOut}
      disabled={isSigningOut}
      className="text-muted-foreground hover:text-foreground gap-1.5"
    >
      <SignOutIcon size={16} weight="bold" />
      <span className="hidden sm:inline">Sign out</span>
    </Button>
  );
}
