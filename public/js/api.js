// ── API CLIENT ────────────────────────────────────────────────────────────────
const API = {
  _token: localStorage.getItem('vibmon_token'),

  setToken(t) { this._token = t; if(t) localStorage.setItem('vibmon_token', t); else localStorage.removeItem('vibmon_token'); },

  async req(method, path, body, isFormData = false) {
    const opts = {
      method,
      headers: { ...(this._token ? { Authorization: 'Bearer ' + this._token } : {}) }
    };
    if (body && !isFormData) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (body && isFormData) { opts.body = body; }
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) {
      // Token expired - refresh the page to re-login instead of silent logout
      const stored = localStorage.getItem('vibmon_token');
      if(stored) {
        // Clear token and show message
        localStorage.removeItem('vibmon_token');
        alert('Tu sesión ha expirado. Por favor inicia sesión de nuevo.\nLos datos ya guardados se conservan.');
        location.reload();
        return;
      }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    return data;
  },

  get: (p) => API.req('GET', p),
  post: (p, b) => API.req('POST', p, b),
  put: (p, b) => API.req('PUT', p, b),
  del: (p) => API.req('DELETE', p),
  postForm: (p, fd) => API.req('POST', p, fd, true),
};
