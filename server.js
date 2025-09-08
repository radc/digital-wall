// server.js — build + APIs + media + redirect HTTP :80 -> :3001
// - Serve o build do CRA em / (pasta build/)
// - Serve APENAS as mídias em /media (public/media)
// - Rotas /api para manifest, auth, admin de mídia e gestão de usuários
// - SPA fallback que NÃO intercepta /api nem /media
// - Redirecionador HTTP na porta 80 para http://<host>:3001

const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const http = require('http');
const crypto = require('crypto');
const os = require('os'); // <-- ADICIONE ESTA LINHA

const app = express();
const PORT = process.env.PORT || 3001;

const ROOT_DIR    = __dirname;
const PUBLIC_DIR  = path.join(ROOT_DIR, 'public');
const MEDIA_DIR   = path.join(PUBLIC_DIR, 'media');
const CONFIG_PATH = path.join(MEDIA_DIR, 'media.json');
const BUILD_DIR   = path.join(ROOT_DIR, 'build'); // saída do CRA (npm run build)

// >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> USERS (auth local com hash) <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<
const DATA_DIR     = path.join(ROOT_DIR, 'data');
const USERS_PATH   = path.join(DATA_DIR, 'users.json');

function ensureDirs() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
ensureDirs();

function loadUsers() {
  if (!fs.existsSync(USERS_PATH)) return { users: [] };
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  } catch {
    return { users: [] };
  }
}
function saveUsers(db) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(db, null, 2), 'utf8');
}
function makeSalt() {
  return crypto.randomBytes(16).toString('hex');
}
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}
function findUser(db, username) {
  return (db.users || []).find(u => u.username === username);
}
function ensureDefaultAdmin() {
  const db = loadUsers();
  if (!(db.users || []).some(u => u.role === 'admin')) {
    const salt = makeSalt();
    const hash = hashPassword('1234', salt);
    db.users.push({ username: 'admin', role: 'admin', salt, hash });
    saveUsers(db);
    console.log('> Created default admin user: admin / 1234');
  }
}
ensureDefaultAdmin();

// Extensões suportadas para mídia
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

// --- Helpers de config do mural ---
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { defaults: {}, items: [] };
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { defaults: {}, items: [] }; }
}
function writeConfig(cfg) {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// --- Auth middlewares ---
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'forbidden' });
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

// ---------- API: Auth (multiusuário) ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const db = loadUsers();
  const user = findUser(db, username);
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });

  const h = hashPassword(password || '', user.salt);
  if (h !== user.hash) return res.status(401).json({ error: 'invalid_credentials' });

  req.session.user = { username: user.username, role: user.role };
  return res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// Trocar a PRÓPRIA senha
app.post('/api/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const db = loadUsers();
  const user = findUser(db, req.session.user.username);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  const h = hashPassword(currentPassword || '', user.salt);
  if (h !== user.hash) return res.status(400).json({ error: 'wrong_password' });

  const newSalt = makeSalt();
  user.salt = newSalt;
  user.hash = hashPassword(newPassword || '', newSalt);
  saveUsers(db);
  res.json({ ok: true });
});

// ---------- API: Gestão de usuários (ADMIN) ----------
// Listar usuários
app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const db = loadUsers();
  const list = (db.users || []).map(u => ({ username: u.username, role: u.role }));
  res.json({ users: list });
});

// Criar usuário
app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username_password_required' });
  const r = role === 'admin' ? 'admin' : 'user';

  const db = loadUsers();
  if (findUser(db, username)) return res.status(409).json({ error: 'user_exists' });

  const salt = makeSalt();
  const hash = hashPassword(password, salt);
  db.users.push({ username, role: r, salt, hash });
  saveUsers(db);
  res.json({ ok: true });
});

// Trocar senha de OUTRO usuário
app.post('/api/users/password', requireAuth, requireAdmin, (req, res) => {
  const { username, newPassword } = req.body || {};
  if (!username || !newPassword) return res.status(400).json({ error: 'username_newPassword_required' });

  const db = loadUsers();
  const user = findUser(db, username);
  if (!user) return res.status(404).json({ error: 'user_not_found' });

  const salt = makeSalt();
  user.salt = salt;
  user.hash = hashPassword(newPassword, salt);
  saveUsers(db);
  res.json({ ok: true });
});

// Remover usuário (não pode remover a si mesmo; não pode remover o último admin)
app.delete('/api/users/:username', requireAuth, requireAdmin, (req, res) => {
  const username = req.params.username;
  const db = loadUsers();
  const me = req.session.user.username;

  const target = findUser(db, username);
  if (!target) return res.status(404).json({ error: 'user_not_found' });

  if (username === me) return res.status(400).json({ error: 'cannot_delete_self' });

  if (target.role === 'admin') {
    const admins = (db.users || []).filter(u => u.role === 'admin');
    if (admins.length <= 1) return res.status(400).json({ error: 'cannot_delete_last_admin' });
  }

  db.users = (db.users || []).filter(u => u.username !== username);
  saveUsers(db);
  res.json({ ok: true });
});

// ---------- API: Admin do mural (mídias/config) ----------
app.get('/api/admin/state', requireAuth, (req, res) => {
  const cfg = readConfig();
  const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
  const mediaFiles = files
    .filter(f => f !== 'media.json' && !f.startsWith('.'))
    .filter(f => ALLOWED_EXT.has(path.extname(f).toLowerCase()));

  const payload = {
    defaults: cfg.defaults || {},
    overrides: cfg.items || [],
    files: mediaFiles,
    currentUser: req.session.user // <<< aqui quebra porque _req != req
  };

  if (req.session.user?.role === 'admin') {
    const db = loadUsers();
    payload.users = (db.users || []).map(u => ({ username: u.username, role: u.role }));
  }

  res.json(payload);
});

// POR ISTO:
app.get('/api/admin/state', requireAuth, (req, res) => {
  const cfg = readConfig();
  const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
  const mediaFiles = files
    .filter(f => f !== 'media.json' && !f.startsWith('.'))
    .filter(f => ALLOWED_EXT.has(path.extname(f).toLowerCase()));

  const payload = {
    defaults: cfg.defaults || {},
    overrides: cfg.items || [],
    files: mediaFiles,
    currentUser: req.session.user
  };

  if (req.session.user?.role === 'admin') {
    const db = loadUsers();
    payload.users = (db.users || []).map(u => ({ username: u.username, role: u.role }));
  }

  res.json(payload);
});

app.get('/api/local-ips', (_req, res) => {
  try {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        const isV4 = net.family === 'IPv4' || net.family === 4;
        if (isV4 && !net.internal) ips.push(net.address);
      }
    }
    // fallback: se nada encontrado, pelo menos 127.0.0.1
    if (ips.length === 0) ips.push('127.0.0.1');
    res.json({ ips });
  } catch (e) {
    console.error('local-ips error', e);
    res.status(500).json({ ips: [], error: 'local_ips_failed' });
  }
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
