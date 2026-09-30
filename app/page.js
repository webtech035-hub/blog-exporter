'use client';

import { useState } from 'react';
import { crawl, words } from '../lib/crawler';
import { FORMATS, buildFile } from '../lib/exporters';

export default function Home() {
  const [url, setUrl] = useState('');
  const [max, setMax] = useState(20);
  const [blog, setBlog] = useState('News');
  const [posts, setPosts] = useState([]);
  const [status, setStatus] = useState({ t: '', err: false });
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    setPosts([]);
    setHint('');
    setStatus({ t: '' });
    try {
      const n = Math.max(1, Math.min(200, +max || 20));
      const { posts: p, skipped } = await crawl(url, n, (t) => setStatus({ t }), setPosts);
      setPosts(p);
      setStatus(p.length
        ? { t: `Done: ${p.length} posts crawled` + (skipped ? ` (${skipped} non-post pages skipped)` : '') + '.' }
        : { t: 'Pages were found but no posts could be extracted.', err: true });
    } catch (e) {
      setStatus({ t: e.message, err: true });
    }
    setBusy(false);
  }

  function download(k) {
    const f = FORMATS[k];
    const host = new URL(posts[0].url).host.replace(/[^a-z0-9.-]/gi, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildFile(k, posts, blog)], { type: f.mime + ';charset=utf-8' }));
    a.download = `${host}-${k}.${f.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setHint(f.hint);
  }

  return (
    <main>
      <h1>Blog Crawler &amp; Exporter</h1>
      <p className="sub">Fetch every blog post from a website and download it in the format your platform imports.</p>

      <div className="card row">
        <input className="grow" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && go()} placeholder="https://example.com/blog" />
        <label>Max <input className="num" type="number" min="1" max="200" value={max} onChange={(e) => setMax(e.target.value)} /></label>
        <button className="p" onClick={go} disabled={busy}>{busy ? 'Crawling…' : 'Crawl blogs'}</button>
      </div>

      <p className={'st' + (status.err ? ' err' : '')}>{status.t}</p>

      {!busy && posts.length > 0 && (
        <div className="card">
          <div className="row" style={{ marginBottom: 10 }}>
            <strong>Export as</strong>
            <label>Shopify blog name <input value={blog} onChange={(e) => setBlog(e.target.value)} /></label>
          </div>
          <div className="row">
            {Object.entries(FORMATS).map(([k, f]) => (
              <button key={k} onClick={() => download(k)}>{f.label}</button>
            ))}
          </div>
          <p className="hint">{hint}</p>
        </div>
      )}

      {posts.length > 0 && (
        <div className="card tw">
          <table>
            <thead><tr><th>Image</th><th>Title</th><th>Date (GMT)</th><th>Words</th></tr></thead>
            <tbody>
              {posts.map((p, i) => (
                <tr key={i}>
                  <td>{(p.image_data || /^https?:/.test(p.image)) && <img src={p.image_data || p.image} alt="" referrerPolicy="no-referrer" />}</td>
                  <td>{p.title}</td>
                  <td>{p.date}</td>
                  <td>{words(p.content)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
