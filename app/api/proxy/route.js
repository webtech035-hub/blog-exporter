import sharp from 'sharp';
import { fetchRemote } from '../../../lib/remote.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

async function fetchTarget(target, optimize) {
  const res = await fetchRemote(target, { image: optimize });
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > 8_000_000) return new Response('Too large', { status: 413 });
  let type = res.headers.get('content-type') || 'application/octet-stream';
  if (optimize && buf.byteLength > 32 && /^image\//i.test(type) && !/svg/i.test(type)) {
    try {
      buf = await sharp(buf)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
      type = 'image/jpeg';
    } catch {
      // keep original bytes if the file is not a bitmap we can transcode
    }
  }
  return new Response(buf, {
    status: res.status,
    headers: { 'content-type': type, 'cache-control': 'no-store' },
  });
}

export async function GET(req) {
  const target = new URL(req.url).searchParams.get('url') || '';
  const optimize = new URL(req.url).searchParams.get('optimize') === '1';
  try {
    return await fetchTarget(target, optimize);
  } catch (e) {
    return new Response('Fetch failed: ' + e.message, { status: 502 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    return await fetchTarget(body.url || '', !!body.optimize);
  } catch (e) {
    return new Response('Fetch failed: ' + e.message, { status: 502 });
  }
}
