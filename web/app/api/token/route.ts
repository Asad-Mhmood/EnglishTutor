import { NextResponse } from 'next/server';
import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { RoomConfiguration } from '@livekit/protocol';
import { hasAvatarPhoto } from '@/lib/avatars';
import { getDb } from '@/lib/db';
import { currentLearnerId } from '@/lib/session';

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

// NOTE: you are expected to define the following environment variables in `.env.local`:
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// don't cache the results
export const revalidate = 0;

export async function POST(req: Request) {
  // The upstream template threw here in production, because this route mints a room token for
  // anyone who asks and every token starts a real agent session that costs Groq, Tavily and
  // LiveKit quota. The session cookie (lib/session.ts) is the authentication layer that warning
  // demanded: it exists only if the holder passed the passcode at /api/login. No cookie, no
  // token, no quota burnt by a crawler.
  const learnerId = await currentLearnerId();
  if (!learnerId) {
    return new NextResponse('Not signed in', { status: 401 });
  }

  try {
    if (LIVEKIT_URL === undefined) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    if (API_KEY === undefined) {
      throw new Error('LIVEKIT_API_KEY is not defined');
    }
    if (API_SECRET === undefined) {
      throw new Error('LIVEKIT_API_SECRET is not defined');
    }

    // Parse room config from request body.
    const body = await req.json();
    const roomConfig = body?.room_config
      ? RoomConfiguration.fromJson(body.room_config, { ignoreUnknownFields: true })
      : new RoomConfiguration();

    // The avatar choice rides in the token's participant attributes, because that is the one
    // channel the agent can trust: attributes minted here are signed with LIVEKIT_API_SECRET,
    // so a client cannot claim the metered photo avatar by editing a request. "photo" is only
    // honoured when a photo row actually exists — and a photo row can only exist if the
    // learner passed the avatar passcode at upload time (/api/avatar). Everything else
    // degrades to the free boy character rather than erroring: a stale choice should never
    // cost anyone their call.
    let avatarMode: 'boy' | 'girl' | 'photo' = body?.avatar === 'girl' ? 'girl' : 'boy';
    if (body?.avatar === 'photo') {
      const sql = getDb();
      if (sql && (await hasAvatarPhoto(sql, learnerId).catch(() => false))) {
        avatarMode = 'photo';
      }
    }

    // The participant identity is how the agent learns whose progress it is recording:
    // agent/tutor.py::_learner_id_from reads the id back out of this prefix. Since sign-in is
    // now mandatory, every session has a learner and every session is tracked — the anonymous
    // "connected but recorded nowhere" case that the old cookie-optional flow could produce is
    // simply unreachable.
    //
    // The id is safe to expose here: it is an opaque uuid, and possessing it grants nothing.
    // Reading a learner's progress requires the signed session cookie (lib/session.ts), which
    // cannot be produced from the uuid alone.
    const participantName = 'user';
    const participantIdentity = `learner_${learnerId}`;

    // The template used a random integer under 10,000 here, which collides at a rate you can
    // actually hit — two people practicing at once had a ~1-in-10,000 chance of landing in
    // the *same room* and hearing each other. A uuid removes that.
    const roomName = `voice_assistant_room_${crypto.randomUUID()}`;

    const participantToken = await createParticipantToken(
      {
        identity: participantIdentity,
        name: participantName,
        attributes: { avatar_mode: avatarMode },
      },
      roomName,
      roomConfig
    );

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantName,
      participantToken,
    };
    const headers = new Headers({
      'Cache-Control': 'no-store',
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  roomConfig: RoomConfiguration | undefined
): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    ...userInfo,
    ttl: '15m',
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);

  if (roomConfig) {
    at.roomConfig = roomConfig;
  }

  return at.toJwt();
}
