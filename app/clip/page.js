'use client';

import { useEffect, useState } from 'react';
import { CLIP_CHANNEL, CLIP_STORE } from '../../lib/clipper';

// Popup opened by the "Save to Blog Exporter" bookmark. Receives the post read from the
// page the user is viewing, stores it, tells the main app tab, then closes itself.
const MAX_HTML = 1_500_000;

function valid(p) {
  return p && typeof p === 'object' && typeof p.title === 'string' && p.title.trim() &&
    typeof p.url === 'string' && /^https?:\/\//i.test(p.url) &&
    typeof p.content === 'string' && p.content.length < MAX_HTML;
}

export default function Clip() {
  const [state, setState] = useState({ kind: 'wait' });

  useEffect(() => {
    let closeTimer;
    function onMessage(e) {
      const msg = e.data;
      if (!msg || msg.type !== 'blog-exporter-clip') return;
      try { e.source.postMessage({ type: 'blog-exporter-ack' }, e.origin); } catch { /* source gone */ }
      if (!valid(msg.post)) {
        setState({ kind: 'error', text: 'No blog post was found on that page.' });
        return;
      }
      const post = { ...msg.post, saved_at: Date.now() };
      let count = 1;
      try {
        const list = JSON.parse(localStorage.getItem(CLIP_STORE) || '[]').filter((x) => x.url !== post.url);
        list.push(post);
        localStorage.setItem(CLIP_STORE, JSON.stringify(list));
        count = list.length;
      } catch { /* storage full or blocked; the broadcast still reaches an open app tab */ }
      try {
        const ch = new BroadcastChannel(CLIP_CHANNEL);
        ch.postMessage({ type: 'clip', post });
        ch.close();
      } catch { /* old browser */ }
      setState({ kind: 'saved', title: post.title, count });
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => window.close(), 1800);
    }
    window.addEventListener('message', onMessage);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(closeTimer); };
  }, []);

  return (
    <main className="clip">
      <div className={'clipcard is-' + state.kind}>
        <span className="clipicon" aria-hidden="true">
          {state.kind === 'saved' ? '✓' : state.kind === 'error' ? '!' : <span className="spin dark" />}
        </span>
        {state.kind === 'wait' && <><h2>Saving post…</h2><p>Reading the page you have open.</p></>}
        {state.kind === 'saved' && <><h2>Saved to Blog Exporter</h2><p className="ctitle">{state.title}</p><p>{state.count} post{state.count === 1 ? '' : 's'} saved · this window closes automatically</p></>}
        {state.kind === 'error' && <><h2>Couldn’t save</h2><p>{state.text} Open a single blog post and click the bookmark again.</p></>}
      </div>
    </main>
  );
}
