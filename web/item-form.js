// Fields of item.json shared by the new item page and the item settings: names, facing, the
// prompt texts, the pixel settings and the target canvas. Edits go straight into `item` and call
// onChange.
import { h } from './ui.js';

function text(item, key, { label, hint, rows, placeholder, onChange }) {
  const el = rows ? h('textarea', { rows, placeholder }, item[key] ?? '') : h('input', { type: 'text', value: item[key] ?? '', placeholder });
  el.addEventListener('input', () => { item[key] = el.value; onChange(); });
  return h('label.field', h('span', label), el, hint ? h('small.muted', hint) : null);
}

function number(item, key, { label, min, max, step = 1, def, onChange }) {
  const el = h('input', { type: 'number', min, max, step, value: item[key] ?? def });
  el.addEventListener('input', () => { if (el.value === '') delete item[key]; else item[key] = Number(el.value); onChange(); });
  return h('label.field', h('span', label), el);
}

export function nameFields(item, onChange) {
  item.name ??= {};
  const lang = (code, label) => {
    const el = h('input', { type: 'text', value: item.name[code] ?? '', lang: code });
    el.addEventListener('input', () => { item.name[code] = el.value; onChange(); });
    return h('label.field', h('span', label), el);
  };
  const facing = h('div.radio', ['left', 'right'].map((f) => {
    const r = h('input', { type: 'radio', name: 'facing', value: f, checked: (item.facing ?? 'left') === f });
    r.addEventListener('change', () => { item.facing = f; onChange(); });
    return h('label.inline', r, f === 'left' ? 'Sola' : 'Sağa');
  }));
  return [lang('en', 'Ad (İngilizce)'), lang('tr', 'Ad (Türkçe)'), h('div.field', h('span', 'Bakış yönü'), facing)];
}

export function promptFields(item, onChange) {
  const details = h('textarea', { rows: 3, placeholder: 'Her satıra bir detay, ör. the smoke wisps on the back and tail' }, (item.persistentDetails ?? []).join('\n'));
  details.addEventListener('input', () => { item.persistentDetails = details.value.split('\n').map((s) => s.trim()).filter(Boolean); onChange(); });
  return [
    text(item, 'subject', { label: 'Öğe tarifi (subject, İngilizce)', placeholder: 'a slate-grey shadow wolf with a shaggy dark mane and amber eyes', onChange,
      hint: 'Her video promptuna girer. Kısa ve görünüşe dair: tür, renk, belirgin özellikler.' }),
    h('label.field', h('span', 'Kalıcı detaylar (İngilizce)'), details,
      h('small.muted', 'Videonun sonuna kadar kaybolmaması gereken detaylar. Promptta "These details stay in every frame…" cümlesine girer.')),
    text(item, 'style', { label: 'Stil cümlesi (İngilizce)', rows: 2, onChange, hint: 'Öğenin bütün promptlarında aynen kullanılır.' }),
  ];
}

export function pixelFields(item, onChange) {
  return h('div.grid3',
    number(item, 'pixelWidth', { label: 'Piksel genişliği', min: 16, max: 1024, def: 170, onChange }),
    number(item, 'ptPerPixel', { label: 'pt / sanat pikseli', min: 1, max: 4, def: 1, onChange }),
    number(item, 'colors', { label: 'Renk sayısı', min: 2, max: 256, def: 24, onChange }));
}

// Target canvas in art pixels: full layers are fitted to its width, anything larger is reported.
export function canvasFields(item, onChange) {
  const field = (key, label) => {
    const el = h('input', { type: 'number', min: 1, max: 4096, step: 1, value: item.canvas?.[key] ?? '', placeholder: '—' });
    el.addEventListener('input', () => {
      const c = { ...item.canvas };
      if (el.value === '') delete c[key]; else c[key] = Number(el.value);
      if (Object.keys(c).length) item.canvas = c; else delete item.canvas;
      onChange();
    });
    return h('label.field', h('span', label), el);
  };
  return h('div.stack',
    h('div.grid3', field('width', 'Tuval genişliği (sanat pikseli)'), field('height', 'Tuval yüksekliği (sanat pikseli)')),
    h('small.muted', 'İsteğe bağlı. Opak katmanlar tuval genişliğine indirilir; figür ya da katman tuvali aşarsa raporda uyarı çıkar, kırpma yapılmaz. İkisi birlikte verilmeli.'));
}
