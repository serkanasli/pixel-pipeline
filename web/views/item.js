// Item board: the poses as cards in chain order with their stage, the package, and the item's
// settings and plan (editable, saved to item.json).
import { api, fileUrl, itemUrl } from '../api.js';
import { nameFields, pixelFields, promptFields } from '../item-form.js';
import { planEditor } from '../plan-editor.js';
import { clear, dropZone, errorCard, extOf, FACING, fmtDate, h, KIND, nextStep, PACKAGE, STAGES, startsFromText, toast } from '../ui.js';

export async function render(mount, { route, data, reload }) {
  const dir = route.dir;
  const head = h('div');
  const cards = h('ol.pose-cards');
  const settings = h('details.panel.settings', { open: route.q.edit === '1' });
  mount.append(head,
    h('p.note', 'Pozlar zincir sırasında. Her pozun videosu, o poz için hazırlanan başlangıç karesinden üretilir; bu yüzden videolar sırayla gelir. Bir karta tıklayıp o pozda kaldığın yerden devam et.'),
    cards, settings);

  let draft = null, dirty = false, outdated = false;

  function drawHead(d) {
    const it = d.item;
    clear(head, h('div.page-head',
      h('div.item-title',
        it.anchor ? h('img.anchor-thumb', { src: fileUrl(dir, it.anchor, d.status.poses[0]?.startFrame?.file ?? it.anchor), alt: 'Çapa görseli' }) : null,
        h('div',
          h('h1', it.name?.tr ?? it.name?.en ?? it.id),
          h('p.muted', h('code', it.id), ` · ${it.type} · ${FACING[it.facing ?? 'left']} bakar`, it.template ? ` · şablon ${it.template}` : '', ` · ${d.status.posesDone}/${d.status.posesTotal} poz hazır`))),
      h('div.row', h('a.button', { href: '#/' + `item/${encodeURIComponent(dir)}?edit=1`, onclick: () => { settings.open = true; } }, 'Ayarlar ve plan'))));
  }

  function poseCard(s, item) {
    const href = `#/item/${encodeURIComponent(dir)}/pose/${s.name}`;
    const idx = STAGES.findIndex(([k]) => k === s.stage);
    const stepper = s.kind === 'still' ? null : h('ol.stepper', STAGES.map(([k, label], i) =>
      h('li', { class: i < idx || s.stage === 'done' ? 'done' : i === idx ? 'current' : '' }, label)));
    const sf = s.startFrame?.file;
    const thumb = sf ? h('img', { src: fileUrl(dir, sf, s.startFrame.state + (s.video ?? '')), alt: `${s.name} başlangıç karesi`, loading: 'lazy' }) : h('span.muted', s.kind === 'still' ? 'tek kare' : 'başlangıç karesi yok');
    const n = s.next ? nextStep(dir, s.next) : null;
    const pose = item.poses.find((p) => p.name === s.name);
    return h('li', h('a.pose-card', { href, class: s.stage === 'done' ? 'done' : '' },
      h('div.thumb', thumb),
      h('div.card-body',
        h('h2', h('code', s.name), h('span.kind', KIND[s.kind])),
        h('p.muted', `${startsFromText(pose.startsFrom)} başlar${s.fps && s.kind !== 'still' ? ` · ${s.fps} fps` : ''}${s.range ? ` · aralık ${s.range[0]}–${s.range[1]}` : ''}`),
        stepper,
        s.stage === 'waiting' ? h('p.muted', `${s.waitsFor} tamamlanınca hazır olur.`) : null,
        s.note === 'start-frame-changed' ? h('p.warn', 'Başlangıç karesinin kaynağı video üretildikten sonra değişti.') : null,
        n ? h('p.next-line', h('span.k', 'Sıradaki: '), n.text) : s.stage === 'done' ? h('p.ok', 'Tamam') : null)));
  }

  function drawCards(d) {
    const pkg = d.status.package;
    const pn = d.status.poses.every((p) => p.stage === 'done') ? nextStep(dir, d.status.next) : null;
    clear(cards,
      d.status.poses.map((s) => poseCard(s, d.item)),
      h('li', h('a.pose-card.package-card', { href: `#/item/${encodeURIComponent(dir)}/package`, class: pkg.state === 'ready' ? 'done' : '' },
        h('div.thumb', h('span', '▦')),
        h('div.card-body',
          h('h2', 'Paket'),
          h('p.muted', PACKAGE[pkg.state] + (pkg.packageKB ? ` · ${pkg.packageKB} / ${pkg.budgetKB} KB` : '') + (pkg.madeAt ? ` · ${fmtDate(pkg.madeAt)}` : '')),
          pkg.warnings ? h('p.warn', `${pkg.warnings} uyarı`) : null,
          pn ? h('p.next-line', h('span.k', 'Sıradaki: '), pn.text) : h('p.muted', 'Bütün pozlar tamamlanınca oluşturulur.')))));
  }

  // ---------- settings and plan ----------
  const out = h('div');
  const banner = h('div');
  function drawSettings(d) {
    draft = structuredClone(d.item);
    dirty = false; outdated = false;
    clear(banner);
    const mark = () => { dirty = true; saveBtn.disabled = false; };
    const saveBtn = h('button.primary', { type: 'submit', disabled: true }, 'Kaydet');
    const anchorZone = dropZone({
      label: d.item.anchor ? 'Çapa görselini değiştir' : 'Çapa görselini buraya bırak', hint: 'PNG ya da JPG', accept: 'image/png,image/jpeg',
      onFile: async (file) => {
        if (!['png', 'jpg'].includes(extOf(file))) throw new Error('Çapa görseli PNG ya da JPG olmalı');
        await api.upload(`${itemUrl(dir)}/anchor?ext=${extOf(file)}`, file);
        toast('Çapa görseli yüklendi');
        await reload();
      },
    });
    const save = async (e) => {
      e.preventDefault();
      clear(out);
      try {
        await api.put(itemUrl(dir), { item: draft });
        dirty = false;
        toast('item.json kaydedildi');
        await reload();
      } catch (err) { out.append(errorCard(err, 'Kaydedilemedi')); }
    };
    clear(settings,
      h('summary', h('h2', 'Ayarlar ve plan')),
      banner,
      h('form.stack', { onsubmit: save },
        h('div.grid3', ...nameFields(draft, mark)),
        h('div.anchor-row', anchorZone, d.item.anchor ? h('div.anchor-preview', h('img', { src: fileUrl(dir, d.item.anchor, Date.now()), alt: 'Çapa görseli' })) : null),
        ...promptFields(draft, mark),
        h('details', h('summary', 'Piksel ayarları'), pixelFields(draft, mark)),
        h('h3', 'Pozlar'),
        h('p.muted', 'Tür ya da fps değişirse o pozun seçili aralığı silinir. Poz adı değişirse başlangıç karesi ve video dosya adları değişmez; gerekirse yeniden hazırla.'),
        planEditor(draft, { onChange: mark }),
        out,
        h('div.row.sticky-actions', saveBtn, h('button', { type: 'button', onclick: () => { drawSettings(current); } }, 'Değişiklikleri at'))));
  }

  let current = data;
  drawHead(data); drawCards(data); drawSettings(data);
  if (route.q.edit === '1') settings.scrollIntoView({ block: 'start' });

  return {
    update(d) {
      current = d;
      drawHead(d); drawCards(d);
      // Never throw away edits in progress; say that the file changed underneath instead.
      if (dirty) {
        if (!outdated) {
          outdated = true;
          clear(banner, h('div.warn-box', 'item.json bu sayfa dışında değişti. Kaydedersen o değişikliklerin üzerine yazılır. ',
            h('button', { type: 'button', onclick: () => drawSettings(current) }, 'Yeni hali yükle')));
        }
      } else drawSettings(d);
    },
  };
}
