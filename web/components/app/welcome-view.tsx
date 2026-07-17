'use client';

import Link from 'next/link';
import { ArrowLeftIcon, MicrophoneIcon } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';

/**
 * The pre-call screen: the last thing a learner sees before the microphone opens.
 *
 * This used to carry the passcode form, and starting a call meant unlocking, creating a
 * profile and connecting in the right order from here. All of that now happens at /login,
 * before this page is even reachable — so the screen is back to doing the one job the moment
 * actually calls for: telling them what is about to happen, and letting them press the button
 * when they're ready.
 */

interface WelcomeViewProps {
  startButtonText: string;
  learnerName: string | null;
  onStartCall: () => void;
}

export const WelcomeView = ({
  startButtonText,
  learnerName,
  onStartCall,
  ref,
}: React.ComponentProps<'div'> & WelcomeViewProps) => {
  return (
    <div ref={ref}>
      <section className="mx-auto flex max-w-md flex-col items-center px-6 text-center">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground flex size-16 items-center justify-center rounded-2xl shadow-md"
        >
          <MicrophoneIcon size={30} weight="bold" />
        </span>

        <h1 className="text-foreground mt-6 text-2xl font-semibold tracking-tight">
          {learnerName ? `Ready when you are, ${learnerName}` : 'Ready when you are'}
        </h1>

        <p className="text-muted-foreground mt-3 text-sm leading-6 text-pretty">
          Speak naturally about anything at all. Ahmad will chat back, gently correct your mistakes,
          and look things up on the web if you ask.
        </p>

        <Button
          size="lg"
          onClick={onStartCall}
          className="mt-7 w-full max-w-xs gap-2 rounded-full font-medium"
        >
          <MicrophoneIcon size={17} weight="bold" />
          {startButtonText}
        </Button>

        <p className="text-muted-foreground mt-4 text-xs leading-5">
          Your browser will ask to use your microphone. Choose &ldquo;Allow&rdquo; so Ahmad can hear
          you.
        </p>

        <Link
          href="/home"
          className="text-muted-foreground hover:text-foreground mt-8 flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeftIcon size={14} weight="bold" />
          Back to home
        </Link>
      </section>

      <div className="fixed bottom-5 left-0 flex w-full items-center justify-center">
        <p className="text-muted-foreground max-w-prose px-6 text-center text-xs leading-5">
          Works best with headphones, in a quiet room.
        </p>
      </div>
    </div>
  );
};
