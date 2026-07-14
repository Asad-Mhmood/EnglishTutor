import Link from 'next/link';
// The Icon *type* only exists on the package root; the SSR entrypoint exports the components
// but not the type. `import type` is erased at compile time, so this pulls in no client bundle.
import type { Icon } from '@phosphor-icons/react';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/ssr';
import { cn } from '@/lib/shadcn/utils';

interface ActionCardProps {
  href: string;
  icon: Icon;
  title: string;
  description: string;
  cta: string;
  /** The primary card is the one a learner should press if they only press one. */
  emphasis?: 'primary' | 'secondary';
}

/**
 * One of the two things you can do from the home page.
 *
 * The whole tile is the link, not a button inside it — a 300px target beats a 100px one on a
 * phone, and there is nothing else in the tile to click.
 */
export function ActionCard({
  href,
  icon: IconComponent,
  title,
  description,
  cta,
  emphasis = 'secondary',
}: ActionCardProps) {
  const isPrimary = emphasis === 'primary';

  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col rounded-2xl border p-6 transition-all duration-200 md:p-7',
        'hover:-translate-y-0.5 hover:shadow-lg',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
        isPrimary
          ? 'bg-primary text-primary-foreground border-transparent shadow-md'
          : 'bg-card border-border text-card-foreground hover:border-foreground/25'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-11 items-center justify-center rounded-xl',
          isPrimary ? 'bg-primary-foreground/15' : 'bg-muted text-foreground'
        )}
      >
        <IconComponent size={22} weight="bold" />
      </span>

      <h2 className="mt-5 text-lg font-semibold tracking-tight">{title}</h2>

      <p
        className={cn(
          'mt-1.5 text-sm leading-6',
          isPrimary ? 'text-primary-foreground/80' : 'text-muted-foreground'
        )}
      >
        {description}
      </p>

      <span className="mt-6 flex items-center gap-1.5 text-sm font-medium">
        {cta}
        <ArrowRightIcon
          size={15}
          weight="bold"
          className="transition-transform duration-200 group-hover:translate-x-1"
        />
      </span>
    </Link>
  );
}
