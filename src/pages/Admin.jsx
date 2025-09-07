import React, { useEffect, useMemo, useState } from 'react';
import { apiJSON, apiUpload } from '../utils/api';

// form helpers
const emptyDefaults = {
  imageDurationMs: 10000,
  fitMode: 'fit',
  bgColor: '#000000',
  mute: true,
  volume: 1.0,
  schedule: { days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '23:59', tz: 'America/Sao_Paulo' }
};

const fitModes = ['fit', 'crop', 'fill', 'zoom'];
const weekDays = ['mon','tue','wed','thu','fri','sat','sun'];

export default function Admin() {
  const [auth, setAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [files, setFiles] = useState([]);
  const [defaults, setDefaults] = useState(emptyDefaults);
  const [overrides, setOverrides] = useState([]);
  const [selected, setSelected] = useState(null); // filename selecionado

  const selectedOverride = useMemo(
    () => overrides.find(o => o.src === selected) || { src: selected },
    [overrides, selected]
  );

  async function refresh() {
    setLoading(true);
    setErr('');
    try {
      const st = await apiJSON('/api/admin/state');
      setAuth(true);
      setFiles(st.files || []);
      setDefaults({ ...emptyDefaults, ...(st.defaults || {}) });
      setOverrides(st.overrides || []);
    } catch (e) {
      // não autenticado
      setAuth(false);
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function onLogin(e) {
    e.preventDefault();
    setErr('');
    const data = new FormData(e.currentTarget);
    const username = data.get('username');
    const password = data.get('password');
    try {
      await apiJSON('/api/login', 'POST', { username, password });
      await refresh();
    } catch (e) {
      setErr('Falha no login');
    }
  }

  async function onLogout() {
    await apiJSON('/api/logout', 'POST', {});
    setAuth(false);
  }

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

  // --------- UI ---------
  if (loading) {
    return <div style={styles.page}><div style={styles.card}>Carregando…</div></div>;
  }

  if (!auth) {
    return (
      <div style={styles.page}>
        <form onSubmit={onLogin} style={styles.card}>
          <h2 style={{marginTop:0}}>Login</h2>
          <div style={styles.field}>
            <label>Usuário</label>
            <input name="username" defaultValue="admin" required />
          </div>
          <div style={styles.field}>
            <label>Senha</label>
            <input name="password" type="password" defaultValue="1234" required />
          </div>
          <button type="submit" style={styles.btn}>Entrar</button>
          {err && <div style={{color:'crimson', marginTop:8}}>{String(err)}</div>}
        </form>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h2 style={{margin:0}}>Admin do Mural</h2>
        <div>
          <button onClick={refresh} style={styles.btnSecondary}>Atualizar</button>{' '}
          <button onClick={onLogout} style={styles.btn}>Sair</button>
        </div>
      </div>

      <div style={styles.grid}>
        {/* Coluna 1: Arquivos / Upload */}
        <div style={styles.col}>
          <div style={styles.card}>
            <h3>Arquivos</h3>
            <input type="file" onChange={onUpload} />
            <ul style={{listStyle:'none', padding:0, marginTop:12, maxHeight:300, overflow:'auto'}}>
              {files.map(f => (
                <li key={f}
                    style={{
                      display:'flex', alignItems:'center',
                      padding:'6px 0', borderBottom:'1px solid #eee'
                    }}>
                  <button onClick={() => setSelected(f)}
                          style={{...styles.linkBtn, fontWeight: selected===f ? '700':'500'}}>
                    {f}
                  </button>
                  <div style={{marginLeft:'auto'}}>
                    <button onClick={() => onDeleteFile(f)} style={styles.dangerBtn}>Excluir</button>
                  </div>
                </li>
              ))}
              {files.length === 0 && <li>Nenhum arquivo</li>}
            </ul>
          </div>

          <div style={styles.card}>
            <h3>Defaults</h3>
            <DefaultsForm defaults={defaults} setDefaults={setDefaults} />
            <button onClick={saveDefaults} style={styles.btn}>Salvar defaults</button>
          </div>
        </div>

        {/* Coluna 2: Override por arquivo */}
        <div style={styles.col}>
          <div style={styles.card}>
            <h3>Override por arquivo</h3>
            {!selected && <div>Selecione um arquivo na lista ao lado.</div>}
            {selected && (
              <OverrideForm
                value={selectedOverride}
                setValue={(v) => {
                  // v tem src incluso; garantimos o src selecionado
                  const withSrc = { ...v, src: selected };
                  // atualiza localmente sem gravar ainda
                  const others = overrides.filter(o => o.src !== selected);
                  setOverrides([...others, withSrc]);
                }}
              />
            )}
            <div style={{marginTop:12}}>
              <button onClick={saveOverride} style={styles.btn} disabled={!selected}>Salvar override</button>{' '}
              <button onClick={removeOverride} style={styles.btnSecondary} disabled={!selected}>Remover override</button>
            </div>
          </div>
        </div>
      </div>

      <p style={{opacity:.7, fontSize:12, marginTop:24}}>
        Dica: o player recarrega o manifest automaticamente a cada 60s. Se quiser ver já, recarregue a página do mural.
      </p>
    </div>
  );
}

// ---- Subcomponentes ----
function DefaultsForm({ defaults, setDefaults }) {
  const d = defaults || {};
  const sch = d.schedule || {};

  return (
    <div>
      <LabeledRow label="Duração padrão de imagem (ms)">
        <input type="number" value={d.imageDurationMs ?? 10000}
               onChange={e => setDefaults({...d, imageDurationMs: Number(e.target.value)})}/>
      </LabeledRow>

      <LabeledRow label="Fit mode padrão">
        <select value={d.fitMode || 'fit'}
                onChange={e => setDefaults({...d, fitMode: e.target.value})}>
          {fitModes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </LabeledRow>

      <LabeledRow label="Cor de fundo">
        <input value={d.bgColor || '#000000'}
               onChange={e => setDefaults({...d, bgColor: e.target.value})}/>
      </LabeledRow>

      <LabeledRow label="Mute padrão">
        <input type="checkbox" checked={!!d.mute}
               onChange={e => setDefaults({...d, mute: e.target.checked})}/>
      </LabeledRow>

      <LabeledRow label="Volume padrão (0..1)">
        <input type="number" step="0.1" min="0" max="1"
               value={d.volume ?? 1}
               onChange={e => setDefaults({...d, volume: Number(e.target.value)})}/>
      </LabeledRow>

      <fieldset style={{border:'1px solid #eee', padding:10, marginTop:10}}>
        <legend>Janela de exibição (schedule)</legend>
        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:8}}>
          {weekDays.map(day => (
            <label key={day} style={{display:'inline-flex', gap:4, alignItems:'center'}}>
              <input type="checkbox"
                     checked={(sch.days||weekDays).includes(day)}
                     onChange={e => {
                       const set = new Set(sch.days||weekDays);
                       if (e.target.checked) set.add(day); else set.delete(day);
                       setDefaults({...d, schedule:{...sch, days:[...set]}});
                     }}/>
              {day}
            </label>
          ))}
        </div>
        <LabeledRow label="Início (HH:mm)">
          <input value={sch.start || '00:00'}
                 onChange={e => setDefaults({...d, schedule:{...sch, start:e.target.value}})} />
        </LabeledRow>
        <LabeledRow label="Fim (HH:mm)">
          <input value={sch.end || '23:59'}
                 onChange={e => setDefaults({...d, schedule:{...sch, end:e.target.value}})} />
        </LabeledRow>
        <LabeledRow label="Timezone">
          <input value={sch.tz || 'America/Sao_Paulo'}
                 onChange={e => setDefaults({...d, schedule:{...sch, tz:e.target.value}})} />
        </LabeledRow>
      </fieldset>
    </div>
  );
}

function OverrideForm({ value, setValue }) {
  if (!value) return null;
  const v = { ...value };

  return (
    <div>
      <LabeledRow label="Arquivo (src)">
        <input value={v.src || ''} readOnly />
      </LabeledRow>

      <LabeledRow label="Tipo (auto se vazio)">
        <select value={v.type || ''} onChange={e => setValue({ ...v, type: e.target.value || undefined })}>
          <option value="">(auto)</option>
          <option value="image">image</option>
          <option value="video">video</option>
        </select>
      </LabeledRow>

      <LabeledRow label="Fit mode">
        <select value={v.fitMode || ''} onChange={e => setValue({ ...v, fitMode: e.target.value || undefined })}>
          <option value="">(padrão)</option>
          {fitModes.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </LabeledRow>

      <LabeledRow label="Duração de imagem (ms)">
        <input type="number" value={v.imageDurationMs ?? ''} placeholder="(padrão)"
               onChange={e => setValue({ ...v, imageDurationMs: e.target.value ? Number(e.target.value) : undefined })}/>
      </LabeledRow>

      <LabeledRow label="Mute">
        <select value={typeof v.mute === 'boolean' ? String(v.mute) : '' }
                onChange={e => setValue({ ...v, mute: e.target.value === '' ? undefined : e.target.value === 'true' })}>
          <option value="">(padrão)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </LabeledRow>

      <LabeledRow label="Volume (0..1)">
        <input type="number" step="0.1" min="0" max="1" value={v.volume ?? ''}
               onChange={e => setValue({ ...v, volume: e.target.value ? Number(e.target.value) : undefined })}/>
      </LabeledRow>

      <fieldset style={{border:'1px solid #eee', padding:10, marginTop:10}}>
        <legend>Schedule</legend>
        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:8}}>
          {weekDays.map(day => {
            const set = new Set(v.schedule?.days || []);
            const checked = set.has(day);
            return (
              <label key={day} style={{display:'inline-flex', gap:4, alignItems:'center'}}>
                <input type="checkbox"
                       checked={checked}
                       onChange={e => {
                         const next = new Set(v.schedule?.days || []);
                         if (e.target.checked) next.add(day); else next.delete(day);
                         setValue({ ...v, schedule: { ...(v.schedule||{}), days: Array.from(next) } });
                       }}/>
                {day}
              </label>
            );
          })}
        </div>
        <LabeledRow label="Início (HH:mm)">
          <input value={v.schedule?.start || ''}
                 onChange={e => setValue({ ...v, schedule: { ...(v.schedule||{}), start: e.target.value || undefined } })}/>
        </LabeledRow>
        <LabeledRow label="Fim (HH:mm)">
          <input value={v.schedule?.end || ''}
                 onChange={e => setValue({ ...v, schedule: { ...(v.schedule||{}), end: e.target.value || undefined } })}/>
        </LabeledRow>
        <LabeledRow label="Timezone">
          <input value={v.schedule?.tz || ''}
                 onChange={e => setValue({ ...v, schedule: { ...(v.schedule||{}), tz: e.target.value || undefined } })}/>
        </LabeledRow>
      </fieldset>
    </div>
  );
}

function LabeledRow({ label, children }) {
  return (
    <div style={styles.field}>
      <label style={{minWidth:190, display:'inline-block'}}>{label}</label>
      <div style={{flex:1}}>{children}</div>
    </div>
  );
}

const styles = {
  page: { minHeight:'100vh', background:'#f6f7f9', padding:'20px' },
  header: { display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 },
  grid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 },
  col: { display:'flex', flexDirection:'column', gap:16 },
  card: { background:'#fff', borderRadius:12, boxShadow:'0 2px 10px rgba(0,0,0,.06)', padding:16 },
  field: { display:'flex', gap:8, alignItems:'center', margin:'8px 0' },
  btn: { padding:'8px 12px', background:'#111827', color:'#fff', border:'none', borderRadius:8, cursor:'pointer' },
  btnSecondary: { padding:'8px 12px', background:'#e5e7eb', color:'#111827', border:'none', borderRadius:8, cursor:'pointer' },
  dangerBtn: { padding:'6px 10px', background:'#dc2626', color:'#fff', border:'none', borderRadius:8, cursor:'pointer' },
  linkBtn: { background:'transparent', border:'none', cursor:'pointer', color:'#111827' }
};
