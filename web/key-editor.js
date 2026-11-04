// Background removal settings of one pose or layer ("key" in item.json) with the cleaned result
// on a checkerboard. value: true or { flood, pockets, fringe } (false is handled by the caller);
// onChange(next) gets true when the defaults are chosen, so item.json stays as it was.
// preview(key) resolves to the URL of the cleaned image, or null when there is nothing to show;
// the returned element's refresh() asks again (e.g. when it is shown).
import { h } from './ui.js';

export const KEY_DEFAULTS = { flood: 42, pockets: true, fringe: 0 }; // same as core/lib/key.mjs

export function keyEditor({ value, onChange, preview }) {
  let custom = typeof value === 'object' && value !== null;
  const vals = { ...KEY_DEFAULTS, ...(custom ? value : {}) };
  const current = () => {
    if (!custom) return true;
    const o = {};
    for (const k of Object.keys(KEY_DEFAULTS)) if (vals[k] !== KEY_DEFAULTS[k]) o[k] = vals[k];
    return Object.keys(o).length ? o : true;
  };

  const number = (k, label, hint) => {
    const el = h('input', { type: 'number', min: 0, max: 255, step: 1, value: vals[k], 'aria-label': label });
    el.addEventListener('input', () => {
      const v = Number(el.value);
      if (el.value === '' || !Number.isInteger(v) || v < 0 || v > 255) { el.setCustomValidity('0–255 arası tam sayı'); el.reportValidity(); return; }
      el.setCustomValidity('');
      vals[k] = v;
      changed();
    });
    return h('label.inline', h('span', label), el, h('small.muted', hint));
  };
  const pockets = h('input', { type: 'checkbox', checked: vals.pockets });
  pockets.addEventListener('change', () => { vals.pockets = pockets.checked; changed(); });
  const fields = h('div.key-fields',
    number('flood', 'Dolgu eşiği', `kenardan başlayan dolgu zemine bu kadar yakın renkleri siler (varsayılan ${KEY_DEFAULTS.flood})`),
    h('label.inline', pockets, h('span', 'Kapalı cepleri temizle'), h('small.muted', 'figürün içindeki zemin renkli bölgeler (bacak arası gibi)')),
    number('fringe', 'Kenar halesi', 'zemine değen ve zemine bu kadar yakın kenar pikselleri silinir, en fazla 3 piksel; 0 kapalı'));
  const toggle = h('input', { type: 'checkbox', checked: custom });
  toggle.addEventListener('change', () => { custom = toggle.checked; fields.hidden = !custom; changed(); });
  fields.hidden = !custom;

  const shown = h('div.key-preview.checker', h('span.muted', 'önizleme yok'));
  let timer, asked = 0;
  async function refresh() {
    if (!preview) { shown.hidden = true; return; }
    const n = ++asked;
    shown.classList.add('busy');
    let url = null, error = null;
    try { url = await preview(current()); } catch (e) { error = e.message; }
    if (n !== asked) return; // a newer setting was asked for meanwhile
    shown.classList.remove('busy');
    shown.replaceChildren(url ? h('img', { src: url, alt: 'arka planı temizlenmiş görsel' }) : h('span.muted', error ? `önizlenemedi: ${error}` : 'önizleme yok'));
  }
  function changed() {
    onChange(current());
    clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  }
  refresh();

  const el = h('div.key-editor',
    h('label.inline', toggle, h('span', 'Özel temizlik ayarı'),
      h('small.muted', 'açık renkli figür zemine yakınsa (gri zeminde gümüş saç gibi): düşük dolgu eşiği, kapalı cepler kapalı, kenar halesi açık')),
    fields, shown);
  el.refresh = refresh;
  return el;
}
