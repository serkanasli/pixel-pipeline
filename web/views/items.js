// Home: the items of the working folder with where each one stands.
import { api, fileUrl } from '../api.js';
import { clear, errorCard, h, nextStep, PACKAGE } from '../ui.js';

export async function render(mount) {
  const config = await api.get('/api/config');
  if (!config.workspace || !config.workspaceFound) { location.hash = '#/setup'; return; }
  const list = h('div.cards');
  const head = h('div.page-head',
    h('div', h('h1', 'Öğeler'), h('p.muted', h('span', 'Çalışma klasörü: '), h('code', config.workspace), ' · ', h('a', { href: '#/setup' }, 'değiştir'))),
    h('a.button.primary', { href: '#/new' }, 'Yeni öğe'));
  mount.append(head, ...(config.ffmpeg.ok ? [] : [errorCard({ message: config.ffmpeg.error }, 'ffmpeg bulunamadı')]), list);

  async function fill() {
    const { items } = await api.get('/api/items');
    clear(list);
    if (!items.length) {
      list.append(h('div.empty', h('p', 'Bu klasörde henüz öğe yok.'), h('a.button.primary', { href: '#/new' }, 'İlk öğeyi oluştur')));
      return;
    }
    for (const it of items) {
      const href = `#/item/${encodeURIComponent(it.dir)}`;
      if (it.error) {
        list.append(h('a.card.bad', { href }, h('h2', it.dir), h('p.error-text', it.error), h('p.muted', 'Düzeltmek için aç')));
        continue;
      }
      const n = nextStep(it.dir, it.next);
      list.append(h('a.card', { href },
        h('div.thumb', it.thumb ? h('img', { src: fileUrl(it.dir, it.thumb), alt: '', loading: 'lazy' }) : h('span.muted', 'görsel yok')),
        h('div.card-body',
          h('h2', it.name?.tr ?? it.name?.en ?? it.dir),
          h('p.muted', h('code', it.id), ` · ${it.type}`, it.template ? ` · ${it.template}` : ''),
          h('p.badges',
            it.posesTotal ? h(`span.badge${it.posesDone === it.posesTotal ? '.ok' : ''}`, `${it.posesDone}/${it.posesTotal} poz hazır`) : null,
            it.layersTotal ? h(`span.badge${it.layersDone === it.layersTotal ? '.ok' : ''}`, `${it.layersDone}/${it.layersTotal} katman hazır`) : null,
            h(`span.badge.${it.package.state}`, PACKAGE[it.package.state] + (it.package.packageKB ? ` · ${it.package.packageKB} KB` : ''))),
          h('p.next-line', h('span.k', 'Sıradaki: '), n.text))));
    }
  }
  await fill();
  return { update: fill };
}
