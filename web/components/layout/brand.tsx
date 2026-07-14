import Link from 'next/link';
import { cn } from '@/lib/shadcn/utils';

/**
 * The wordmark. A link on every page that has a header, and inert on the pages that don't
 * have anywhere to go back to (login).
 */
export function Brand({
  href,
  className,
  size = 'sm',
}: {
  href?: string;
  className?: string;
  size?: 'sm' | 'lg';
}) {
  const content = (
    <span className={cn('flex items-center gap-2.5', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/tutor-logo.svg"
        alt=""
        className={cn('block dark:hidden', size === 'lg' ? 'size-9' : 'size-7')}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/tutor-logo-dark.svg"
        alt=""
        className={cn('hidden dark:block', size === 'lg' ? 'size-9' : 'size-7')}
      />
      <span
        className={cn(
          'text-foreground font-semibold tracking-tight',
          size === 'lg' ? 'text-xl' : 'text-base'
        )}
      >
        English Tutor
      </span>
    </span>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="rounded-md transition-opacity hover:opacity-80">
      {content}
    </Link>
  );
}
