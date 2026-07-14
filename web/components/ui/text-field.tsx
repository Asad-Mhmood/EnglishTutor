'use client';

import { useId } from 'react';
import { cn } from '@/lib/shadcn/utils';

interface TextFieldProps extends Omit<React.ComponentProps<'input'>, 'id'> {
  label: string;
  /** Shown under the field, always — guidance, not an error. */
  hint?: string;
}

/**
 * A labelled text input.
 *
 * The label is a real <label> tied to the input by id, not a placeholder. Placeholder-as-label
 * disappears the moment you start typing, which is exactly when a learner on a phone keyboard
 * wants to check which box they are in.
 */
export function TextField({ label, hint, className, ...props }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="w-full">
      <label htmlFor={id} className="text-foreground mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={hintId}
        className={cn(
          'border-input bg-background text-foreground placeholder:text-muted-foreground/60',
          'focus:border-ring focus:ring-ring/30 w-full rounded-lg border px-3.5 py-2.5 text-base',
          'transition-colors outline-none focus:ring-2',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className
        )}
        {...props}
      />
      {hint && (
        <p id={hintId} className="text-muted-foreground mt-1.5 text-xs leading-5">
          {hint}
        </p>
      )}
    </div>
  );
}
