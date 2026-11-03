// New item, on one screen: identity and type, anchor image, plan (a pose template with pose
// edits, or the image layers of a static item), prompt fields and, if there are any already,
// videos or layer images. Nothing is written until "Oluştur".
import { api, itemUrl, poseUrl } from '../api.js';
import { canvasFields, nameFields, pixelFields, promptFields } from '../item-form.js';
import { layerEditor } from '../layer-editor.js';
import { planEditor } from '../plan-editor.js';
import { clear, dropZone, errorCard, extOf, h, toast } from '../ui.js';

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function render(mount) {
  const [templates, types, config] = await Promise.all([api.get('/api/templates'), api.get('/api/types'), api.get('/api/config')]);
  if (!config.workspaceFound) { location.hash = '#/setup'; return; }

  const item = { name: { en: '', tr: '' }, facing: 'left', subject: '', persistentDetails: [], style: '' };
  const state = { dir: '', dirEdited: false, idEdited: false, template: null, anchor: null, videos: new Map(), layerFiles: new Map() };
  const plan = { poses: [], behavior: {} };
  const layered = () => !!templates.find((t) => t.name === state.template)?.layers;
  const typeOf = (name) => types.find((t) => t.name === name);

  // ---------- identity ----------
  const dirInput = h('input', { type: 'text', placeholder: 'shadow-wolf', spellcheck: false, pattern: '[A-Za-z0-9][A-Za-z0-9._-]*' });
  const idInput = h('input', { type: 'text', placeholder: 'pet.shadow-wolf', spellcheck: false });
  const typeSelect = h('select', types.map((t) => h('option', { value: t.name }, `${t.title?.tr ?? t.name} (${t.name})`)));
  const syncIds = () => {
    if (!state.dirEdited) dirInput.value = slug(item.name.en || item.name.tr || '');
    if (!state.idEdited) idInput.value = typeSelect.value && dirInput.value ? `${typeSelect.value}.${slug(dirInput.value)}` : '';
  };
  dirInput.addEventListener('input', () => { state.dirEdited = true; syncIds(); });
  idInput.addEventListener('input', () => { state.idEdited = true; });
  // A type shows its own templates; the first one is picked.
  typeSelect.addEventListener('change', () => { drawTemplates(); const t = templates.find((x) => x.type === typeSelect.value); if (t) pickTemplate(t); syncIds(); });

  // ---------- anchor ----------
  const anchorPreview = h('div.anchor-preview');
  const anchorZone = dropZone({
    label: 'Çapa görselini buraya bırak', hint: 'PNG ya da JPG · düz açık arka plan, yandan görünüm', accept: 'image/png,image/jpeg',
    onFile: (file) => {
      if (!['png', 'jpg'].includes(extOf(file))) throw new Error('Çapa görseli PNG ya da JPG olmalı');
      state.anchor = file;
      clear(anchorPreview, h('img', { src: URL.createObjectURL(file), alt: 'Çapa görseli' }), h('span.muted', file.name));
    },
  });
  const anchorHint = h('p.muted');

  // ---------- plan ----------
  const planBox = h('div');
  const videosBox = h('div.video-drops');
  const drawVideos = () => clear(videosBox, plan.poses.filter((p) => p.kind !== 'still').map((p) => {
    const have = state.videos.get(p.name);
    return h('div.video-drop', h('code', p.name), dropZone({
      label: have ? have.name : 'video bırak', accept: 'video/*',
      onFile: (file) => { state.videos.set(p.name, file); drawVideos(); },
    }), have ? h('button.icon', { type: 'button', 'aria-label': `${p.name} videosunu çıkar`, onclick: () => { state.videos.delete(p.name); drawVideos(); } }, '×') : null);
  }));
  const pickTemplate = (t) => {
    state.template = t.name;
    typeSelect.value = t.type;
    if (!item.style && t.poses) { item.style = t.item?.style ?? ''; drawPrompt(); }
    Object.assign(item, { pixelWidth: t.item?.pixelWidth, ptPerPixel: t.item?.ptPerPixel, colors: t.item?.colors, canvas: structuredClone(t.item?.canvas) });
    drawPixels();
    syncIds();
    for (const card of templateCards.children) card.classList.toggle('selected', card.dataset.name === t.name);
    if (t.layers) {
      plan.poses = []; plan.behavior = {};
      item.layers = structuredClone(t.layers);
      state.layerFiles.clear();
      clear(planBox, layerEditor(item, {
        keyDefault: typeOf(t.type)?.key ?? true, onChange: () => {},
        onImage: (l, file) => { state.layerFiles.set(l, file); },
        imageUrl: (l) => (state.layerFiles.has(l) ? URL.createObjectURL(state.layerFiles.get(l)) : null),
      }));
    } else {
      delete item.layers;
      plan.poses = structuredClone(t.poses);
      plan.behavior = structuredClone(t.behavior ?? {});
      clear(planBox, planEditor(plan, { onChange: drawVideos }));
    }
    drawVideos();
    for (const el of poseOnly) el.hidden = !!t.layers;
    anchorHint.textContent = t.layers
      ? 'İsteğe bağlı. Katmanlı öğede görseller katmanlardan gelir.'
      : 'Öğenin referans görseli. "Çapadan" başlayan pozların başlangıç karesi ve "çapa" görselli tek kareler bundan hazırlanır.';
  };
  const templateCards = h('div.template-cards');
  const drawTemplates = () => clear(templateCards, templates.filter((t) => t.type === typeSelect.value).map((t) =>
    h('button.template', { type: 'button', dataset: { name: t.name }, class: t.name === state.template ? 'selected' : '', onclick: () => pickTemplate(t) },
      h('strong', t.title?.tr ?? t.name), h('span', t.description?.tr ?? ''),
      h('small.muted', t.layers ? `katmanlar: ${t.layers.map((l) => l.name).join(', ')}` : t.poses.map((p) => p.name).join(' → ')))));

  const promptBox = h('div.stack');
  const drawPrompt = () => clear(promptBox, promptFields(item, () => {}));
  const pixelBox = h('div.stack');
  const drawPixels = () => clear(pixelBox, pixelFields(item, () => {}), canvasFields(item, () => {}));
  drawPrompt();
  drawPixels();

  // ---------- create ----------
  const out = h('div');
  const create = async (e) => {
    e.preventDefault();
    clear(out);
    if (!state.template) { out.append(errorCard({ message: 'Bir plan şablonu seç.' }, 'Eksik')); return; }
    const dir = dirInput.value.trim();
    const fields = {
      ...item, id: idInput.value.trim(), type: typeSelect.value,
      name: Object.fromEntries(Object.entries(item.name).filter(([, v]) => v.trim())),
      ...(layered() ? {} : { poses: plan.poses, behavior: plan.behavior }),
    };
    if (layered()) for (const k of ['subject', 'persistentDetails', 'style', 'facing']) delete fields[k];
    for (const k of ['pixelWidth', 'ptPerPixel', 'colors', 'canvas']) if (fields[k] === undefined) delete fields[k];
    let created;
    try { created = await api.post('/api/items', { dir, template: state.template, fields }); }
    catch (err) { out.append(errorCard(err, 'Öğe oluşturulamadı')); out.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    // The item exists from here on; a failed upload is reported but the item stays.
    const failed = [];
    if (state.anchor) {
      try { await api.upload(`${itemUrl(dir)}/anchor?ext=${extOf(state.anchor)}`, state.anchor); }
      catch (err) { failed.push(['Çapa görseli', err]); }
    }
    if (!layered()) for (const [pose, file] of state.videos) {
      try { await api.upload(`${poseUrl(dir, pose)}/video?ext=${extOf(file)}`, file); }
      catch (err) { failed.push([`${pose} videosu`, err]); }
    }
    for (const [layer, file] of state.layerFiles) {
      if (!item.layers?.includes(layer)) continue; // removed after its image was dropped
      try { await api.upload(`${itemUrl(dir)}/layers/${encodeURIComponent(layer.name)}/image?ext=${extOf(file)}`, file); }
      catch (err) { failed.push([`${layer.name} katmanı`, err]); }
    }
    if (failed.length) {
      for (const [what, err] of failed) out.append(errorCard(err, `${what} yüklenemedi`));
      out.append(h('p', 'Öğe oluşturuldu. Eksik dosyaları öğe sayfasından ekleyebilirsin. ', h('a.button', { href: `#/item/${encodeURIComponent(created.dir)}` }, 'Öğeye git')));
      return;
    }
    toast(`${created.id} oluşturuldu`);
    location.hash = `#/item/${encodeURIComponent(created.dir)}`;
  };

  const promptPanel = h('section.panel', h('h2', 'Prompt alanları'), promptBox);
  const videoPanel = h('section.panel',
    h('h2', 'Videolar (isteğe bağlı)'),
    h('p.note', 'Videolar genellikle adım adım gelir: her pozun videosu, aracın o poz için hazırladığı başlangıç karesinden üretilir (zincirdeki pozlar bir önceki pozun seçilen karesinden başlar). Elinde hazır video varsa şimdi bırakabilirsin; yoksa panoda sırayla ilerlersin.'),
    videosBox);
  const poseOnly = [promptPanel, videoPanel];

  mount.append(h('form.stack.new-item', { onsubmit: create, novalidate: true },
    h('div.page-head', h('div', h('h1', 'Yeni öğe'), h('p.muted', 'Gereken her şey bu ekranda. Sonra öğe panosunda pozları ya da katmanları tamamlarsın.'))),
    h('section.panel',
      h('h2', 'Kimlik ve tür'),
      h('div.grid3', ...nameFields(item, syncIds)),
      h('div.grid3',
        h('label.field', h('span', 'Tür'), typeSelect, h('small.muted', 'Şablonları ve varsayılanları belirler.')),
        h('label.field', h('span', 'Klasör adı'), dirInput, h('small.muted', 'Çalışma klasöründe açılır.')),
        h('label.field', h('span', 'Kimlik (id)'), idInput, h('small.muted', '<tür>.<kebab-case>')))),
    h('section.panel',
      h('h2', 'Plan'),
      h('p.muted', 'Bir şablon seç. Pozlu şablonda pozları ekleyip çıkarabilir, sıralarını ve alanlarını değiştirebilirsin; katmanlı şablonda katmanları ve görsellerini düzenlersin.'),
      templateCards, planBox),
    h('section.panel',
      h('h2', 'Çapa görseli'),
      anchorHint,
      h('div.anchor-row', anchorZone, anchorPreview)),
    promptPanel,
    h('section.panel', h('h2', 'Piksel ayarları ve tuval'), pixelBox),
    videoPanel,
    out,
    h('div.row.sticky-actions', h('button.primary', { type: 'submit' }, 'Oluştur'), h('a.button', { href: '#/' }, 'Vazgeç'))));
  typeSelect.value = 'pet';
  drawTemplates();
  if (templates[0]) pickTemplate(templates.find((t) => t.name === 'walking-pet') ?? templates[0]);
}
