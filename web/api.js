// JSON API client. Failures become ApiError with the server's message, the full error text
// (stack) and the log file it was written to, so the page can show all three.
export class ApiError extends Error {
  constructor(message, { status, detail, log } = {}) {
    super(message);
    this.status = status;
    this.detail = detail ?? null;
    this.log = log ?? null;
  }
}

async function call(method, url, body, headers = {}) {
  let res;
  try {
    res = await fetch(url, { method, body, headers });
  } catch (e) {
    throw new ApiError('Sunucuya ulaşılamıyor. Terminalde "npm start" çalışıyor mu?', { detail: e.message });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`, { status: res.status, detail: data?.detail, log: data?.log });
  return data;
}

const json = (method) => (url, data) => call(method, url, data === undefined ? undefined : JSON.stringify(data), { 'content-type': 'application/json' });

export const api = {
  get: (url) => call('GET', url),
  post: json('POST'),
  put: json('PUT'),
  upload: (url, file) => call('PUT', url, file, { 'content-type': file.type || 'application/octet-stream' }),
};

const enc = encodeURIComponent;
export const itemUrl = (dir) => `/api/items/${enc(dir)}`;
export const poseUrl = (dir, pose) => `${itemUrl(dir)}/poses/${enc(pose)}`;
// Files inside an item folder; `v` busts the browser cache after the file was remade.
export const fileUrl = (dir, rel, v) => `${itemUrl(dir)}/files/${rel.split('/').map(enc).join('/')}${v ? `?v=${enc(v)}` : ''}`;
