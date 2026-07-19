'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);

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

  // The token request carries the avatar choice, and the choice can change right up until
  // the start button is pressed — after the token source is built. A ref bridges that gap:
  // the source reads whatever the choice is at the moment of the request, without being
  // rebuilt (and confusing useSession) on every click.
  const avatarChoiceRef = useRef(avatarChoice);
  useEffect(() => {
    avatarChoiceRef.current = avatarChoice;
  }, [avatarChoice]);

  const tokenSource = useMemo(() => {
    if (typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string') {
      return getSandboxTokenSource(appConfig);
    }
    return TokenSource.custom(async () => {
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: avatarChoiceRef.current }),
      });
      if (!res.ok) {
        throw new Error(`Token request failed with status ${res.status}`);
      }
      return await res.json();
    });
  }, [appConfig]);

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
          hasPhoto={hasPhoto}
          onPickAvatar={setAvatarChoice}
          onPickPhotoAvatar={() => setPhotoDialogOpen(true)}
        />
      </main>
      <PersonalAvatarDialog
        open={photoDialogOpen}
        hasPhoto={hasPhoto}
        onClose={() => setPhotoDialogOpen(false)}
        onReady={() => {
          setHasPhoto(true);
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
