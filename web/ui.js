// Small DOM helpers, shared widgets and every Turkish text that describes a state or a step.

// h('div.card', { onclick }, child, …): element with classes, attributes/handlers and children.
export function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean)); // adds to the tag's classes
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const clear = (el, ...children) => { el.replaceChildren(); for (const c of children.flat()) if (c) el.append(c); return el; };

export const KIND = { locomotion: 'yürüme (takip kamerası)', loop: 'döngü', transition: 'geçiş', reaction: 'tepki', still: 'tek kare' };
export const FACING = { left: 'sola', right: 'sağa' };
export const FIELD = { style: 'stil cümlesi', subject: 'öğe tarifi', persistentDetails: 'kalıcı detaylar', motion: 'hareket tarifi', anchor: 'çapa görseli' };
export const STAGES = [
  ['start-frame', 'Başlangıç karesi'],
  ['prompt', 'Prompt'],
  ['video', 'Video'],
  ['range', 'Aralık'],
  ['done', 'Tamam'],
];
export const PACKAGE = { none: 'paket yok', stale: 'paket eski', ready: 'paket hazır' };

export const poseName = (n) => h('code.pose', n);

export function startsFromText(sf) {
  if (!sf || sf === 'anchor') return 'çapadan';
  const f = sf.frame === 'first' ? 'ilk karesinden' : sf.frame === 'last' ? 'son karesinden' : `${sf.frame}. karesinden`;
  return `${sf.pose} pozunun ${f}`;
}

// The next step of an item as a sentence and the page that does it.
export function nextStep(dir, n) {
  const pose = (p) => `#/item/${encodeURIComponent(dir)}/pose/${p}`;
  const board = `#/item/${encodeURIComponent(dir)}`;
  const pkg = `${board}/package`;
  switch (n?.action) {
    case 'add-anchor': return { text: 'Çapa görselini ekle (öğe ayarları)', href: `${board}?edit=1` };
    case 'make-start-frame': return { text: `${n.pose}: başlangıç karesini hazırla`, href: pose(n.pose) };
    case 'remake-start-frame': return { text: `${n.pose}: başlangıç karesi eskidi, yeniden hazırla`, href: pose(n.pose) };
    case 'fill-fields': return { text: `${n.pose}: prompt için ${n.fields.map((f) => FIELD[f] ?? f).join(', ')} eksik`, href: n.fields.includes('motion') && n.fields.length === 1 ? pose(n.pose) : `${board}?edit=1` };
    case 'add-video': return { text: `${n.pose}: promptla videoyu üret ve buraya bırak`, href: pose(n.pose) };
    case 'choose-range': return { text: `${n.pose}: kullanılacak kare aralığını seç`, href: pose(n.pose) };
    case 'wait': return { text: `${n.pose}: önce ${n.waitsFor ?? 'önceki poz'} tamamlanmalı`, href: n.waitsFor ? pose(n.waitsFor) : board };
    case 'make-package': return { text: 'Tüm pozlar hazır: paketi oluştur', href: pkg };
    case 'remake-package': return { text: 'Paket eski: yeniden oluştur', href: pkg };
    case 'done': return { text: 'Paket hazır ve güncel', href: pkg };
    default: return { text: 'Durum bilinmiyor', href: board };
  }
}

// An error from the API as a card: message, full text on demand, and where it was logged.
export function errorCard(err, title = 'Bir sorun oluştu') {
  return h('div.error', { role: 'alert' },
    h('strong', title),
    h('p', err.message),
    err.detail ? h('details', h('summary', 'Ayrıntı'), h('pre', err.detail)) : null,
    err.log ? h('p.muted', `Öğenin log dosyasına yazıldı: ${err.log}. Alttaki log panelinde de görünür.`) : null);
}

// Drop zone with a file picker fallback. accept: e.g. 'video/*'; onFile(file) may be async.
export function dropZone({ label, hint, accept, onFile }) {
  const input = h('input', { type: 'file', accept, hidden: true });
  const status = h('span.drop-status');
  const zone = h('label.drop', { tabindex: 0 }, h('strong', label), hint ? h('span.muted', hint) : null, status, input);
  const take = async (file) => {
    if (!file) return;
    zone.classList.add('busy');
    status.textContent = `${file.name} yükleniyor…`;
    try { await onFile(file); status.textContent = ''; }
    catch (e) { status.textContent = ''; zone.after(errorCard(e, 'Yükleme başarısız')); }
    finally { zone.classList.remove('busy'); }
  };
  input.addEventListener('change', () => take(input.files[0]));
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); take(e.dataTransfer.files[0]); });
  return zone;
}

export const extOf = (file) => (file.name.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');

let toastTimer;
export function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// A button that disables itself and shows a busy label while its async action runs.
export function actionButton(label, run, { primary = false, busy = 'Çalışıyor…' } = {}) {
  const b = h(`button${primary ? '.primary' : ''}`, { type: 'button' }, label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    const old = b.textContent;
    b.textContent = busy;
    try { await run(); } finally { b.disabled = false; b.textContent = old; }
  });
  return b;
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '');
