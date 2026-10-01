// Server-only helpers for fetching third-party pages and images safely.
import dns from 'node:dns/promises';
import net from 'node:net';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// A complete, consistent set of Chrome request headers. Partial or outdated browser
// headers are rejected by many hosts, and some sites (Duda) return internal JSON
// instead of HTML when application/json is listed in Accept.
const HEADERS = {
  'user-agent': CHROME,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="140", "Google Chrome";v="140", "Not;A=Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/png,image/jpeg,image/*,*/*;q=0.8';

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

async function fetchWith(target, headers) {
  let url = await check(target);
  let res;
  for (let i = 0; i < 6; i++) {
    res = await fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(18000) });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = await check(new URL(loc, url).href);
      continue;
    }
    break;
  }
  return res;
}

// Fetch a public URL (page, feed, API or image) with browser headers.
export function fetchRemote(target, { image = false } = {}) {
  const headers = image
    ? { ...HEADERS, accept: IMAGE_ACCEPT, 'sec-fetch-dest': 'image', 'sec-fetch-mode': 'no-cors' }
    : HEADERS;
  if (image) delete headers['sec-fetch-user'];
  return fetchWith(target, headers);
}
