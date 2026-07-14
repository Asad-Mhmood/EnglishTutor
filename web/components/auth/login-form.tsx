'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';

/**
 * Sign in with a username and the shared passcode.
 *
 * One request. The old flow made two (unlock, then create-profile) and the call could start
 * before the second finished, which produced a tutor that worked perfectly and recorded
 * nothing — the worst kind of bug, because it looks like success. There is now no order to get
 * wrong: /api/login either returns a session or it doesn't.
 */
export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = username.trim().length > 0 && passcode.trim().length > 0 && !isSubmitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, passcode }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? 'Something went wrong. Try again.');
        return;
      }

      // push() then refresh(): /home is server-rendered per learner, and without the refresh a
      // previously-cached copy of it — someone else's, on a shared browser — can be shown.
      router.push('/home');
      router.refresh();
    } catch {
      setError('Could not reach the tutor. Check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value);
          setError(null);
        }}
        placeholder="asad"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={24}
        required
        hint="Pick any name and use it every time — it's how your progress follows you between your phone and your laptop."
      />

      <TextField
        label="Passcode"
        type="password"
        value={passcode}
        onChange={(e) => {
          setPasscode(e.target.value);
          setError(null);
        }}
        placeholder="••••••••"
        autoComplete="current-password"
        required
        className="font-mono tracking-widest"
      />

      {/* Reserved space, not a conditional element: a message that appears out of nowhere
          shoves the button down under the user's thumb as they reach for it. */}
      <p
        role="status"
        aria-live="polite"
        className="text-destructive min-h-8 text-sm leading-5 [&:empty]:min-h-0"
      >
        {error}
      </p>

      <Button type="submit" size="lg" disabled={!canSubmit} className="w-full gap-2 rounded-lg">
        {isSubmitting ? 'Signing in…' : 'Sign in'}
        {!isSubmitting && <ArrowRightIcon size={16} weight="bold" />}
      </Button>
    </form>
  );
}
