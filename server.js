// server.js — build + APIs + media + redirect HTTP :80 -> :3001
// - Serve o build do CRA em / (pasta build/)
// - Serve APENAS as mídias em /media (public/media)
// - Rotas /api para manifest, auth e admin (upload/excluir/overrides)
// - SPA fallback que NÃO intercepta /api nem /media
// - Redirecionador HTTP na porta 80 para http://<host>:3001

const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const http = require('http'); // para o redirect :80 -> :3001

const app = express();
const PORT = process.env.PORT || 3001;

const ROOT_DIR    = __dirname;
const PUBLIC_DIR  = path.join(ROOT_DIR, 'public');
const MEDIA_DIR   = path.join(PUBLIC_DIR, 'media');
const CONFIG_PATH = path.join(MEDIA_DIR, 'media.json');
const BUILD_DIR   = path.join(ROOT_DIR, 'build'); // saída do CRA (npm run build)

// Extensões suportadas
const IMAGE_EXT   = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const VIDEO_EXT   = new Set(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.wmv', '.flv']);
const ALLOWED_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT]);

function detectType(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// Middlewares básicos
app.use(express.json({ limit: '10mb' }));
app.use(
  session({
    secret: 'mural-digital-secret', // troque em produção
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // em produção com HTTPS: true
  })
);

// --- Estáticos ---
// 1) Serve SOMENTE as mídias em /media
app.use('/media', express.static(MEDIA_DIR));

// 2) Serve o build do React na raiz (se existir)
if (fs.existsSync(BUILD_DIR)) {
  app.use(express.static(BUILD_DIR));
}

// --- Helpers de config ---
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { defaults: {}, items: [] };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { defaults: {}, items: [] }; }
}
function writeConfig(cfg) {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}
function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---------- API: Manifest do Player ----------
app.get('/api/manifest', (_req, res) => {
  try {
    const config = readConfig();
    const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];

    const overrideMap = new Map();
    for (const it of (config.items || [])) if (it?.src) overrideMap.set(it.src, it);

    const items = [];
    for (const f of files) {
      if (f === 'media.json' || f.startsWith('.')) continue;
      const type = detectType(f);
      if (!type) continue; // ignora extensões não suportadas
      const base = { src: f, type };
      const ov = overrideMap.get(f);
      items.push(ov ? { ...base, ...ov } : base); // aplica override só se existir
    }
    res.json({ defaults: config.defaults || {}, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to build manifest' });
  }
});

// ---------- API: Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === 'admin' && password === '1234') {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'invalid_credentials' });
});
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- API: Admin (protegidas) ----------
app.get('/api/admin/state', requireAuth, (_req, res) => {
  const cfg = readConfig();
  const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
  const mediaFiles = files
    .filter(f => f !== 'media.json' && !f.startsWith('.'))
    .filter(f => ALLOWED_EXT.has(path.extname(f).toLowerCase()));
  res.json({
    defaults: cfg.defaults || {},
    overrides: cfg.items || [],
    files: mediaFiles
  });
});

app.post('/api/admin/defaults', requireAuth, (req, res) => {
  const cfg = readConfig();
  cfg.defaults = req.body || {};
  writeConfig(cfg);
  res.json({ ok: true, defaults: cfg.defaults });
});

app.post('/api/admin/override', requireAuth, (req, res) => {
  const { src, ...props } = req.body || {};
  if (!src) return res.status(400).json({ error: 'src_required' });
  const cfg = readConfig();
  const items = cfg.items || [];
  const idx = items.findIndex(it => it.src === src);
  if (idx >= 0) items[idx] = { ...items[idx], src, ...props };
  else items.push({ src, ...props });
  cfg.items = items;
  writeConfig(cfg);
  res.json({ ok: true, override: items.find(it => it.src === src) });
});

app.delete('/api/admin/override/:src', requireAuth, (req, res) => {
  const src = req.params.src;
  const cfg = readConfig();
  cfg.items = (cfg.items || []).filter(it => it.src !== src);
  writeConfig(cfg);
  res.json({ ok: true });
});

// Uploads (multer)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
    cb(null, MEDIA_DIR);
  },
  filename: (_req, file, cb) => cb(null, file.originalname) // em prod, sanitize/unique
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('unsupported_extension'));
    cb(null, true);
  },
  limits: { fileSize: 1024 * 1024 * 1024 } // até 1GB
});
app.post('/api/admin/upload', requireAuth, upload.single('file'), (req, res) => {
  res.json({ ok: true, file: req.file?.originalname });
});

app.delete('/api/admin/file/:src', requireAuth, (req, res) => {
  const src = req.params.src;
  const target = path.join(MEDIA_DIR, src);
  if (!target.startsWith(MEDIA_DIR)) return res.status(400).json({ error: 'invalid_path' });
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    const cfg = readConfig();
    cfg.items = (cfg.items || []).filter(it => it.src !== src); // remove override, se houver
    writeConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'delete_failed' });
  }
});

// ---------- SPA fallback (depois de /api e /media) ----------
if (fs.existsSync(BUILD_DIR)) {
  app.get('*', (req, res, next) => {
    // não intercepta API nem arquivos de mídia
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next();
    return res.sendFile(path.join(BUILD_DIR, 'index.html'));
  });
}

// ---------- Inicia a app (porta 3001) ----------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// ---------- Redirecionador HTTP :80 -> :3001 ----------
try {
  const redirectServer = http.createServer((req, res) => {
    const host = (req.headers.host || 'localhost').split(':')[0];
    const target = `http://${host}:${PORT}${req.url}`;
    res.statusCode = 301;
    res.setHeader('Location', target);
    res.end(`Redirecting to ${target}`);
  });
  redirectServer.listen(80, () => {
    console.log('Redirect HTTP :80 -> :3001 ativo');
  });
} catch (e) {
  console.warn('Não foi possível abrir a porta 80. Rode como root/admin ou use setcap/authbind.');
}
