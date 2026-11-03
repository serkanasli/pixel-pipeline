// Editor for the image layers of a static item. Works on item.layers in place and calls onChange
// after every edit. onImage(layer, file) keeps or uploads a dropped image (the new item page keeps
// it until the item exists); imageUrl(layer) previews the layer's current image, or null.
import { clear, dropZone, extOf, h } from './ui.js';

const NAME = /^[a-z][a-z0-9_]*$/;
export const LAYER_EXTS = ['png', 'jpg', 'webp'];

export function layerEditor(item, { keyDefault, onChange, onImage, imageUrl }) {
  const root = h('div.plan');
  item.layers ??= [];
  const changed = (rerender = false) => { onChange(); if (rerender) draw(); };

  function number(value, { label, min, max, step = 1, onInput }) {
    const el = h('input', { type: 'number', min, max, step, value, 'aria-label': label });
    el.addEventListener('input', () => onInput(el.value === '' ? null : Number(el.value)));
    return el;
  }

  function row(l, i) {
    const list = item.layers;
    const name = h('input', { type: 'text', value: l.name, 'aria-label': 'Katman adı', pattern: '[a-z][a-z0-9_]*', spellcheck: false });
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!NAME.test(v) || list.some((x) => x !== l && x.name === v)) { name.setCustomValidity('snake_case ve benzersiz olmalı'); name.reportValidity(); return; }
      name.setCustomValidity('');
      l.name = v;
      changed();
    });
    const key = h('input', { type: 'checkbox', checked: l.key ?? keyDefault });
    key.addEventListener('change', () => { l.key = key.checked; changed(); });
    const z = number(l.z ?? i, { label: `${l.name} z sırası`, onInput: (v) => { if (v == null) delete l.z; else l.z = Math.round(v); changed(); } });
    const pivotOn = h('input', { type: 'checkbox', checked: !!l.pivot });
    const px = number(l.pivot?.x ?? 0.5, { label: `${l.name} pivot x`, min: 0, max: 1, step: 0.05, onInput: (v) => { if (l.pivot && v != null) { l.pivot.x = v; changed(); } } });
    const py = number(l.pivot?.y ?? 1, { label: `${l.name} pivot y`, min: 0, max: 1, step: 0.05, onInput: (v) => { if (l.pivot && v != null) { l.pivot.y = v; changed(); } } });
    px.disabled = py.disabled = !l.pivot;
    pivotOn.addEventListener('change', () => {
      if (pivotOn.checked) l.pivot = { x: Number(px.value) || 0.5, y: Number(py.value) || 1 }; else delete l.pivot;
      px.disabled = py.disabled = !pivotOn.checked;
      changed();
    });
    const src = imageUrl(l);
    const preview = h('div.layer-preview.checker', src ? h('img', { src, alt: `${l.name} görseli` }) : h('span.muted', 'görsel yok'));
    const drop = dropZone({
      label: src ? 'Görseli değiştir' : 'Görseli buraya bırak', hint: `PNG, JPG ya da WebP · ${l.image}`, accept: 'image/png,image/jpeg,image/webp',
      onFile: async (file) => {
        if (!LAYER_EXTS.includes(extOf(file))) throw new Error('Katman görseli PNG, JPG ya da WebP olmalı');
        await onImage(l, file);
        draw();
      },
    });
    const move = (d) => { const j = i + d; [list[i], list[j]] = [list[j], list[i]]; changed(true); };
    return h('li.pose-row.layer-row',
      h('div.pose-row-head',
        h('span.num', String(i + 1)),
        name,
        h('label.inline', key, h('span', 'arka planı temizle')),
        h('label.inline', h('span', 'z'), z),
        h('label.inline', pivotOn, h('span', 'pivot'), px, py),
        h('span.spacer'),
        h('button.icon', { type: 'button', title: 'Yukarı', 'aria-label': `${l.name} yukarı`, disabled: i === 0, onclick: () => move(-1) }, '↑'),
        h('button.icon', { type: 'button', title: 'Aşağı', 'aria-label': `${l.name} aşağı`, disabled: i === list.length - 1, onclick: () => move(1) }, '↓'),
        h('button.icon.danger', { type: 'button', title: 'Sil', 'aria-label': `${l.name} sil`, disabled: list.length === 1, onclick: () => { list.splice(i, 1); changed(true); } }, '×')),
      h('div.layer-body', drop, preview));
  }

  function draw() {
    clear(root,
      h('p.muted', '"Arka planı temizle" açıksa düz arka plan silinir ve katman saydam sprite olur; kapalıysa görsel olduğu gibi kalır (opak arka plan katmanı). Görsel zaten saydamsa kendi alfası korunur. Pivot 0–1 arası, figürün kutusuna göredir.'),
      h('ol.pose-list', item.layers.map(row)),
      h('button', { type: 'button', onclick: () => {
        let n = 1; while (item.layers.some((l) => l.name === `layer_${n}`)) n++;
        const z = Math.max(-1, ...item.layers.map((l, i) => l.z ?? i)) + 1;
        item.layers.push({ name: `layer_${n}`, image: `layer_${n}.png`, key: keyDefault, z });
        changed(true);
      } }, '+ Katman ekle'));
  }
  draw();
  return root;
}
