import { NextResponse } from 'next/server';
import { MAX_PHOTO_BYTES, deleteAvatarPhoto, hasAvatarPhoto, saveAvatarPhoto } from '@/lib/avatars';
import { getDb } from '@/lib/db';
import { avatarPasscodeMatches, currentLearnerId } from '@/lib/session';

/**
 * /api/avatar — the personalized photo avatar.
 *
 *   GET     → { hasPhoto } for the signed-in learner, so the picker knows whether "use my
 *             photo" can start a call immediately or needs an upload first.
 *   POST    → { passcode, image } stores a new photo. The AVATAR PASSCODE (not the app
 *             passcode) is required on EVERY upload — this is the paywall in front of the
 *             metered bitHuman credits, and it is checked here and nowhere else.
 *   DELETE  → removes the photo. No passcode: deleting your own photo costs nothing and
 *             should never be gated behind remembering a code.
 *
 * The image travels as base64 JPEG, already downscaled by the client (components/avatar/
 * photo-upload.ts). Decoding and a magic-byte check happen here so a hand-crafted request
 * cannot park arbitrary bytes in the database for the agent to hand to bitHuman.
 */

export const revalidate = 0;

export async function GET() {
  const learnerId = await currentLearnerId();
  if (!learnerId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ hasPhoto: false });
  }

  try {
    return NextResponse.json({ hasPhoto: await hasAvatarPhoto(sql, learnerId) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ hasPhoto: false });
  }
}

export async function POST(req: Request) {
  const learnerId = await currentLearnerId();
  if (!learnerId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let passcode = '';
  let imageBase64 = '';
  try {
    const body = await req.json();
    passcode = typeof body?.passcode === 'string' ? body.passcode : '';
    imageBase64 = typeof body?.image === 'string' ? body.image : '';
  } catch {
    // A malformed body falls through to the checks below.
  }

  // Passcode first, same order as /api/login: no feedback about anything else without it.
  try {
    if (!avatarPasscodeMatches(passcode.trim())) {
      return NextResponse.json({ error: "That passcode isn't right." }, { status: 401 });
    }
  } catch (error) {
    // AVATAR_PASSCODE missing on the server — a misconfiguration, not a wrong guess.
    console.error(error);
    return NextResponse.json(
      { error: 'Personalized avatars are not set up on this server.' },
      { status: 500 }
    );
  }

  // Accept both a bare base64 string and a data URL — the client sends the latter.
  const commaAt = imageBase64.indexOf(',');
  const payload =
    imageBase64.startsWith('data:') && commaAt !== -1
      ? imageBase64.slice(commaAt + 1)
      : imageBase64;

  let image: Buffer;
  try {
    image = Buffer.from(payload, 'base64');
  } catch {
    return NextResponse.json({ error: 'That image could not be read.' }, { status: 400 });
  }

  // JPEG magic bytes (FF D8 FF): the client always sends JPEG, so anything else is not a
  // well-meaning user with an odd file format — it is a request the client never made.
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff) {
    return NextResponse.json({ error: 'Please upload a photo (JPEG).' }, { status: 400 });
  }
  if (image.length > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: 'That photo is too large.' }, { status: 400 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json(
      { error: 'Avatars are unavailable — this server has no database configured.' },
      { status: 503 }
    );
  }

  try {
    await saveAvatarPhoto(sql, learnerId, image);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not save your photo. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const learnerId = await currentLearnerId();
  if (!learnerId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ ok: true });
  }

  try {
    await deleteAvatarPhoto(sql, learnerId);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Could not remove your photo.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
