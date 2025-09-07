// Servidor que:
// - Lê a pasta public/media e expõe /api/manifest (player)
// - Expõe /api/login, /api/logout, e rotas /api/admin/* protegidas por sessão
// - Permite listar/enviar/excluir mídias, alterar defaults e overrides do media.json
//
// Execute em paralelo ao CRA: `npm run server`

const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3001;

const PUBLIC_DIR = path.join(__dirname, 'public');
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media');
const CONFIG_PATH = path.join(MEDIA_DIR, 'media.json');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogg']);
const ALLOWED_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT]);

function detectType(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(
  session({
    secret: 'mural-digital-secret', // troque em produção
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // em produção, usar true + HTTPS
  })
);

// Static
app.use(express.static(PUBLIC_DIR)); // serve /public (inclui /media)

// Helpers
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { defaults: {}, items: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (e) {
    return { defaults: {}, items: [] };
  }
}
function writeConfig(cfg) {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ---------- Player manifest ----------
app.get('/api/manifest', (_req, res) => {
  try {
    const config = readConfig();
    const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];

    const overrideMap = new Map();
    for (const it of (config.items || [])) {
      if (it && it.src) overrideMap.set(it.src, it);
    }

    const items = [];
    for (const f of files) {
      if (f === 'media.json') continue;
      if (f.startsWith('.')) continue;
      const type = detectType(f);
      if (!type) continue;
      const base = { src: f, type };
      const ov = overrideMap.get(f);
      items.push(ov ? { ...base, ...ov } : base);
    }

    res.json({ defaults: config.defaults || {}, items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to build manifest' });
  }
});

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === 'admin' && password === '1234') {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'invalid_credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// ---------- Admin APIs (protegidas) ----------
app.get('/api/admin/state', requireAuth, (_req, res) => {
  const config = readConfig();
  const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
  const mediaFiles = files
    .filter(f => f !== 'media.json' && !f.startsWith('.'))
    .filter(f => ALLOWED_EXT.has(path.extname(f).toLowerCase()));
  res.json({
    defaults: config.defaults || {},
    overrides: config.items || [],
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
  // body: { src, ...props }
  const { src, ...props } = req.body || {};
  if (!src) return res.status(400).json({ error: 'src_required' });

  const cfg = readConfig();
  const items = cfg.items || [];
  const idx = items.findIndex(it => it.src === src);
  if (idx >= 0) {
    items[idx] = { ...items[idx], src, ...props };
  } else {
    items.push({ src, ...props });
  }
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

// Uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
    cb(null, MEDIA_DIR);
  },
  filename: (_req, file, cb) => {
    // mantém nome original; em produção, considere sanitizar/normalizar
    cb(null, file.originalname);
  }
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
    // remove override se existir
    const cfg = readConfig();
    cfg.items = (cfg.items || []).filter(it => it.src !== src);
    writeConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'delete_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
