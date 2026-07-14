import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { RoomConfiguration } from '@livekit/protocol';
import { UNLOCK_COOKIE, isUnlocked } from '@/lib/auth';
import { LEARNER_COOKIE, learnerIdFrom } from '@/lib/learner';

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
  // The upstream template threw here in production, because this route mints a room
  // token for anyone who asks and every token costs real quota. The passcode gate in
  // lib/auth.ts is the authentication layer that warning demanded — without a valid
  // unlock cookie, no token is issued.
  const cookieStore = await cookies();
  if (!isUnlocked(cookieStore.get(UNLOCK_COOKIE)?.value)) {
    return new NextResponse('Locked', { status: 401 });
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

    // The participant identity is how the agent learns whose progress it is recording. When
    // a learner is signed in we put their id in it, prefixed; agent/tutor.py::_learner_id_from
    // reads it back out. A visitor with no profile keeps the template's anonymous identity and
    // is simply not tracked — the tutor works, nothing is written.
    //
    // The id is safe to expose here: it is an opaque uuid, and possessing it grants nothing.
    // Reading a learner's progress requires the HMAC-signed cookie (lib/learner.ts), which
    // cannot be produced from the uuid alone.
    const learnerId = learnerIdFrom(cookieStore.get(LEARNER_COOKIE)?.value);

    const participantName = 'user';
    const participantIdentity = learnerId
      ? `learner_${learnerId}`
      : `voice_assistant_user_${crypto.randomUUID()}`;

    // The template used a random integer under 10,000 here, which collides at a rate you can
    // actually hit — two people practising at once had a ~1-in-10,000 chance of landing in
    // the *same room* and hearing each other. A uuid removes that.
    const roomName = `voice_assistant_room_${crypto.randomUUID()}`;

    const participantToken = await createParticipantToken(
      { identity: participantIdentity, name: participantName },
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
