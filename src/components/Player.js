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
  const [manifest, setManifest] = useState(null);
  const [ready, setReady] = useState(false);

  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(false);
  const timerRef = useRef(null);
  const videoRef = useRef(null);

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

    // Caminho principal (novo): files + overrides
    let baseFiles = Array.isArray(manifest.files) ? manifest.files : null;
    const overrides = Array.isArray(manifest.overrides) ? manifest.overrides : [];
    const overridesMap = toMapBySrc(overrides);

    let items = [];

    if (baseFiles && baseFiles.length) {
      items = baseFiles.map((name) => {
        const ov = overridesMap.get(name) || {};
        const type = ov.type || inferType(name);
        return {
          ...d,
          ...ov,
          src: name,
          type
        };
      });
    } else if (Array.isArray(manifest.items) && manifest.items.length) {
      // Fallback para formatos antigos
      items = manifest.items.map((it) => ({
        ...d,
        ...it,
        src: it.src,
        type: it.type || inferType(it.src)
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
        if (!cancelled) {
          setManifest(data);
          // se o index atual passou do tamanho, reseta
          setIndex((i) => 0);
        }
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

  // Timer para imagens/HTML
  useEffect(() => {
    if (!ready) return;
    if (!playlist.length) return;

    const current = playlist[index];
    clearTimeout(timerRef.current);

    if (current.type === 'image') {
      const dur = Math.max(500, Number(current.imageDurationMs || defaults.imageDurationMs || 10000));
      timerRef.current = setTimeout(goNext, dur);
    } else if (current.type === 'html') {
      const dur = Math.max(500, Number(current.htmlDurationMs || defaults.htmlDurationMs || 15000));
      timerRef.current = setTimeout(goNext, dur);
    } else {
      // video: não agenda; avançamos no onEnded / onError
    }

    return () => clearTimeout(timerRef.current);
  }, [ready, playlist, index, goNext, defaults.imageDurationMs, defaults.htmlDurationMs]);

  // atalhos: N (next), R (reload)
  useEffect(() => {
    const onKey = (e) => {
      const k = String(e.key || '').toLowerCase();
      if (k === 'n') goNext();
      if (k === 'r') window.location.reload();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext]);

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

  return (
    <div
      className={cx('mural-root', fade && 'fade')}
      style={{ width:'100vw', height:'100vh', overflow:'hidden', background:item.bgColor || '#000' }}
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
            } catch (_) {}
          }}
          style={{ width:'100%', height:'100%', objectFit, outline:'none' }}
        />
      )}

      {item.type === 'html' && (
        <iframe
          title={`html-${item.src}`}
          src={`/media/${encodeURIComponent(item.src)}`}
          style={{ width:'100%', height:'100%', border:0, display:'block', background:'#000' }}
        />
      )}

      <style>{`
        .fade { animation: mural-fade 300ms ease both; }
        @keyframes mural-fade { from { opacity: 1 } to { opacity: 0 } }
        * { cursor: none !important; }
      `}</style>
    </div>
  );
}
