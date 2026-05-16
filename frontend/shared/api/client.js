let portal = '';
let unauthorizedHandler = null;

function backendBase() {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const protocol = window.location.protocol || 'http:';
    return `${protocol}//${window.location.hostname}:8000`;
  }
  return 'http://localhost:8000';
}

export function setPortal(nextPortal) {
  portal = String(nextPortal || '').trim().toLowerCase();
}

export function getPortal() {
  return portal;
}

export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
}

function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (portal) {
    headers.set('X-Rwendo-Portal', portal);
  }
  return fetch(backendBase() + path, { credentials: 'include', ...init, headers }).then(async (r) => {
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      let detail = '';
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.detail === 'string') {
          detail = parsed.detail;
        }
      } catch {
        // body wasn't JSON — keep detail empty so callers fall back to status text
      }
      const err = new Error(detail || `${r.status} ${r.statusText}`);
      err.status = r.status;
      err.detail = detail;
      err.body = text;
      if (r.status === 401 && unauthorizedHandler) {
        try {
          unauthorizedHandler(err);
        } catch {
          // ignore handler failures and still surface the original request error
        }
      }
      throw err;
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
  });
}

export const get = (path) => request(path);

export const post = (path, body) =>
  request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const patch = (path, body) =>
  request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const del = (path) =>
  request(path, {
    method: 'DELETE',
  });

export const postForm = (path, formData) =>
  request(path, { method: 'POST', body: formData });

export const fileUrl = (path) => backendBase() + path;

export const api = { get, post, patch, del, postForm, fileUrl, setPortal, getPortal, setUnauthorizedHandler };
