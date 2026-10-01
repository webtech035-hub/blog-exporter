import { slugify, txt, imgSrc } from './crawler.js';

const cd = (s) => '<![CDATA[' + String(s == null ? '' : s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
const ex = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (p) => p.date.replace(' ', 'T') + 'Z';
const login = (s) => s.toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'admin';
const csv = (rows) => '﻿' + rows.map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
const isHttp = (u) => /^https?:\/\//i.test(u || '');
const absUrl = (h, b) => { try { return new URL(h, b).href; } catch { return ''; } };

// ---------------------------------------------------------------------------
// Content normalisation
//
// Scraped post bodies are full of page-builder wrappers (div/span soup, classes,
// inline styles, lazy-load attributes). Importers either show that as raw code or
// mangle it, so every post is reduced to a small list of semantic blocks first,
// then rendered per platform (plain HTML or Gutenberg block markup).
// ---------------------------------------------------------------------------

const DROP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM', 'NAV', 'ASIDE', 'FOOTER', 'SVG', 'CANVAS', 'LINK', 'META', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO', 'DIALOG']);
const INLINE = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'SUB', 'SUP', 'S', 'DEL', 'STRIKE', 'SPAN', 'U', 'FONT', 'SMALL', 'MARK', 'ABBR', 'TIME', 'LABEL', 'CITE', 'Q', 'INS', 'KBD', 'BIG']);
const INLINE_KEEP = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', CODE: 'code', SUB: 'sub', SUP: 'sup', S: 's', DEL: 's', STRIKE: 's', MARK: 'mark', KBD: 'kbd' };

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isEmptyHtml = (h) => !String(h).replace(/<br\s*\/?>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;|[\s ​]/g, '');
// Keep edge whitespace outside inline tags: "<a> link </a>" -> " <a>link</a> ".
function wrapTag(inner, open, close) {
  const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return isEmptyHtml(m[2]) ? inner : m[1] + open + m[2] + close + m[3];
}
const trimRun = (h) => String(h).replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');

function hasBlockChild(el) {
  return !!el.querySelector('img,picture,p,div,section,article,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,table,figure,iframe,pre,hr');
}

function inlineHtml(node, base) {
  let out = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { out += escText(c.nodeValue.replace(/[\s​]+/g, ' ')); return; }
    if (c.nodeType !== 1) return;
    const t = c.tagName;
    if (DROP.has(t) || t === 'IMG' || t === 'PICTURE') return;
    if (t === 'BR') { out += '<br>'; return; }
    const inner = inlineHtml(c, base);
    if (t === 'A') {
      const href = absUrl(c.getAttribute('href') || '', base);
      out += href && isHttp(href) || /^mailto:/i.test(href) ? wrapTag(inner, `<a href="${ex(href)}">`, '</a>') : inner;
      return;
    }
    const keep = INLINE_KEEP[t];
    if (keep) { out += wrapTag(inner, `<${keep}>`, `</${keep}>`); return; }
    if (/^(P|DIV|LI|H[1-6])$/.test(t)) { out += (out && !/<br>$/.test(out) ? '<br>' : '') + inner; return; }
    out += inner;
  });
  return out;
}

function listBlock(el, base) {
  const items = [];
  [...el.children].forEach((li) => {
    if (li.tagName !== 'LI') return;
    const clone = li.cloneNode(true);
    const subs = [...clone.querySelectorAll(':scope > ul, :scope > ol')];
    subs.forEach((s) => s.remove());
    const html = trimRun(inlineHtml(clone, base));
    const sub = subs.map((s) => listBlock(s, base)).find((b) => b.items.length) || null;
    if (!isEmptyHtml(html) || sub) items.push({ html, sub });
  });
  return { type: 'list', ordered: el.tagName === 'OL', items };
}

function tableHtml(el, base) {
  const rows = [...el.querySelectorAll('tr')].map((tr) => {
    const cells = [...tr.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map((c) => {
      const tag = c.tagName.toLowerCase();
      const span = ['colspan', 'rowspan'].map((a) => (c.getAttribute(a) && +c.getAttribute(a) > 1 ? ` ${a}="${+c.getAttribute(a)}"` : '')).join('');
      return `<${tag}${span}>${trimRun(inlineHtml(c, base))}</${tag}>`;
    });
    return cells.length ? `<tr>${cells.join('')}</tr>` : '';
  }).filter(Boolean);
  return rows.length ? `<table><tbody>${rows.join('')}</tbody></table>` : '';
}

function imageBlock(img, base, caption) {
  const src = imgSrc(img, base);
  if (!isHttp(src)) return null;
  return { type: 'img', src, alt: (img.getAttribute('alt') || '').trim(), caption: caption || '' };
}

function embedBlock(el, base) {
  const src = absUrl(el.getAttribute('src') || el.getAttribute('data-src') || '', base);
  return isHttp(src) ? { type: 'embed', src } : null;
}

function walk(node, ctx) {
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { ctx.run += escText(c.nodeValue.replace(/[\s​]+/g, ' ')); return; }
    if (c.nodeType !== 1) return;
    const t = c.tagName;
    if (DROP.has(t)) return;
    if (t === 'BR') { ctx.run += '<br>'; return; }
    if (INLINE.has(t) && !hasBlockChild(c)) {
      const wrap = c.ownerDocument.createElement('span');
      wrap.appendChild(c.cloneNode(true));
      ctx.run += inlineHtml(wrap, ctx.base);
      return;
    }
    flush(ctx);
    if (t === 'IMG') { push(ctx, imageBlock(c, ctx.base)); return; }
    if (t === 'IFRAME') { push(ctx, embedBlock(c, ctx.base)); return; }
    if (t === 'HR') { push(ctx, { type: 'hr' }); return; }
    if (/^H[1-6]$/.test(t)) {
      const html = trimRun(inlineHtml(c, ctx.base));
      const same = txt(html).toLowerCase() === ctx.title;
      if (!isEmptyHtml(html) && !(same && !ctx.blocks.length)) push(ctx, { type: 'h', level: Math.max(2, +t[1]), html });
      c.querySelectorAll('img').forEach((i) => push(ctx, imageBlock(i, ctx.base)));
      return;
    }
    if (t === 'UL' || t === 'OL') {
      const b = listBlock(c, ctx.base);
      if (b.items.length) push(ctx, b);
      return;
    }
    if (t === 'PRE') {
      const text = c.textContent.replace(/\s+$/, '');
      if (text.trim()) push(ctx, { type: 'pre', text });
      return;
    }
    if (t === 'TABLE') {
      const html = tableHtml(c, ctx.base);
      if (html) push(ctx, { type: 'table', html });
      return;
    }
    if (t === 'BLOCKQUOTE') {
      const sub = { blocks: [], run: '', base: ctx.base, title: '' };
      walk(c, sub);
      flush(sub);
      if (sub.blocks.length) push(ctx, { type: 'quote', blocks: sub.blocks });
      return;
    }
    if (t === 'FIGURE' || t === 'PICTURE') {
      const imgs = c.querySelectorAll('img');
      const frame = c.querySelector('iframe');
      const cap = c.querySelector('figcaption');
      if (imgs.length === 1 && !c.querySelector('p,ul,ol,table,h1,h2,h3,h4,h5,h6')) {
        push(ctx, imageBlock(imgs[0], ctx.base, cap ? trimRun(inlineHtml(cap, ctx.base)) : ''));
        return;
      }
      if (frame && !imgs.length) { push(ctx, embedBlock(frame, ctx.base)); return; }
    }
    // P, DIV, SECTION, ARTICLE, FIGCAPTION, inline elements wrapping blocks, unknown tags:
    // treat as a paragraph boundary and keep walking the children.
    walk(c, ctx);
    flush(ctx);
  });
}

function push(ctx, b) {
  if (!b) return;
  const last = ctx.blocks[ctx.blocks.length - 1];
  if (b.type === 'img' && last && last.type === 'img' && last.src === b.src) return;
  ctx.blocks.push(b);
}

function flush(ctx) {
  const html = trimRun(ctx.run.replace(/ {2,}/g, ' '))
    .replace(/(<\/(?:a|strong|em)>) +([,.;:!?])/g, '$1$2')
    .replace(/(<br>\s*){3,}/g, '<br><br>');
  ctx.run = '';
  if (!isEmptyHtml(html)) ctx.blocks.push({ type: 'p', html });
}

// Site builders (Duda, Wix, GoDaddy...) often style section titles as a bold line
// instead of a heading. A paragraph that is only one short bold run becomes an H2.
function promoteBoldHeadings(blocks) {
  return blocks.map((b) => {
    if (b.type !== 'p') return b;
    const m = b.html.match(/^<strong>([\s\S]*)<\/strong>$/);
    if (!m || /<\/?strong>|<br>/.test(m[1])) return b;
    const text = txt(m[1]);
    if (!text || text.length > 120 || /[.:,;]$/.test(text)) return b;
    return { type: 'h', level: 2, html: m[1] };
  });
}

function toBlocks(p) {
  const d = new DOMParser().parseFromString(p.content || '', 'text/html');
  const ctx = { blocks: [], run: '', base: p.url || 'https://example.com/', title: String(p.title || '').trim().toLowerCase() };
  walk(d.body, ctx);
  flush(ctx);
  return promoteBoldHeadings(ctx.blocks);
}

function coverBlock(p) {
  return isHttp(p.image) ? { type: 'img', src: p.image, alt: p.image_alt || p.title || '', caption: '' } : null;
}

// Blocks for a post; optionally prepend the cover image when the body does not already show it.
// withCover false: the platform shows the featured image itself, so drop it from the top of the body.
function postBlocks(p, withCover) {
  const blocks = toBlocks(p);
  const cover = coverBlock(p);
  if (!cover) return blocks;
  if (withCover) {
    if (!blocks.some((b) => b.type === 'img' && b.src === cover.src)) blocks.unshift(cover);
  } else if (blocks[0] && blocks[0].type === 'img' && blocks[0].src === cover.src) {
    blocks.shift();
  }
  return blocks;
}

function imageUrls(blocks, out = []) {
  blocks.forEach((b) => {
    if (b.type === 'img') out.push(b.src);
    if (b.type === 'quote') imageUrls(b.blocks, out);
  });
  return out;
}

// ---- Plain semantic HTML (Wix, Squarespace, Shopify, Webflow, Ghost, CSV) ----

function listHtml(b) {
  const tag = b.ordered ? 'ol' : 'ul';
  return `<${tag}>${b.items.map((i) => `<li>${i.html}${i.sub ? listHtml(i.sub) : ''}</li>`).join('')}</${tag}>`;
}

function embedHtml(src) {
  return `<iframe src="${ex(src)}" width="560" height="315" frameborder="0" allowfullscreen></iframe>`;
}

function blockHtml(b) {
  switch (b.type) {
    case 'p': return `<p>${b.html}</p>`;
    case 'h': return `<h${b.level}>${b.html}</h${b.level}>`;
    case 'list': return listHtml(b);
    case 'img': return `<figure><img src="${ex(b.src)}" alt="${ex(b.alt)}" />${b.caption ? `<figcaption>${b.caption}</figcaption>` : ''}</figure>`;
    case 'hr': return '<hr />';
    case 'pre': return `<pre><code>${escText(b.text)}</code></pre>`;
    case 'table': return b.html;
    case 'quote': return `<blockquote>${b.blocks.map(blockHtml).join('')}</blockquote>`;
    case 'embed': return embedHtml(b.src);
    default: return '';
  }
}

const toHtml = (blocks) => blocks.map(blockHtml).join('\n');

// ---- Gutenberg block markup (WordPress) ----
// Each block is serialised exactly as the core block's save() produces it so the
// editor shows native Paragraph / Heading / Image / List blocks instead of a
// "Custom HTML" block full of source code.

const gb = (name, attrs, inner) => `<!-- wp:${name}${attrs ? ' ' + JSON.stringify(attrs) : ''} -->\n${inner}\n<!-- /wp:${name} -->`;

function gbList(b) {
  const tag = b.ordered ? 'ol' : 'ul';
  const items = b.items.map((i) => gb('list-item', null, `<li>${i.html}${i.sub ? gbList(i.sub) : ''}</li>`)).join('\n\n');
  return gb('list', b.ordered ? { ordered: true } : null, `<${tag} class="wp-block-list">${items}</${tag}>`);
}

function blockGutenberg(b) {
  switch (b.type) {
    case 'p': return gb('paragraph', null, `<p>${b.html}</p>`);
    case 'h': return gb('heading', b.level === 2 ? null : { level: b.level }, `<h${b.level} class="wp-block-heading">${b.html}</h${b.level}>`);
    case 'list': return gbList(b);
    case 'img': return gb('image', null, `<figure class="wp-block-image"><img src="${ex(b.src)}" alt="${ex(b.alt)}"/>${b.caption ? `<figcaption class="wp-element-caption">${b.caption}</figcaption>` : ''}</figure>`);
    case 'hr': return gb('separator', null, '<hr class="wp-block-separator has-alpha-channel-opacity"/>');
    case 'pre': return gb('code', null, `<pre class="wp-block-code"><code>${escText(b.text)}</code></pre>`);
    // Tables go in as a Classic block: WordPress renders them formatted and they stay editable.
    case 'table': return b.html;
    case 'quote': return gb('quote', null, `<blockquote class="wp-block-quote">${b.blocks.map(blockGutenberg).join('\n\n')}</blockquote>`);
    case 'embed': return gb('html', null, embedHtml(b.src));
    default: return '';
  }
}

const toGutenberg = (blocks) => blocks.map(blockGutenberg).join('\n\n');

// ---- Hosted images ----
// Importers download images by URL. Many sites block those downloads (firewalls,
// hotlink protection) or serve WebP/AVIF that WordPress rejects, so exports can route
// every image through this app's /api/image endpoint, which fetches it like a browser
// and returns a real JPEG/PNG under a clean file name.

const IMAGE_EXT = { jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif' };

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hostedName(u) {
  let base = 'image', ext = '';
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '');
    const m = last.match(/^(.*?)(?:\.([a-z0-9]{2,5}))?$/i);
    base = (m[1] || 'image').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'image';
    ext = IMAGE_EXT[(m[2] || '').toLowerCase()] || '';
  } catch { /* keep defaults */ }
  return `${base}.${ext || 'jpg'}`;
}

function imageHoster(host) {
  if (!host) return (u) => u;
  const root = host.replace(/\/+$/, '');
  return (u) => (isHttp(u) ? `${root}/api/image/${b64url(u)}/${hostedName(u)}` : u);
}

function mapImages(blocks, fn) {
  return blocks.map((b) => {
    if (b.type === 'img') return { ...b, src: fn(b.src) };
    if (b.type === 'quote') return { ...b, blocks: mapImages(b.blocks, fn) };
    return b;
  });
}

function fileNameFromUrl(u, fallback) {
  try {
    const name = new URL(u).pathname.split('/').filter(Boolean).pop() || fallback;
    return decodeURIComponent(name).replace(/[^a-zA-Z0-9._~-]/g, '') || fallback;
  } catch {
    return fallback;
  }
}

// WordPress WXR 1.2 (also accepted by Wix and Squarespace).
// Every image (featured + in-body) is exported as an attachment item. The WordPress
// importer downloads each one into the Media Library and rewrites the matching URLs
// inside post content, so images end up hosted on the new site.
// Tags are one-per-line so the WordPress regex importer can parse content:encoded.
function wxr(posts, opts) {
  const { gutenberg, cover } = opts;
  const hosted = imageHoster(opts.imageHost);
  const host = new URL(posts[0].url).host;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<rss version="2.0"',
    '  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"',
    '  xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    '  xmlns:wfw="http://wellformedweb.org/CommentAPI/"',
    '  xmlns:dc="http://purl.org/dc/elements/1.1/"',
    '  xmlns:wp="http://wordpress.org/export/1.2/">',
    '<channel>',
    `<title>${ex(host)}</title>`,
    `<link>https://${ex(host)}</link>`,
    '<description></description>',
    '<language>en-US</language>',
    '<wp:wxr_version>1.2</wp:wxr_version>',
    `<wp:base_site_url>https://${ex(host)}</wp:base_site_url>`,
    `<wp:base_blog_url>https://${ex(host)}</wp:base_blog_url>`,
  ];
  const au = {};
  posts.forEach((p) => { if (p.author) au[login(p.author)] = p.author; });
  Object.entries(au).forEach(([l, n], i) => {
    lines.push('<wp:author>');
    lines.push(`<wp:author_id>${i + 1}</wp:author_id>`);
    lines.push(`<wp:author_login>${cd(l)}</wp:author_login>`);
    lines.push(`<wp:author_email>${cd('')}</wp:author_email>`);
    lines.push(`<wp:author_display_name>${cd(n)}</wp:author_display_name>`);
    lines.push('</wp:author>');
  });

  let n = 1000;
  const attachments = new Map(); // url -> attachment id (one media item per unique image)
  const usedNames = new Set();
  const uniqueName = (base) => {
    let name = base, i = 2;
    while (usedNames.has(name)) name = `${base}-${i++}`;
    usedNames.add(name);
    return name;
  };

  for (const p of posts) {
    const pid = ++n;
    const rfc = new Date(iso(p)).toUTCString().replace('GMT', '+0000');
    // WordPress themes show the featured image themselves, so it is not repeated in the body.
    const blocks = mapImages(postBlocks(p, cover), hosted);
    const content = gutenberg ? toGutenberg(blocks) : toHtml(blocks);
    const featured = isHttp(p.image) ? hosted(p.image) : '';
    const media = [...new Set([featured, ...imageUrls(blocks)].filter(Boolean))].filter((u) => !attachments.has(u));
    const mediaItems = media.map((u) => {
      const aid = ++n;
      attachments.set(u, aid);
      return { u, aid };
    });

    lines.push('<item>');
    lines.push(`<title>${cd(p.title)}</title>`);
    lines.push(`<link>${ex(p.url)}</link>`);
    lines.push(`<pubDate>${rfc}</pubDate>`);
    lines.push(`<dc:creator>${cd(p.author ? login(p.author) : 'admin')}</dc:creator>`);
    lines.push(`<guid isPermaLink="false">${ex(p.url)}</guid>`);
    lines.push('<description></description>');
    lines.push(`<content:encoded>${cd(content)}</content:encoded>`);
    lines.push(`<excerpt:encoded>${cd(txt(p.excerpt))}</excerpt:encoded>`);
    lines.push(`<wp:post_id>${pid}</wp:post_id>`);
    lines.push(`<wp:post_date>${cd(p.date)}</wp:post_date>`);
    lines.push(`<wp:post_date_gmt>${cd(p.date)}</wp:post_date_gmt>`);
    lines.push(`<wp:comment_status>${cd('closed')}</wp:comment_status>`);
    lines.push(`<wp:ping_status>${cd('closed')}</wp:ping_status>`);
    lines.push(`<wp:post_name>${cd(p.slug)}</wp:post_name>`);
    lines.push(`<wp:status>${cd('publish')}</wp:status>`);
    lines.push('<wp:post_parent>0</wp:post_parent>');
    lines.push('<wp:menu_order>0</wp:menu_order>');
    lines.push(`<wp:post_type>${cd('post')}</wp:post_type>`);
    lines.push('<wp:is_sticky>0</wp:is_sticky>');
    p.categories.forEach((x) => {
      lines.push(`<category domain="category" nicename="${ex(slugify(x))}">${cd(x)}</category>`);
    });
    p.tags.forEach((x) => {
      lines.push(`<category domain="post_tag" nicename="${ex(slugify(x))}">${cd(x)}</category>`);
    });
    if (featured) {
      lines.push('<wp:postmeta>');
      lines.push(`<wp:meta_key>${cd('_thumbnail_id')}</wp:meta_key>`);
      lines.push(`<wp:meta_value>${cd(String(attachments.get(featured)))}</wp:meta_value>`);
      lines.push('</wp:postmeta>');
    }
    lines.push('</item>');

    mediaItems.forEach(({ u, aid }, i) => {
      const fn = fileNameFromUrl(u, `${slugify(p.slug)}-${i + 1}.jpg`);
      // The importer skips attachments whose title + date already exist, so titles must be unique.
      const name = uniqueName(slugify(fn.replace(/\.[a-z0-9]+$/i, '')));
      lines.push('<item>');
      lines.push(`<title>${cd(name)}</title>`);
      lines.push(`<link>${ex(u)}</link>`);
      lines.push(`<pubDate>${rfc}</pubDate>`);
      lines.push(`<dc:creator>${cd(p.author ? login(p.author) : 'admin')}</dc:creator>`);
      lines.push(`<guid isPermaLink="false">${ex(u)}</guid>`);
      lines.push('<description></description>');
      lines.push(`<content:encoded>${cd('')}</content:encoded>`);
      lines.push(`<excerpt:encoded>${cd('')}</excerpt:encoded>`);
      lines.push(`<wp:post_id>${aid}</wp:post_id>`);
      lines.push(`<wp:post_date>${cd(p.date)}</wp:post_date>`);
      lines.push(`<wp:post_date_gmt>${cd(p.date)}</wp:post_date_gmt>`);
      lines.push(`<wp:comment_status>${cd('closed')}</wp:comment_status>`);
      lines.push(`<wp:ping_status>${cd('closed')}</wp:ping_status>`);
      lines.push(`<wp:post_name>${cd(name)}</wp:post_name>`);
      lines.push(`<wp:status>${cd('inherit')}</wp:status>`);
      lines.push(`<wp:post_parent>${pid}</wp:post_parent>`);
      lines.push('<wp:menu_order>0</wp:menu_order>');
      lines.push(`<wp:post_type>${cd('attachment')}</wp:post_type>`);
      lines.push(`<wp:attachment_url>${cd(u)}</wp:attachment_url>`);
      if (u === featured && (p.image_alt || p.title)) {
        lines.push('<wp:postmeta>');
        lines.push(`<wp:meta_key>${cd('_wp_attachment_image_alt')}</wp:meta_key>`);
        lines.push(`<wp:meta_value>${cd(p.image_alt || p.title)}</wp:meta_value>`);
        lines.push('</wp:postmeta>');
      }
      lines.push('</item>');
    });
  }
  lines.push('</channel>', '</rss>', '');
  return lines.join('\n');
}

const cleanHtml = (p, withCover = true, host = (u) => u) => toHtml(mapImages(postBlocks(p, withCover), host));
const shopifyDate = (p) => p.date + ' +0000';
const imageSrc = (p, host = (u) => u) => (isHttp(p.image) ? host(p.image) : '');
const summary = (p) => txt(p.excerpt);

function ghostId(i) {
  return Date.now().toString(16).padStart(12, '0').slice(-12) + i.toString(16).padStart(12, '0').slice(-12);
}

function ghost(posts) {
  const tagIds = new Map();
  const postsTags = [];
  const out = posts.map((p, i) => {
    const id = ghostId(i);
    p.categories.concat(p.tags).forEach((name, order) => {
      if (!tagIds.has(name)) tagIds.set(name, ghostId(100000 + tagIds.size));
      postsTags.push({ post_id: id, tag_id: tagIds.get(name), sort_order: order });
    });
    return {
      id, title: p.title, slug: p.slug, html: cleanHtml(p, false),
      feature_image: imageSrc(p) || null, feature_image_alt: imageSrc(p) ? (p.image_alt || p.title) : null,
      featured: false, status: 'published', visibility: 'public', type: 'post',
      created_at: iso(p), updated_at: iso(p), published_at: iso(p),
      custom_excerpt: summary(p).slice(0, 290) || null,
    };
  });
  const tags = [...tagIds].map(([name, id]) => ({ id, name, slug: slugify(name) }));
  return JSON.stringify({ db: [{ meta: { exported_on: Date.now(), version: '5.0.0' }, data: { posts: out, tags, posts_tags: postsTags } }] }, null, 2);
}

export const FORMATS = {
  wordpress: {
    label: 'WordPress (.xml)', ext: 'xml', mime: 'application/xml',
    hint: 'WordPress: Tools → Import → WordPress. Upload the XML, assign an author, and tick "Download and import file attachments". Posts import as native blocks (paragraphs, headings, images, lists). Every image is converted to JPG/PNG and downloaded into your Media Library, even from sites that block downloads, and the featured image is set.',
    build: (p, blog, o) => wxr(p, { gutenberg: true, cover: false, imageHost: o.imageHost }),
  },
  wix: {
    label: 'Wix (.xml)', ext: 'xml', mime: 'application/xml',
    hint: 'Wix: Dashboard → Blog → More Actions → Import posts → "By using a WordPress XML file", then upload this file. Wix copies the images into your site and imports categories; it does not import authors or tags.',
    build: (p, blog, o) => wxr(p, { gutenberg: false, cover: true, imageHost: o.imageHost }),
  },
  squarespace: {
    label: 'Squarespace (.xml)', ext: 'xml', mime: 'application/xml',
    hint: 'Squarespace: Settings → Website → Import & Export Content → Import → WordPress → Advanced, upload this file and choose the "Standard WordPress" processor. The blog appears under "Not linked" in the Pages panel.',
    build: (p, blog, o) => wxr(p, { gutenberg: false, cover: true, imageHost: o.imageHost }),
  },
  shopify: {
    label: 'Shopify (.csv)', ext: 'csv', mime: 'text/csv', name: 'shopify-blog-posts',
    hint: 'Shopify has no built-in blog import. Install the Matrixify app and import this file as is (its name must contain "blog-posts" so Matrixify recognises it). Posts go into the blog named above, and cover images are copied from their URLs.',
    build: (posts, blog, o) => csv([['Handle', 'Command', 'Title', 'Author', 'Body HTML', 'Summary HTML', 'Tags', 'Published', 'Published At', 'Image Src', 'Image Alt Text', 'Blog: Handle', 'Blog: Title', 'Blog: Commentable']]
      .concat(posts.map((p) => [p.slug, 'MERGE', p.title, p.author, cleanHtml(p, false), summary(p) ? '<p>' + ex(summary(p)) + '</p>' : '', p.categories.concat(p.tags).join(', '), 'TRUE', shopifyDate(p), imageSrc(p, imageHoster(o.imageHost)), p.image_alt || p.title, slugify(blog || 'news'), blog || 'News', 'no']))),
  },
  webflow: {
    label: 'Webflow (.csv)', ext: 'csv', mime: 'text/csv',
    hint: 'Webflow: CMS → your Blog Posts collection → Import → upload this CSV and map the columns (Post Body → Rich Text, Main Image → Image, Publish Date → Date). Webflow copies the main image into its CDN; images inside the body stay linked to their original URLs.',
    build: (posts, blog, o) => csv([['Name', 'Slug', 'Post Body', 'Post Summary', 'Main Image', 'Publish Date', 'Author', 'Categories', 'Tags', 'Original URL', 'Archived', 'Draft']]
      .concat(posts.map((p) => [p.title, p.slug, cleanHtml(p, false), summary(p), imageSrc(p, imageHoster(o.imageHost)), iso(p), p.author, p.categories.join(', '), p.tags.join(', '), p.url, 'false', 'false']))),
  },
  ghost: {
    label: 'Ghost (.json)', ext: 'json', mime: 'application/json', hint: 'Ghost: Settings → Advanced → Import/Export → Import content.',
    build: ghost,
  },
  csv: {
    label: 'Generic CSV', ext: 'csv', mime: 'text/csv', hint: 'Generic spreadsheet with all fields.',
    build: (posts) => csv([['title', 'slug', 'date_gmt', 'author', 'featured_image', 'excerpt', 'content_html', 'categories', 'tags', 'source_url']]
      .concat(posts.map((p) => [p.title, p.slug, p.date, p.author, imageSrc(p), summary(p), cleanHtml(p), p.categories.join(', '), p.tags.join(', '), p.url]))),
  },
  json: {
    label: 'Generic JSON', ext: 'json', mime: 'application/json', hint: 'JSON of every crawled post, with cleaned HTML.',
    build: (posts) => JSON.stringify(posts.map(({ image_data, image_map, ...p }) => ({ ...p, content: cleanHtml(p) })), null, 2),
  },
};

// opts.imageHost: public origin of this app (e.g. https://blog-exporter.vercel.app). When set,
// formats whose importer downloads images get URLs on this app's /api/image endpoint.
export const buildFile = (key, posts, blog, opts = {}) => FORMATS[key].build(posts, blog, opts);
