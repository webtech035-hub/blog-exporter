import { slugify } from './crawler.js';

const cd = (s) => '<![CDATA[' + String(s == null ? '' : s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
const ex = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (p) => p.date.replace(' ', 'T') + 'Z';
const login = (s) => s.toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'admin';
const csv = (rows) => '\ufeff' + rows.map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');

function applyImages(html, map) {
  if (!html || !map) return html || '';
  let out = html;
  Object.keys(map).forEach((u) => {
    if (!u) return;
    out = out.split(u).join(map[u]);
    try {
      out = out.split(u.replace(/&/g, '&amp;')).join(map[u]);
    } catch { /* ignore */ }
  });
  return out;
}

function coverHtml(p) {
  const src = p.image_data || p.image;
  if (!src) return '';
  return `<p><img src="${/^data:/i.test(src) ? src : ex(src)}" alt="${ex(p.image_alt || p.title)}" /></p>`;
}

function bodyHtml(p, inlineCover) {
  let c = applyImages(p.content || '', p.image_map);
  if (inlineCover) {
    const src = p.image_data || p.image;
    if (src && !c.includes(src) && !(p.image && c.includes(p.image))) c = coverHtml(p) + c;
  }
  return c;
}

function wpBlocks(html) {
  if (/<!--\s*wp:/.test(html)) return html;
  return '<!-- wp:html -->\n' + html + '\n<!-- /wp:html -->';
}

function fileNameFromUrl(u, fallback) {
  if (!u || /^data:/i.test(u)) return fallback;
  try {
    const name = new URL(u).pathname.split('/').filter(Boolean).pop() || fallback;
    return decodeURIComponent(name).replace(/[^a-zA-Z0-9._-]/g, '') || fallback;
  } catch {
    return fallback;
  }
}

// WordPress WXR 1.2 (also used by Wix and Squarespace).
// Tags are one-per-line so the WordPress regex importer can parse content:encoded.
function wxr(posts, opts) {
  const { inline, gutenberg } = opts;
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
  for (const p of posts) {
    const pid = ++n;
    const rfc = new Date(iso(p)).toUTCString().replace('GMT', '+0000');
    let c = bodyHtml(p, inline || gutenberg);
    if (gutenberg) c = wpBlocks(c);
    const featuredHttp = p.image && !/^data:/i.test(p.image) ? p.image : '';
    const aid = featuredHttp ? ++n : 0;
    lines.push('<item>');
    lines.push(`<title>${cd(p.title)}</title>`);
    lines.push(`<link>${ex(p.url)}</link>`);
    lines.push(`<pubDate>${rfc}</pubDate>`);
    lines.push(`<dc:creator>${cd(p.author ? login(p.author) : 'admin')}</dc:creator>`);
    lines.push(`<guid isPermaLink="false">${ex(p.url)}</guid>`);
    lines.push('<description></description>');
    lines.push(`<content:encoded>${cd(c)}</content:encoded>`);
    lines.push(`<excerpt:encoded>${cd(p.excerpt)}</excerpt:encoded>`);
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
    if (aid) {
      lines.push('<wp:postmeta>');
      lines.push(`<wp:meta_key>${cd('_thumbnail_id')}</wp:meta_key>`);
      lines.push(`<wp:meta_value>${cd(String(aid))}</wp:meta_value>`);
      lines.push('</wp:postmeta>');
    }
    lines.push('</item>');
    if (aid) {
      const fn = fileNameFromUrl(featuredHttp, slugify(p.slug) + '.jpg');
      lines.push('<item>');
      lines.push(`<title>${cd(fn)}</title>`);
      lines.push(`<link>${ex(featuredHttp)}</link>`);
      lines.push(`<pubDate>${rfc}</pubDate>`);
      lines.push(`<dc:creator>${cd('admin')}</dc:creator>`);
      lines.push(`<guid isPermaLink="false">${ex(featuredHttp)}</guid>`);
      lines.push('<description></description>');
      lines.push(`<content:encoded>${cd('')}</content:encoded>`);
      lines.push(`<excerpt:encoded>${cd('')}</excerpt:encoded>`);
      lines.push(`<wp:post_id>${aid}</wp:post_id>`);
      lines.push(`<wp:post_date>${cd(p.date)}</wp:post_date>`);
      lines.push(`<wp:post_date_gmt>${cd(p.date)}</wp:post_date_gmt>`);
      lines.push(`<wp:post_name>${cd(slugify(fn))}</wp:post_name>`);
      lines.push(`<wp:status>${cd('inherit')}</wp:status>`);
      lines.push(`<wp:post_parent>${pid}</wp:post_parent>`);
      lines.push('<wp:menu_order>0</wp:menu_order>');
      lines.push(`<wp:post_type>${cd('attachment')}</wp:post_type>`);
      lines.push(`<wp:attachment_url>${cd(featuredHttp)}</wp:attachment_url>`);
      lines.push('</item>');
    }
  }
  lines.push('</channel>', '</rss>', '');
  return lines.join('\n');
}

function contentForCsv(p) {
  return applyImages(p.content || '', p.image_map);
}

function imageSrc(p) {
  if (p.image && !/^data:/i.test(p.image)) return p.image;
  return p.image_data || p.image || '';
}

export const FORMATS = {
  wordpress: {
    label: 'WordPress (.xml)', ext: 'xml', mime: 'application/xml',
    hint: 'WordPress: Tools → Import → WordPress. Upload the XML. Tick "Download and import file attachments". Images are also embedded in the post HTML so they still show if a remote download fails. Content is wrapped as a Gutenberg HTML block so it renders as formatted posts, not source code.',
    build: (p) => wxr(p, { inline: true, gutenberg: true }),
  },
  wix: {
    label: 'Wix (.xml)', ext: 'xml', mime: 'application/xml',
    hint: 'Wix: Blog dashboard → Import → WordPress, upload the file. Cover and body images are embedded in the post so Wix does not have to fetch the original CDN URLs.',
    build: (p) => wxr(p, { inline: true, gutenberg: false }),
  },
  squarespace: {
    label: 'Squarespace (.xml)', ext: 'xml', mime: 'application/xml',
    hint: 'Squarespace: Settings → Website → Import & Export → Import → WordPress.',
    build: (p) => wxr(p, { inline: true, gutenberg: false }),
  },
  shopify: {
    label: 'Shopify (.csv)', ext: 'csv', mime: 'text/csv',
    hint: 'Shopify has no native blog CSV import. Use an app such as Matrixify (Blog Posts import).',
    build: (posts, blog) => csv([['Handle', 'Command', 'Title', 'Author', 'Body HTML', 'Summary HTML', 'Tags', 'Published', 'Published At', 'Image Src', 'Image Alt Text', 'Blog: Handle', 'Blog: Title', 'Blog: Commentable']]
      .concat(posts.map((p) => [p.slug, 'MERGE', p.title, p.author, contentForCsv(p), '<p>' + ex(p.excerpt) + '</p>', p.categories.concat(p.tags).join(', '), 'TRUE', iso(p), imageSrc(p), p.image_alt, slugify(blog || 'news'), blog || 'News', 'no']))),
  },
  webflow: {
    label: 'Webflow (.csv)', ext: 'csv', mime: 'text/csv',
    hint: 'Webflow: create a CMS collection first, then Import CSV and map the columns to your fields.',
    build: (posts) => csv([['Name', 'Slug', 'Post Body', 'Post Summary', 'Main Image', 'Publish Date', 'Author', 'Categories', 'Tags', 'Original URL', 'Archived', 'Draft']]
      .concat(posts.map((p) => [p.title, p.slug, contentForCsv(p), p.excerpt, imageSrc(p), iso(p), p.author, p.categories.join(', '), p.tags.join(', '), p.url, 'false', 'false']))),
  },
  ghost: {
    label: 'Ghost (.json)', ext: 'json', mime: 'application/json', hint: 'Ghost: Settings → Labs → Import content.',
    build: (posts) => JSON.stringify({ db: [{ meta: { exported_on: Date.now(), version: '5.0.0' }, data: { posts: posts.map((p, i) => ({ id: (Date.now().toString(16) + i.toString(16).padStart(12, '0')).slice(-24), title: p.title, slug: p.slug, html: contentForCsv(p), feature_image: imageSrc(p) || null, featured: false, status: 'published', visibility: 'public', created_at: iso(p), updated_at: iso(p), published_at: iso(p), custom_excerpt: (p.excerpt || '').slice(0, 290) })), tags: [], posts_tags: [] } }] }, null, 2),
  },
  csv: {
    label: 'Generic CSV', ext: 'csv', mime: 'text/csv', hint: 'Generic spreadsheet with all fields.',
    build: (posts) => csv([['title', 'slug', 'date_gmt', 'author', 'featured_image', 'excerpt', 'content_html', 'categories', 'tags', 'source_url']]
      .concat(posts.map((p) => [p.title, p.slug, p.date, p.author, imageSrc(p), p.excerpt, contentForCsv(p), p.categories.join(', '), p.tags.join(', '), p.url]))),
  },
  json: { label: 'Generic JSON', ext: 'json', mime: 'application/json', hint: 'Raw JSON of every crawled post.', build: (posts) => JSON.stringify(posts, null, 2) },
};

export const buildFile = (key, posts, blog) => FORMATS[key].build(posts, blog);
