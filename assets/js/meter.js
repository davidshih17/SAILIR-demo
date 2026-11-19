// Optional scroll meter: open the page with ?meter to see how smoothly this device is scrolling.
const BUILD = 7;
const box = document.createElement('div');
box.className = 'meter';
document.body.append(box);

let long = 0, longMs = 0, supported = false;
try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) { long++; longMs += e.duration; } }).observe({ type: 'longtask' });
  supported = true;
} catch { /* this browser does not report long tasks */ }

const intervals = [];
let lastScroll = -1e9, last = performance.now(), frames = 0, slow = 0, worst = 0;
addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });

function typical() {
  const s = [...intervals].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 16.7;
}

function tick(now) {
  const dt = now - last;
  last = now;
  intervals.push(dt);
  if (intervals.length > 240) intervals.shift();
  if (now - lastScroll < 120) {
    frames++;
    worst = Math.max(worst, dt);
    if (dt > typical() * 1.6) slow++;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

setInterval(() => {
  const model = document.getElementById('play')?.textContent.includes('Model ready') ? 'ready' : 'loading';
  box.textContent = [
    `Build ${BUILD}   ${Math.round(1000 / typical())} Hz   ${devicePixelRatio}x   ${innerWidth}x${innerHeight}`,
    `Frames while scrolling  ${frames}`,
    `Slow frames             ${slow}`,
    `Worst frame             ${Math.round(worst)} ms`,
    `Long tasks              ${supported ? `${long} (${Math.round(longMs)} ms)` : 'not reported'}`,
    `Model                   ${model}`,
  ].join('\n');
}, 500);
