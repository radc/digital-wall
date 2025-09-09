// src/pages/Admin.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiJSON, apiUpload } from '../utils/api';

const emptyDefaults = {
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
};

// Padrões de layout do aviso HTML (não exibidos no formulário)
const DEFAULT_HTML_MAX_WIDTH = 1200; // px
const DEFAULT_HTML_PADDING   = 24;   // px

const fitModes = ['fit', 'crop', 'fill', 'zoom'];
const weekDays = ['mon','tue','wed','thu','fri','sat','sun'];

// Ordem e rótulos atuais do menu
const VIEWS = [
  { key: 'media',    label: 'Arquivos + Overrides' },
  { key: 'notice',   label: 'Aviso Rápido (HTML)' },
  { key: 'defaults', label: 'Configurações Padrão' },
  { key: 'users',    label: 'Usuários' },
  { key: 'password', label: 'Alterar Senha' },
];

// --------- helpers de preview (cliente) ---------
function sanitizeUserHtmlClient(input = '') {
  let out = String(input);
  // remove <script>...</script> e handlers inline
  out = out.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/\son\w+="[^"]*"/gi, '');
  out = out.replace(/\son\w+='[^']*'/gi, '');
  out = out.replace(/\son\w+=\S+/gi, '');
  return out;
}

function makeHtmlDoc({
  title = 'Aviso',
  bodyHtml = '<p>Escreva sua mensagem…</p>',
  bgColor = '#000000',
  textColor = '#ffffff',
  fontFamily = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`,
  fontSizePx = 48,
  textAlign = 'center',
  paddingPx = DEFAULT_HTML_PADDING,
  maxWidthPx = DEFAULT_HTML_MAX_WIDTH
}) {
  const safeBody = sanitizeUserHtmlClient(bodyHtml);
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

export default function Admin() {
  const [auth, setAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [currentUser, setCurrentUser] = useState(null);

  const [files, setFiles] = useState([]);
  const [defaults, setDefaults] = useState(emptyDefaults);
  const [overrides, setOverrides] = useState([]);
  const [selected, setSelected] = useState(null);
  const [users, setUsers] = useState([]);

  const selectedOverride = useMemo(
    () => overrides.find(o => o.src === selected) || { src: selected },
    [overrides, selected]
  );

  // Preview modal: arquivo selecionado para visualizar
  const [previewFile, setPreviewFile] = useState(null);

  // Editor de HTML (modal)
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFile, setEditorFile] = useState('');
  const [editorHtml, setEditorHtml] = useState('');
  const [editorSaving, setEditorSaving] = useState(false);

  // view atual (persistimos no localStorage) — default é "media"
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('adminView') || 'media'; } catch { return 'media'; }
  });
  useEffect(() => {
    try { localStorage.setItem('adminView', view); } catch {}
  }, [view]);

  // menu dropdown no header
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    const onClick = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        if (previewFile) setPreviewFile(null);
        if (editorOpen) setEditorOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [previewFile, editorOpen]);

  const usersCardRef = useRef(null);

  // refs e estado da pré-visualização do aviso
  const htmlFormRef = useRef(null);
  const [previewSrcDoc, setPreviewSrcDoc] = useState('');

  async function refresh() {
    setLoading(true);
    setErr('');
    try {
      const st = await apiJSON('/api/admin/state');
      setAuth(true);
      setCurrentUser(st.currentUser || null);
      setFiles(st.files || []);
      setDefaults({ ...emptyDefaults, ...(st.defaults || {}) });
      setOverrides(st.overrides || []);
      setUsers(st.users || []);
      if (!st.currentUser) {
        try { const me = await apiJSON('/api/me'); setCurrentUser(me.user || null); } catch {}
      }
      // prepara preview inicial com valores padrão
      setPreviewSrcDoc(makeHtmlDoc({}));
    } catch (e) {
      setAuth(false);
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  // --------- Auth ---------
  async function onLogin(e) {
    e.preventDefault();
    setErr('');
    const data = new FormData(e.currentTarget);
    const username = data.get('username');
    const password = data.get('password');
    try {
      await apiJSON('/api/login', 'POST', { username, password });
      await refresh();
    } catch {
      setErr('Falha no login');
    }
  }
  async function onLogout() {
    await apiJSON('/api/logout', 'POST', {});
    setAuth(false);
  }

  // --------- Mídias / Config ---------
  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await apiUpload('/api/admin/upload', file);
      await refresh();
      setSelected(file.name);
      e.target.value = '';
    } catch (e) {
      alert('Falha no upload: ' + e.message);
    }
  }

  async function onDeleteFile(name) {
    if (!window.confirm(`Excluir o arquivo ${name}?`)) return;
    try {
      await apiJSON(`/api/admin/file/${encodeURIComponent(name)}`, 'DELETE');
      if (selected === name) setSelected(null);
      await refresh();
    } catch (e) {
      alert('Falha ao excluir: ' + e.message);
    }
  }

  // Duplicar aviso HTML
  async function duplicateHtml(src) {
    const base = src.replace(/\.html?$/i, '');
    const suggested = `copia-de-${base}.html`;
    const dest = prompt('Novo nome do arquivo HTML:', suggested);
    if (!dest) return;
    if (!/\.html?$/i.test(dest)) {
      alert('O nome do destino deve terminar com .html');
      return;
    }
    if (/[\\/]/.test(dest)) {
      alert('Não use barras no nome do arquivo.');
      return;
    }
    try {
      const res = await apiJSON('/api/admin/duplicate', 'POST', { src, dest });
      if (res && res.ok === false) throw new Error(res.error || 'Falha ao duplicar');
      alert('Arquivo duplicado!');
      await refresh();
      setSelected(dest);
    } catch (e) {
      alert('Falha ao duplicar: ' + e.message);
    }
  }

  async function saveDefaults() {
    try {
      await apiJSON('/api/admin/defaults', 'POST', defaults);
      alert('Configurações padrão salvas');
      await refresh();
    } catch (e) {
      alert('Falha ao salvar configurações: ' + e.message);
    }
  }

  async function saveOverride() {
    if (!selected) return alert('Selecione um arquivo');
    try {
      const payload = { ...selectedOverride, src: selected };
      await apiJSON('/api/admin/override', 'POST', payload);
      alert('Override salvo');
      await refresh();
    } catch (e) {
      alert('Falha ao salvar override: ' + e.message);
    }
  }

  async function removeOverride() {
    if (!selected) return;
    try {
      await apiJSON(`/api/admin/override/${encodeURIComponent(selected)}`, 'DELETE');
      alert('Override removido');
      await refresh();
    } catch (e) {
      alert('Falha ao remover: ' + e.message);
    }
  }

  // --------- Alterar Senha ---------
  async function changeOwnPassword(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const currentPassword = data.get('currentPassword');
    const newPassword = data.get('newPassword');
    if (!newPassword) return alert('Informe a nova senha.');
    try {
      await apiJSON('/api/me/password', 'POST', { currentPassword, newPassword });
      alert('Senha alterada com sucesso!');
      e.currentTarget.reset();
    } catch (err) {
      alert('Falha ao trocar senha: ' + err.message);
    }
  }

  // --------- Gestão de usuários (admin) ---------
  async function addUser(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const username = data.get('nu_username');
    const password = data.get('nu_password');
    const role = data.get('nu_role');
    if (!username || !password) return alert('Preencha usuário e senha.');
    try {
      await apiJSON('/api/users', 'POST', { username, password, role });
      alert('Usuário criado');
      e.currentTarget.reset();
      await refresh();
    } catch (err) {
      alert('Falha ao criar usuário: ' + err.message);
    }
  }

  async function resetPassword(username) {
    const newPassword = prompt(`Nova senha para ${username}:`);
    if (!newPassword) return;
    try {
      await apiJSON('/api/users/password', 'POST', { username, newPassword });
      alert('Senha redefinida.');
    } catch (err) {
      alert('Falha ao redefinir senha: ' + err.message);
    }
  }

  async function deleteUser(username) {
    if (!window.confirm(`Remover usuário ${username}?`)) return;
    try {
      await apiJSON(`/api/users/${encodeURIComponent(username)}`, 'DELETE');
      alert('Usuário removido');
      await refresh();
    } catch (err) {
      alert('Falha ao remover: ' + err.message);
    }
  }

  // --------- Criar aviso HTML + preview ---------
  function updatePreview() {
    if (!htmlFormRef.current) return;
    const data = new FormData(htmlFormRef.current);
    const payload = {
      title: data.get('title') || 'Aviso',
      bodyHtml: data.get('bodyHtml') || '<p>Escreva sua mensagem…</p>',
      bgColor: data.get('bgColor') || '#000000',
      textColor: data.get('textColor') || '#ffffff',
      fontFamily: data.get('fontFamily') || `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`,
      fontSizePx: Number(data.get('fontSizePx') || 48),
      textAlign: data.get('textAlign') || 'center',
      // defaults "ocultos"
      paddingPx: DEFAULT_HTML_PADDING,
      maxWidthPx: DEFAULT_HTML_MAX_WIDTH
    };
    setPreviewSrcDoc(makeHtmlDoc(payload));
  }

  async function createHtml(e) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const payload = {
      filename: (data.get('filename') || '').trim(),
      title: data.get('title') || '',
      bodyHtml: data.get('bodyHtml') || '',
      bgColor: data.get('bgColor') || '#000000',
      textColor: data.get('textColor') || '#ffffff',
      fontFamily: data.get('fontFamily') || `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif`,
      fontSizePx: Number(data.get('fontSizePx') || 48),
      textAlign: data.get('textAlign') || 'center',
      paddingPx: DEFAULT_HTML_PADDING,
      maxWidthPx: DEFAULT_HTML_MAX_WIDTH
    };
    try {
      const res = await apiJSON('/api/admin/html', 'POST', payload);
      alert('Aviso criado: ' + res.file);
      e.currentTarget.reset();
      // reseta preview
      setPreviewSrcDoc(makeHtmlDoc({}));
      await refresh();
      setSelected(res.file);
      setView('media');
    } catch (err) {
      alert('Falha ao criar aviso: ' + err.message);
    }
  }

  // --------- Preview de mídia (modal) ---------
  function openPreview(name) { setPreviewFile(name); }
  function closePreview() { setPreviewFile(null); }

  function renderFilePreview(name) {
    const url = `/media/${encodeURIComponent(name)}`;
    const isImg  = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    const isVid  = /\.(mp4|webm|ogg)$/i.test(name);
    const isHtml = /\.html?$/i.test(name);
    if (isImg) {
      return <img src={url} alt={name} style={{maxWidth:'100%', maxHeight:'70vh', display:'block'}} />;
    }
    if (isVid) {
      return (
        <video
          src={url}
          style={{maxWidth:'100%', maxHeight:'70vh', display:'block'}}
          controls
          autoPlay
          loop
          playsInline
          muted
        />
      );
    }
    if (isHtml) {
      return (
        <iframe
          title={`preview-${name}`}
          src={url}
          style={{width:'min(90vw, 1200px)', height:'70vh', border:0, background:'#000'}}
        />
      );
    }
    return <div className="muted">Tipo não suportado para preview.</div>;
  }

  // --------- Editor de HTML (modal) ---------
  async function openHtmlEditor(name) {
    try {
      const res = await apiJSON(`/api/admin/html/${encodeURIComponent(name)}`);
      setEditorFile(name);
      setEditorHtml(res.html || '');
      setEditorOpen(true);
    } catch (e) {
      alert('Falha ao carregar HTML: ' + e.message);
    }
  }
  async function reloadHtmlFromDisk() {
    if (!editorFile) return;
    try {
      const res = await apiJSON(`/api/admin/html/${encodeURIComponent(editorFile)}`);
      setEditorHtml(res.html || '');
    } catch (e) {
      alert('Falha ao recarregar: ' + e.message);
    }
  }
  async function saveHtmlToDisk() {
    if (!editorFile) return;
    try {
      setEditorSaving(true);
      await apiJSON('/api/admin/html-save', 'POST', { src: editorFile, html: editorHtml });
      setEditorSaving(false);
      alert('HTML salvo com sucesso.');
      await refresh();
    } catch (e) {
      setEditorSaving(false);
      alert('Falha ao salvar: ' + e.message);
    }
  }
  function closeEditor() { setEditorOpen(false); }

  // --------- Render helpers por view ---------
  function renderNoticeView() {
    return (
      <div className="card">
        <h3 className="card-title">Aviso Rápido (HTML)</h3>
        <div className="view-grid notice-grid">
          {/* Formulário */}
          <form
            ref={htmlFormRef}
            className="form"
            onSubmit={createHtml}
            autoComplete="off"
            onInput={updatePreview}
            onChange={updatePreview}
          >
            <LabeledRow label="Título (opcional)">
              <input name="title" className="input" placeholder="Aviso" />
            </LabeledRow>

            <LabeledRow label="Mensagem (aceita HTML básico)">
              <textarea name="bodyHtml" className="input" rows={6} placeholder="Digite sua mensagem..."></textarea>
            </LabeledRow>

            <div className="field" style={{flexWrap:'wrap'}}>
              <label className="field-label">Cores</label>
              <div className="field-control" style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                  <span style={{minWidth:70}}>Texto</span>
                  <input type="color" name="textColor" defaultValue="#ffffff" className="input" style={{width:52, padding:0, minHeight:44}} />
                </label>
                <label style={{display:'inline-flex', alignItems:'center', gap:6}}>
                  <span style={{minWidth:70}}>Fundo</span>
                  <input type="color" name="bgColor" defaultValue="#000000" className="input" style={{width:52, padding:0, minHeight:44}} />
                </label>
              </div>
            </div>

            <div className="field" style={{flexWrap:'wrap'}}>
              <label className="field-label">Tipografia</label>
              <div className="field-control" style={{display:'flex', gap:8, flexWrap:'wrap'}}>
                <select
                  name="fontFamily"
                  className="input"
                  defaultValue='system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'
                >
                  <option value='system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif'>Sistema/Inter</option>
                  <option value='"Arial", sans-serif'>Arial</option>
                  <option value='"Times New Roman", serif'>Times</option>
                  <option value='"Courier New", monospace'>Mono</option>
                </select>
                <input type="number" name="fontSizePx" className="input" defaultValue={48} min={12} max={200} step={2} />
                <select name="textAlign" className="input" defaultValue="center">
                  <option value="left">left</option>
                  <option value="center">center</option>
                  <option value="right">right</option>
                  <option value="justify">justify</option>
                </select>
              </div>
            </div>

            {/* Explicação sobre layout padrão */}
            <div className="muted" style={{marginTop:8}}>
              O layout do aviso usa <strong>largura máxima {DEFAULT_HTML_MAX_WIDTH}px</strong> e
              <strong> padding {DEFAULT_HTML_PADDING}px</strong> como padrão.
            </div>

            <LabeledRow label="Nome do arquivo (opcional)">
              <input name="filename" className="input" placeholder="ex.: aviso-loja.html (sem barras)" />
            </LabeledRow>

            <div className="actions-row">
              <button type="submit" className="btn">Gerar aviso</button>
              <div className="muted" style={{fontSize:12}}>
                Observação: removemos <code>&lt;script&gt;</code> e atributos <code>on*</code> por segurança.
              </div>
            </div>
          </form>

          {/* Pré-visualização 16:9 abaixo do formulário */}
          <div className="preview-card">
            <div className="preview-header">
              <strong>Pré-visualização 16:9</strong>
              <span className="muted">(render ao vivo)</span>
            </div>
            {/* Caixa de proporção fixa 16:9 */}
            <div className="ratio-16x9">
              <iframe
                className="preview-iframe"
                title="preview-aviso"
                srcDoc={previewSrcDoc}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderMediaView() {
    return (
      <div className="card">
        <h3 className="card-title">Arquivos + Overrides</h3>
        <div className="view-grid media-grid">
          {/* Arquivos (esquerda) */}
          <div className="card subcard">
            <h4 className="sub-title">Arquivos</h4>
            <label className="file-input">
              <input type="file" onChange={onUpload} />
              <span>Selecionar arquivo…</span>
            </label>

            <ul className="file-list">
              {files.map(f => {
                const isHtml = /\.html?$/i.test(f);
                return (
                  <li
                    key={f}
                    className="file-item"
                    onDoubleClick={() => openPreview(f)}
                    title="Duplo clique para pré-visualizar"
                  >
                    <button
                      onClick={() => setSelected(f)}
                      className={`link-btn ${selected===f ? 'is-active' : ''}`}
                      title="Selecionar para editar override"
                    >
                      {f}
                    </button>
                    {isHtml && (
                      <>
                        <button
                          onClick={() => openHtmlEditor(f)}
                          className="btn btn-secondary"
                          title="Editar HTML"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => duplicateHtml(f)}
                          className="btn btn-secondary"
                          title="Duplicar aviso HTML"
                        >
                          Duplicar
                        </button>
                      </>
                    )}
                    <button onClick={() => onDeleteFile(f)} className="btn btn-danger">Excluir</button>
                  </li>
                );
              })}
              {files.length === 0 && <li className="muted">Nenhum arquivo</li>}
            </ul>
          </div>

          {/* Override (direita) */}
          <div className="card subcard">
            <h4 className="sub-title">Override por arquivo</h4>
            {!selected && <div className="muted">Selecione um arquivo na lista.</div>}
            {selected && (
              <OverrideForm
                value={selectedOverride}
                setValue={(v) => {
                  const withSrc = { ...v, src: selected };
                  const others = overrides.filter(o => o.src !== selected);
                  setOverrides([...others, withSrc]);
                }}
              />
            )}
            <div className="actions-row">
              <button onClick={saveOverride} className="btn" disabled={!selected}>Salvar override</button>
              <button onClick={removeOverride} className="btn btn-secondary" disabled={!selected}>Remover override</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderDefaultsView() {
    return (
      <div className="card">
        <h3 className="card-title">Configurações Padrão</h3>
        <DefaultsForm defaults={defaults} setDefaults={setDefaults} />
        <div className="actions-row">
          <button onClick={saveDefaults} className="btn">Salvar configurações</button>
        </div>
      </div>
    );
  }

  function renderUsersView() {
    const isAdmin = currentUser?.role === 'admin';
    return (
      <div className="card" ref={usersCardRef}>
        <h3 className="card-title">Usuários</h3>
        {!isAdmin && <div className="muted">Você não tem permissão para gerenciar usuários.</div>}
        {isAdmin && (
          <div className="view-grid users-grid">
            <div className="card subcard">
              <h4 className="sub-title">Lista</h4>
              <ul className="user-list">
                {(users || []).map(u => (
                  <li key={u.username} className="user-item">
                    <div className="user-id">
                      <strong>{u.username}</strong>
                      <span className="tag">{u.role}</span>
                    </div>
                    <div className="user-actions">
                      <button onClick={() => resetPassword(u.username)} className="btn btn-secondary">Redefinir senha</button>
                      <button onClick={() => deleteUser(u.username)} className="btn btn-danger">Remover</button>
                    </div>
                  </li>
                ))}
                {(!users || users.length === 0) && <li className="muted">Nenhum usuário</li>}
              </ul>
            </div>

            <div className="card subcard">
              <h4 className="sub-title">Novo usuário</h4>
              <form onSubmit={addUser} className="form" autoComplete="off">
                <LabeledRow label="Usuário">
                  <input name="nu_username" className="input" autoComplete="off" required />
                </LabeledRow>
                <LabeledRow label="Senha">
                  <input name="nu_password" type="password" className="input" autoComplete="new-password" required />
                </LabeledRow>
                <LabeledRow label="Role">
                  <select name="nu_role" className="input">
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </LabeledRow>
                <div className="actions-row">
                  <button type="submit" className="btn">Criar usuário</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderPasswordView() {
    return (
      <div className="card">
        <h3 className="card-title">Alterar Senha</h3>
        <form onSubmit={changeOwnPassword} className="form">
          <LabeledRow label="Senha atual">
            <input name="currentPassword" type="password" className="input" required />
          </LabeledRow>
          <LabeledRow label="Nova senha">
            <input name="newPassword" type="password" className="input" required />
          </LabeledRow>
          <div className="actions-row">
            <button type="submit" className="btn">Trocar minha senha</button>
          </div>
        </form>
      </div>
    );
  }

  // --------- UI ---------
  if (loading) {
    return (
      <div className="admin-page">
        <div className="card">Carregando…</div>
        <AdminStyles/>
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="admin-page">
        <form onSubmit={onLogin} className="card login-card" autoComplete="off">
          <h2 className="card-title">Login</h2>

          <div className="field">
            <label className="field-label">Usuário</label>
            <input
              name="username"
              className="input"
              autoComplete="off"
              required
            />
          </div>

          <div className="field">
            <label className="field-label">Senha</label>
            <input
              name="password"
              type="password"
              className="input"
              autoComplete="new-password"
              required
            />
          </div>

          <button type="submit" className="btn">Entrar</button>
          {err && <div className="error">{String(err)}</div>}
        </form>
        <AdminStyles/>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="left">
          <h2 className="admin-title">Admin do Mural</h2>
          <div className="breadcrumb muted">
            {VIEWS.find(v => v.key === view)?.label || ''}
          </div>
        </div>

        <div className="header-actions">
          {/* Menu dropdown */}
          <div className="menu-wrapper" ref={menuRef}>
            <button
              className="btn btn-secondary menu-trigger"
              onClick={() => setMenuOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen ? 'true' : 'false'}
              title="Selecionar seção"
            >
              Menu ▾
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                {VIEWS.map(v => (
                  <button
                    key={v.key}
                    role="menuitem"
                    className={`menu-item ${view===v.key ? 'is-active' : ''}`}
                    onClick={() => { setView(v.key); setMenuOpen(false); }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={refresh} className="btn btn-secondary">Atualizar</button>
          <span className="user-chip">{currentUser?.username} ({currentUser?.role})</span>
          <button onClick={onLogout} className="btn">Sair</button>
        </div>
      </header>

      <main className="content-area">
        {view === 'notice'   && renderNoticeView()}
        {view === 'media'    && renderMediaView()}
        {view === 'defaults' && renderDefaultsView()}
        {view === 'users'    && renderUsersView()}
        {view === 'password' && renderPasswordView()}
      </main>

      <p className="footnote">
        Dica: o player recarrega o manifest automaticamente a cada 60s.
      </p>

      {/* Modal de preview */}
      {previewFile && (
        <div className="modal-backdrop" onClick={closePreview}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong>Preview:</strong> <span className="muted" style={{wordBreak:'break-all'}}>{previewFile}</span>
              <button className="btn btn-secondary" onClick={closePreview}>Fechar</button>
            </div>
            <div className="modal-body">
              {renderFilePreview(previewFile)}
            </div>
          </div>
        </div>
      )}

      {/* Modal de edição de HTML */}
      {editorOpen && (
        <div className="modal-backdrop" onClick={closeEditor}>
          <div className="modal modal-editor" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong>Editar HTML:</strong>&nbsp;
              <span className="muted" style={{wordBreak:'break-all'}}>{editorFile}</span>
              <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                <button className="btn btn-secondary" onClick={reloadHtmlFromDisk} title="Recarregar do disco">Recarregar</button>
                <button className="btn" onClick={saveHtmlToDisk} disabled={editorSaving}>
                  {editorSaving ? 'Salvando…' : 'Salvar'}
                </button>
                <button className="btn btn-secondary" onClick={closeEditor}>Fechar</button>
              </div>
            </div>
            <div className="editor-grid">
              <div className="editor-pane">
                <textarea
                  className="code-textarea"
                  value={editorHtml}
                  onChange={e => setEditorHtml(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="preview-pane">
                <iframe
                  title="preview-editor"
                  className="editor-iframe"
                  srcDoc={sanitizeUserHtmlClient(editorHtml)}
                />
              </div>
            </div>
            <div className="muted" style={{padding:'8px 12px'}}>
              Por segurança, no preview removemos <code>&lt;script&gt;</code> e atributos <code>on*</code>.
              Ao salvar, o servidor também aplica uma sanitização básica.
            </div>
          </div>
        </div>
      )}

      <AdminStyles/>
    </div>
  );
}

function DefaultsForm({ defaults, setDefaults }) {
  const d = defaults || {};
  const sch = d.schedule || {};

  return (
    <div className="form">
      <LabeledRow label="Duração padrão de imagem (ms)">
        <input
          type="number"
          className="input"
          value={d.imageDurationMs ?? 10000}
          onChange={e => setDefaults({ ...d, imageDurationMs: Number(e.target.value) })}
        />
      </LabeledRow>

      <LabeledRow label="Duração padrão de HTML (ms)">
        <input
          type="number"
          className="input"
          value={d.htmlDurationMs ?? 15000}
          onChange={e => setDefaults({ ...d, htmlDurationMs: Number(e.target.value) })}
        />
      </LabeledRow>

      <LabeledRow label="Fit mode padrão">
        <select
          className="input"
          value={d.fitMode || 'fit'}
          onChange={e => setDefaults({ ...d, fitMode: e.target.value })}
        >
          {fitModes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </LabeledRow>

      <LabeledRow label="Cor de fundo">
        <input
          className="input"
          value={d.bgColor || '#000000'}
          onChange={e => setDefaults({ ...d, bgColor: e.target.value })}
        />
      </LabeledRow>

      <LabeledRow label="Mute padrão">
        <input
          type="checkbox"
          className="checkbox"
          checked={!!d.mute}
          onChange={e => setDefaults({ ...d, mute: e.target.checked })}
        />
      </LabeledRow>

      <LabeledRow label="Volume padrão (0..1)">
        <input
          type="number" step="0.1" min="0" max="1"
          className="input"
          value={d.volume ?? 1}
          onChange={e => setDefaults({ ...d, volume: Number(e.target.value) })}
        />
      </LabeledRow>

      <fieldset className="fieldset">
        <legend>Janela de exibição (schedule)</legend>
        <div className="chips">
          {weekDays.map(day => (
            <label key={day} className="chip">
              <input
                type="checkbox"
                checked={(sch.days || weekDays).includes(day)}
                onChange={e => {
                  const set = new Set(sch.days || weekDays);
                  if (e.target.checked) set.add(day); else set.delete(day);
                  setDefaults({ ...d, schedule: { ...sch, days: [...set] } });
                }}
              />
              <span>{day}</span>
            </label>
          ))}
        </div>
        <LabeledRow label="Início (HH:mm)">
          <input
            className="input"
            value={sch.start || '00:00'}
            onChange={e => setDefaults({ ...d, schedule: { ...sch, start: e.target.value } })}
          />
        </LabeledRow>
        <LabeledRow label="Fim (HH:mm)">
          <input
            className="input"
            value={sch.end || '23:59'}
            onChange={e => setDefaults({ ...d, schedule: { ...sch, end: e.target.value } })}
          />
        </LabeledRow>
        <LabeledRow label="Timezone">
          <input
            className="input"
            value={sch.tz || 'America/Sao_Paulo'}
            onChange={e => setDefaults({ ...d, schedule: { ...sch, tz: e.target.value } })}
          />
        </LabeledRow>
      </fieldset>
    </div>
  );
}

function OverrideForm({ value, setValue }) {
  if (!value) return null;
  const v = { ...value };

  return (
    <div className="form">
      <LabeledRow label="Arquivo (src)">
        <input className="input" value={v.src || ''} readOnly />
      </LabeledRow>

      <LabeledRow label="Tipo (auto se vazio)">
        <select
          className="input"
          value={v.type || ''}
          onChange={e => setValue({ ...v, type: e.target.value || undefined })}
        >
          <option value="">(auto)</option>
          <option value="image">image</option>
          <option value="video">video</option>
          <option value="html">html</option>
        </select>
      </LabeledRow>

      <LabeledRow label="Fit mode">
        <select
          className="input"
          value={v.fitMode || ''}
          onChange={e => setValue({ ...v, fitMode: e.target.value || undefined })}
        >
          <option value="">(padrão)</option>
          {fitModes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </LabeledRow>

      <LabeledRow label="Duração de imagem (ms)">
        <input
          type="number"
          className="input"
          value={v.imageDurationMs ?? ''}
          placeholder="(padrão)"
          onChange={e =>
            setValue({ ...v, imageDurationMs: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </LabeledRow>

      <LabeledRow label="Duração de HTML (ms)">
        <input
          type="number"
          className="input"
          value={v.htmlDurationMs ?? ''}
          placeholder="(padrão)"
          onChange={e =>
            setValue({ ...v, htmlDurationMs: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </LabeledRow>

      <LabeledRow label="Mute">
        <select
          className="input"
          value={typeof v.mute === 'boolean' ? String(v.mute) : '' }
          onChange={e =>
            setValue({ ...v, mute: e.target.value === '' ? undefined : e.target.value === 'true' })
          }
        >
          <option value="">(padrão)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </LabeledRow>

      <LabeledRow label="Volume (0..1)">
        <input
          type="number" step="0.1" min="0" max="1"
          className="input"
          value={v.volume ?? ''}
          onChange={e =>
            setValue({ ...v, volume: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </LabeledRow>

      <fieldset className="fieldset">
        <legend>Schedule</legend>
        <div className="chips">
          {weekDays.map(day => {
            const set = new Set(v.schedule?.days || []);
            const checked = set.has(day);
            return (
              <label key={day} className="chip">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => {
                    const next = new Set(v.schedule?.days || []);
                    if (e.target.checked) next.add(day); else next.delete(day);
                    setValue({ ...v, schedule: { ...(v.schedule || {}), days: Array.from(next) } });
                  }}
                />
                <span>{day}</span>
              </label>
            );
          })}
        </div>
        <LabeledRow label="Início (HH:mm)">
          <input
            className="input"
            value={v.schedule?.start || ''}
            onChange={e => setValue({
              ...v,
              schedule: { ...(v.schedule || {}), start: e.target.value || undefined }
            })}
          />
        </LabeledRow>
        <LabeledRow label="Fim (HH:mm)">
          <input
            className="input"
            value={v.schedule?.end || ''}
            onChange={e => setValue({
              ...v,
              schedule: { ...(v.schedule || {}), end: e.target.value || undefined }
            })}
          />
        </LabeledRow>
        <LabeledRow label="Timezone">
          <input
            className="input"
            value={v.schedule?.tz || ''}
            onChange={e => setValue({
              ...v,
              schedule: { ...(v.schedule || {}), tz: e.target.value || undefined }
            })}
          />
        </LabeledRow>
      </fieldset>
    </div>
  );
}

function LabeledRow({ label, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-control">{children}</div>
    </div>
  );
}

/** CSS Responsivo embutido (escopo /admin) */
function AdminStyles() {
  return (
    <style>{`
      :root{
        --bg-admin:#f6f7f9;
        --text:#0f172a;
        --muted:#475569;
        --border:#e5e7eb;
        --primary:#111827;
        --primary-contrast:#ffffff;
        --secondary:#e5e7eb;
        --danger:#dc2626;
        --radius:12px;
        --shadow:0 6px 20px rgba(0,0,0,.06);
      }

      .admin-page{
        min-height:100vh;
        background:var(--bg-admin);
        color:var(--text);
        padding:24px;
      }
      @media (max-width:640px){
        .admin-page{ padding:12px; }
      }

      .admin-header{
        position:sticky;
        top:0;
        z-index:10;
        background:rgba(246,247,249,.7);
        backdrop-filter: saturate(1.2) blur(8px);
        border-bottom:1px solid var(--border);
        display:flex;
        justify-content:space-between;
        align-items:center;
        padding:12px 8px 12px 4px;
        margin:-12px -12px 16px -12px;
      }
      @media (min-width:641px){
        .admin-header{ margin:-24px -24px 24px -24px; padding:14px 16px; }
      }
      .admin-title{ margin:0; font-size:20px; font-weight:700; }
      .left{ display:flex; flex-direction:column; gap:4px; }
      .breadcrumb{ font-size:12px; }

      .header-actions{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .user-chip{ opacity:.8; font-size:14px; }

      /* dropdown */
      .menu-wrapper{ position:relative; }
      .menu-trigger{ position:relative; }
      .menu{
        position:absolute; right:0; top:calc(100% + 6px);
        background:#fff; border:1px solid var(--border); border-radius:12px;
        box-shadow:var(--shadow); padding:6px; min-width:220px; z-index:20;
      }
      .menu-item{
        display:block; width:100%; text-align:left;
        background:transparent; border:none; border-radius:10px;
        padding:10px 12px; cursor:pointer;
      }
      .menu-item:hover{ background:#f3f4f6; }
      .menu-item.is-active{ font-weight:700; }

      .content-area{
        margin: 0 auto;
        max-width: 1400px;
        display: grid;
        gap: 16px;
      }

      .card{
        background:#fff;
        border-radius:var(--radius);
        box-shadow:var(--shadow);
        padding:16px;
      }
      .login-card{
        max-width:520px;
        margin:10vh auto 0 auto;
      }
      .card-title{ margin:0 0 12px 0; font-weight:700; font-size:18px; }
      .sub-title{ margin:8px 0 12px; font-size:16px; font-weight:700; }

      /* grids por view */
      .view-grid{
        display:grid;
        gap:16px;
        grid-template-columns: 1fr;
      }
      /* Aviso: preview abaixo, largura total; coluna única */
      .notice-grid{ grid-template-columns: 1fr; }

      /* Media: arquivos + override lado a lado em telas grandes */
      @media (min-width: 1024px){
        .media-grid{ grid-template-columns: 1fr 1.2fr; }
      }
      /* Users: lista + novo usuário lado a lado */
      @media (min-width: 1024px){
        .users-grid{ grid-template-columns: 1.2fr 1fr; }
      }

      .subcard{ padding:0; }
      .subcard > .sub-title{ padding:16px 16px 0 16px; }
      .subcard > .form,
      .subcard > .user-list{ padding:0 16px 16px 16px; }

      .form{ display:block; }
      .field{ display:flex; gap:10px; align-items:center; margin:10px 0; }
      .field-label{ min-width:190px; font-size:14px; color:var(--muted); }
      .field-control{ flex:1; }

      @media (max-width:640px){
        .field{ flex-direction:column; align-items:stretch; }
        .field-label{ min-width:0; }
      }

      .input{
        width:100%;
        padding:12px 12px;
        border:1px solid var(--border);
        border-radius:10px;
        background:#fff;
        font-size:16px;
        min-height:44px;
      }
      .checkbox{
        width:20px; height:20px;
      }

      .btn{
        background:var(--primary);
        color:var(--primary-contrast);
        border:none;
        border-radius:10px;
        padding:10px 14px;
        min-height:44px;
        cursor:pointer;
        font-weight:600;
      }
      .btn:disabled{ opacity:.6; cursor:not-allowed; }
      .btn-secondary{
        background:var(--secondary);
        color:var(--text);
      }
      .btn-danger{
        background:var(--danger);
        color:#fff;
      }
      .actions-row{
        display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;
      }

      .file-input{
        display:inline-flex;
        align-items:center; gap:8px;
        padding:10px 12px;
        border:1px dashed var(--border);
        border-radius:10px;
        color:var(--muted);
        cursor:pointer;
        user-select:none;
        margin:16px;
      }
      .file-input input{ display:none; }

      .file-list{ list-style:none; padding:0 16px 16px 16px; margin:0; max-height:60vh; overflow:auto; }
      .file-item{
        display:flex; align-items:center; gap:8px;
        border-bottom:1px solid var(--border);
        padding:8px 0;
      }
      .file-item:hover{ background:#fafafa; }
      .link-btn{
        background:transparent;
        border:none;
        padding:6px 0;
        cursor:pointer;
        color:var(--text);
        text-align:left;
        flex:1;
        font-weight:500;
      }
      .link-btn.is-active{ font-weight:700; }

      .muted{ color:var(--muted); }

      .user-list{ list-style:none; padding:0; margin:0; max-height:60vh; overflow:auto; }
      .user-item{
        display:flex; align-items:center; gap:8px;
        padding:8px 0; border-bottom:1px solid var(--border);
      }
      .user-id{ display:flex; align-items:center; gap:8px; }
      .tag{
        background:#eef2ff; color:#3730a3;
        font-size:12px; padding:2px 6px; border-radius:999px;
      }
      .user-actions{ margin-left:auto; display:flex; gap:6px; }

      .chips{ display:flex; flex-wrap:wrap; gap:8px; margin:6px 0 8px; }
      .chip{
        display:inline-flex; align-items:center; gap:6px;
        padding:6px 10px; border:1px solid var(--border); border-radius:999px;
        user-select:none; cursor:pointer;
      }
      .chip input{ width:16px; height:16px; }

      .error{ color:#dc2626; margin-top:8px; }

      .footnote{ opacity:.7; font-size:12px; margin-top:24px; }

      /* preview notice */
      .preview-card{
        border:1px solid var(--border);
        border-radius:12px;
        overflow:hidden;
        background:#fafafa;
      }
      .preview-header{
        display:flex; align-items:center; gap:8px;
        padding:10px 12px;
        border-bottom:1px solid var(--border);
        background:#fff;
      }

      /* Caixa com proporção 16:9 */
      .ratio-16x9{ position:relative; width:100%; }
      .ratio-16x9::before{ content:''; display:block; padding-top:56.25%; } /* 9/16 */
      .preview-iframe{
        position:absolute; inset:0;
        width:100%; height:100%;
        border:0; display:block; background:#000;
      }

      /* ===== Modal base ===== */
      .modal-backdrop{
        position:fixed; inset:0; background:rgba(0,0,0,.55);
        display:flex; align-items:center; justify-content:center;
        z-index:1000; padding:20px;
      }
      .modal{
        background:#fff; color:var(--text);
        border-radius:14px; box-shadow:var(--shadow);
        width:min(92vw, 1280px);
        max-height:90vh;
        display:flex; flex-direction:column;
      }
      .modal-header{
        display:flex; align-items:center; gap:8px;
        padding:12px 14px; border-bottom:1px solid var(--border);
      }
      .modal-header .btn{ min-height:36px; padding:8px 12px; }
      .modal-body{
        padding:12px; overflow:auto;
        display:flex; justify-content:center; align-items:center;
      }

      /* ===== Editor modal ===== */
      .modal-editor{ width:min(96vw, 1400px); }
      .editor-grid{
        display:grid; gap:0; height:70vh;
        grid-template-columns: 1fr;
      }
      @media (min-width: 1024px){
        .editor-grid{ grid-template-columns: 1fr 1fr; }
      }
      .editor-pane, .preview-pane{
        min-height:0; /* permite grid children ocupar altura total */
        display:flex; flex-direction:column;
      }
      .code-textarea{
        flex:1;
        width:100%;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size:14px;
        line-height:1.4;
        padding:12px;
        border:none;
        outline:none;
        resize:none;
        border-right:1px solid var(--border);
      }
      .preview-pane{
        background:#000;
      }
      .editor-iframe{
        flex:1; width:100%; border:0;
      }
    `}</style>
  );
}
