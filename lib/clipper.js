// "Save to Blog Exporter" bookmark.
//
// For sites with bot protection, the user opens each post in their own browser (and
// passes any human check themselves). Clicking the bookmark reads the post from the
// page they are looking at - title, date, author, cover, body with images - and sends
// it to this app through a small popup (/clip), which hands it to the main tab.
// Nothing here fetches the site; it only reads the page already on screen.

const SOURCE = `(function (APP) {
  var d = document, here = location.href;
  function meta(n) {
    var m = d.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]');
    return m ? (m.getAttribute('content') || '').trim() : '';
  }
  function abs(u) { try { return new URL(u, here).href; } catch (e) { return ''; } }
  function text(el) { return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : ''; }

  var ld = null;
  d.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
    try {
      var j = JSON.parse(s.textContent);
      [].concat(j['@graph'] || j).forEach(function (x) {
        if (!ld && x && /Article|BlogPosting|NewsArticle|Posting/.test([].concat(x['@type']).join(' '))) ld = x;
      });
    } catch (e) {}
  });

  var sels = ['[itemprop="articleBody"]', '[data-hook="post-description"]', '[data-hook="post-content"]', '.entry-content',
    '.post-content', '.blog-post-content', '.article-content', '.article-body', '.post-body', '.blog-content', '.rte',
    '.sqs-layout', '.w-richtext', '.gh-content', 'article', '[role="main"]', 'main'];
  var node = null;
  for (var i = 0; i < sels.length && !node; i++) {
    var n = d.querySelector(sels[i]);
    if (n && text(n).length > 200) node = n;
  }
  node = node || d.body;

  var originals = node.querySelectorAll('img');
  var clone = node.cloneNode(true);
  clone.querySelectorAll('img').forEach(function (img, k) {
    var o = originals[k], src = '';
    ['data-src', 'data-lazy-src', 'data-original', 'data-pin-media'].forEach(function (a) {
      var v = o && o.getAttribute(a);
      if (!src && v && !/^data:/.test(v)) src = v;
    });
    var set = o && (o.getAttribute('srcset') || o.getAttribute('data-srcset'));
    if (!src && set) {
      var best = '', bw = -1;
      set.split(',').forEach(function (part) {
        var bits = part.trim().split(/\\s+/), w = parseInt(bits[1], 10) || 1;
        if (bits[0] && w >= bw) { bw = w; best = bits[0]; }
      });
      src = best;
    }
    if (!src && o) src = o.currentSrc || o.getAttribute('src') || '';
    if (src && !/^data:/.test(src)) img.setAttribute('src', abs(src)); else img.remove();
    ['srcset', 'sizes', 'loading', 'data-src', 'data-srcset', 'data-lazy-src'].forEach(function (a) { img.removeAttribute(a); });
  });
  clone.querySelectorAll('a[href]').forEach(function (a) { a.setAttribute('href', abs(a.getAttribute('href'))); });
  clone.querySelectorAll('script,style,noscript,nav,form,aside,footer,button,svg,canvas,template').forEach(function (x) { x.remove(); });

  var h1 = d.querySelector('article h1, main h1, h1');
  var author = ld && ld.author ? [].concat(ld.author)[0] : null;
  var tm = d.querySelector('time[datetime]');
  var ldImg = ld && ld.image ? [].concat(ld.image)[0] : '';
  var post = {
    url: (d.querySelector('link[rel="canonical"]') || {}).href || here,
    title: (ld && ld.headline) || text(h1) || meta('og:title') || d.title,
    content: clone.innerHTML,
    excerpt: meta('og:description') || meta('description') || (ld && ld.description) || '',
    date: meta('article:published_time') || (ld && (ld.datePublished || ld.dateCreated)) || (tm ? tm.getAttribute('datetime') : ''),
    author: (author && (typeof author === 'string' ? author : author.name)) || meta('author') || '',
    image: abs(meta('og:image') || meta('twitter:image') || (typeof ldImg === 'string' ? ldImg : (ldImg && ldImg.url)) || ''),
    categories: meta('article:section') ? [meta('article:section')] : [],
    tags: [].map.call(d.querySelectorAll('meta[property="article:tag"]'), function (m) { return m.getAttribute('content'); }).filter(Boolean)
  };

  var w = window.open(APP + '/clip', 'blogExporterClip', 'width=440,height=360');
  if (!w) { alert('Blog Exporter: please allow pop-ups for this site, then click Save again.'); return; }
  var tries = 0, timer = setInterval(function () {
    if (++tries > 60) { clearInterval(timer); return; }
    try { w.postMessage({ type: 'blog-exporter-clip', post: post }, APP); } catch (e) {}
  }, 250);
  window.addEventListener('message', function done(e) {
    if (e.origin === APP && e.data && e.data.type === 'blog-exporter-ack') {
      clearInterval(timer);
      window.removeEventListener('message', done);
    }
  });
})`;

export function bookmarkletHref(appOrigin) {
  const code = SOURCE.replace(/\n\s*/g, ' ') + '(' + JSON.stringify(appOrigin) + ');void 0';
  return 'javascript:' + encodeURIComponent(code);
}

export const CLIP_CHANNEL = 'blog-exporter';
export const CLIP_STORE = 'blog-exporter-clips';
