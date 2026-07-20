'use client';

import { useEffect, useMemo, useState } from 'react';
import { TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr';
import type { AppConfig } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { StartAudioButton } from '@/components/agents-ui/start-audio-button';
import { ViewController } from '@/components/app/view-controller';
import { PersonalAvatarDialog } from '@/components/avatar/personal-avatar-dialog';
import { Toaster } from '@/components/ui/sonner';
import { useAgentErrors } from '@/hooks/useAgentErrors';
import { useDebugMode } from '@/hooks/useDebug';
import { type AvatarChoice, DEFAULT_AVATAR_CHOICE } from '@/lib/avatar-choice';
import { getSandboxTokenSource } from '@/lib/utils';

const IN_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function AppSetup() {
  useDebugMode({ enabled: IN_DEVELOPMENT });
  useAgentErrors();

  return null;
}

interface AppProps {
  appConfig: AppConfig;
  /** For the greeting on the pre-call screen. Null when the learner's row couldn't be read. */
  learnerName: string | null;
}

export function App({ appConfig, learnerName }: AppProps) {
  const [avatarChoice, setAvatarChoice] = useState<AvatarChoice>(DEFAULT_AVATAR_CHOICE);
  const [hasPhoto, setHasPhoto] = useState(false);
  // Bumped on every new upload so the <img> URLs change and no cache — browser or CDN —
  // can keep showing the photo that was just replaced.
  const [photoVersion, setPhotoVersion] = useState(0);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);

  // Where the learner's own photo can be fetched from, or null before any upload. This is
  // what lets the "My photo" tile show the actual photo instead of a generic icon.
  const photoSrc = hasPhoto ? `/api/avatar/photo?v=${photoVersion}` : null;

  // Whether a photo is on file decides how the "My photo" tile presents itself (locked vs
  // ready). Fetched once; a failure just leaves the tile locked, which costs one extra click.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/avatar')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.hasPhoto) setHasPhoto(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The token source must be REBUILT when the avatar choice changes, not read the choice
  // through a ref: TokenSource.custom caches its minted token for the token's 15-minute
  // TTL, and the avatar choice lives in the request body, which the cache does not key on.
  // With a long-lived source, picking "My photo" after any earlier token fetch silently
  // reuses the cached boy-mode token and the agent never hears about the photo. A fresh
  // source per choice starts with an empty cache; the choice can only change on the
  // pre-call screen, so the session this replaces is never a connected one.
  const tokenSource = useMemo(() => {
    if (typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string') {
      return getSandboxTokenSource(appConfig);
    }
    return TokenSource.custom(async () => {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: avatarChoice }),
      });
      if (!res.ok) {
        throw new Error(`Token request failed with status ${res.status}`);
      }
      return await res.json();
    });
  }, [appConfig, avatarChoice]);

  const session = useSession(
    tokenSource,
    appConfig.agentName ? { agentName: appConfig.agentName } : undefined
  );

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      <main className="grid h-svh grid-cols-1 place-content-center">
        <ViewController
          appConfig={appConfig}
          learnerName={learnerName}
          avatarChoice={avatarChoice}
          photoSrc={photoSrc}
          onPickAvatar={setAvatarChoice}
          onPickPhotoAvatar={() => setPhotoDialogOpen(true)}
        />
      </main>
      <PersonalAvatarDialog
        open={photoDialogOpen}
        photoSrc={photoSrc}
        onClose={() => setPhotoDialogOpen(false)}
        onReady={(uploadedNew) => {
          setHasPhoto(true);
          if (uploadedNew) {
            setPhotoVersion((v) => v + 1);
          }
          setAvatarChoice('photo');
          setPhotoDialogOpen(false);
        }}
      />
      <StartAudioButton label="Start Audio" />
      <Toaster
        icons={{
          warning: <WarningIcon weight="bold" />,
        }}
        position="top-center"
        className="toaster group"
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
          } as React.CSSProperties
        }
      />
    </AgentSessionProvider>
  );
}
