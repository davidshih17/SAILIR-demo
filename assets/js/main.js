import { $, whenNear } from './ui.js';
import { glyph } from './glyph.js';

// Theme toggle.  The default follows the system setting.
const root = document.documentElement;
const themeBtn = $('#theme');
const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
const syncTheme = () => { themeBtn.textContent = isDark() ? 'Light' : 'Dark'; };
try { const saved = localStorage.getItem('sailir-theme'); if (saved) root.dataset.theme = saved; } catch { /* storage unavailable */ }
themeBtn.addEventListener('click', () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('sailir-theme', root.dataset.theme); } catch { /* storage unavailable */ }
  syncTheme();
});
syncTheme();

$('#hero-glyph').append(glyph([1, 1, 2, 1, 1, 1, -2], { size: 460, labels: true }));
$('#hero-glyph svg').style.maxWidth = '100%';
$('#hero-glyph svg').style.height = 'auto';

// Highlight the section in view; number keys 1-8 jump between sections.
const links = [...document.querySelectorAll('#topnav a')];
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    links.forEach((a) => a.classList.toggle('on', a.hash === `#${e.target.id}`));
    links.find((a) => a.hash === `#${e.target.id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}, { rootMargin: '-30% 0px -65% 0px' });
links.forEach((a) => spy.observe(document.querySelector(a.hash)));
addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= links.length) links[n - 1].click();
});

const SECTIONS = { play: './play.js', scramble: './scramble.js', data: './explorer.js', model: './anatomy.js', train: './training.js', beam: './beam.js', tree: './tree.js', results: './results.js' };
for (const [id, path] of Object.entries(SECTIONS)) whenNear(id, async () => (await import(path)).default());
