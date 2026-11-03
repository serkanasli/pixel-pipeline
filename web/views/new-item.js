// New item, on one screen: identity, anchor image, plan (template + pose edits), prompt fields
// and, if there are any already, videos. Nothing is written until "Oluştur".
import { api, itemUrl, poseUrl } from '../api.js';
import { nameFields, pixelFields, promptFields } from '../item-form.js';
import { planEditor } from '../plan-editor.js';
import { clear, dropZone, errorCard, extOf, h, toast } from '../ui.js';

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function render(mount) {
  const [templates, config] = await Promise.all([api.get('/api/templates'), api.get('/api/config')]);
  if (!config.workspaceFound) { location.hash = '#/setup'; return; }

  const item = { name: { en: '', tr: '' }, facing: 'left', subject: '', persistentDetails: [], style: '' };
  const state = { dir: '', dirEdited: false, idEdited: false, template: null, anchor: null, videos: new Map() };
  const plan = { poses: [], behavior: {} };

  // ---------- identity ----------
  const dirInput = h('input', { type: 'text', placeholder: 'shadow-wolf', spellcheck: false, pattern: '[A-Za-z0-9][A-Za-z0-9._-]*' });
  const idInput = h('input', { type: 'text', placeholder: 'pet.shadow-wolf', spellcheck: false });
  const typeInput = h('input', { type: 'text', placeholder: 'pet', spellcheck: false });
  const syncIds = () => {
    if (!state.dirEdited) dirInput.value = slug(item.name.en || item.name.tr || '');
    if (!state.idEdited) idInput.value = typeInput.value && dirInput.value ? `${typeInput.value}.${slug(dirInput.value)}` : '';
  };
  dirInput.addEventListener('input', () => { state.dirEdited = true; syncIds(); });
  idInput.addEventListener('input', () => { state.idEdited = true; });
  typeInput.addEventListener('input', syncIds);

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
    plan.poses = structuredClone(t.poses);
    plan.behavior = structuredClone(t.behavior ?? {});
    typeInput.value = t.type;
    if (!item.style) { item.style = t.item?.style ?? ''; drawPrompt(); }
    Object.assign(item, { pixelWidth: t.item?.pixelWidth, ptPerPixel: t.item?.ptPerPixel, colors: t.item?.colors });
    drawPixels();
    syncIds();
    for (const card of templateCards.children) card.classList.toggle('selected', card.dataset.name === t.name);
    clear(planBox, planEditor(plan, { onChange: drawVideos }));
    drawVideos();
  };
  const templateCards = h('div.template-cards', templates.map((t) => h('button.template', { type: 'button', dataset: { name: t.name }, onclick: () => pickTemplate(t) },
    h('strong', t.title?.tr ?? t.name), h('span', t.description?.tr ?? ''), h('small.muted', t.poses.map((p) => p.name).join(' → ')))));

  const promptBox = h('div.stack');
  const drawPrompt = () => clear(promptBox, promptFields(item, () => {}));
  const pixelBox = h('div');
  const drawPixels = () => clear(pixelBox, pixelFields(item, () => {}));
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
      ...item, id: idInput.value.trim(), type: typeInput.value.trim(),
      name: Object.fromEntries(Object.entries(item.name).filter(([, v]) => v.trim())),
      poses: plan.poses, behavior: plan.behavior,
    };
    for (const k of ['pixelWidth', 'ptPerPixel', 'colors']) if (fields[k] === undefined) delete fields[k];
    let created;
    try { created = await api.post('/api/items', { dir, template: state.template, fields }); }
    catch (err) { out.append(errorCard(err, 'Öğe oluşturulamadı')); out.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    // The item exists from here on; a failed upload is reported but the item stays.
    const failed = [];
    if (state.anchor) {
      try { await api.upload(`${itemUrl(dir)}/anchor?ext=${extOf(state.anchor)}`, state.anchor); }
      catch (err) { failed.push(['Çapa görseli', err]); }
    }
    for (const [pose, file] of state.videos) {
      try { await api.upload(`${poseUrl(dir, pose)}/video?ext=${extOf(file)}`, file); }
      catch (err) { failed.push([`${pose} videosu`, err]); }
    }
    if (failed.length) {
      for (const [what, err] of failed) out.append(errorCard(err, `${what} yüklenemedi`));
      out.append(h('p', 'Öğe oluşturuldu. Eksik dosyaları öğe sayfasından ekleyebilirsin. ', h('a.button', { href: `#/item/${encodeURIComponent(created.dir)}` }, 'Öğeye git')));
      return;
    }
    toast(`${created.id} oluşturuldu`);
    location.hash = `#/item/${encodeURIComponent(created.dir)}`;
  };

  mount.append(h('form.stack.new-item', { onsubmit: create, novalidate: true },
    h('div.page-head', h('div', h('h1', 'Yeni öğe'), h('p.muted', 'Gereken her şey bu ekranda. Sonra öğe panosunda pozları sırayla tamamlarsın.'))),
    h('section.panel',
      h('h2', '1. Kimlik'),
      h('div.grid3', ...nameFields(item, syncIds)),
      h('div.grid3',
        h('label.field', h('span', 'Klasör adı'), dirInput, h('small.muted', 'Çalışma klasöründe açılır.')),
        h('label.field', h('span', 'Tür'), typeInput, h('small.muted', 'pet, character…; şablondan gelir.')),
        h('label.field', h('span', 'Kimlik (id)'), idInput, h('small.muted', '<tür>.<kebab-case>')))),
    h('section.panel',
      h('h2', '2. Çapa görseli'),
      h('p.muted', 'Öğenin referans görseli. "Çapadan" başlayan pozların başlangıç karesi bundan hazırlanır.'),
      h('div.anchor-row', anchorZone, anchorPreview)),
    h('section.panel',
      h('h2', '3. Plan'),
      h('p.muted', 'Bir şablon seç; sonra pozları ekleyip çıkarabilir, sıralarını ve alanlarını değiştirebilirsin.'),
      templateCards, planBox),
    h('section.panel',
      h('h2', '4. Prompt alanları'),
      promptBox,
      h('details', h('summary', 'Piksel ayarları'), pixelBox)),
    h('section.panel',
      h('h2', '5. Videolar (isteğe bağlı)'),
      h('p.note', 'Videolar genellikle adım adım gelir: her pozun videosu, aracın o poz için hazırladığı başlangıç karesinden üretilir (zincirdeki pozlar bir önceki pozun seçilen karesinden başlar). Elinde hazır video varsa şimdi bırakabilirsin; yoksa panoda sırayla ilerlersin.'),
      videosBox),
    out,
    h('div.row.sticky-actions', h('button.primary', { type: 'submit' }, 'Oluştur'), h('a.button', { href: '#/' }, 'Vazgeç'))));
  if (templates[0]) pickTemplate(templates.find((t) => t.name === 'walking-pet') ?? templates[0]);
}
