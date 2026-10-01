import sharp from 'sharp';
import { fetchRemote } from '../../../../../lib/remote.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/image/<base64url of the original image URL>/<file-name>.<jpg|png|gif>
//
// Export files point their images here instead of at the original site. Importers
// (WordPress, Wix, Squarespace, Shopify...) download from this URL, so images still
// import when the original host blocks them, and every file arrives as a real
// JPEG / PNG with a proper file name.
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' };

export async function GET(req, { params }) {
  const { key, name } = await params;
  const ext = String(name).split('.').pop().toLowerCase();
  const want = TYPES[ext];
  if (!want) return new Response('Unsupported file type', { status: 400 });
  let source;
  try {
    source = Buffer.from(key, 'base64url').toString('utf8');
    if (!/^https?:\/\//i.test(source)) throw new Error('bad url');
  } catch {
    return new Response('Bad image key', { status: 400 });
  }
  try {
    const res = await fetchRemote(source, { image: true });
    if (!res.ok) return new Response('Image unavailable', { status: 502 });
    let buf = Buffer.from(await res.arrayBuffer());
    if (!buf.byteLength || buf.byteLength > 15_000_000) return new Response('Image too large', { status: 413 });
    const got = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (want === 'image/gif') {
      // GIFs pass through untouched so animations survive.
      if (got !== 'image/gif') return new Response('Not a GIF', { status: 415 });
    } else if (got !== want) {
      // Convert WebP / AVIF / mislabelled files to the format the file name promises.
      const img = sharp(buf, { animated: false }).rotate();
      buf = await (want === 'image/png' ? img.png({ compressionLevel: 9 }) : img.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true })).toBuffer();
    }
    return new Response(buf, {
      headers: {
        'content-type': want,
        'content-length': String(buf.byteLength),
        'content-disposition': `inline; filename="${String(name).replace(/[^\w.-]/g, '')}"`,
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Image could not be processed', { status: 502 });
  }
}
