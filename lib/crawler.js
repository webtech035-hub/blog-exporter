const API = '/api/proxy';

async function get(u, json) {
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: u }),
    });
    if (!r.ok) return null;
    const t = await r.text();
    if (!json) return t;
    try { return JSON.parse(t); } catch { return null; }
  } catch {
    return null;
  }
}

export const norm = (u) => {
  u = (u || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).href; } catch { return null; }
};

const abs = (h, b) => { try { return new URL(h, b).href; } catch { return h; } };
const hostKey = (h) => String(h || '').replace(/^www\./i, '').toLowerCase();
const sameSite = (a, b) => hostKey(a) === hostKey(b);

export const txt = (h) => new DOMParser().parseFromString(h || '', 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'post';
export const words = (h) => txt(h).split(/\s+/).filter(Boolean).length;

function decodeEntities(s) {
  const ta = document.createElement('textarea');
  ta.innerHTML = s || '';
  return ta.value;
}

export function cleanImageUrl(u) {
  if (!u || /^data:/i.test(u) || /^blob:/i.test(u)) return u || '';
  try {
    const url = new URL(u);
    if (/wixstatic\.com$/i.test(url.hostname)) {
      const m = url.pathname.match(/^\/media\/([^/]+)/);
      if (m) return `${url.origin}/media/${m[1]}`;
    }
    url.hash = '';
    return url.href;
  } catch {
    return u;
  }
}

function isTinyPlaceholder(u) {
  return !u || /^data:image\/gif/i.test(u) || /^data:image\/svg/i.test(u) && u.length < 400;
}

function fromSrcset(ss, base) {
  if (!ss) return '';
  let best = '', bw = -1;
  for (const part of ss.split(',')) {
    const bits = part.trim().split(/\s+/);
    const u = bits[0];
    const w = bits[1] && bits[1].endsWith('w') ? parseInt(bits[1], 10) : 1;
    if (u && w >= bw) { bw = w; best = u; }
  }
  return best ? cleanImageUrl(abs(best, base)) : '';
}

export function imgSrc(el, base) {
  const attrs = ['data-src', 'data-lazy-src', 'data-original', 'data-pin-media', 'data-img', 'data-bg', 'data-url'];
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (v && !isTinyPlaceholder(v)) return cleanImageUrl(abs(v, base));
  }
  const set = fromSrcset(el.getAttribute('srcset') || el.getAttribute('data-srcset'), base);
  if (set) return set;
  const src = el.getAttribute('src') || '';
  if (src && !isTinyPlaceholder(src)) return cleanImageUrl(abs(src, base));
  const st = el.getAttribute('style') || '';
  const bg = st.match(/url\((['"]?)(.*?)\1\)/i);
  if (bg && bg[2]) return cleanImageUrl(abs(bg[2], base));
  return '';
}

function mk(a) {
  const d = Object.assign({ title: '', content: '', excerpt: '', date: '', slug: '', url: '', image: '', image_alt: '', author: '', categories: [], tags: [] }, a);
  let dt = new Date(d.date);
  if (isNaN(dt)) dt = new Date();
  d.date = dt.toISOString().slice(0, 19).replace('T', ' ');
  d.content = maybeUnescape(d.content || '');
  d.image = cleanImageUrl(d.image);
  if (!d.excerpt) d.excerpt = txt(d.content).split(/\s+/).slice(0, 40).join(' ');
  if (!d.slug) d.slug = slugify(d.title);
  return d;
}

function maybeUnescape(html) {
  const t = String(html || '').trim();
  if (/&lt;(p|div|h[1-6]|img|article|ul|ol|figure)\b/i.test(t) && !/<(p|div|h[1-6]|img|article)\b/i.test(t)) {
    return decodeEntities(t);
  }
  return html;
}

function tagText(el, names) {
  for (const n of names) {
    const nodes = el.getElementsByTagName(n);
    if (nodes[0]) return (nodes[0].textContent || '').trim();
  }
  return '';
}

function tagHtml(el, names) {
  for (const n of names) {
    const nodes = el.getElementsByTagName(n);
    if (!nodes[0]) continue;
    const raw = nodes[0].textContent || '';
    const decoded = decodeEntities(raw);
    return decoded.includes('<') ? decoded : raw;
  }
  return '';
}

function parseJsonLd(d) {
  const blocks = [];
  for (const s of d.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      const arr = Array.isArray(j) ? j : (j['@graph'] ? j['@graph'] : [j]);
      blocks.push(...arr);
    } catch { /* ignore broken JSON-LD */ }
  }
  return blocks;
}

function ldImage(ld) {
  if (!ld || ld.image == null) return '';
  const im = ld.image;
  if (typeof im === 'string') return im;
  if (Array.isArray(im)) return ldImage({ image: im[0] });
  return im.url || im.contentUrl || '';
}

function ldArticle(d) {
  return parseJsonLd(d).find((x) => {
    const t = [].concat(x && x['@type']).join(' ');
    return /BlogPosting|NewsArticle|Article/i.test(t);
  }) || null;
}

async function viaRest(url, max) {
  const origin = new URL(url).origin;
  const path = new URL(url).pathname.replace(/\/$/, '');
  const bases = [...new Set([origin, path ? origin + path : '', path.endsWith('/blog') ? origin : ''].filter(Boolean))];
  for (const base of bases) {
    const out = [];
    let page = 1;
    while (out.length < max) {
      const per = Math.min(100, max - out.length);
      const rows = await get(`${base}/wp-json/wp/v2/posts?per_page=${per}&page=${page}&_embed=1`, true);
      if (!Array.isArray(rows) || !rows.length || !rows[0] || !rows[0].id) break;
      for (const r of rows) {
        const e = r._embedded || {};
        const fm = (e['wp:featuredmedia'] || [])[0] || {};
        const cats = [], tags = [];
        (e['wp:term'] || []).flat().forEach((t) => {
          if (t.taxonomy === 'category') cats.push(t.name);
          else if (t.taxonomy === 'post_tag') tags.push(t.name);
        });
        out.push(mk({
          title: txt(r.title && r.title.rendered),
          content: (r.content && r.content.rendered) || '',
          excerpt: txt(r.excerpt && r.excerpt.rendered),
          date: r.date_gmt ? r.date_gmt + 'Z' : r.date,
          slug: r.slug, url: r.link,
          image: fm.source_url || '', image_alt: fm.alt_text || '',
          author: ((e.author || [])[0] || {}).name || '',
          categories: cats, tags,
        }));
      }
      if (rows.length < per) break;
      page++;
    }
    if (out.length) return out.slice(0, max);
  }
  return [];
}

function locTexts(xml) {
  const x = new DOMParser().parseFromString(xml, 'text/xml');
  if (x.querySelector('parsererror')) return { root: '', locs: [] };
  const root = (x.documentElement && x.documentElement.nodeName) || '';
  const locs = [...x.getElementsByTagName('loc')].map((n) => n.textContent.trim()).filter(Boolean);
  return { root: root.replace(/^.*:/, ''), locs };
}

async function sitemap(u, depth = 0) {
  const t = await get(u);
  if (!t || !/<loc[\s>]/i.test(t)) return [];
  const { root, locs } = locTexts(t);
  if (root === 'sitemapindex' && depth < 2) {
    const ranked = locs.slice().sort((a, b) => scoreSitemap(b) - scoreSitemap(a));
    let out = [];
    for (const l of ranked.slice(0, 8)) {
      out = out.concat(await sitemap(l, depth + 1));
      if (out.length >= 800) break;
    }
    return out;
  }
  return locs;
}

function scoreSitemap(u) {
  return /post|blog|article|news|rss/i.test(u) ? 1 : 0;
}

function scorePostUrl(u) {
  try {
    const p = new URL(u).pathname.toLowerCase();
    if (/\/(blog|post|posts|news|articles|insights|journal|stories)\//.test(p)) return 5;
    if (/^\/post\//.test(p)) return 6;
    if (/\/\d{4}\/\d{2}\//.test(p)) return 4;
    if (/feed|tag|category|author|page\/\d|wp-json|cart|product|shop/.test(p)) return 0;
    return 1;
  } catch { return 0; }
}

function extractFeedItems(xml, base) {
  const x = new DOMParser().parseFromString(xml, 'text/xml');
  if (x.querySelector('parsererror') && !xml.includes('<item') && !xml.includes('<entry')) return [];
  const items = [...x.getElementsByTagName('item'), ...x.getElementsByTagName('entry')];
  const out = [];
  for (const it of items) {
    let link = tagText(it, ['link']);
    const linkEl = it.getElementsByTagName('link')[0];
    if (linkEl && linkEl.getAttribute('href')) link = linkEl.getAttribute('href');
    const alt = [...it.getElementsByTagName('link')].find((l) => (l.getAttribute('rel') || 'alternate') === 'alternate' && l.getAttribute('href'));
    if (alt) link = alt.getAttribute('href');
    link = link ? abs(link.trim(), base) : '';
    const title = tagText(it, ['title']);
    const content = tagHtml(it, ['content:encoded', 'encoded', 'content', 'description', 'summary']);
    const description = it.getElementsByTagName('content:encoded')[0] ? txt(tagHtml(it, ['description', 'summary'])) : '';
    const date = tagText(it, ['pubDate', 'published', 'updated', 'dc:date', 'date']);
    const author = tagText(it, ['dc:creator', 'creator', 'author', 'name']);
    const cats = [...it.getElementsByTagName('category')].map((n) => (n.getAttribute('term') || n.textContent || '').trim()).filter(Boolean);
    let image = '';
    const enc = it.getElementsByTagName('enclosure')[0];
    if (enc && /image/i.test(enc.getAttribute('type') || '')) image = enc.getAttribute('url') || '';
    const media = it.getElementsByTagName('media:content')[0] || it.getElementsByTagName('content')[0];
    if (!image && media && media.getAttribute('url')) image = media.getAttribute('url');
    const thumb = it.getElementsByTagName('media:thumbnail')[0];
    if (!image && thumb && thumb.getAttribute('url')) image = thumb.getAttribute('url');
    if (!image && content) {
      const m = content.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) image = m[1];
    }
    if (!title && !link) continue;
    out.push({ title, link, content, description, date, author, cats, image: image ? abs(image, base) : '' });
  }
  return out;
}

function rssLinksFromHtml(html, base) {
  const d = new DOMParser().parseFromString(html || '', 'text/html');
  const hrefs = [];
  d.querySelectorAll('link[rel="alternate"]').forEach((l) => {
    const type = (l.getAttribute('type') || '').toLowerCase();
    if (/rss|atom|xml/.test(type) || /rss|atom|feed/.test(l.getAttribute('href') || '')) {
      hrefs.push(abs(l.getAttribute('href'), base));
    }
  });
  d.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href') || '';
    if (/rss|atom|feed\.xml|blog-feed/i.test(h)) hrefs.push(abs(h, base));
  });
  return [...new Set(hrefs)];
}

async function discoverFeeds(url) {
  const root = new URL(url).origin;
  const path = new URL(url).pathname.replace(/\/$/, '') || '';
  const guessed = [
    '/feed', '/feed/', '/feed/rss2', '/feed/atom', '/rss.xml', '/rss', '/atom.xml', '/feed.xml', '/index.xml',
    '/blog-feed.xml', '/blog/rss.xml', '/blog/feed', '/blog/feed.xml', '/blog/atom.xml',
    '/posts/rss.xml', '/news/rss.xml', '/blogs/blog.atom', '/blogs/news.atom',
    path + '/rss.xml', path + '/feed', path + '/feed.xml', path + '/atom.xml',
  ].map((p) => root + p.replace(/\/{2,}/g, '/').replace(':/', '://'));
  const html = await get(url);
  const home = url === root + '/' || url === root ? html : await get(root);
  const fromHtml = rssLinksFromHtml(html, url).concat(rssLinksFromHtml(home, root));
  return [...new Set(fromHtml.concat(guessed))];
}

async function viaFeed(url, max) {
  const feeds = await discoverFeeds(url);
  for (const f of feeds) {
    const t = await get(f);
    if (!t || !/(<item|<entry)[\s>]/i.test(t)) continue;
    const items = extractFeedItems(t, f);
    if (!items.length) continue;
    const posts = [];
    for (const it of items.slice(0, max)) {
      let content = it.content || '';
      if (txt(content).length < 120 && it.link) {
        const scraped = await scrape(it.link);
        if (scraped) {
          posts.push(scraped);
          continue;
        }
      }
      if (!it.title && !content) continue;
      const post = mk({
        title: it.title || txt(content).slice(0, 80),
        content: content || `<p>${txt(it.title)}</p>`,
        excerpt: it.description,
        date: it.date,
        url: it.link || url,
        slug: it.link ? slugify(new URL(it.link).pathname.split('/').filter(Boolean).pop() || it.title) : slugify(it.title),
        image: it.image,
        image_alt: it.title,
        author: it.author,
        categories: it.cats,
      });
      // Many feeds (Duda, Squarespace, Wix...) omit author and tags; fill them from the post page later.
      if (it.link && (!post.author || !post.categories.length)) post.needs_meta = true;
      posts.push(post);
    }
    if (posts.length) return posts;
  }
  return [];
}

async function robotsSitemaps(origin) {
  const t = await get(origin + '/robots.txt');
  if (!t) return [];
  return t.split(/\r?\n/).map((l) => l.match(/^\s*sitemap:\s*(\S+)/i)).filter(Boolean).map((m) => m[1]);
}

function mdLinks(text, base) {
  const out = [];
  const re = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
  let m;
  while ((m = re.exec(text || ''))) out.push(m[1]);
  const re2 = /https?:\/\/[^\s<>"']+/g;
  while ((m = re2.exec(text || ''))) out.push(abs(m[0], base));
  return out;
}

async function findUrls(url, max) {
  const root = new URL(url).origin;
  const host = new URL(url).host;
  let found = [];
  const maps = [
    ...await robotsSitemaps(root),
    root + '/sitemap.xml',
    root + '/sitemap_index.xml',
    root + '/wp-sitemap.xml',
    root + '/sitemap-index.xml',
    root + '/blog-posts-sitemap.xml',
    root + '/blog-categories-sitemap.xml',
    root + '/post-sitemap.xml',
    root + '/news-sitemap.xml',
    root + '/sitemap/sitemap.xml',
  ];
  for (const p of [...new Set(maps)]) {
    const locs = await sitemap(p);
    if (locs.length) { found = found.concat(locs); if (found.length > 50) break; }
  }
  if (found.length < 10) {
    const llms = await get(root + '/llms.txt');
    if (llms) found = found.concat(mdLinks(llms, root));
  }
  if (found.length < 5) {
    const pages = [url, root, root + '/blog', root + '/news', root + '/posts', root + '/articles'];
    const seen = new Set();
    for (const page of pages) {
      if (seen.has(page)) continue;
      seen.add(page);
      const t = await get(page);
      if (!t) continue;
      const d = new DOMParser().parseFromString(t, 'text/html');
      d.querySelectorAll('a[href]').forEach((a) => found.push(abs(a.getAttribute('href'), page)));
      const next = d.querySelector('a[rel="next"], link[rel="next"]');
      if (next) {
        const n = abs(next.getAttribute('href'), page);
        if (!seen.has(n)) pages.push(n);
      }
    }
  }
  found = [...new Set(found)].filter((u) => {
    try {
      const p = new URL(u);
      if (!sameSite(p.host, host)) return false;
      const path = p.pathname.replace(/\/+$/, '');
      if (!path || path === '') return false;
      if (/\.(jpe?g|png|gif|webp|svg|pdf|css|js|xml|zip|mp4|mp3)$/i.test(p.pathname)) return false;
      if (/\/(tag|tags|category|categories|author|cart|checkout|product|products|shop|wp-admin|wp-json|cdn-cgi)\b/i.test(p.pathname)) return false;
      return scorePostUrl(u) > 0;
    } catch { return false; }
  });
  const pre = new URL(url).pathname.replace(/^\/|\/$/g, '');
  if (pre && !/^(blog|news|posts|articles|insights)$/i.test(pre)) {
    const f = found.filter((u) => new URL(u).pathname.replace(/^\//, '').startsWith(pre + '/'));
    if (f.length >= 3) found = f;
  } else if (pre) {
    const f = found.filter((u) => {
      const p = new URL(u).pathname.toLowerCase();
      return p.includes('/' + pre.toLowerCase() + '/') || p.startsWith('/post/') || scorePostUrl(u) >= 4;
    });
    if (f.length) found = f;
  }
  found.sort((a, b) => scorePostUrl(b) - scorePostUrl(a));
  return found.slice(0, Math.max(max * 3, max));
}

function contentLen(n) {
  const clone = n.cloneNode(true);
  clone.querySelectorAll('script,style,nav,form,noscript,aside,footer,header').forEach((x) => x.remove());
  return txt(clone.innerHTML).length;
}

function pickContentNode(d) {
  const selectors = [
    '[itemprop="articleBody"]',
    '[data-hook="post-description"]',
    '[data-hook="post-content"]',
    '.blog-post-content',
    '.post-content',
    '.entry-content',
    'article .post-body',
    '.post-body',
    '.article-body',
    '.blog-content',
    '.rte',
    '.rich-text',
    '.d-rich-text',
    '[data-element-type="body"]',
    'article',
    '[role="main"]',
    'main',
    '#dmRoot',
    '#dm',
    '.dmRoot',
  ];
  for (const s of selectors) {
    const n = d.querySelector(s);
    if (n && contentLen(n) >= 120) return n;
  }
  const paras = d.querySelectorAll('.dmNewParagraph, .u_content_text, [data-auto="text"]');
  if (paras.length >= 2) {
    const parent = paras[0].closest('section, article, .dmRespCol, .dmInner, div') || paras[0].parentElement;
    if (parent && contentLen(parent) >= 120) return parent;
  }
  return d.querySelector(selectors.find((s) => d.querySelector(s)) || 'body');
}

function rewriteMedia(node, url) {
  node.querySelectorAll('img,source').forEach((i) => {
    const src = imgSrc(i, url);
    if (src) i.setAttribute('src', src);
    ['srcset', 'sizes', 'loading', 'data-src', 'data-lazy-src', 'data-srcset'].forEach((a) => i.removeAttribute(a));
  });
  node.querySelectorAll('[style*="url("]').forEach((el) => {
    const st = el.getAttribute('style') || '';
    el.setAttribute('style', st.replace(/url\((['"]?)(.*?)\1\)/gi, (_, q, u) => {
      if (!u || /^data:/i.test(u)) return `url(${q}${u}${q})`;
      return `url(${q}${cleanImageUrl(abs(u, url))}${q})`;
    }));
  });
  node.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', abs(a.getAttribute('href'), url)));
}

async function scrape(url) {
  const html = await get(url);
  if (!html) return null;
  const d = new DOMParser().parseFromString(html, 'text/html');
  const meta = (n) => {
    const m = d.querySelector(`meta[property="${n}"],meta[name="${n}"]`);
    return m ? (m.getAttribute('content') || '').trim() : '';
  };
  const ld = ldArticle(d);
  const node = pickContentNode(d);
  if (!node && !(ld && (ld.articleBody || ld.description))) return null;
  let content = '';
  if (node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script,style,nav,form,noscript,aside,footer').forEach((n) => n.remove());
    rewriteMedia(clone, url);
    content = clone.innerHTML;
  }
  if (ld && ld.articleBody && txt(String(ld.articleBody)).length > txt(content).length) {
    content = String(ld.articleBody);
    if (!/<[a-z]/i.test(content)) content = `<p>${content}</p>`;
  }
  content = maybeUnescape(content);
  const textLen = txt(content).length;
  const ogType = (meta('og:type') || '').toLowerCase();
  const isArticle = /article|blog/.test(ogType) || !!ld;
  if (textLen < (isArticle ? 80 : 180)) return null;
  const h1 = d.querySelector('article h1, h1, .blog-post-title, [data-hook="post-title"]');
  const title = (h1 && h1.textContent.trim()) || (ld && ld.headline) || meta('og:title') || (d.title || '').trim();
  if (!title) return null;
  const img = cleanImageUrl(meta('og:image') || meta('twitter:image') || ldImage(ld));
  const tm = d.querySelector('time[datetime]');
  const date = meta('article:published_time') || meta('datePublished') || (ld && (ld.datePublished || ld.dateCreated)) || (tm ? tm.getAttribute('datetime') : '');
  const sec = meta('article:section');
  const author = meta('author') || meta('article:author') || (ld && (ld.author && (ld.author.name || ld.author))) || '';
  return mk({
    title, content,
    excerpt: meta('og:description') || meta('description') || (ld && ld.description) || '',
    date,
    slug: slugify(new URL(url).pathname.split('/').filter(Boolean).pop() || title),
    url, image: img, image_alt: title,
    author: typeof author === 'string' ? author : '',
    categories: sec ? [sec] : [],
    tags: [...d.querySelectorAll('meta[property="article:tag"]')].map((m) => m.getAttribute('content')).filter(Boolean),
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function downloadImage(u) {
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: u, optimize: true }),
    });
    if (!r.ok) return '';
    const blob = await r.blob();
    if (!blob.size || blob.size > 2_000_000) return '';
    const type = blob.type || 'image/jpeg';
    if (!/^image\//i.test(type) && blob.size < 100) return '';
    return await blobToDataUrl(blob);
  } catch {
    return '';
  }
}

// Author, categories and tags from the post page (meta tags + JSON-LD), for posts whose
// source (usually an RSS feed) did not include them.
async function enrichFromPage(post) {
  delete post.needs_meta;
  const html = await get(post.url);
  if (!html) return post;
  const d = new DOMParser().parseFromString(html, 'text/html');
  const meta = (n) => {
    const m = d.querySelector(`meta[property="${n}"],meta[name="${n}"]`);
    return m ? (m.getAttribute('content') || '').trim() : '';
  };
  const ld = ldArticle(d);
  if (!post.author) {
    const a = ld && ld.author ? [].concat(ld.author)[0] : null;
    const name = (a && (typeof a === 'string' ? a : a.name)) || meta('author') || meta('article:author');
    if (name && !/^https?:/i.test(name)) post.author = String(name).trim();
  }
  if (!post.categories.length) {
    const sec = meta('article:section') || (ld && [].concat(ld.articleSection || [])[0]) || '';
    if (sec) post.categories = [String(sec)];
  }
  if (!post.tags.length) {
    const tags = [...d.querySelectorAll('meta[property="article:tag"]')].map((m) => m.getAttribute('content')).filter(Boolean);
    const kw = ld && ld.keywords ? [].concat(ld.keywords).join(',').split(',').map((k) => k.trim()).filter(Boolean) : [];
    post.tags = [...new Set(tags.length ? tags : kw)];
  }
  if (!post.image) post.image = cleanImageUrl(meta('og:image') || ldImage(ld));
  return post;
}

// Only the cover is downloaded, for the preview thumbnail. Post bodies keep their
// original absolute image URLs: importers (WordPress, Wix, Shopify, Webflow...)
// fetch remote images into their own media library, but reject base64 data: URIs.
async function previewCover(post) {
  if (!post.image || /^data:/i.test(post.image)) return post;
  const data = await downloadImage(post.image);
  if (data) post.image_data = data;
  return post;
}

export async function crawl(input, max, onStatus, onUpdate) {
  const url = norm(input);
  if (!url) throw new Error('Please enter a valid URL.');
  onStatus('Looking for posts…');
  let posts = await viaRest(url, max);
  let skipped = 0;
  if (!posts.length) {
    onStatus('Checking RSS / Atom feeds…');
    posts = await viaFeed(url, max);
  }
  if (!posts.length) {
    const urls = await findUrls(url, max);
    if (!urls.length) throw new Error('No posts found on that URL. Try the blog listing page (for example /blog).');
    const seen = new Set();
    for (let i = 0; i < urls.length && posts.length < max; i++) {
      if (seen.has(urls[i])) continue;
      seen.add(urls[i]);
      onStatus(`Scraping post ${posts.length + 1} of ${max} (page ${i + 1}/${urls.length})…`);
      const p = await scrape(urls[i]);
      if (p) {
        posts.push(p);
        onUpdate([...posts]);
      } else skipped++;
    }
  } else {
    onUpdate([...posts]);
  }
  for (let i = 0; i < posts.length; i++) {
    onStatus(`Loading post details ${i + 1} of ${posts.length}…`);
    if (posts[i].needs_meta) posts[i] = await enrichFromPage(posts[i]);
    posts[i] = await previewCover(posts[i]);
    onUpdate([...posts]);
  }
  return { posts, skipped };
}
