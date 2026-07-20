'use client';

import Image from 'next/image';
import { LockSimpleIcon } from '@phosphor-icons/react/dist/ssr';
import { AnimatedTutor } from '@/components/avatar/animated-tutor';
import type { AvatarChoice } from '@/lib/avatar-choice';
import { cn } from '@/lib/shadcn/utils';

/**
 * The pre-call tutor picker: Ahmad, Sara, or your own photo.
 *
 * The two characters are free and switch instantly. The photo option always routes through
 * its dialog (it may need a passcode and an upload), so this component never decides whether
 * the learner is *entitled* to it — it only reports the click. Entitlement lives on the
 * server (/api/avatar), where it can't be edited out of a bundle.
 */

interface AvatarPickerProps {
  choice: AvatarChoice;
  /**
   * URL of the learner's uploaded photo, or null before any upload. Non-null makes the
   * photo tile show the actual photo — the visible proof the upload worked — where the
   * character tiles show their faces.
   */
  photoSrc: string | null;
  onPick: (choice: 'boy' | 'girl') => void;
  onPickPhoto: () => void;
}

interface TileProps {
  label: string;
  sublabel: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Tile({ label, sublabel, selected, onClick, children }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex flex-1 flex-col items-center gap-1.5 rounded-2xl border p-3 transition-all',
        'hover:border-ring/60 focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
        selected ? 'border-primary ring-primary/25 shadow-sm ring-2' : 'border-input'
      )}
    >
      {children}
      <span className="text-foreground text-sm leading-none font-medium">{label}</span>
      <span className="text-muted-foreground text-xs leading-none">{sublabel}</span>
    </button>
  );
}

export function AvatarPicker({ choice, photoSrc, onPick, onPickPhoto }: AvatarPickerProps) {
  return (
    <div className="w-full">
      <p className="text-foreground mb-2 text-sm font-medium">Choose your tutor</p>
      <div className="flex w-full gap-2.5">
        <Tile
          label="Ahmad"
          sublabel="his voice"
          selected={choice === 'boy'}
          onClick={() => onPick('boy')}
        >
          <AnimatedTutor character="boy" className="size-14" />
        </Tile>

        <Tile
          label="Sara"
          sublabel="her voice"
          selected={choice === 'girl'}
          onClick={() => onPick('girl')}
        >
          <AnimatedTutor character="girl" className="size-14" />
        </Tile>

        <Tile
          label="My photo"
          sublabel={photoSrc ? 'ready' : 'passcode'}
          selected={choice === 'photo'}
          onClick={onPickPhoto}
        >
          {photoSrc ? (
            <Image
              src={photoSrc}
              alt="Your uploaded photo"
              width={56}
              height={56}
              unoptimized
              className="size-14 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full"
            >
              <LockSimpleIcon size={22} weight="bold" />
            </span>
          )}
        </Tile>
      </div>
    </div>
  );
}
