import Link from 'next/link';
import { Brand } from '@/components/layout/brand';
import { SignOutButton } from '@/components/layout/sign-out-button';
import type { Learner } from '@/lib/learners';
import { cn } from '@/lib/shadcn/utils';

/**
 * The frame around every signed-in page: header, navigation, and the content column.
 *
 * Pages pass which tab they are rather than the header reading the pathname. That keeps this a
 * server component — no client bundle, no hydration — and makes the highlighted tab a fact the
 * page states about itself instead of one the header infers.
 */

const TABS = [
  { key: 'home', href: '/home', label: 'Home' },
  { key: 'progress', href: '/progress', label: 'Dashboard' },
] as const;

export type ShellTab = (typeof TABS)[number]['key'];

function NavTabs({ active }: { active: ShellTab }) {
  return (
    <nav className="bg-muted/60 flex items-center gap-1 rounded-full p-1">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? 'page' : undefined}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
            tab.key === active
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** The learner's initial in a circle. Cheap identity confirmation at a glance. */
function LearnerChip({ learner }: { learner: Learner }) {
  return (
    <span className="flex items-center gap-2" title={`Signed in as ${learner.username}`}>
      <span
        aria-hidden
        className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-full text-xs font-semibold"
      >
        {learner.displayName.slice(0, 1).toUpperCase()}
      </span>
      <span className="text-foreground hidden text-sm font-medium md:inline">
        {learner.displayName}
      </span>
    </span>
  );
}

interface AppShellProps {
  learner: Learner;
  active: ShellTab;
  children: React.ReactNode;
}

export function AppShell({ learner, active, children }: AppShellProps) {
  return (
    <div className="bg-background min-h-svh">
      <header className="border-border/70 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 md:px-8">
          <Brand href="/home" />

          <div className="flex items-center gap-2 sm:gap-4">
            <NavTabs active={active} />
            <span className="bg-border hidden h-6 w-px sm:block" aria-hidden />
            <LearnerChip learner={learner} />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 py-10 md:px-8">{children}</main>
    </div>
  );
}
