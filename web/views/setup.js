// Working folder: the folder whose subfolders are items. Saved to config.local.json by the server.
import { api } from '../api.js';
import { clear, errorCard, h, toast } from '../ui.js';

export async function render(mount) {
  const config = await api.get('/api/config');
  const input = h('input', { type: 'text', value: config.workspace ?? '', placeholder: '/Users/ad/pixel-items', spellcheck: false, autocomplete: 'off' });
  const out = h('div');
  const save = async (e) => {
    e.preventDefault();
    clear(out);
    try {
      await api.put('/api/config', { workspace: input.value.trim() });
      toast('Çalışma klasörü kaydedildi');
      location.hash = '#/';
    } catch (err) { out.append(errorCard(err, 'Kaydedilemedi')); }
  };
  mount.append(h('section.panel.narrow',
    h('h1', 'Çalışma klasörü'),
    h('p', 'Öğelerin bulunduğu klasör. İçindeki her alt klasör bir öğedir (item.json, videolar, başlangıç kareleri, paket). Komut satırı ve yapay zekâ ajanı da aynı klasörlerle çalışır.'),
    h('form.stack', { onsubmit: save },
      h('label.field', h('span', 'Klasörün tam yolu'), input),
      h('p.muted', 'Tarayıcı klasör yolunu okuyamadığı için yolu buraya yaz ya da yapıştır (Finder: klasöre sağ tık, Option basılıyken "Yol olarak kopyala"). Bu ayar yalnızca bu bilgisayarda, depo dışındaki config.local.json dosyasında tutulur.'),
      h('div.row', h('button.primary', { type: 'submit' }, 'Kaydet'), config.workspace ? h('a.button', { href: '#/' }, 'Vazgeç') : null)),
    out,
    !config.ffmpeg.ok ? errorCard({ message: config.ffmpeg.error }, 'ffmpeg bulunamadı') : null));
}
