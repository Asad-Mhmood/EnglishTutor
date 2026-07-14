'use client';

import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  SparkleIcon,
  WarningCircleIcon,
  WarningIcon,
} from '@phosphor-icons/react/dist/ssr';
import type { Strength, Weakness, WeaknessStatus } from '@/lib/progress/types';

/**
 * Strengths and weak areas.
 *
 * STATUS COLOUR NEVER TRAVELS ALONE. Each status ships an icon AND a text label, because
 * --viz-warning sits below 3:1 contrast on the light surface by design, and because roughly
 * one man in twelve cannot reliably separate the red from the green. If you strip the icon or
 * the label to "clean it up", the status becomes invisible to those users — the colour is a
 * third, redundant channel here, not the carrier.
 */

const STATUS: Record<WeaknessStatus, { label: string; color: string; Icon: typeof WarningIcon }> = {
  // The headline finding. A mistake the learner had stopped making has come back — something
  // only a system with memory of past sessions can possibly tell them.
  regressed: {
    label: 'Slipped back',
    color: 'var(--viz-critical)',
    Icon: ArrowCounterClockwiseIcon,
  },
  persistent: { label: 'Keeps happening', color: 'var(--viz-warning)', Icon: WarningIcon },
  active: { label: 'Watch this', color: 'var(--viz-axis)', Icon: WarningCircleIcon },
  new: { label: 'New', color: 'var(--viz-axis)', Icon: SparkleIcon },
};

export function WeaknessCard({ weakness }: { weakness: Weakness }) {
  const status = STATUS[weakness.status];
  const { Icon } = status;

  return (
    <li className="bg-card border-border rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <Icon
          weight="fill"
          className="mt-0.5 size-4 shrink-0"
          style={{ color: status.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="text-card-foreground text-sm font-semibold">{weakness.label}</h3>
            {/* The text label, not the colour, is what conveys the status. */}
            <span className="text-[11px] font-medium" style={{ color: status.color }}>
              {status.label}
            </span>
          </div>

          <p className="text-muted-foreground mt-1 text-xs leading-5">{weakness.note}</p>

          <p className="text-card-foreground/90 mt-2 text-xs leading-5">{weakness.advice}</p>
        </div>
      </div>
    </li>
  );
}

export function StrengthCard({ strength }: { strength: Strength }) {
  return (
    <li className="bg-card border-border rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <CheckCircleIcon
          weight="fill"
          className="mt-0.5 size-4 shrink-0"
          style={{ color: 'var(--viz-good)' }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-card-foreground text-sm font-semibold">{strength.label}</h3>
          <p className="text-muted-foreground mt-1 text-xs leading-5">{strength.detail}</p>
        </div>
      </div>
    </li>
  );
}
