// src/App.js (arquivo completo)

import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Player from './components/Player';
import Admin from './pages/Admin';

function FullscreenOnInteract() {
  const location = useLocation();

  useEffect(() => {
    // só habilita fullscreen na rota do mural
    if (location.pathname !== '/') return;

    const reqFullscreen = () => {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
      window.removeEventListener('click', reqFullscreen);
      window.removeEventListener('touchstart', reqFullscreen);
    };

    window.addEventListener('click', reqFullscreen);
    window.addEventListener('touchstart', reqFullscreen);

    return () => {
      window.removeEventListener('click', reqFullscreen);
      window.removeEventListener('touchstart', reqFullscreen);
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
