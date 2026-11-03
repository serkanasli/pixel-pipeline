// Editor for an item's pose plan and behavior. Works on plan = { poses, behavior } in place and
// calls onChange after every edit. Fields it does not show (video, range, start) are kept, except
// where an edit makes them meaningless: a new kind or fps clears the chosen range. A still takes
// a frame of another pose or an image (the anchor or a file, dropped on the pose page).
import { clear, h, KIND } from './ui.js';

const KINDS = Object.keys(KIND);
const FPS = [6, 8, 12, 24];
const NAME = /^[a-z][a-z0-9_]*$/;
const isObj = (v) => v !== null && typeof v === 'object';

export function planEditor(plan, { onChange }) {
  const root = h('div.plan');
  plan.behavior ??= {};

  const changed = (rerender = false) => { onChange(); if (rerender) draw(); };
  const others = (p) => plan.poses.filter((q) => q !== p && q.kind !== 'still');

  function startsFromSelect(p) {
    const value = p.image === 'anchor' ? 'image:anchor' : p.image ? 'image:file'
      : p.startsFrom === 'anchor' || !p.startsFrom ? 'anchor' : `${p.startsFrom.pose}:${p.startsFrom.frame}`;
    const opts = [];
    if (p.kind !== 'still') opts.push(h('option', { value: 'anchor' }, 'çapadan'));
    else opts.push(h('option', { value: 'image:anchor' }, 'görsel · çapa'), h('option', { value: 'image:file' }, p.image && p.image !== 'anchor' ? `görsel · ${p.image}` : 'görsel · dosya'));
    for (const q of others(p)) {
      opts.push(h('option', { value: `${q.name}:first` }, `${q.name} · ilk kare`));
      opts.push(h('option', { value: `${q.name}:last` }, `${q.name} · son kare`));
    }
    // A specific source frame set in item.json stays selectable.
    if (isObj(p.startsFrom) && !/:(first|last)$/.test(value)) opts.push(h('option', { value }, `${p.startsFrom.pose} · kare ${p.startsFrom.frame}`));
    const sel = h('select', { 'aria-label': `${p.name} nereden başlar` }, opts);
    sel.value = value;
    if (sel.value !== value) sel.value = opts[0]?.value ?? '';
    sel.addEventListener('change', () => {
      const [pose, frame] = sel.value.split(':');
      if (pose === 'image') {
        delete p.startsFrom;
        p.image = frame === 'anchor' ? 'anchor' : p.image && p.image !== 'anchor' ? p.image : `${p.name}.png`;
        return changed(true);
      }
      const wasImage = !!p.image;
      delete p.image;
      p.startsFrom = sel.value === 'anchor' ? 'anchor' : { pose, frame: /^\d+$/.test(frame) ? Number(frame) : frame };
      if (p.startsFrom !== 'anchor' && p.start) { delete p.start.below; delete p.start.maxFigure; if (!Object.keys(p.start).length) delete p.start; }
      changed(wasImage);
    });
    return sel;
  }

  function renamePose(p, next) {
    const old = p.name;
    for (const q of plan.poses) if (q.startsFrom?.pose === old) q.startsFrom.pose = next;
    const b = plan.behavior;
    for (const k of ['enter', 'onPress']) if (b[k] === old) b[k] = next;
    if (b.arrive) b.arrive = b.arrive.map((x) => (x === old ? next : x));
    if (b.occasional) b.occasional = b.occasional.map((o) => (typeof o === 'string' ? (o === old ? next : o) : o.pose === old ? { ...o, pose: next } : o));
    p.name = next;
  }

  function removePose(p) {
    plan.poses.splice(plan.poses.indexOf(p), 1);
    for (const q of plan.poses) {
      if (q.startsFrom?.pose !== p.name) continue;
      if (q.kind !== 'still') q.startsFrom = 'anchor';
      else if (others(q)[0]) q.startsFrom = { pose: others(q)[0].name, frame: 'last' };
      else { delete q.startsFrom; q.image = 'anchor'; }
    }
    const b = plan.behavior;
    for (const k of ['enter', 'onPress']) if (b[k] === p.name) delete b[k];
    if (b.arrive) b.arrive = b.arrive.filter((x) => x !== p.name);
    if (b.occasional) b.occasional = b.occasional.filter((o) => (o.pose ?? o) !== p.name);
  }

  function poseRow(p, i) {
    const name = h('input', { type: 'text', value: p.name, 'aria-label': 'Poz adı', pattern: '[a-z][a-z0-9_]*', spellcheck: false });
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!NAME.test(v) || plan.poses.some((q) => q !== p && q.name === v)) { name.setCustomValidity('snake_case ve benzersiz olmalı'); name.reportValidity(); return; }
      name.setCustomValidity('');
      renamePose(p, v);
      changed(true);
    });
    const kind = h('select', { 'aria-label': 'Tür' }, KINDS.map((k) => h('option', { value: k }, KIND[k])));
    kind.value = p.kind;
    kind.addEventListener('change', () => {
      p.kind = kind.value;
      delete p.range;
      if (p.kind === 'still') {
        for (const k of ['fps', 'video', 'start', 'motion']) delete p[k];
        if (p.startsFrom === 'anchor' || !p.startsFrom) {
          if (others(p)[0]) p.startsFrom = { pose: others(p)[0].name, frame: 'first' };
          else { delete p.startsFrom; p.image = 'anchor'; }
        }
      } else {
        p.fps ??= 12;
        if (p.image) { delete p.image; p.startsFrom = 'anchor'; }
      }
      changed(true);
    });
    const fps = h('select', { 'aria-label': 'fps' }, FPS.map((f) => h('option', { value: f }, `${f} fps`)));
    fps.value = String(p.fps ?? 12);
    fps.addEventListener('change', () => { p.fps = Number(fps.value); delete p.range; changed(); });
    const motion = h('textarea', { rows: 2, placeholder: 'Hareketin kısa İngilizce tarifi (video promptuna girer)', 'aria-label': 'Hareket tarifi' }, p.motion ?? '');
    motion.addEventListener('input', () => { p.motion = motion.value; changed(); });
    const move = (d) => { const j = i + d; [plan.poses[i], plan.poses[j]] = [plan.poses[j], plan.poses[i]]; changed(true); };
    return h('li.pose-row',
      h('div.pose-row-head',
        h('span.num', String(i + 1)),
        name, kind,
        p.kind !== 'still' ? fps : null,
        h('label.inline', h('span', p.kind === 'still' ? 'kaynak' : 'başlangıç'), startsFromSelect(p)),
        h('span.spacer'),
        h('button.icon', { type: 'button', title: 'Yukarı', 'aria-label': `${p.name} yukarı`, disabled: i === 0, onclick: () => move(-1) }, '↑'),
        h('button.icon', { type: 'button', title: 'Aşağı', 'aria-label': `${p.name} aşağı`, disabled: i === plan.poses.length - 1, onclick: () => move(1) }, '↓'),
        h('button.icon.danger', { type: 'button', title: 'Sil', 'aria-label': `${p.name} sil`, disabled: plan.poses.length === 1, onclick: () => { removePose(p); changed(true); } }, '×')),
      p.kind !== 'still' ? motion : h('p.muted', p.image
        ? 'Tek kare, görselden: video kareleriyle aynı arka plan temizleme, ızgara ve paletten geçer. Dosyayı poz sayfasında bırakırsın.'
        : 'Tek kare: başladığı pozun seçilen karesini kullanır, videosu yoktur.'),
      p.range ? h('p.muted', `Seçili aralık: ${p.range[0]}–${p.range[1]}`) : null);
  }

  function behaviorBox() {
    const b = plan.behavior;
    const names = plan.poses.map((p) => p.name);
    const select = (key, list, label) => {
      const sel = h('select', { 'aria-label': label }, h('option', { value: '' }, '—'), list.map((n) => h('option', { value: n }, n)));
      sel.value = b[key] ?? '';
      sel.addEventListener('change', () => { if (sel.value) b[key] = sel.value; else delete b[key]; changed(); });
      return sel;
    };
    const arrive = h('div.chips');
    const drawArrive = () => {
      clear(arrive, (b.arrive ?? []).map((n, i) => h('span.chip', n, h('button.icon', { type: 'button', 'aria-label': `${n} çıkar`, onclick: () => { b.arrive.splice(i, 1); if (!b.arrive.length) delete b.arrive; changed(); drawArrive(); } }, '×'))));
      const add = h('select', { 'aria-label': 'Varışa poz ekle' }, h('option', { value: '' }, '+ poz ekle'), names.map((n) => h('option', { value: n }, n)));
      add.addEventListener('change', () => { if (!add.value) return; (b.arrive ??= []).push(add.value); changed(); drawArrive(); });
      arrive.append(add);
    };
    drawArrive();
    const occ = h('div.occ', names.map((n) => {
      const cur = (b.occasional ?? []).find((o) => (o.pose ?? o) === n);
      const o = typeof cur === 'string' ? { pose: cur } : cur;
      const on = h('input', { type: 'checkbox', checked: !!o });
      const min = h('input', { type: 'number', min: 0, step: 1, value: o?.wait?.[0] ?? 5, 'aria-label': `${n} en az bekleme` });
      const max = h('input', { type: 'number', min: 0, step: 1, value: o?.wait?.[1] ?? 12, 'aria-label': `${n} en çok bekleme` });
      const weight = h('input', { type: 'number', min: 0.1, step: 0.1, value: o?.weight ?? 1, 'aria-label': `${n} ağırlık` });
      const write = () => {
        const list = (b.occasional ?? []).filter((x) => (x.pose ?? x) !== n);
        if (on.checked) list.push({ pose: n, weight: Number(weight.value) || 1, wait: [Number(min.value) || 0, Number(max.value) || 0] });
        if (list.length) b.occasional = list; else delete b.occasional;
        changed();
      };
      for (const el of [on, min, max, weight]) el.addEventListener('change', write);
      return h('div.occ-row', h('label.inline', on, h('code', n)), h('span.muted', 'bekleme'), min, h('span', '–'), max, h('span.muted', 'sn, ağırlık'), weight);
    }));
    const locos = plan.poses.filter((p) => p.kind === 'locomotion').map((p) => p.name);
    return h('fieldset.behavior',
      h('legend', 'Davranış'),
      h('div.grid2',
        h('label.field', h('span', 'Giriş (yürüyerek gelir)'), select('enter', locos, 'Giriş pozu')),
        h('label.field', h('span', 'Dokununca'), select('onPress', names, 'Dokunma pozu'))),
      h('div.field', h('span', 'Varış sırası (sonuncusu dinlenme pozudur)'), arrive),
      h('details', { open: !!b.occasional?.length }, h('summary', 'Ara hareketler (dinlenirken arada oynar)'), occ));
  }

  function draw() {
    clear(root,
      h('ol.pose-list', plan.poses.map(poseRow)),
      h('button', { type: 'button', onclick: () => {
        let n = 1; while (plan.poses.some((p) => p.name === `pose_${n}`)) n++;
        plan.poses.push({ name: `pose_${n}`, kind: 'reaction', fps: 12, startsFrom: 'anchor', motion: '' });
        changed(true);
      } }, '+ Poz ekle'),
      behaviorBox());
  }
  draw();
  return root;
}
