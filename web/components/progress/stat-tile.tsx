import { Card } from '@/components/ui/card';

/**
 * One headline number. Shared by the home page's summary strip and the dashboard, so the two
 * cannot drift into disagreeing about what a "session" or a "streak" looks like.
 */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-muted-foreground text-xs leading-4">{label}</div>
      <div className="text-card-foreground mt-1.5 text-2xl leading-none font-semibold">{value}</div>
      {hint && <div className="text-muted-foreground mt-1.5 text-[11px] leading-4">{hint}</div>}
    </Card>
  );
}
