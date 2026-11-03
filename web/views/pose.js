// Pose page, top to bottom in the order of the work: start frame -> video prompt -> video ->
// range. Each section redraws only when its own inputs change, so a file change elsewhere does
// not reset a video that is playing or a range being chosen. A still has one section: where its
// frame comes from (a frame of another pose or an image).
import { api, fileUrl, itemUrl, poseUrl } from '../api.js';
import { actionButton, clear, dropZone, errorCard, extOf, FIELD, h, KIND, sourceText, startsFromText, toast } from '../ui.js';

const START_DEFAULTS = { below: 0.2, maxFigure: 0.66 };
const LOOPING = new Set(['locomotion', 'loop']);
const TILE_W = 104; // contact sheet tile width on screen

export async function render(mount, { route, data, reload }) {
  const dir = route.dir, name = route.pose;
  const sections = { head: h('div'), start: h('section.panel'), prompt: h('section.panel'), video: h('section.panel'), range: h('section.panel'), nav: h('nav.pose-nav') };
  const keys = {};
  let d = data;
  const pose = () => d.item.poses.find((p) => p.name === name);
  const stat = () => d.status.poses.find((p) => p.name === name);
  if (!pose()) { mount.append(errorCard({ message: `${dir} öğesinde "${name}" adında poz yok.` }, 'Poz bulunamadı')); return; }

  // Saves one pose's fields into item.json (motion edits, start settings).
  async function savePose(patch) {
    const item = structuredClone(d.item);
    Object.assign(item.poses.find((p) => p.name === name), patch);
    await api.put(itemUrl(dir), { item });
  }

  // ---------- head ----------
  function drawHead() {
    const p = pose(), s = stat();
    clear(sections.head, h('div.page-head', h('div',
      h('h1', h('code', p.name), h('span.kind', KIND[p.kind])),
      h('p.muted', `${sourceText(p)} ${p.image ? 'oluşur' : 'başlar'}`, p.kind !== 'still' ? ` · ${p.fps ?? 12} fps` : '',
        s.stage === 'done' ? ' · tamam' : ''))));
  }

  // ---------- 1. start frame ----------
  function drawStart() {
    const p = pose(), s = stat(), sf = s.startFrame;
    const box = sections.start;
    const fromAnchor = p.startsFrom === 'anchor';
    const out = h('div');
    const vals = { ...START_DEFAULTS, ...p.start };
    const badge = { ready: ['ok', 'hazır'], missing: ['', 'henüz hazırlanmadı'], stale: ['warn', 'eski: kaynağı değişti, yeniden hazırla'], blocked: ['', 'bekliyor'] }[sf.state];
    const make = async () => {
      clear(out);
      try {
        const body = fromAnchor ? { start: { below: vals.below, maxFigure: vals.maxFigure } } : {};
        await api.post(`${poseUrl(dir, name)}/start-frame`, body);
        toast('Başlangıç karesi hazır');
        await reload();
      } catch (e) { out.append(errorCard(e, 'Başlangıç karesi hazırlanamadı')); }
    };
    const blocked = sf.blocked;
    const blockedText = blocked && {
      'no-anchor': h('p', 'Önce çapa görselini ekle. ', h('a', { href: `#/item/${encodeURIComponent(dir)}?edit=1` }, 'Öğe ayarları')),
      'source-video': h('p', `Bu kare ${blocked.pose} pozunun videosundan alınır; önce o video gelmeli. `, h('a', { href: `#/item/${encodeURIComponent(dir)}/pose/${blocked.pose}` }, `${blocked.pose} pozuna git`)),
      'source-range': h('p', `Bu kare ${blocked.pose} pozunun seçilen aralığından alınır; önce o aralığı seç. `, h('a', { href: `#/item/${encodeURIComponent(dir)}/pose/${blocked.pose}` }, `${blocked.pose} pozuna git`)),
    }[blocked.blocked];
    const slider = (key, label, min, max) => {
      const val = h('span.val', vals[key].toFixed(2));
      const input = h('input', { type: 'range', min, max, step: 0.01, value: vals[key], 'aria-label': label });
      input.addEventListener('input', () => { vals[key] = Number(input.value); val.textContent = vals[key].toFixed(2); });
      // Remade when the slider is let go: one job per adjustment, not one per pixel of drag.
      input.addEventListener('change', make);
      return h('label.slider', h('span', label), input, val);
    };
    clear(box,
      h('h2', '1. Başlangıç karesi ', badge ? h(`span.badge.${badge[0]}`, badge[1]) : null),
      h('p.muted', fromAnchor
        ? 'Video modeline verilecek ilk kare: çapa görseli 16:9 tuvalde, figürün çevresinde kuyruk ve kol savrulması için boşlukla.'
        : `Video modeline verilecek ilk kare: ${startsFromText(p.startsFrom)} alınan ham kare (arka plan düz renge eşitlenmiş, 16:9). Konumu korunur, böylece pozlar arasında sıçrama olmaz.`),
      s.hasVideo && sf.state !== 'ready' ? h('p.note', 'Bu pozun videosu zaten var. Başlangıç karesi yalnızca videoyu yeniden üretmek istersen gerekir.') : null,
      sf.file ? h('figure.start-frame', h('img', { src: fileUrl(dir, sf.file, sf.madeAt), alt: `${name} başlangıç karesi` }),
        h('figcaption', h('a', { href: fileUrl(dir, sf.file, sf.madeAt), download: `${name}-start.png` }, 'PNG indir'),
          sf.made?.background ? h('span.muted', ` · arka plan ${sf.made.background}`) : null,
          sf.made?.sourceFrame != null ? h('span.muted', ` · kaynak kare ${sf.made.sourceFrame}`) : null)) : null,
      blockedText,
      !blocked && fromAnchor ? h('div.sliders',
        slider('below', 'Altta boşluk (below)', 0, 0.6),
        slider('maxFigure', 'En büyük figür yüksekliği (maxFigure)', 0.1, 1)) : null,
      !blocked ? h('div.row', actionButton(sf.state === 'missing' ? 'Hazırla' : 'Yeniden hazırla', make, { primary: sf.state !== 'ready' })) : null,
      out);
  }

  // ---------- 2. prompt ----------
  async function drawPrompt() {
    const p = pose(), box = sections.prompt;
    const motion = h('textarea', { rows: 3, placeholder: 'It …' }, p.motion ?? '');
    const out = h('div');
    const saveMotion = actionButton('Hareket tarifini kaydet', async () => {
      clear(out);
      try { await savePose({ motion: motion.value.trim() }); toast('Kaydedildi'); await reload(); }
      catch (e) { out.append(errorCard(e, 'Kaydedilemedi')); }
    });
    let r;
    try { r = await api.get(`${poseUrl(dir, name)}/prompt`); }
    catch (e) { clear(box, h('h2', '2. Video promptu'), errorCard(e, 'Prompt hazırlanamadı')); return; }
    const text = h('textarea.prompt', { rows: 7, readonly: true }, r.text ?? '');
    const copy = actionButton('Kopyala', async () => {
      try { await navigator.clipboard.writeText(r.text); toast('Prompt kopyalandı'); }
      catch { text.select(); document.execCommand('copy'); toast('Prompt kopyalandı'); }
    }, { primary: true });
    const otherMissing = r.missing.filter((f) => f !== 'motion');
    clear(box,
      h('h2', '2. Video promptu ', r.text ? h('span.badge.ok', 'hazır') : h('span.badge', 'eksik alan var')),
      h('label.field', h('span', 'Hareket tarifi (motion, İngilizce)'), motion, h('div.row', saveMotion)),
      otherMissing.length ? h('div.warn-box', `Prompt için eksik: ${otherMissing.map((f) => FIELD[f] ?? f).join(', ')}. `,
        h('a', { href: `#/item/${encodeURIComponent(dir)}?edit=1` }, 'Öğe ayarlarında doldur')) : null,
      r.text ? [h('p.muted', 'Bu metni video modeline yapıştır ve başlangıç karesini ilk kare olarak ver.'), text, h('div.row', copy)] : null,
      out);
  }

  // ---------- 3. video ----------
  function drawVideo() {
    const p = pose(), s = stat(), box = sections.video;
    const zone = dropZone({
      label: s.hasVideo ? 'Videoyu değiştir' : 'Videoyu buraya bırak', hint: 'mp4, mov ya da webm · 360p yeterli', accept: 'video/*',
      onFile: async (file) => {
        await api.upload(`${poseUrl(dir, name)}/video?ext=${extOf(file)}`, file);
        toast('Video yüklendi');
        await reload();
      },
    });
    clear(box,
      h('h2', '3. Video ', s.hasVideo ? h('span.badge.ok', 'var') : h('span.badge', 'bekleniyor')),
      s.hasVideo
        ? h('figure.video', h('video', { src: fileUrl(dir, s.video, s.video), controls: true, loop: true, muted: true, playsInline: true, preload: 'metadata' }), h('figcaption.muted', s.video))
        : h('p.muted', `Videoyu başlangıç karesi ve promptla üret, sonra buraya bırak. Ya da dosyayı ${s.video} olarak kaydet; sayfa kendiliğinden görür.`),
      zone,
      s.hasVideo && p.range ? h('small.muted', 'Yeni video yüklenirse seçili aralık silinir.') : null);
  }

  // ---------- 4. range ----------
  let picker = null;
  async function drawRange() {
    const p = pose(), s = stat(), box = sections.range;
    picker?.stop();
    picker = null;
    if (!s.hasVideo) {
      clear(box, h('h2', '4. Aralık'), h('p.muted', 'Video gelince burada kareleri görüp kullanılacak aralığı seçersin.'));
      return;
    }
    clear(box, h('h2', '4. Aralık'), h('p.muted', 'Kareler çıkarılıyor ve ölçülüyor… (ilk seferde birkaç saniye sürer)'));
    let r;
    try { r = await api.post(`${poseUrl(dir, name)}/inspect`); }
    catch (e) { clear(box, h('h2', '4. Aralık'), errorCard(e, 'Video incelenemedi')); return; }
    picker = rangePicker(box, p, r);
  }

  function rangePicker(box, p, r) {
    const looping = LOOPING.has(p.kind), step = r.step, n = r.frames;
    const sug = r.suggestion ? [r.suggestion.start, r.suggestion.end] : null;
    let sel = r.range ? [...r.range] : sug ? [...sug] : [0, Math.min(n - 1, step * 8)];
    let pending = null; // start chosen, waiting for the end click
    const scale = TILE_W / r.sheet.tileW, tw = TILE_W, th = Math.round(r.sheet.tileH * scale);
    const sheetUrl = fileUrl(dir, r.contactSheet);
    const sheet = new Image();
    sheet.src = sheetUrl;

    const played = () => { const o = []; for (let i = sel[0]; i <= (looping ? sel[1] - 1 : sel[1]); i += step) o.push(i); return o; };
    const grid = h('div.frames', { style: `--tw:${tw}px; --th:${th}px` });
    const tiles = [];
    for (let i = 0; i < n; i++) {
      const c = i % r.sheet.cols, row = Math.floor(i / r.sheet.cols);
      const t = h('button.frame', { type: 'button', title: `Kare ${i}`, style: `background-image:url("${sheetUrl}"); background-size:${r.sheet.cols * tw}px auto; background-position:-${c * tw}px -${row * th}px`, onclick: () => pick(i) }, h('span', String(i)));
      tiles.push(t);
      grid.append(t);
    }
    const info = h('p.range-info');
    const measure = h('p.measure');
    const saveState = h('span.muted');
    const out = h('div');
    const canvas = h('canvas.loop', { width: tw * 2, height: th * 2, 'aria-label': 'Seçili aralığın canlı önizlemesi' });

    function pick(i) {
      if (pending == null) { pending = i; sel = [i, Math.min(n - 1, i + step)]; }
      else {
        let a = pending, b = i;
        if (b < a) [a, b] = [b, a];
        if (looping) {
          // The end is the frame that matches the start: a whole number of steps after it.
          let k = Math.max(1, Math.round((b - a) / step));
          while (a + k * step > n - 1 && k > 1) k--;
          b = a + k * step;
        }
        if (b === a) b = Math.min(n - 1, a + step);
        sel = [a, b];
        pending = null;
      }
      paint();
    }

    let measureTimer;
    function paint() {
      const pl = new Set(played());
      tiles.forEach((t, i) => {
        t.classList.toggle('in', i >= sel[0] && i <= sel[1]);
        t.classList.toggle('played', pl.has(i));
        t.classList.toggle('edge', i === sel[0] || i === sel[1]);
        t.classList.toggle('match', looping && i === sel[1]);
        t.classList.toggle('sug', !!sug && i >= sug[0] && i <= sug[1]);
        t.classList.toggle('pending', i === pending);
      });
      const saved = p.range && p.range[0] === sel[0] && p.range[1] === sel[1];
      clear(info,
        h('strong', `${sel[0]}–${sel[1]}`),
        ` · ${pl.size} kare @ ${p.fps ?? 12} fps (${(pl.size / (p.fps ?? 12)).toFixed(2)} sn)`,
        looping ? ` · ${sel[1]}. kare başlangıçla eşleşen kare, oynatılmaz` : '',
        pending != null ? h('span.muted', ' · şimdi bitiş karesine tıkla') : '');
      saveState.textContent = saved ? 'kayıtlı' : p.range ? `kayıtlı aralık ${p.range[0]}–${p.range[1]}; değişiklik kaydedilmedi` : 'henüz kaydedilmedi';
      saveBtn.disabled = saved || pending != null;
      if (p.kind === 'locomotion') {
        clearTimeout(measureTimer);
        measure.textContent = 'ölçülüyor…';
        measureTimer = setTimeout(async () => {
          const at = sel.join();
          try {
            const m = await api.get(`${poseUrl(dir, name)}/measure?a=${sel[0]}&b=${sel[1]}`);
            if (at === sel.join()) measure.textContent = `Adım uzunluğu ${m.strideLength} pt · hız ${m.speed} pt/sn · yere basma örneği ${m.samples}`;
          } catch (e) { measure.textContent = `ölçülemedi: ${e.message}`; }
        }, 250);
      }
    }

    // Live loop of the selection at the pose's fps, drawn from the contact sheet.
    let raf, t0 = performance.now();
    const ctx = canvas.getContext('2d');
    function tick(now) {
      const frames = played(), fps = p.fps ?? 12;
      const hold = looping ? 0 : Math.round(fps * 0.6); // one-shot poses pause on their last frame
      const k = Math.floor(((now - t0) / 1000) * fps) % (frames.length + hold);
      const f = frames[Math.min(k, frames.length - 1)];
      if (sheet.complete && sheet.naturalWidth && f != null) {
        const c = f % r.sheet.cols, row = Math.floor(f / r.sheet.cols);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sheet, c * r.sheet.tileW, row * r.sheet.tileH, r.sheet.tileW, r.sheet.tileH, 0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    const saveBtn = h('button.primary', { type: 'button', onclick: async () => {
      clear(out);
      saveBtn.disabled = true;
      try {
        await api.put(`${poseUrl(dir, name)}/range`, { range: sel });
        toast('Aralık kaydedildi');
        await reload();
      } catch (e) { out.append(errorCard(e, 'Aralık kaydedilemedi')); saveBtn.disabled = false; }
    } }, 'Aralığı kaydet');

    clear(box,
      h('h2', '4. Aralık ', p.range ? h('span.badge.ok', 'seçildi') : h('span.badge', 'seçilmedi')),
      h('p.muted', `${n} kare (24 fps). Önce başlangıç, sonra bitiş karesine tıkla. ${looping ? 'Döngüde bitiş, başlangıçla aynı görünen karedir; aralık her zaman ' + step + ' karenin katı olur.' : 'Bitiş karesi oynatılan son karedir.'} Kesik çerçeve önerilen aralığı, nokta oynatılan kareleri gösterir.`),
      h('div.range-top',
        h('div.loop-box', canvas, h('small.muted', 'canlı önizleme')),
        h('div.range-side', info, p.kind === 'locomotion' ? measure : null,
          r.suggestion ? h('p.muted', `Önerilen: ${sug[0]}–${sug[1]}${r.suggestion.score != null ? ` (döngü kapanma puanı ${r.suggestion.score}; düşük daha iyi)` : ''}${r.suggestion.returnScore != null ? ` (ilk duruşa dönüş puanı ${r.suggestion.returnScore})` : ''}`) : h('p.muted', 'Öneri yok: aralığı elle seç.'),
          h('div.row',
            sug ? h('button', { type: 'button', onclick: () => { sel = [...sug]; pending = null; paint(); } }, 'Öneriyi kullan') : null,
            saveBtn, saveState),
          out)),
      grid);
    paint();
    return { stop() { cancelAnimationFrame(raf); clearTimeout(measureTimer); } };
  }

  // ---------- navigation ----------
  function drawNav() {
    const order = d.status.poses.map((p) => p.name), i = order.indexOf(name);
    const link = (n, label) => h('a.button', { href: `#/item/${encodeURIComponent(dir)}/pose/${n}` }, label);
    clear(sections.nav,
      i > 0 ? link(order[i - 1], `← ${order[i - 1]}`) : h('span'),
      h('a.button', { href: `#/item/${encodeURIComponent(dir)}` }, 'Panoya dön'),
      i < order.length - 1 ? link(order[i + 1], `${order[i + 1]} →`) : h('a.button', { href: `#/item/${encodeURIComponent(dir)}/package` }, 'Paket →'));
  }

  // ---------- still ----------
  function drawStill() {
    const p = pose(), s = stat();
    const out = h('div');
    const others = d.item.poses.filter((q) => q.kind !== 'still');
    // Source: a frame of another pose, the anchor image or an image file of its own.
    const current = p.image === 'anchor' ? 'anchor' : p.image ? 'file' : 'pose';
    const choose = async (kind) => {
      clear(out);
      const patch = kind === 'anchor' ? { image: 'anchor', startsFrom: undefined }
        : kind === 'file' ? { image: p.image && p.image !== 'anchor' ? p.image : `${p.name}.png`, startsFrom: undefined }
        : { image: undefined, startsFrom: { pose: others[0].name, frame: 'last' } };
      try { await savePose(patch); await reload(); } catch (e) { out.append(errorCard(e, 'Kaydedilemedi')); }
    };
    const radio = (kind, label, disabled) => {
      const r = h('input', { type: 'radio', name: 'still-source', value: kind, checked: current === kind, disabled });
      r.addEventListener('change', () => choose(kind));
      return h('label.inline', r, label);
    };
    const drop = dropZone({
      label: p.image && p.image !== 'anchor' && s.stage === 'done' ? 'Görseli değiştir' : 'Görseli buraya bırak',
      hint: 'PNG, JPG ya da WebP · düz açık arka plan ya da saydam; videolu pozlarla aynı ızgara ve paletten geçer', accept: 'image/png,image/jpeg,image/webp',
      onFile: async (file) => {
        if (!['png', 'jpg', 'webp'].includes(extOf(file))) throw new Error('Görsel PNG, JPG ya da WebP olmalı');
        await api.upload(`${poseUrl(dir, name)}/image?ext=${extOf(file)}`, file);
        toast(`${name} görseli yüklendi`);
        await reload();
      },
    });
    const img = p.image && s.stage === 'done' ? h('div.anchor-preview.checker', h('img', { src: fileUrl(dir, s.image, Date.now()), alt: `${name} görseli` })) : null;
    clear(sections.start, h('h2', 'Tek kare'),
      h('div.radio', radio('pose', 'bir pozun karesi', !others.length), radio('anchor', 'çapa görseli'), radio('file', 'görsel dosyası')),
      out,
      current === 'pose'
        ? [h('p', `Bu poz ${startsFromText(p.startsFrom)} oluşur; videosu, başlangıç karesi ve promptu yoktur. Hangi kare olduğu planda seçilir.`),
          s.stage === 'done' ? h('p.ok', 'Kaynak poz tamam, bu kare pakete girer.') : h('p', `${s.waitsFor} pozu tamamlanınca hazır olur. `, h('a', { href: `#/item/${encodeURIComponent(dir)}/pose/${s.waitsFor}` }, `${s.waitsFor} pozuna git`))]
        : [h('p', 'Görsel, videolu pozlarla aynı arka plan temizlemeden, ızgaradan ve paletten geçer. Ölçeği çapadan gelir: çapadaki figür "piksel genişliği" kadar sanat pikseli olur. Ayak noktası en alt pikseldir.'),
          current === 'file' ? h('div.anchor-row', drop, img) : img,
          s.stage === 'done' ? h('p.ok', 'Görsel hazır, bu kare pakete girer.')
            : current === 'anchor' ? h('p', 'Önce çapa görselini ekle. ', h('a', { href: `#/item/${encodeURIComponent(dir)}?edit=1` }, 'Öğe ayarları'))
            : h('p.muted', `Beklenen dosya: ${p.image}`)]);
  }

  // Sections redraw when their inputs change; a range being chosen survives unrelated changes.
  const inputs = {
    head: () => JSON.stringify([pose(), stat().stage]),
    start: () => JSON.stringify([pose().startsFrom, pose().start, stat().startFrame, stat().hasVideo]),
    prompt: () => JSON.stringify([d.item.subject, d.item.style, d.item.persistentDetails, d.item.facing, pose().motion, pose().kind, stat().startFrame]),
    video: () => JSON.stringify([stat().video, stat().hasVideo, pose().range]),
    range: () => JSON.stringify([stat().video, stat().hasVideo, pose().range, pose().fps, pose().kind]),
    nav: () => JSON.stringify(d.status.poses.map((p) => p.name)),
  };
  const draw = { head: drawHead, start: drawStart, prompt: drawPrompt, video: drawVideo, range: drawRange, nav: drawNav };
  function refresh(force) {
    if (pose().kind === 'still') {
      for (const k of ['prompt', 'video', 'range']) sections[k].hidden = true;
      drawHead(); drawStill(); drawNav();
      return;
    }
    for (const k of ['prompt', 'video', 'range']) sections[k].hidden = false;
    for (const k of Object.keys(draw)) {
      const key = inputs[k]();
      if (!force && keys[k] === key) continue;
      keys[k] = key;
      draw[k]();
    }
  }

  mount.append(sections.head, sections.start, sections.prompt, sections.video, sections.range, sections.nav);
  refresh(true);

  return {
    update(next) {
      d = next;
      if (!pose()) { toast(`${name} pozu artık yok`); location.hash = `#/item/${encodeURIComponent(dir)}`; return; }
      refresh(false);
    },
    destroy() { picker?.stop(); },
  };
}
