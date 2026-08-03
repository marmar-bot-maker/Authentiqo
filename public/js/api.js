// Small fetch wrapper + session helpers shared by every page.
// Tokens are kept in localStorage per role, so a repairman and a seller
// account can both be signed in on the same browser at once.

const Auth = {
  setToken(role, token, extra) {
    localStorage.setItem(`authentiqo_${role}_token`, token);
    if (extra) localStorage.setItem(`authentiqo_${role}_meta`, JSON.stringify(extra));
  },
  getToken(role) {
    return localStorage.getItem(`authentiqo_${role}_token`);
  },
  getMeta(role) {
    try { return JSON.parse(localStorage.getItem(`authentiqo_${role}_meta`) || 'null'); }
    catch { return null; }
  },
  logout(role) {
    localStorage.removeItem(`authentiqo_${role}_token`);
    localStorage.removeItem(`authentiqo_${role}_meta`);
  },
};

async function apiRequest(path, { method = 'GET', body, role } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (role) {
    const token = Auth.getToken(role);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return data;
}

function showAlert(el, message, type = 'error') {
  el.textContent = message;
  el.className = `alert alert-${type} show`;
}

function hideAlert(el) {
  el.classList.remove('show');
}

function requireAuthOrRedirect(role, loginPage) {
  if (!Auth.getToken(role)) {
    window.location.href = loginPage;
    return false;
  }
  return true;
}
