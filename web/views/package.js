// Package: make it, read the report (budget, atlas, layers, canvas, warnings), look at the layers
// on a checkerboard, play preview.html in the page and export the package to another folder.
import { api, fileUrl, itemUrl } from '../api.js';
import { actionButton, clear, errorCard, fmtDate, h, KIND, PACKAGE, toast } from '../ui.js';

export async function render(mount, { route, data, reload }) {
  const dir = route.dir;
  const head = h('div'), body = h('div.stack'), out = h('div'), progress = h('ol.progress'), exportBox = h('section.panel');
  let makeJob = null, current = data;
  const exportResult = h('div'); // outlives redraws: saving the target re-reads the item
  mount.append(head, out, progress, body, exportBox);

  const makeBtn = actionButton('Paketi oluştur', async () => {
    clear(out); clear(progress);
    try {
      await api.post(`${itemUrl(dir)}/make`);
      toast('Paket hazır');
      await reload();
      await drawReport();
    } catch (e) { out.append(errorCard(e, 'Paket oluşturulamadı')); }
  }, { primary: true, busy: 'Oluşturuluyor…' });

  function drawHead(d) {
    const s = d.status, notDone = s.poses.filter((p) => p.stage !== 'done');
    clear(head, h('div.page-head',
      h('div', h('h1', 'Paket ve önizleme'),
        h('p.muted', `${PACKAGE[s.package.state]}${s.package.madeAt ? ` · ${fmtDate(s.package.madeAt)}` : ''}`)),
      h('div.row', makeBtn)),
      notDone.length ? h('div.warn-box', `Tamamlanmamış pozlar: ${notDone.map((p) => p.name).join(', ')}. `,
        'Videosu olan pozlar seçilmemiş aralık yerine önerilen aralıkla pakete girer; videosu ya da görseli olmayan poz varken paket oluşturulamaz.') : null,
      s.layers.some((l) => !l.hasImage) ? h('div.warn-box', `Görseli olmayan katmanlar: ${s.layers.filter((l) => !l.hasImage).map((l) => l.name).join(', ')}. Paket oluşturulamaz.`) : null,
      s.package.state === 'stale' ? h('div.warn-box', 'item.json ya da videolar paket oluşturulduktan sonra değişti. Paketi yeniden oluştur.') : null);
  }

  async function drawReport() {
    let r;
    try { r = await api.get(`${itemUrl(dir)}/report`); }
    catch (e) { clear(body, errorCard(e, 'Rapor okunamadı')); return; }
    if (!r.report) {
      clear(body, h('p.muted', 'Henüz paket oluşturulmadı. Bütün pozlar tamamlanınca "Paketi oluştur" ile başlat.'));
      return;
    }
    const rep = r.report, base = r.base;
    const overBudget = rep.packageKB > rep.budgetKB;
    const maxSide = rep.maxAtlasSide ?? 2048;
    const overAtlas = rep.atlas && (rep.atlas.w > maxSide || rep.atlas.h > maxSide);
    const layers = Object.entries(rep.layers ?? {}).sort(([, a], [, b]) => a.z - b.z);
    const fact = (k, v, bad) => h('div.fact', { class: bad ? 'bad' : '' }, h('span.k', k), h('span.v', v));
    const BG = { keyed: 'arka planı temizlendi', opaque: 'olduğu gibi', alpha: 'kendi saydamlığı' };
    clear(body,
      h('section.panel',
        h('h2', 'Rapor'),
        h('div.facts',
          fact('Paket', `${rep.packageKB} KB / ${rep.budgetKB} KB`, overBudget),
          rep.atlas ? fact('Atlas', `${rep.atlas.w}×${rep.atlas.h} px (en fazla ${maxSide})`, overAtlas) : null,
          rep.atlas ? fact('Atlas dosyası', `${rep.atlas.kb} KB`) : null,
          rep.atlas ? fact('Bellek', `${rep.atlas.memoryMB} MB`) : null,
          fact('Boyut', `${rep.size.width}×${rep.size.height} pt`),
          fact('Çapa', `x ${rep.anchor.x} · y ${rep.anchor.y}`),
          rep.canvas ? fact('Tuval', `${rep.canvas.width}×${rep.canvas.height} sanat pikseli`, rep.warnings.some((w) => w.includes('canvas'))) : null,
          fact('Izgara', `${rep.sourcePxPerPixel} kaynak px / sanat pikseli`),
          fact('Palet', `${rep.palette.length} renk`),
          rep.locomotion ? fact('Adım / hız', `${rep.locomotion.strideLength} pt · ${rep.locomotion.speed} pt/sn`) : null),
        h('div.palette', rep.palette.map((c) => h('span', { style: `background:${c}`, title: c }))),
        Object.keys(rep.poses).length ? h('table.poses',
          h('thead', h('tr', h('th', 'Poz'), h('th', 'Tür'), h('th', 'Kare'), h('th', 'fps'), h('th', 'Kaynak'))),
          h('tbody', Object.entries(rep.poses).map(([n, p]) => h('tr',
            h('td', h('code', n)), h('td', KIND[p.kind]), h('td', String(p.frames)), h('td', p.fps ? String(p.fps) : '—'),
            h('td', p.range ? `${p.range[0]}–${p.range[1]}${p.rangeChosen === false ? ' (önerilen)' : ''}` : p.sourceFrame != null ? `kare ${p.sourceFrame}` : p.image ? `görsel ${p.image}` : '—'))))) : null,
        layers.length ? h('table.poses',
          h('thead', h('tr', h('th', 'Katman'), h('th', 'z'), h('th', 'Boyut'), h('th', 'Dosya'), h('th', 'Arka plan'))),
          h('tbody', layers.map(([n, l]) => h('tr',
            h('td', h('code', n)), h('td', String(l.z)), h('td', `${l.w}×${l.h} px`), h('td', `${l.file} · ${l.kb} KB`), h('td', BG[l.background] ?? l.background))))) : null,
        rep.warnings.length ? h('div.warn-box', h('strong', 'Uyarılar'), h('ul', rep.warnings.map((w) => h('li', w)))) : h('p.ok', 'Uyarı yok.'),
        h('p.files', 'Dosyalar: ',
          ['manifest.json', 'report.json', 'preview.html'].map((f) => [h('a', { href: fileUrl(dir, `${base}/${f}`), target: '_blank', rel: 'noopener' }, f), ' ']),
          h('span.muted', `(${base}/)`))),
      layers.length ? h('section.panel',
        h('h2', 'Katmanlar'),
        h('p.muted', 'Her katman ayrı, dama deseni saydam alanları gösterir. Birlikte görünümü önizlemede.'),
        h('div.layer-grid', layers.map(([n, l]) => h('figure',
          h('div.checker', h('img', { src: fileUrl(dir, `${base}/${l.file}`, rep.madeAt), alt: `${n} katmanı`, style: `height:${Math.min(l.h * 2, 320)}px` })),
          h('figcaption', h('code', n), ` · z ${l.z}`))))) : null,
      h('section.panel',
        h('h2', 'Önizleme'),
        h('iframe.preview', { src: fileUrl(dir, `${base}/preview.html`, rep.madeAt), title: 'Paket önizlemesi' })));
  }

  // ---------- export ----------
  function drawExport(d) {
    const state = d.status.package.state;
    const target = h('input', { type: 'text', value: d.item.export ?? '', placeholder: '../my-app/assets/items', spellcheck: false });
    const result = exportResult;
    const run = async () => {
      clear(result);
      try {
        const r = await api.post(`${itemUrl(dir)}/export`, { to: target.value.trim() || undefined });
        const e = r.export;
        toast('Dışa aktarıldı');
        result.append(h('div.ok-box', h('p', 'Paket kopyalandı: ', h('code', e.target)),
          h('p.muted', `Dosyalar: ${e.files.join(', ')}`),
          e.removed.length ? h('p.muted', `Eski paketten silinen: ${e.removed.join(', ')}`) : null,
          e.untouched.length ? h('p.muted', `Dokunulmayan (pakete ait değil): ${e.untouched.join(', ')}`) : null));
        await reload();
      } catch (err) { result.append(errorCard(err, 'Dışa aktarılamadı')); }
    };
    clear(exportBox,
      h('h2', 'Dışa aktar'),
      h('p.muted', 'Paketi başka bir klasöre kopyalar: ', h('code', '<hedef>/<id>/'), '. Hedefte yalnızca bu paketin kendi dosyaları yazılır ya da silinir; başka dosyalara dokunulmaz. Göreli yol öğe klasörüne göredir. Hedef item.json\'a "export" olarak kaydedilir.'),
      h('label.field', h('span', 'Hedef klasör'), target),
      state === 'stale' ? h('div.warn-box', 'Paket güncel değil: item.json ya da medya paket oluşturulduktan sonra değişti. Önce yeniden oluşturman önerilir; yine de dışa aktarırsan eski paket gider.') : null,
      state === 'none' ? h('p.muted', 'Önce paketi oluştur.') : h('div.row', actionButton(state === 'stale' ? 'Eski paketi yine de dışa aktar' : 'Dışa aktar', run, { primary: state === 'ready', busy: 'Kopyalanıyor…' })),
      result);
  }

  drawHead(data);
  drawExport(data);
  await drawReport();
  return {
    update(d) {
      drawHead(d);
      // Keep a typed target unless the package or the setting changed.
      if (d.status.package.state !== current.status.package.state || d.item.export !== current.item.export) drawExport(d);
      current = d;
    },
    // Progress of a running make, line by line, next to the button that started it.
    job(j) {
      if (j.name !== 'make package') return;
      if (j.state === 'running') { makeJob = j.job; clear(progress); }
      if (j.state === 'done' || j.state === 'failed') makeJob = null;
    },
    log(line) {
      if (line.job === makeJob) progress.append(h('li', { class: line.level === 'error' ? 'err' : '' }, line.text));
    },
  };
}
