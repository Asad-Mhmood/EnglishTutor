/**
 * Client-side photo preparation for the personalized avatar.
 *
 * The downscale happens in the browser, before upload, for three reasons: a phone camera
 * photo is 5–15 MB and Vercel caps request bodies well below that; the database stores the
 * result and should hold tens of kilobytes, not megabytes; and bitHuman renders a 512px
 * square, so anything larger is bandwidth spent on pixels nobody will see.
 */

/** Longest edge of the uploaded image. Comfortably above bitHuman's 512px render size. */
const MAX_EDGE_PX = 640;

const JPEG_QUALITY = 0.85;

/**
 * Read, downscale and re-encode a picked file as a JPEG data URL.
 *
 * Re-encoding via canvas also strips EXIF metadata (GPS position, device ids) — the server
 * should never receive more about the photo than the pixels themselves.
 */
export async function prepareAvatarPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw new Error('That file could not be read as an image.');
  }

  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Your browser could not process the image.');
    }

    // A JPEG has no alpha channel: a transparent PNG would otherwise composite onto black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}
