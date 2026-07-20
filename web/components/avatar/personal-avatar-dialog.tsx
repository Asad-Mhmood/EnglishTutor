'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { XIcon } from '@phosphor-icons/react/dist/ssr';
import { prepareAvatarPhoto } from '@/components/avatar/photo-utils';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/text-field';

/**
 * The personalized-avatar dialog: passcode in, photo up, avatar on.
 *
 * The avatar passcode is typed here and sent with the upload, but it is never *checked*
 * here — /api/avatar does that, server-side, on every write. This dialog holding the
 * passcode in component state for the duration of the form is fine; baking the expected
 * value into the bundle would not be.
 *
 * A learner with a photo already on file can start using it with one click and no passcode:
 * the passcode gates *adding* a photo (the action that arms the metered bitHuman avatar),
 * not re-using one that was already admitted through that gate.
 */

interface PersonalAvatarDialogProps {
  open: boolean;
  /** URL of the already-uploaded photo, or null before any upload. */
  photoSrc: string | null;
  onClose: () => void;
  /** The photo is on the server; the caller flips the pre-call choice to 'photo'. */
  onReady: (uploadedNew: boolean) => void;
}

export function PersonalAvatarDialog({
  open,
  photoSrc,
  onClose,
  onReady,
}: PersonalAvatarDialogProps) {
  const hasPhoto = photoSrc !== null;
  const [passcode, setPasscode] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Each opening starts fresh — a stale error or a previous photo preview would be confusing
  // ten minutes later.
  useEffect(() => {
    if (open) {
      setPasscode('');
      setPhotoDataUrl(null);
      setError(null);
      setShowUploadForm(!hasPhoto);
    }
  }, [open, hasPhoto]);

  if (!open) {
    return null;
  }

  const handleFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    try {
      setPhotoDataUrl(await prepareAvatarPhoto(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  };

  const canSubmit = passcode.trim().length > 0 && photoDataUrl !== null && !isSubmitting;

  const handleUpload = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode, image: photoDataUrl }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? 'Something went wrong. Try again.');
        return;
      }

      onReady(true);
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Personalized avatar"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background w-full max-w-sm rounded-2xl border p-5 text-left shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-foreground text-lg font-semibold">Personalized avatar</h2>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              Upload a photo and your tutor takes that face — with a matching voice. Only use a
              photo of yourself, or someone who said it&rsquo;s okay.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground -m-1 p-1 transition-colors"
          >
            <XIcon size={18} weight="bold" />
          </button>
        </div>

        {hasPhoto && !showUploadForm ? (
          <div className="flex flex-col gap-2.5">
            {photoSrc && (
              <div className="flex items-center gap-3">
                <Image
                  src={photoSrc}
                  alt="Your saved photo"
                  width={56}
                  height={56}
                  unoptimized
                  className="size-14 rounded-full object-cover"
                />
                <p className="text-muted-foreground text-sm">
                  This is the photo your tutor will use.
                </p>
              </div>
            )}
            <Button size="lg" className="w-full rounded-lg" onClick={() => onReady(false)}>
              Use my saved photo
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full rounded-lg"
              onClick={() => setShowUploadForm(true)}
            >
              Upload a different photo
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <div>
              <p className="text-foreground mb-1.5 text-sm font-medium">Photo</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="border-input hover:border-ring/60 flex w-full items-center gap-3 rounded-lg border border-dashed p-3 transition-colors"
              >
                {photoDataUrl ? (
                  <Image
                    src={photoDataUrl}
                    alt="Your chosen photo"
                    width={56}
                    height={56}
                    unoptimized
                    className="size-14 rounded-full object-cover"
                  />
                ) : (
                  <span className="bg-muted size-14 shrink-0 rounded-full" aria-hidden />
                )}
                <span className="text-muted-foreground text-sm">
                  {photoDataUrl ? 'Tap to choose a different photo' : 'Tap to choose a photo'}
                </span>
              </button>
              <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                A clear, front-facing photo of one person works best.
              </p>
            </div>

            <TextField
              label="Avatar passcode"
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
                setError(null);
              }}
              placeholder="••••••••"
              autoComplete="off"
              className="font-mono tracking-widest"
              hint="This is a separate passcode from the one you signed in with — avatar minutes are limited, so ask Asad for it."
            />

            <p
              role="status"
              aria-live="polite"
              className="text-destructive min-h-5 text-sm leading-5 [&:empty]:min-h-0"
            >
              {error}
            </p>

            <Button
              size="lg"
              disabled={!canSubmit}
              onClick={handleUpload}
              className="w-full rounded-lg"
            >
              {isSubmitting ? 'Saving…' : 'Save and use this photo'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
