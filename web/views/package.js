// Package: make it, read the report (budget, atlas, warnings) and play preview.html in the page.
import { api, fileUrl, itemUrl } from '../api.js';
import { actionButton, clear, errorCard, fmtDate, h, KIND, PACKAGE, toast } from '../ui.js';

export async function render(mount, { route, data, reload }) {
  const dir = route.dir;
  const head = h('div'), body = h('div.stack'), out = h('div'), progress = h('ol.progress');
  let makeJob = null;
  mount.append(head, out, progress, body);

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
        'Videosu olan pozlar seçilmemiş aralık yerine önerilen aralıkla pakete girer; videosu olmayan poz varken paket oluşturulamaz.') : null,
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
    const overAtlas = rep.atlas.w > maxSide || rep.atlas.h > maxSide;
    const fact = (k, v, bad) => h('div.fact', { class: bad ? 'bad' : '' }, h('span.k', k), h('span.v', v));
    clear(body,
      h('section.panel',
        h('h2', 'Rapor'),
        h('div.facts',
          fact('Paket', `${rep.packageKB} KB / ${rep.budgetKB} KB`, overBudget),
          fact('Atlas', `${rep.atlas.w}×${rep.atlas.h} px (en fazla ${maxSide})`, overAtlas),
          fact('Atlas dosyası', `${rep.atlas.kb} KB`),
          fact('Bellek', `${rep.atlas.memoryMB} MB`),
          fact('Boyut', `${rep.size.width}×${rep.size.height} pt`),
          fact('Izgara', `${rep.sourcePxPerPixel} kaynak px / sanat pikseli`),
          fact('Palet', `${rep.palette.length} renk`),
          rep.locomotion ? fact('Adım / hız', `${rep.locomotion.strideLength} pt · ${rep.locomotion.speed} pt/sn`) : null),
        h('div.palette', rep.palette.map((c) => h('span', { style: `background:${c}`, title: c }))),
        h('table.poses',
          h('thead', h('tr', h('th', 'Poz'), h('th', 'Tür'), h('th', 'Kare'), h('th', 'fps'), h('th', 'Kaynak aralık'))),
          h('tbody', Object.entries(rep.poses).map(([n, p]) => h('tr',
            h('td', h('code', n)), h('td', KIND[p.kind]), h('td', String(p.frames)), h('td', p.fps ? String(p.fps) : '—'),
            h('td', p.range ? `${p.range[0]}–${p.range[1]}${p.rangeChosen === false ? ' (önerilen)' : ''}` : p.sourceFrame != null ? `kare ${p.sourceFrame}` : '—'))))),
        rep.warnings.length ? h('div.warn-box', h('strong', 'Uyarılar'), h('ul', rep.warnings.map((w) => h('li', w)))) : h('p.ok', 'Uyarı yok.'),
        h('p.files', 'Dosyalar: ',
          ['manifest.json', 'report.json', 'preview.html'].map((f) => [h('a', { href: fileUrl(dir, `${base}/${f}`), target: '_blank', rel: 'noopener' }, f), ' ']),
          h('span.muted', `(${base}/)`))),
      h('section.panel',
        h('h2', 'Önizleme'),
        h('iframe.preview', { src: fileUrl(dir, `${base}/preview.html`, rep.madeAt), title: 'Paket önizlemesi' })));
  }

  drawHead(data);
  await drawReport();
  return {
    update(d) { drawHead(d); },
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
