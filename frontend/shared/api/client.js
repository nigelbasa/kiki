const BASE = 'http://localhost:8000';

function request(path, init = {}) {
  return fetch(BASE + path, { credentials: 'include', ...init }).then(async (r) => {
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const err = new Error(`${r.status} ${r.statusText}: ${text}`);
      err.status = r.status;
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

export const fileUrl = (path) => BASE + path;

export const api = { get, post, patch, del, postForm, fileUrl };
