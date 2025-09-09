// server.js
/* eslint-disable no-console */
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const os = require('os');
const http = require('http');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const mime = require('mime-types');
const crypto = require('crypto');

const APP_PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const REDIRECT_80 = process.env.REDIRECT_80 !== 'false'; // def: true
const REDIRECT_PORT = 80;

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media');
const MANIFEST_PATH = path.join(MEDIA_DIR, 'media.json');
const USERS_PATH = path.join(ROOT_DIR, 'data/users.json');

// ---------- util ----------
function ensureDirSync(dir) {
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
}
ensureDirSync(PUBLIC_DIR);
ensureDirSync(MEDIA_DIR);

// password hashing (simples com salt + sha256)
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(s + '::' + String(password)).digest('hex');
  return { salt: s, hash };
}

// carregar / salvar JSON seguros
async function readJsonSafe(file, fallback) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}
async function writeJsonSafe(file, obj) {
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// inicializa users.json com admin:1234
async function ensureInitialUsers() {
  const exists = fsSync.existsSync(USERS_PATH);
  if (!exists) {
    const { salt, hash } = hashPassword('1234');
    const data = {
      users: [
        { username: 'admin', role: 'admin', salt, hash }
      ]
    };
    await writeJsonSafe(USERS_PATH, data);
    console.log('users.json criado com admin / 1234');
  }
}
async function getUsersDb() {
  await ensureInitialUsers();
  return await readJsonSafe(USERS_PATH, { users: [] });
}
async function saveUsersDb(db) {
  await writeJsonSafe(USERS_PATH, db);
}
function findUser(db, username) {
  return (db.users || []).find(u => u.username === username);
}
function sanitizeBasename(name) {
  if (typeof name !== 'string') return null;
  const base = path.basename(name);
  if (!base || base === '.' || base === '..') return null;
  if (base.includes('\0')) return null;
  return base;
}
function insideMedia(fullPath) {
  const root = path.resolve(MEDIA_DIR) + path.sep;
  const abs = path.resolve(fullPath);
  if (!abs.startsWith(root)) throw new Error('Path traversal');
  return abs;
}
function isAllowedExt(name) {
  return /\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|ogg|html?)$/i.test(name);
}
function isHtmlFile(name) {
  return /\.html?$/i.test(name);
}

// Sanitização simples de HTML (remove <script> e atributos on*)
function sanitizeUserHtml(input = '') {
  let out = String(input);
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/\son\w+="[^"]*"/gi, '');
  out = out.replace(/\son\w+='[^']*'/gi, '');
  out = out.replace(/\son\w+=\S+/gi, '');
  return out;
}

// Manifest helpers
async function readManifest() {
  const m = await readJsonSafe(MANIFEST_PATH, null);
  if (m && typeof m === 'object') return m;
  // padrão inicial
  const def = {
    defaults: {
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
    },
    overrides: []
  };
  await writeJsonSafe(MANIFEST_PATH, def);
  return def;
}
async function saveManifest(partial) {
  const current = await readManifest();
  const next = { ...current, ...partial };
  // garante estrutura
  if (!Array.isArray(next.overrides)) next.overrides = [];
  if (typeof next.defaults !== 'object' || !next.defaults) next.defaults = {};
  await writeJsonSafe(MANIFEST_PATH, next);
  return next;
}
async function listMediaFiles() {
  const all = await fs.readdir(MEDIA_DIR);
  return all
    .filter(n => n !== 'media.json')
    .filter(n => isAllowedExt(n))
    .sort((a,b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Local IPs
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'mural-secret-' + Math.random().toString(36).slice(2),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000
  }
}));

// static
app.use('/media', express.static(MEDIA_DIR, { dotfiles: 'ignore', index: false }));
app.use(express.static(BUILD_DIR, { index: false }));
app.use(express.static(PUBLIC_DIR, { index: false }));

// ---------- auth middlewares ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'auth required' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).json({ error: 'admin required' });
}

// ---------- auth routes ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing credentials' });
  const db = await getUsersDb();
  const user = findUser(db, String(username));
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const { hash } = hashPassword(String(password), user.salt);
  if (crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'))) {
    req.session.user = { username: user.username, role: user.role };
    return res.json({ ok: true, user: req.session.user });
  }
  return res.status(401).json({ error: 'invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  return res.json({ user: req.session?.user || null });
});

// trocar a própria senha
app.post('/api/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing fields' });
  const db = await getUsersDb();
  const user = findUser(db, req.session.user.username);
  if (!user) return res.status(401).json({ error: 'not found' });
  const { hash } = hashPassword(String(currentPassword), user.salt);
  const ok = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
  if (!ok) return res.status(401).json({ error: 'invalid current password' });
  const next = hashPassword(String(newPassword));
  user.salt = next.salt;
  user.hash = next.hash;
  await saveUsersDb(db);
  return res.json({ ok: true });
});

// ---------- users management (admin) ----------
app.get('/api/users', requireAdmin, async (req, res) => {
  const db = await getUsersDb();
  res.json({ users: (db.users || []).map(u => ({ username: u.username, role: u.role })) });
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  const u = String(username || '').trim();
  const p = String(password || '');
  const r = role === 'admin' ? 'admin' : 'user';
  if (!u || !p) return res.status(400).json({ error: 'missing username/password' });
  const db = await getUsersDb();
  if (findUser(db, u)) return res.status(409).json({ error: 'user exists' });
  const { salt, hash } = hashPassword(p);
  db.users.push({ username: u, role: r, salt, hash });
  await saveUsersDb(db);
  res.json({ ok: true });
});

app.delete('/api/users/:username', requireAdmin, async (req, res) => {
  const uname = sanitizeBasename(req.params.username);
  if (!uname) return res.status(400).json({ error: 'invalid username' });
  const db = await getUsersDb();
  const before = db.users.length;
  db.users = db.users.filter(u => u.username !== uname);
  if (before === db.users.length) return res.status(404).json({ error: 'not found' });
  await saveUsersDb(db);
  res.json({ ok: true });
});

app.post('/api/users/password', requireAdmin, async (req, res) => {
  const { username, newPassword } = req.body || {};
  const u = String(username || '').trim();
  const p = String(newPassword || '');
  if (!u || !p) return res.status(400).json({ error: 'missing fields' });
  const db = await getUsersDb();
  const user = findUser(db, u);
  if (!user) return res.status(404).json({ error: 'not found' });
  const next = hashPassword(p);
  user.salt = next.salt;
  user.hash = next.hash;
  await saveUsersDb(db);
  res.json({ ok: true });
});

// ---------- admin state ----------
app.get('/api/admin/state', requireAuth, async (req, res) => {
  const m = await readManifest();
  const files = await listMediaFiles();
  const currentUser = req.session.user;
  let users = [];
  if (currentUser?.role === 'admin') {
    const db = await getUsersDb();
    users = (db.users || []).map(u => ({ username: u.username, role: u.role }));
  }
  res.json({
    defaults: m.defaults || {},
    overrides: m.overrides || [],
    files,
    currentUser,
    users
  });
});

// ---------- upload / delete ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    // mantém o nome original (sanitizado)
    const base = sanitizeBasename(file.originalname);
    cb(null, base || ('upload-' + Date.now()));
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname).slice(1);
    const name = file.originalname.toLowerCase();
    if (isAllowedExt(name) || /(mp4|webm|ogg|png|jpe?g|gif|webp|bmp|svg|html?)$/.test(ext || '')) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

app.post('/api/admin/upload', requireAuth, upload.single('file'), async (req, res) => {
  res.json({ ok: true, file: req.file?.filename });
});

app.delete('/api/admin/file/:name', requireAuth, async (req, res) => {
  try {
    const base = sanitizeBasename(req.params.name);
    if (!base) return res.status(400).json({ error: 'invalid name' });
    const full = insideMedia(path.join(MEDIA_DIR, base));
    await fs.unlink(full);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'delete failed' });
  }
});

// ---------- overrides / defaults ----------
app.post('/api/admin/override', requireAuth, async (req, res) => {
  const body = req.body || {};
  const src = sanitizeBasename(body.src);
  if (!src) return res.status(400).json({ error: 'invalid src' });
  const m = await readManifest();
  const clean = { ...body, src };
  // permite apenas campos conhecidos
  const allowed = ['src','type','fitMode','imageDurationMs','htmlDurationMs','mute','volume','schedule'];
  Object.keys(clean).forEach(k => { if (!allowed.includes(k)) delete clean[k]; });
  const idx = (m.overrides || []).findIndex(o => o.src === src);
  if (idx >= 0) m.overrides[idx] = { ...m.overrides[idx], ...clean };
  else m.overrides.push(clean);
  await saveManifest(m);
  res.json({ ok: true });
});

app.delete('/api/admin/override/:src', requireAuth, async (req, res) => {
  const src = sanitizeBasename(req.params.src);
  if (!src) return res.status(400).json({ error: 'invalid src' });
  const m = await readManifest();
  m.overrides = (m.overrides || []).filter(o => o.src !== src);
  await saveManifest(m);
  res.json({ ok: true });
});

app.post('/api/admin/defaults', requireAuth, async (req, res) => {
  const m = await readManifest();
  m.defaults = { ...(m.defaults || {}), ...(req.body || {}) };
  await saveManifest(m);
  res.json({ ok: true });
});

// ---------- criar aviso HTML ----------
const DEFAULT_HTML_MAX_WIDTH = 1200;
const DEFAULT_HTML_PADDING = 24;

function makeHtmlDoc({
  title = 'Aviso',
  bodyHtml = '<p>Escreva sua mensagem…</p>',
  bgColor = '#000000',
  textColor = '#ffffff',
  fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  fontSizePx = 48,
  textAlign = 'center',
  paddingPx = DEFAULT_HTML_PADDING,
  maxWidthPx = DEFAULT_HTML_MAX_WIDTH
}) {
  const safeBody = sanitizeUserHtml(bodyHtml);
  const align = ['left','center','right','justify'].includes(String(textAlign).toLowerCase())
    ? String(textAlign).toLowerCase() : 'center';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  html,body{height:100%}
  body{
    margin:0;
    background:${bgColor};
    color:${textColor};
    font-family:${fontFamily};
    display:flex;
    align-items:center;
    justify-content:center;
  }
  .wrap{
    box-sizing:border-box;
    max-width:${Number(maxWidthPx) || DEFAULT_HTML_MAX_WIDTH}px;
    width:100%;
    padding:${Number(paddingPx) || DEFAULT_HTML_PADDING}px;
    font-size:${Number(fontSizePx) || 48}px;
    line-height:1.25;
    text-align:${align};
    word-wrap:break-word;
    overflow-wrap:break-word;
  }
  * { cursor:none !important; }
</style>
</head>
<body>
  <div class="wrap">
    ${safeBody}
  </div>
</body>
</html>`;
}

app.post('/api/admin/html', requireAuth, async (req, res) => {
  try {
    const {
      filename,
      title, bodyHtml,
      bgColor, textColor,
      fontFamily, fontSizePx, textAlign,
      paddingPx = DEFAULT_HTML_PADDING,
      maxWidthPx = DEFAULT_HTML_MAX_WIDTH
    } = req.body || {};

    const baseName = sanitizeBasename(filename || '') || `aviso-${Date.now()}.html`;
    if (!isHtmlFile(baseName)) return res.status(400).json({ error: 'filename must end with .html' });

    const html = makeHtmlDoc({
      title, bodyHtml, bgColor, textColor, fontFamily, fontSizePx, textAlign,
      paddingPx, maxWidthPx
    });

    const dest = insideMedia(path.join(MEDIA_DIR, baseName));
    await fs.writeFile(dest, html, 'utf8');
    res.json({ ok: true, file: baseName });
  } catch (err) {
    console.error('html create error:', err);
    res.status(500).json({ error: 'failed to create html' });
  }
});

// ---------- duplicar aviso HTML ----------
app.post('/api/admin/duplicate', requireAuth, async (req, res) => {
  try {
    const { src, dest } = req.body || {};
    const srcName = sanitizeBasename(src);
    const destName = sanitizeBasename(dest);
    if (!srcName || !destName) return res.status(400).json({ ok:false, error:'Nome inválido' });
    if (!isHtmlFile(srcName) || !isHtmlFile(destName)) {
      return res.status(400).json({ ok:false, error:'Apenas .html / .htm' });
    }
    const srcPath = insideMedia(path.join(MEDIA_DIR, srcName));
    const destPath = insideMedia(path.join(MEDIA_DIR, destName));
    try { await fs.access(srcPath); } catch { return res.status(404).json({ ok:false, error:'Origem não encontrada' }); }
    try {
      await fs.access(destPath);
      return res.status(409).json({ ok:false, error:'Destino já existe' });
    } catch { /* ok */ }
    await fs.copyFile(srcPath, destPath);
    res.json({ ok:true, file: destName });
  } catch (err) {
    console.error('duplicate error:', err);
    res.status(500).json({ ok:false, error:'Erro ao duplicar' });
  }
});

// LER conteúdo de um HTML existente
app.get('/api/admin/html/:name', requireAuth, async (req, res) => {
  try {
    const base = sanitizeBasename(req.params.name);
    if (!base || !isHtmlFile(base)) {
      return res.status(400).json({ error: 'nome inválido' });
    }
    const full = insideMedia(path.join(MEDIA_DIR, base));
    const html = await fs.readFile(full, 'utf8');
    return res.json({ ok: true, name: base, html });
  } catch (err) {
    console.error('read html error:', err);
    return res.status(500).json({ error: 'falha ao ler html' });
  }
});

// SALVAR conteúdo de um HTML
app.post('/api/admin/html-save', requireAuth, async (req, res) => {
  try {
    const { src, html } = req.body || {};
    const base = sanitizeBasename(src);
    if (!base || !isHtmlFile(base)) {
      return res.status(400).json({ error: 'nome inválido' });
    }
    // Sanitização simples: remove <script> e on*
    const safe = sanitizeUserHtml(String(html || ''));
    const full = insideMedia(path.join(MEDIA_DIR, base));
    await fs.writeFile(full, safe, 'utf8');
    return res.json({ ok: true });
  } catch (err) {
    console.error('save html error:', err);
    return res.status(500).json({ error: 'falha ao salvar html' });
  }
});


// ---------- manifest para o Player ----------
app.get('/api/manifest', async (req, res) => {
  const m = await readManifest();
  const files = await listMediaFiles();
  res.json({
    defaults: m.defaults || {},
    overrides: m.overrides || [],
    files
  });
});

// ---------- ip local para overlay do Player ----------
app.get('/api/local-ip', (req, res) => {
  res.json({ ips: getLocalIPs() });
});

// ---------- SPA fallback (CRA) ----------
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(BUILD_DIR, 'index.html'));
});
app.get('*', (req, res, next) => {
  // se for request para arquivo existente em public/build, deixa 404 padrão
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next();
  // serve index do build
  res.sendFile(path.join(BUILD_DIR, 'index.html'), err => {
    if (err) next();
  });
});

// ---------- start servers ----------
app.listen(APP_PORT, () => {
  console.log(`Server running on http://localhost:${APP_PORT}`);
});

// opcional: redirect 80 -> APP_PORT
if (REDIRECT_80) {
  try {
    http.createServer((req, res) => {
      const host = (req.headers.host || '').replace(/:\d+$/, '');
      const location = `http://${host}:${APP_PORT}${req.url || '/'}`;
      res.statusCode = 302;
      res.setHeader('Location', location);
      res.end(`Redirecting to ${location}\n`);
    }).listen(REDIRECT_PORT, () => {
      console.log(`Redirector listening on :${REDIRECT_PORT} -> :${APP_PORT}`);
    }).on('error', (err) => {
      console.warn(`Port ${REDIRECT_PORT} redirect not started: ${err.message}`);
    });
  } catch (e) {
    console.warn('Redirector error:', e.message);
  }
}
