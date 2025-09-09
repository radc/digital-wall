import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNowInSchedule } from '../utils/schedule';

function cx(...xs){ return xs.filter(Boolean).join(' '); }

const FIT_TO_OBJECT_FIT = {
  fit: 'contain',
  crop: 'cover',
  fill: 'fill',
  zoom: 'cover'
};

function inferType(src) {
  const s = String(src || '').toLowerCase();
  if (/\.(mp4|webm|ogg)$/.test(s)) return 'video';
  if (/\.(html?)$/.test(s)) return 'html';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(s)) return 'image';
  return 'image';
}

function toMapBySrc(list = []) {
  const m = new Map();
  for (const it of list) if (it && it.src) m.set(it.src, it);
  return m;
}

export default function Player({ manifestUrl = '/api/manifest' }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const iframeRef = useRef(null);

  const [manifest, setManifest] = useState(null);
  const [ready, setReady] = useState(false);

  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(false);
  const timerRef = useRef(null);

  // Overlay de IP/QR
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayIPs, setOverlayIPs] = useState([]);
  const overlayTimerRef = useRef(null);

  const defaults = useMemo(() => ({
    imageDurationMs: 10000,
    htmlDurationMs: 15000,
    fitMode: 'fit',
    bgColor: '#000000',
    mute: true,
    volume: 1.0,
    schedule: {
      days: ['mon','tue','wed','thu','fri','sat','sun'],
      start: '00:00',
      end: '23:59',
      tz: 'America/Sao_Paulo'
    }
  }), []);

  // Monta playlist a partir de /api/manifest (files + overrides). Fallback: manifest.items
  const playlist = useMemo(() => {
    if (!manifest) return [];
    const d = { ...defaults, ...(manifest.defaults || {}) };

    let baseFiles = Array.isArray(manifest.files) ? manifest.files : null;
    const overrides = Array.isArray(manifest.overrides) ? manifest.overrides : [];
    const overridesMap = toMapBySrc(overrides);

    let items = [];
    if (baseFiles && baseFiles.length) {
      items = baseFiles.map((name) => {
        const ov = overridesMap.get(name) || {};
        const type = ov.type || inferType(name);
        return { ...d, ...ov, src: name, type };
      });
    } else if (Array.isArray(manifest.items) && manifest.items.length) {
      // Fallback antigo
      items = manifest.items.map((it) => ({
        ...d, ...it, src: it.src, type: it.type || inferType(it.src)
      }));
    }

    // Filtra por schedule
    items = items.filter((it) => isNowInSchedule(it.schedule || d.schedule));
    return items;
  }, [manifest, defaults]);

  const goNext = useCallback(() => {
    if (!playlist.length) return;
    setFade(true);
    window.setTimeout(() => {
      setIndex(i => (i + 1) % playlist.length);
      setFade(false);
    }, 300);
  }, [playlist.length]);

  // Carrega manifest e repete a cada 60s
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const url = manifestUrl + (manifestUrl.includes('?') ? '&' : '?') + '_=' + Date.now();
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('Manifest fetch failed');
        const data = await res.json();
        if (!cancelled) { setManifest(data); setIndex(0); }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    load();
    const iv = setInterval(load, 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [manifestUrl]);

  // Timers de imagem/HTML
  useEffect(() => {
    if (!ready || !playlist.length) return;
    const current = playlist[index];
    clearTimeout(timerRef.current);

    if (current.type === 'image') {
      const dur = Math.max(500, Number(current.imageDurationMs ?? defaults.imageDurationMs ?? 10000));
      timerRef.current = setTimeout(goNext, dur);
    } else if (current.type === 'html') {
      const dur = Math.max(500, Number(current.htmlDurationMs ?? defaults.htmlDurationMs ?? 15000));
      timerRef.current = setTimeout(goNext, dur);
    } // video: avança no onEnded/onError

    return () => clearTimeout(timerRef.current);
  }, [ready, playlist, index, goNext, defaults.imageDurationMs, defaults.htmlDurationMs]);

  // ======== Fullscreen handling ========
  const ensureFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement;
    if (fsEl !== el) {
      try {
        if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
      } catch {}
    }
  }, []);

  // Verifica a cada 20s se não está em fullscreen e tenta aplicar
  useEffect(() => {
    const iv = setInterval(() => ensureFullscreen(), 20000);
    return () => clearInterval(iv);
  }, [ensureFullscreen]);

  // Evita fullscreen nativo de <video> no dblclick (Firefox/Chrome)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const stopDbl = (e) => { e.preventDefault(); e.stopPropagation(); };
    v.addEventListener('dblclick', stopDbl, { capture: true });
    return () => v.removeEventListener('dblclick', stopDbl, { capture: true });
  }, [index, playlist]);

  // === Toggle overlay: usado por atalho e por postMessage do iframe ===
  const toggleOverlay = useCallback(async () => {
    await ensureFullscreen(); // gesto do usuário garantido em keydown; no postMessage pode simplesmente falhar silencioso
    if (!overlayOpen) {
      try {
        const res = await fetch('/api/local-ip', { cache: 'no-store' });
        const data = await res.json();
        const ips = Array.isArray(data.ips) ? data.ips : [];
        setOverlayIPs(ips);
      } catch {
        setOverlayIPs([]);
      }
      setOverlayOpen(true);
      clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = setTimeout(() => setOverlayOpen(false), 10000);
    } else {
      setOverlayOpen(false);
      clearTimeout(overlayTimerRef.current);
    }
  }, [overlayOpen, ensureFullscreen]);

  // atalhos globais (imagem/vídeo e quando foco está no documento)
  useEffect(() => {
    const onKey = (e) => {
      const k = String(e.key || '').toLowerCase();
      if (k === 'n') goNext();
      if (k === 'r') window.location.reload();
      if (k === 'i' || k === 'u') { e.preventDefault(); toggleOverlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, toggleOverlay]);

  // recebe pedidos do iframe (quando o foco está dentro do HTML)
  useEffect(() => {
    const onMsg = (e) => {
      if (e?.data && e.data.type === 'mural:toggle-overlay') {
        toggleOverlay();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [toggleOverlay]);

  // injeta listener de keydown dentro do iframe (mesma origem) para repassar i/u
  useEffect(() => {
    const current = playlist[index];
    if (!current || current.type !== 'html') return;
    const ifr = iframeRef.current;
    if (!ifr) return;

    const attach = () => {
      try {
        const doc = ifr.contentDocument || ifr.contentWindow?.document;
        if (!doc) return;
        const handler = (e) => {
          const k = String(e.key || '').toLowerCase();
          if (k === 'i' || k === 'u') {
            e.preventDefault();
            ifr.contentWindow?.parent?.postMessage({ type: 'mural:toggle-overlay' }, '*');
          }
        };
        doc.addEventListener('keydown', handler);
        // guarda para cleanup
        ifr._muralHandler = handler;
      } catch {}
    };

    // se já carregou, injeta; senão espera load
    if (ifr.contentDocument?.readyState === 'complete') {
      attach();
    } else {
      ifr.addEventListener('load', attach, { once: true });
    }

    return () => {
      try {
        const doc = ifr.contentDocument || ifr.contentWindow?.document;
        const h = ifr._muralHandler;
        if (doc && h) doc.removeEventListener('keydown', h);
      } catch {}
    };
  }, [index, playlist]);

  if (!ready) {
    return <div style={{background:'#000',color:'#000',width:'100vw',height:'100vh'}}/>;
  }

  if (playlist.length === 0) {
    return (
      <div
        style={{
          background:'#000', color:'#fff',
          width:'100vw', height:'100vh',
          display:'grid', placeItems:'center',
          fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif'
        }}
      >
        Nenhuma mídia disponível no momento
      </div>
    );
  }

  const item = playlist[index];
  const objectFit = FIT_TO_OBJECT_FIT[item.fitMode] || FIT_TO_OBJECT_FIT.fit;

  const currentPort = window.location.port ? `:${window.location.port}` : '';
  const proto = window.location.protocol || 'http:';

  return (
    <div
      ref={rootRef}
      className={cx('mural-root', fade && 'fade')}
      style={{ width:'100vw', height:'100vh', overflow:'hidden', background:item.bgColor || '#000' }}
      tabIndex={0}
    >
      {item.type === 'image' && (
        <img
          src={`/media/${encodeURIComponent(item.src)}`}
          alt=""
          draggable={false}
          style={{ width:'100%', height:'100%', objectFit, userSelect:'none' }}
        />
      )}

      {item.type === 'video' && (
        <video
          key={item.src}
          ref={videoRef}
          src={`/media/${encodeURIComponent(item.src)}`}
          autoPlay
          playsInline
          muted={!!item.mute}
          controls={false}
          onEnded={goNext}
          onError={goNext}
          onLoadedMetadata={() => {
            try {
              if (videoRef.current) {
                videoRef.current.currentTime = 0;
                const vol = Number(item.volume);
                if (!Number.isNaN(vol)) {
                  videoRef.current.volume = Math.min(1, Math.max(0, vol));
                }
              }
            } catch {}
          }}
          style={{ width:'100%', height:'100%', objectFit, outline:'none' }}
        />
      )}

      {item.type === 'html' && (
        <iframe
          ref={iframeRef}
          title={`html-${item.src}`}
          src={`/media/${encodeURIComponent(item.src)}`}
          tabIndex={-1}
          style={{ width:'100%', height:'100%', border:0, display:'block', background:'#000' }}
        />
      )}

      {/* Overlay com IPs + QR */}
      {overlayOpen && (
        <div className="ip-overlay" onClick={() => setOverlayOpen(false)}>
          <div className="ip-card" onClick={e => e.stopPropagation()}>
            <div className="ip-title">Acesse este mural pela rede</div>
            <div className="ip-grid">
              {overlayIPs.length === 0 && (
                <div className="ip-empty">Sem IPs de rede detectados.</div>
              )}
              {overlayIPs.map(ip => {
                const url = `${proto}//${ip}${currentPort}/admin`;
                const svgSrc = `/api/qr.svg?data=${encodeURIComponent(url)}`;
                return (
                  <div className="ip-item" key={ip}>
                    <img
                      className="ip-qr"
                      src={svgSrc}
                      alt={`QR ${ip}`}
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = `/api/qr?data=${encodeURIComponent(url)}`;
                      }}
                    />
                    <div className="ip-url">{url}</div>
                  </div>
                );
              })}
            </div>
            <div className="ip-hint">Pressione I ou U para fechar (fecha em 10s)</div>
          </div>
        </div>
      )}

      <style>{`
        .fade { animation: mural-fade 300ms ease both; }
        @keyframes mural-fade { from { opacity: 1 } to { opacity: 0 } }
        * { cursor: none !important; }

        .ip-overlay{
          position:fixed; inset:0;
          background:rgba(0,0,0,.7);
          display:flex; align-items:center; justify-content:center;
          z-index: 100000;
          padding: 24px;
        }
        .ip-card{
          background:#0b0f19;
          color:#fff;
          border:1px solid rgba(255,255,255,.1);
          border-radius:16px;
          box-shadow:0 10px 30px rgba(0,0,0,.4);
          width:min(92vw, 1100px);
          max-height: 90vh;
          overflow:auto;
          padding:16px;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans, sans-serif;
        }
        .ip-title{
          font-weight:800; font-size:20px; margin-bottom:12px;
        }
        .ip-grid{
          display:grid; gap:16px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 720px){
          .ip-grid{ grid-template-columns: repeat(3, 1fr); }
        }
        .ip-item{
          background:#0f172a;
          border:1px solid rgba(255,255,255,.08);
          border-radius:12px;
          padding:12px;
          display:flex; flex-direction:column; align-items:center; gap:8px;
        }
        .ip-qr{
          width:160px; height:160px; display:block; background:#fff; border-radius:6px;
        }
        .ip-url{
          font-size:14px; word-break:break-all; text-align:center; opacity:.95;
        }
        .ip-hint{
          margin-top:10px; opacity:.7; font-size:12px; text-align:center;
        }
      `}</style>
    </div>
  );
}
