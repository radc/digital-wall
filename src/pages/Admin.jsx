// src/pages/Admin.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiJSON, apiUpload } from '../utils/api';

const emptyDefaults = {
  imageDurationMs: 10000,
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

const fitModes = ['fit', 'crop', 'fill', 'zoom'];
const weekDays = ['mon','tue','wed','thu','fri','sat','sun'];

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

  const usersCardRef = useRef(null);

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

  async function saveDefaults() {
    try {
      await apiJSON('/api/admin/defaults', 'POST', defaults);
      alert('Defaults salvos');
      await refresh();
    } catch (e) {
      alert('Falha ao salvar defaults: ' + e.message);
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
      alert('Falha ao remover override: ' + e.message);
    }
  }

  // --------- Minha senha ---------
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
      usersCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h2 className="admin-title">Admin do Mural</h2>
        <div className="header-actions">
          <span className="user-chip">
            {currentUser?.username} ({currentUser?.role})
          </span>
          <button onClick={refresh} className="btn btn-secondary">Atualizar</button>
          {isAdmin && (
            <button
              onClick={() => usersCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="btn btn-secondary"
              title="Ir para gestão de usuários"
            >
              Usuários
            </button>
          )}
          <button onClick={onLogout} className="btn">Sair</button>
        </div>
      </header>

      <div className="admin-grid">
        {/* Coluna 1: Arquivos / Upload + Defaults */}
        <section className="col">
          <div className="card">
            <h3 className="card-title">Arquivos</h3>
            <label className="file-input">
              <input type="file" onChange={onUpload} />
              <span>Selecionar arquivo…</span>
            </label>

            <ul className="file-list">
              {files.map(f => (
                <li key={f} className="file-item">
                  <button
                    onClick={() => setSelected(f)}
                    className={`link-btn ${selected===f ? 'is-active' : ''}`}
                    title="Selecionar para editar override"
                  >
                    {f}
                  </button>
                  <button onClick={() => onDeleteFile(f)} className="btn btn-danger">Excluir</button>
                </li>
              ))}
              {files.length === 0 && <li className="muted">Nenhum arquivo</li>}
            </ul>
          </div>

          <div className="card">
            <h3 className="card-title">Defaults</h3>
            <DefaultsForm defaults={defaults} setDefaults={setDefaults} />
            <div className="actions-row">
              <button onClick={saveDefaults} className="btn">Salvar defaults</button>
            </div>
          </div>
        </section>

        {/* Coluna 2: Override por arquivo + Minha senha */}
        <section className="col">
          <div className="card">
            <h3 className="card-title">Override por arquivo</h3>
            {!selected && <div className="muted">Selecione um arquivo na lista ao lado.</div>}
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

          <div className="card">
            <h3 className="card-title">Minha senha</h3>
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
        </section>

        {/* Coluna 3: Gestão de usuários (apenas admin) */}
        <section className="col">
          <div className="card" ref={usersCardRef}>
            <h3 className="card-title">Usuários</h3>
            {!isAdmin && <div className="muted">Você não tem permissão para gerenciar usuários.</div>}
            {isAdmin && (
              <>
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
              </>
            )}
          </div>
        </section>
      </div>

      <p className="footnote">
        Dica: o player recarrega o manifest automaticamente a cada 60s.
      </p>

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
        margin:-12px -12px 16px -12px; /* compensa o padding quando sticky */
      }
      @media (min-width:641px){
        .admin-header{ margin:-24px -24px 24px -24px; padding:14px 16px; }
      }
      .admin-title{ margin:0; font-size:20px; font-weight:700; }
      .header-actions{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
      .user-chip{ opacity:.8; font-size:14px; }

      .admin-grid{
        display:grid;
        gap:16px;
        grid-template-columns: 1fr;
      }
      @media (min-width:768px){
        .admin-grid{ grid-template-columns: 1fr 1fr; }
      }
      @media (min-width:1200px){
        .admin-grid{ grid-template-columns: 1fr 1fr 1fr; }
      }
      .col{ display:flex; flex-direction:column; gap:16px; }

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

      .sub-title{ margin:16px 0 8px; font-size:16px; font-weight:700; }

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
        align-items:center;
        gap:8px;
        padding:10px 12px;
        border:1px dashed var(--border);
        border-radius:10px;
        color:var(--muted);
        cursor:pointer;
        user-select:none;
      }
      .file-input input{ display:none; }

      .file-list{ list-style:none; padding:0; margin:12px 0 0 0; max-height:40vh; overflow:auto; }
      .file-item{
        display:flex; align-items:center; gap:8px;
        border-bottom:1px solid var(--border);
        padding:8px 0;
      }
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

      .user-list{ list-style:none; padding:0; margin:6px 0 0 0; max-height:40vh; overflow:auto; }
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
    `}</style>
  );
}
