'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { crawl, words } from '../lib/crawler';
import { FORMATS, buildFile } from '../lib/exporters';

// Presentation details for each export format (FORMATS holds the file logic).
const PLATFORMS = {
  wordpress: { name: 'WordPress', file: 'WXR .xml', color: '#3858e9', mark: 'W' },
  wix: { name: 'Wix', file: 'WXR .xml', color: '#0c6efc', mark: 'Wx' },
  squarespace: { name: 'Squarespace', file: 'WXR .xml', color: 'var(--ink)', ink: true, mark: 'S' },
  shopify: { name: 'Shopify', file: 'Matrixify .csv', color: '#5e8e3e', mark: 'Sh' },
  webflow: { name: 'Webflow', file: 'CMS .csv', color: '#146ef5', mark: 'Wf' },
  ghost: { name: 'Ghost', file: 'Ghost .json', color: 'var(--ink)', ink: true, mark: 'G' },
  csv: { name: 'Spreadsheet', file: 'Generic .csv', color: '#0f9d58', mark: 'CSV' },
  json: { name: 'Developer', file: 'Generic .json', color: '#8b5cf6', mark: '{ }' },
};

// Brand mark CSS vars; black brands (ink) flip to white in dark mode.
const markVars = (pl) => ({ '--c': pl.color, '--mt': pl.ink ? 'var(--ink-tx)' : '#fff' });

const STEPS = ['Finding posts', 'Reading posts', 'Loading details', 'Ready'];

function stageOf(text, busy, done) {
  if (done) return 3;
  if (!busy) return -1;
  if (/Loading post details|cover/i.test(text)) return 2;
  if (/Scraping/i.test(text)) return 1;
  return 0;
}

function progressOf(text, stage) {
  const m = String(text).match(/(\d+) of (\d+)/);
  const frac = m ? Math.min(1, +m[1] / Math.max(1, +m[2])) : 0;
  if (stage === 0) return 8;
  if (stage === 1) return 15 + frac * 45;
  if (stage === 2) return 60 + frac * 38;
  return stage === 3 ? 100 : 0;
}

const fmtDate = (d) => {
  const t = new Date(String(d).replace(' ', 'T') + 'Z');
  return isNaN(t) ? d : t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const Icon = {
  globe: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></svg>,
  arrow: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  download: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  check: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
  alert: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>,
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>,
  doc: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></svg>,
  image: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 16l-5-5-8 8" /></svg>,
  user: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" /></svg>,
  sun: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></svg>,
  moon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>,
  monitor: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>,
  clock: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
};

export default function Home() {
  const [url, setUrl] = useState('');
  const [max, setMax] = useState(20);
  const [blog, setBlog] = useState('News');
  const [posts, setPosts] = useState([]);
  const [status, setStatus] = useState({ t: '', err: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [excluded, setExcluded] = useState(() => new Set());
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const resultsRef = useRef(null);
  // 'system' follows the OS setting via CSS; 'light' / 'dark' are saved overrides.
  const [theme, setTheme] = useState('');

  // The inline script in layout.js applies a saved choice before paint; mirror it here.
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'system');
  }, []);

  function chooseTheme(next) {
    const root = document.documentElement;
    try {
      if (next === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', next);
    } catch { /* storage blocked */ }
    if (next === 'system') delete root.dataset.theme;
    else root.dataset.theme = next;
    setTheme(next);
  }

  const stage = stageOf(status.t, busy, done);
  const progress = progressOf(status.t, stage);
  const selected = posts.filter((p) => !excluded.has(p.url));

  const stats = useMemo(() => {
    const w = posts.reduce((n, p) => n + words(p.content), 0);
    return {
      words: w,
      images: posts.filter((p) => p.image).length,
      authors: new Set(posts.map((p) => p.author).filter(Boolean)).size,
      minutes: Math.max(1, Math.round(w / 230)),
    };
  }, [posts]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? posts.filter((p) => p.title.toLowerCase().includes(q) || (p.author || '').toLowerCase().includes(q)) : posts;
  }, [posts, filter]);

  async function go(e) {
    if (e) e.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    setDone(false);
    setPosts([]);
    setExcluded(new Set());
    setFilter('');
    setActive('');
    setSkipped(0);
    setStatus({ t: 'Looking for posts…' });
    try {
      const n = Math.max(1, Math.min(200, +max || 20));
      const { posts: p, skipped: s } = await crawl(url, n, (t) => setStatus({ t }), setPosts);
      setPosts(p);
      setSkipped(s);
      if (p.length) {
        setDone(true);
        setStatus({ t: `Found ${p.length} post${p.length === 1 ? '' : 's'}` });
        setTimeout(() => resultsRef.current && resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      } else {
        setStatus({ t: 'Pages were found but no posts could be extracted. Try the blog listing page URL.', err: true });
      }
    } catch (err) {
      setStatus({ t: err.message, err: true });
    }
    setBusy(false);
  }

  function notify(msg) {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  function download(k) {
    if (!selected.length) return notify('Select at least one post to export');
    const f = FORMATS[k];
    const host = new URL(selected[0].url).host.replace(/[^a-z0-9.-]/gi, '');
    const name = `${host}-${f.name || k}.${f.ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildFile(k, selected, blog)], { type: f.mime + ';charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setActive(k);
    notify(`${name} downloaded · ${selected.length} post${selected.length === 1 ? '' : 's'}`);
  }

  function toggle(u) {
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(u)) n.delete(u); else n.add(u);
      return n;
    });
  }

  const allOn = excluded.size === 0;
  const showResults = posts.length > 0;

  return (
    <>
      <div className="bg" aria-hidden="true"><span className="blob b1" /><span className="blob b2" /><span className="blob b3" /><span className="grid" /></div>

      <header className="nav">
        <div className="brand"><span className="logo">{Icon.doc}</span>Blog Exporter</div>
        <div className="theme" role="radiogroup" aria-label="Color theme" data-mode={theme || undefined}>
          <span className="thumb" aria-hidden="true" />
          {[['light', 'Light', Icon.sun], ['system', 'System', Icon.monitor], ['dark', 'Dark', Icon.moon]].map(([k, label, ic]) => (
            <button
              key={k} type="button" role="radio" aria-checked={theme === k} aria-label={label + ' theme'} title={label}
              className={theme === k ? 'on' : ''} onClick={() => chooseTheme(k)}
            >
              {ic}
            </button>
          ))}
        </div>
      </header>

      <main>
        <section className="hero">
          <span className="pill"><span className="dot" />WordPress · Wix · Squarespace · Shopify · Webflow · Ghost</span>
          <h1>Move any blog to <span className="grad">any platform</span></h1>
          <p className="lead">Paste a blog URL. We find every post, clean up the formatting, and package it in the exact file your new platform imports — images, headings and all.</p>

          <form className={'search' + (busy ? ' busy' : '')} onSubmit={go}>
            <span className="sicon">{Icon.globe}</span>
            <input
              className="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/blog" aria-label="Blog URL" inputMode="url" autoComplete="url" spellCheck="false"
            />
            <label className="max" title="Maximum number of posts">
              <span>Max</span>
              <input type="number" min="1" max="200" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Maximum posts" />
            </label>
            <button className="go" type="submit" disabled={busy || !url.trim()}>
              {busy ? <><span className="spin" />Crawling</> : <>Crawl blog<span className="ico">{Icon.arrow}</span></>}
            </button>
          </form>

          {(busy || done || status.err) && (
            <div className={'progress' + (status.err ? ' err' : '') + (done ? ' done' : '')} role="status" aria-live="polite">
              <ol className="steps">
                {STEPS.map((s, i) => (
                  <li key={s} className={i < stage || done ? 'on' : i === stage ? 'cur' : ''}>
                    <span className="sdot">{i < stage || done ? Icon.check : i + 1}</span>{s}
                  </li>
                ))}
              </ol>
              {!status.err && <div className="bar"><span style={{ width: progress + '%' }} /></div>}
              <p className="ptext">
                {status.err && <span className="ico">{Icon.alert}</span>}
                {status.t}
                {done && skipped > 0 && <span className="muted"> · {skipped} non-post pages skipped</span>}
              </p>
            </div>
          )}
        </section>

        {!showResults && !busy && !status.err && (
          <section className="how">
            {[
              ['Paste a URL', 'Any blog — WordPress, Wix, Squarespace, Duda, Shopify, Ghost or custom sites.'],
              ['We crawl it', 'Posts are found via the API, RSS feed or sitemap, with authors, dates and images.'],
              ['Download & import', 'Pick your platform and upload the file to its importer. Done.'],
            ].map(([t, d], i) => (
              <div className="howcard" key={t} style={{ '--d': i * 90 + 'ms' }}>
                <span className="num">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </section>
        )}

        {busy && !posts.length && (
          <section className="cards">
            {Array.from({ length: 6 }).map((_, i) => <div className="post skel" key={i}><div className="cover" /><div className="pbody"><i /><i /><i className="short" /></div></div>)}
          </section>
        )}

        {showResults && (
          <div ref={resultsRef} className="results">
            {done && (
              <section className="stats">
                {[
                  [Icon.doc, posts.length, 'Posts'],
                  [Icon.clock, stats.words.toLocaleString(), 'Words'],
                  [Icon.image, stats.images, 'Cover images'],
                  [Icon.user, stats.authors || '—', 'Authors'],
                ].map(([ic, v, l], i) => (
                  <div className="stat" key={l} style={{ '--d': i * 70 + 'ms' }}>
                    <span className="sic">{ic}</span>
                    <div><b>{v}</b><span>{l}</span></div>
                  </div>
                ))}
              </section>
            )}

            {done && (
              <section className="panel">
                <div className="phead">
                  <div>
                    <h2>Export</h2>
                    <p className="muted">{selected.length} of {posts.length} posts selected · choose your platform</p>
                  </div>
                  <label className="field">
                    <span>Shopify blog name</span>
                    <input value={blog} onChange={(e) => setBlog(e.target.value)} />
                  </label>
                </div>
                <div className="platforms">
                  {Object.keys(FORMATS).map((k, i) => {
                    const pl = PLATFORMS[k] || { name: FORMATS[k].label, file: FORMATS[k].ext, color: '#666', mark: '?' };
                    return (
                      <button key={k} className={'plat' + (active === k ? ' active' : '')} style={{ ...markVars(pl), '--d': i * 45 + 'ms' }} onClick={() => download(k)}>
                        <span className="mark">{pl.mark}</span>
                        <span className="pname">{pl.name}<small>{pl.file}</small></span>
                        <span className="dl">{active === k ? Icon.check : Icon.download}</span>
                      </button>
                    );
                  })}
                </div>
                {active && (
                  <div className="guide" key={active}>
                    <span className="mark sm" style={markVars(PLATFORMS[active] || {})}>{(PLATFORMS[active] || {}).mark}</span>
                    <div>
                      <b>How to import into {(PLATFORMS[active] || {}).name}</b>
                      <p>{FORMATS[active].hint.replace(/^(WordPress|Wix|Squarespace|Webflow|Ghost):\s*/, '')}</p>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section className="panel">
              <div className="phead">
                <div>
                  <h2>Posts</h2>
                  <p className="muted">{busy ? 'Loading…' : 'Untick any post you don’t want to export'}</p>
                </div>
                {done && (
                  <div className="tools">
                    <label className="filter"><span className="ico">{Icon.search}</span><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter posts" aria-label="Filter posts" /></label>
                    <button className="ghost" onClick={() => setExcluded(allOn ? new Set(posts.map((p) => p.url)) : new Set())}>{allOn ? 'Select none' : 'Select all'}</button>
                  </div>
                )}
              </div>
              <div className="cards">
                {visible.map((p, i) => {
                  const on = !excluded.has(p.url);
                  const src = p.image_data || (/^https?:/.test(p.image) ? p.image : '');
                  return (
                    <article key={p.url + i} className={'post' + (on ? '' : ' off')} style={{ '--d': Math.min(i, 12) * 40 + 'ms' }} onClick={() => done && toggle(p.url)}>
                      <div className="cover">
                        {src ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="noimg">{Icon.image}</span>}
                        {done && <span className={'tick' + (on ? ' on' : '')} role="checkbox" aria-checked={on} aria-label={'Include ' + p.title}>{Icon.check}</span>}
                      </div>
                      <div className="pbody">
                        <h3 title={p.title}>{p.title}</h3>
                        <div className="meta">
                          <span>{fmtDate(p.date)}</span>
                          <span>{words(p.content).toLocaleString()} words</span>
                        </div>
                        {p.author && <div className="by"><span className="ico">{Icon.user}</span>{p.author}</div>}
                      </div>
                    </article>
                  );
                })}
                {done && !visible.length && <p className="muted empty">No posts match “{filter}”.</p>}
              </div>
            </section>
          </div>
        )}
      </main>

      <footer className="foot">© {new Date().getFullYear()} Blog Exporter. All rights reserved.</footer>

      <div className={'toast' + (toast ? ' show' : '')} role="status" aria-live="polite">
        <span className="ico">{Icon.check}</span>{toast}
      </div>
    </>
  );
}
