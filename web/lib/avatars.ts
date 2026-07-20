import type { Sql } from '@/lib/db';

/**
 * Avatar photo rows — the only module in the web half that touches `learner_avatars`.
 *
 * Same rule as lib/learners.ts: SQL lives in one place. The photo is stored as bytea in the
 * same Neon database both halves already reach, because it is small (the client downscales
 * before upload) and because a separate blob store would be a fifth secret location for a
 * feature that must never be the reason the tutor breaks.
 *
 * A row's existence doubles as the entitlement: the only writer is the avatar route, which
 * re-checks AVATAR_PASSCODE on every write. The agent (agent/avatars.py) reads the row back
 * by learner id and never sees the passcode at all.
 */

/** Matches the client-side downscale (~640px JPEG ≈ 60–150 KB) with generous headroom. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export async function saveAvatarPhoto(sql: Sql, learnerId: string, image: Buffer): Promise<void> {
  // Neon's HTTP driver sends parameters as text, so the bytes go over as Postgres's hex
  // bytea input format ('\x...') and the column's input conversion does the rest. Handing
  // the driver a raw Buffer would stringify it as UTF-8 and quietly corrupt the image.
  const hex = '\\x' + image.toString('hex');
  await sql`
    INSERT INTO learner_avatars (learner_id, image, content_type)
         VALUES (${learnerId}, ${hex}, 'image/jpeg')
    ON CONFLICT (learner_id) DO UPDATE
            SET image = EXCLUDED.image,
                content_type = EXCLUDED.content_type,
                updated_at = now()
  `;
}

export async function hasAvatarPhoto(sql: Sql, learnerId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM learner_avatars WHERE learner_id = ${learnerId}`;
  return rows.length > 0;
}

/**
 * The stored photo bytes, or null if there aren't any.
 *
 * The driver's bytea handling is asymmetric: we WRITE the hex text form ('\x...') because
 * parameters travel as text, but on READ the driver's type parser may hand back a Buffer
 * already — or, without a parser, the raw hex string. Accept both rather than betting on
 * which side of that behaviour the installed driver version lands on.
 */
export async function getAvatarPhoto(sql: Sql, learnerId: string): Promise<Buffer | null> {
  const rows = await sql<{ image: unknown }>`
    SELECT image FROM learner_avatars WHERE learner_id = ${learnerId}
  `;
  if (rows.length === 0) {
    return null;
  }
  const value = rows[0].image;
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === 'string') {
    return Buffer.from(value.startsWith('\\x') ? value.slice(2) : value, 'hex');
  }
  return null;
}

export async function deleteAvatarPhoto(sql: Sql, learnerId: string): Promise<void> {
  await sql`DELETE FROM learner_avatars WHERE learner_id = ${learnerId}`;
}
