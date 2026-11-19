import { $, buildSection } from './ui.js';
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
const nav = $('#topnav');
const links = [...nav.querySelectorAll('a')];
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    links.forEach((a) => a.classList.toggle('on', a.hash === `#${e.target.id}`));
    // On narrow screens keep the active link visible by scrolling the nav bar only, never the page.
    const link = links.find((a) => a.hash === `#${e.target.id}`);
    if (link && nav.scrollWidth > nav.clientWidth) {
      const r = link.getBoundingClientRect(), n = nav.getBoundingClientRect();
      nav.scrollLeft += r.left - n.left - (n.width - r.width) / 2;
    }
  }
}, { rootMargin: '-30% 0px -65% 0px' });
links.forEach((a) => spy.observe(document.querySelector(a.hash)));
addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= links.length) links[n - 1].click();
});

// Sections are built in page order.  Each one reserves about its final height first, so content
// never moves under the reader while the page fills in.  Heights are [desktop, phone] in pixels.
const SECTIONS = {
  play: ['./play.js', 1000, 1778], scramble: ['./scramble.js', 950, 1403], data: ['./explorer.js', 1309, 2500], model: ['./anatomy.js', 1145, 1512],
  train: ['./training.js', 828, 1246], beam: ['./beam.js', 1112, 976], tree: ['./tree.js', 1148, 959], results: ['./results.js', 817, 1921],
};
const phone = innerWidth <= 980;
for (const [id, [, desktop, narrow]] of Object.entries(SECTIONS)) document.getElementById(id).style.minHeight = `${phone ? narrow : desktop}px`;
const idle = () => new Promise((resolve) => (window.requestIdleCallback ? requestIdleCallback(resolve, { timeout: 250 }) : setTimeout(resolve, 40)));
let moved = false;
for (const type of ['wheel', 'touchmove', 'keydown']) addEventListener(type, () => { moved = true; }, { passive: true, once: true });
(async () => {
  for (const [id, [path]] of Object.entries(SECTIONS)) {
    await idle();
    await buildSection(id, async () => (await import(path)).default());
    document.getElementById(id).style.minHeight = '';
  }
  if (location.hash && !moved) document.querySelector(location.hash)?.scrollIntoView();
})();
