import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isNowInSchedule } from '../utils/schedule';
import QRCode from 'qrcode';

function classNames(...xs){return xs.filter(Boolean).join(' ');} 

const FIT_TO_OBJECT_FIT = {
  fit: 'contain',
  crop: 'cover',
  fill: 'fill',
  zoom: 'cover'
};

function isVideo(src){
  return /\.(mp4|webm|ogg)$/i.test(src);
}

export default function Player({ manifestUrl = '/api/manifest' }){
  const [manifest, setManifest] = useState(null);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [fade, setFade] = useState(false);
  const timerRef = useRef(null);
  const videoRef = useRef(null);

  // overlay de IP + QR
  const [ipOverlay, setIpOverlay] = useState({ visible:false, text:'', error:false, url:'', qr:'' });
  const ipTimerRef = useRef(null);

  const defaults = useMemo(()=>({
    imageDurationMs: 10000,
    fitMode: 'fit',
    bgColor: '#000000',
    mute: true,
    volume: 1.0,
    schedule: null,
  }),[]);

  const activeItems = useMemo(()=>{
    if (!manifest) return [];
    const d = { ...defaults, ...(manifest.defaults||{}) };
    const list = (manifest.items||[]).map(it=>({
      ...d,
      ...it,
      type: it.type || (isVideo(it.src) ? 'video' : 'image')
    }))
    .filter(it => isNowInSchedule(it.schedule || d.schedule));
    return list;
  }, [manifest, defaults]);

  const goNext = useCallback(() => {
    setFade(true);
    window.setTimeout(()=>{
      setIndex(i => (activeItems.length ? (i+1) % activeItems.length : 0));
      setFade(false);
    }, 300);
  }, [activeItems.length]);

  // carrega manifest e atualiza a cada 60s
  useEffect(()=>{
    let cancelled = false;
    async function load(){
      try{
        const res = await fetch(manifestUrl + (manifestUrl.includes('?') ? '&' : '?') + '_=' + Date.now());
        if(!res.ok) throw new Error('Manifest fetch failed');
        const data = await res.json();
        if(!cancelled) setManifest(data);
      }catch(e){
        console.error(e);
      }finally{
        if(!cancelled) setReady(true);
      }
    }
    load();
    const iv = setInterval(load, 60*1000);
    return ()=>{ cancelled=true; clearInterval(iv); };
  }, [manifestUrl]);

  // agenda avanço (imagem) ou espera evento (vídeo)
  useEffect(()=>{
    if(!ready || !activeItems.length) return;
    const current = activeItems[index];

    if(current.type === 'image'){
      const dur = Math.max(1000, current.imageDurationMs || 10000);
      timerRef.current && clearTimeout(timerRef.current);
      timerRef.current = setTimeout(goNext, dur);
    } else {
      timerRef.current && clearTimeout(timerRef.current);
    }
    return ()=>{ timerRef.current && clearTimeout(timerRef.current); };
  }, [ready, activeItems, index, goNext]);

  // atalhos de teclado
  useEffect(()=>{
    const onKey = (e)=>{
      const k = (e.key||'').toLowerCase();
      if(k==='n') goNext();
      if(k==='r') window.location.reload();
      if(k==='i' || k==='u') showLocalIp();
    };
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  }, [goNext]);

  // função para buscar IP e mostrar overlay por 10s (com QR do /admin)
  const showLocalIp = async () => {
    try {
      if (ipTimerRef.current) clearTimeout(ipTimerRef.current);

      const res = await fetch('/api/local-ips');
      if (!res.ok) throw new Error('ip_fetch_failed');
      const { ips = [] } = await res.json();

      const text = ips.length ? ips.join('  •  ') : 'IP indisponível';

      // monta URL do /admin usando o primeiro IP encontrado
      const ip = ips[0] || '127.0.0.1';
      const port =
        window.location.port
          ? `:${window.location.port}`
          : (window.location.protocol === 'https:' ? '' : ':3001'); // fallback comum no seu setup
      const url = `${window.location.protocol}//${ip}${port}/admin`;

      // gera QR (dataURL) desta URL
      let qr = '';
      try {
        qr = await QRCode.toDataURL(url, { margin: 1, scale: 6 });
      } catch (e) {
        console.warn('Erro ao gerar QRCode:', e);
      }

      setIpOverlay({ visible:true, text, error:false, url, qr });

      ipTimerRef.current = setTimeout(() => {
        setIpOverlay(o => ({ ...o, visible:false }));
      }, 10000);
    } catch (e) {
      setIpOverlay({ visible:true, text:'Falha ao obter IP local', error:true, url:'', qr:'' });
      ipTimerRef.current = setTimeout(() => {
        setIpOverlay(o => ({ ...o, visible:false }));
      }, 10000);
    }
  };

  if(!ready){
    return <div style={{background:'#000',color:'#000',width:'100vw',height:'100vh'}}/>;
  }
  if(activeItems.length===0){
    return (
      <div style={{
        background:'#000',color:'#fff',width:'100vw',height:'100vh',
        display:'grid',placeItems:'center', position:'relative'
      }}>
        Nenhuma mídia disponível no momento
        {ipOverlay.visible && (
          <IpOverlay text={ipOverlay.text} error={ipOverlay.error} url={ipOverlay.url} qr={ipOverlay.qr} />
        )}
      </div>
    );
  }

  const item = activeItems[index];
  const objectFit = FIT_TO_OBJECT_FIT[item.fitMode] || FIT_TO_OBJECT_FIT.fit;

  return (
    <div className={classNames('mural-root', fade && 'fade')}
      style={{
        width:'100vw', height:'100vh', overflow:'hidden',
        background:item.bgColor||'#000', position:'relative'
      }}
    >
      {item.type==='image' ? (
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
            try{
              if(videoRef.current){
                videoRef.current.currentTime = 0;
                videoRef.current.volume = Math.max(0, Math.min(1, item.volume ?? 1));
              }
            }catch(e){}
          }}
          style={{ width:'100%', height:'100%', objectFit, outline:'none' }}
        />
      )}

      {/* Overlay de IP + QR (10s ao apertar "i" ou "u") */}
      {ipOverlay.visible && (
        <IpOverlay text={ipOverlay.text} error={ipOverlay.error} url={ipOverlay.url} qr={ipOverlay.qr} />
      )}

      <style>{`
        .fade { animation: mural-fade 300ms ease both; }
        @keyframes mural-fade { from { opacity: 1 } to { opacity: 0.0 } }
        * { cursor: none !important; }
      `}</style>
    </div>
  );
}

function IpOverlay({ text, error, url, qr }) {
  return (
    <div
      style={{
        position:'absolute',
        left:'50%',
        top:20,
        transform:'translateX(-50%)',
        background: error ? 'rgba(220,38,38,.95)' : 'rgba(17,24,39,.9)',
        color:'#fff',
        padding:'12px 16px',
        borderRadius:12,
        boxShadow:'0 6px 24px rgba(0,0,0,.35)',
        zIndex: 9999,
        border: '1px solid rgba(255,255,255,.15)',
        display:'flex',
        alignItems:'center',
        gap:12,
        maxWidth:'92vw'
      }}
      title={text}
    >
      {qr ? (
        <img
          src={qr}
          alt={url}
          style={{ width:92, height:92, borderRadius:8, background:'#fff', padding:6 }}
        />
      ) : null}
      <div style={{ display:'flex', flexDirection:'column', gap:6, minWidth:0 }}>
        <div style={{
          fontSize:18, fontWeight:700, letterSpacing:.2,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'
        }}>
          {text}
        </div>
        {url && (
          <div style={{ fontSize:14, opacity:.9, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            URL admin: <span style={{fontFamily:'monospace'}}>{url}</span>
          </div>
        )}
        <div style={{ fontSize:12, opacity:.7 }}>
          Dica: pressione <b>i</b> ou <b>u</b> para mostrar este painel.
        </div>
      </div>
    </div>
  );
}
