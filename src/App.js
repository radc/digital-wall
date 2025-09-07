// src/App.js
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Player from './components/Player';
import Admin from './pages/Admin';

// Helpers cross-browser para Fullscreen
function isFullscreen() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  );
}
function requestFS(el) {
  const fn =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.msRequestFullscreen;
  return fn ? fn.call(el) : Promise.resolve();
}
function exitFS() {
  const fn =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.msExitFullscreen;
  return fn ? fn.call(document) : Promise.resolve();
}

function FullscreenOnInteract() {
  const location = useLocation();

  useEffect(() => {
    // Só aplica na rota do mural ("/")
    if (location.pathname !== '/') return;

    // 1) Gesto do usuário (click/touch) -> entra em fullscreen se não estiver
    const onUserGesture = () => {
      if (!isFullscreen()) {
        requestFS(document.documentElement).catch(() => {
          /* alguns browsers bloqueiam sem gesto válido */
        });
      }
    };

    // 2) Tecla "f" alterna fullscreen (útil em testes)
    const onKey = (e) => {
      const k = e.key?.toLowerCase();
      if (k === 'f') {
        if (isFullscreen()) exitFS();
        else requestFS(document.documentElement).catch(() => {});
      }
    };

    // 3) Verificação automática a cada 20s
    const intervalMs = 20000;
    const tick = () => {
      // só tenta se a aba estiver visível (evita chamadas em background)
      const visible = document.visibilityState === 'visible';
      if (visible && !isFullscreen()) {
        requestFS(document.documentElement).catch(() => {});
      }
    };

    window.addEventListener('click', onUserGesture);
    window.addEventListener('touchstart', onUserGesture, { passive: true });
    window.addEventListener('keydown', onKey);

    const iv = setInterval(tick, intervalMs);

    // (Opcional) reagir à mudança de visibilidade para tentar imediatamente quando voltar
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('click', onUserGesture);
      window.removeEventListener('touchstart', onUserGesture);
      window.removeEventListener('keydown', onKey);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <FullscreenOnInteract />
      <Routes>
        <Route path="/" element={<Player manifestUrl="/api/manifest" />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  );
}
