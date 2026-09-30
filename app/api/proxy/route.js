import dns from 'node:dns/promises';
import net from 'node:net';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) return isPrivate(l.slice(7));
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function check(u) {
  const url = new URL(u);
  if (!/^https?:$/.test(url.protocol)) throw new Error('only http/https allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('port not allowed');
  const addrs = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error('address not allowed');
  return url;
}

async function fetchTarget(target, optimize) {
  let url = await check(target);
  let res;
  for (let i = 0; i < 6; i++) {
    res = await fetch(url, {
      redirect: 'manual',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,application/json,image/avif,image/webp,image/*,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(18000),
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = await check(new URL(loc, url).href);
      continue;
    }
    break;
  }
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
