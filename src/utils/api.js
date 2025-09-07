// pequenos helpers de chamada à API com JSON e sessão por cookie
export async function apiJSON(url, method = 'GET', body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // importante para enviar cookie de sessão
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let msg = 'erro';
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }
  
  export async function apiUpload(url, file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(url, {
      method: 'POST',
      body: fd,
      credentials: 'include'
    });
    if (!res.ok) {
      let msg = 'erro_upload';
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  }
  