import { cn } from '@/lib/shadcn/utils';

/**
 * The surface every panel in the app sits on.
 *
 * One component rather than a repeated `bg-card border-border rounded-xl border` incantation,
 * because the chart palette in styles/globals.css was contrast-validated against *this* colour
 * specifically. A panel that drifts to a different background quietly invalidates that.
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('bg-card border-border rounded-xl border', className)} {...props} />;
}
