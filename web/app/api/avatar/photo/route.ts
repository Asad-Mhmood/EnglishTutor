import { NextResponse } from 'next/server';
import { getAvatarPhoto } from '@/lib/avatars';
import { getDb } from '@/lib/db';
import { currentLearnerId } from '@/lib/session';

/**
 * GET /api/avatar/photo — the signed-in learner's own avatar photo, as an image.
 *
 * Exists so the pre-call picker can show the learner the photo they uploaded — the visual
 * proof that "My photo" really has their photo behind it. Only ever serves the requester's
 * own photo (the id comes from the session cookie, not the URL), so one learner can never
 * browse another's picture by guessing an address.
 *
 * `no-store` because a replaced photo must show up immediately; the client adds a version
 * query param as a second belt against stubborn phone browser caches.
 */

export const revalidate = 0;

export async function GET() {
  const learnerId = await currentLearnerId();
  if (!learnerId) {
    return new NextResponse('Not signed in', { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return new NextResponse('No database configured', { status: 404 });
  }

  try {
    const image = await getAvatarPhoto(sql, learnerId);
    if (!image) {
      return new NextResponse('No photo uploaded', { status: 404 });
    }
    return new NextResponse(new Uint8Array(image), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error(error);
    return new NextResponse('Could not load the photo', { status: 500 });
  }
}
