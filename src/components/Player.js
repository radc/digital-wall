// src/components/Player.js
// (arquivo completo — só mudou o <style> no final)

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNowInSchedule } from '../utils/schedule';

function classNames(...xs){ return xs.filter(Boolean).join(' '); }

const FIT_TO_OBJECT_FIT = {
  fit: 'contain',
  crop: 'cover',
  fill: 'fill',
  zoom: 'cover'
};

function isVideo(src){ return /\.(mp4|webm|ogg)$/i.test(src); }

export default function Player({ manifestUrl = '/api/manifest' }) {
  const [manifest, setManifest] = useState(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [fade, setFade] = useState(false);
  const timerRef = useRef(null);
  const videoRef = useRef(null);

  const defaults = useMemo(() => ({
    imageDurationMs: 10000,
    fitMode: 'fit',
    bgColor: '#000000',
    mute: true,
    volume: 1.0,
    schedule: null
  }), []);

  const activeItems = useMemo(() => {
    if (!manifest) return [];
    const d = { ...defaults, ...(manifest.defaults || {}) };
    const list = (manifest.items || [])
      .map(it => ({
        ...d,
        ...it,
        type: it.type || (isVideo(it.src) ? 'video' : 'image')
      }))
      .filter(it => isNowInSchedule(it.schedule || d.schedule));
    return list;
  }, [manifest, defaults]);

  const goNext = useCallback(() => {
    setFade(true);
    window.setTimeout(() => {
      setIndex(i => (activeItems.length ? (i + 1) % activeItems.length : 0));
      setFade(false);
    }, 300);
  }, [activeItems.length]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(manifestUrl + (manifestUrl.includes('?') ? '&' : '?') + '_=' + Date.now());
        if (!res.ok) throw new Error('Manifest fetch failed');
        const data = await res.json();
        if (!cancelled) setManifest(data);
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

  useEffect(() => {
    if (!ready || !activeItems.length) return;
    const current = activeItems[index];
    if (current.type === 'image') {
      const dur = Math.max(1000, current.imageDurationMs || 10000);
      timerRef.current && clearTimeout(timerRef.current);
      timerRef.current = setTimeout(goNext, dur);
    } else {
      timerRef.current && clearTimeout(timerRef.current);
    }
    return () => { timerRef.current && clearTimeout(timerRef.current); };
  }, [ready, activeItems, index, goNext]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === 'n') goNext();
      if (e.key.toLowerCase() === 'r') window.location.reload();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext]);

  if (!ready) {
    return <div style={{ background:'#000', color:'#000', width:'100vw', height:'100vh' }} />;
  }
  if (!activeItems || activeItems.length === 0) {
    return (
      <div style={{
        background:'#000', color:'#fff', width:'100vw', height:'100vh',
        display:'grid', placeItems:'center', textAlign:'center'
      }}>
        Nenhuma mídia disponível no momento
      </div>
    );
  }

  const item = activeItems[index];
  const objectFit = {
    fit: 'contain',
    crop: 'cover',
    fill: 'fill',
    zoom: 'cover'
  }[item.fitMode] || 'contain';

  return (
    <div className={classNames('mural-root', fade && 'fade')}
      style={{ width:'100vw', height:'100vh', overflow:'hidden', background:item.bgColor||'#000' }}>
      {item.type === 'image' ? (
        <img
          src={"/media/" + item.src}
          alt=""
          draggable={false}
          style={{ width:'100%', height:'100%', objectFit, userSelect:'none' }}
        />
      ) : (
        <video
          key={item.src}
          ref={videoRef}
          src={"/media/" + item.src}
          autoPlay
          playsInline
          muted={!!item.mute}
          onEnded={goNext}
          onError={goNext}
          onLoadedMetadata={() => {
            try {
              if (videoRef.current) {
                videoRef.current.currentTime = 0;
                videoRef.current.volume = Math.max(0, Math.min(1, item.volume ?? 1));
              }
            } catch (e) {}
          }}
          style={{ width:'100%', height:'100%', objectFit, outline:'none' }}
        />
      )}
      <style>{`
        .fade { animation: mural-fade 300ms ease both; }
        @keyframes mural-fade { from { opacity: 1 } to { opacity: 0.0 } }
        /* ESCOPADO ao player apenas */
        .mural-root, .mural-root * { cursor: none !important; }
      `}</style>
    </div>
  );
}
