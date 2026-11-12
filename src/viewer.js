// Deck page: one slide at a time. ← / → (and swipe) move between slides;
// "Present" goes full screen.
(() => {
  const deck = document.querySelector('[data-deck]');
  const stage = deck.querySelector('.stage');
  const frames = [...deck.querySelectorAll('.slide-frame')];
  const counter = deck.querySelector('[data-counter]');
  const prevBtn = deck.querySelector('[data-prev]');
  const nextBtn = deck.querySelector('[data-next]');
  let current = -1;
  let idleTimer;

  const eager = (frame) => frame?.querySelectorAll('img[loading]').forEach((img) => img.removeAttribute('loading'));

  function show(i, { updateHash = true } = {}) {
    const next = Math.max(0, Math.min(frames.length - 1, i));
    if (next === current) return;
    current = next;
    frames.forEach((f, n) => { f.hidden = n !== current; });
    eager(frames[current]);
    eager(frames[current + 1]);
    eager(frames[current - 1]);
    counter.textContent = `${current + 1} / ${frames.length}`;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === frames.length - 1;
    if (updateHash) history.replaceState(null, '', `#${current + 1}`);
    // Lets live components on the slide restore their starting state.
    frames[current].dispatchEvent(new CustomEvent('deck-slide-shown', { bubbles: true }));
  }

  function fromHash() {
    const n = parseInt(location.hash.slice(1), 10);
    return Number.isFinite(n) ? n - 1 : 0;
  }

  function wake() {
    deck.classList.remove('idle');
    clearTimeout(idleTimer);
    if (document.fullscreenElement) idleTimer = setTimeout(() => deck.classList.add('idle'), 2500);
  }

  prevBtn.addEventListener('click', () => show(current - 1));
  nextBtn.addEventListener('click', () => show(current + 1));

  document.querySelector('[data-present]').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else deck.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', wake);
  deck.addEventListener('mousemove', wake);

  // In full screen, clicking the slide advances (left third goes back).
  stage.addEventListener('click', (e) => {
    if (!document.fullscreenElement || e.target.closest('a, button, [role="menu"], uds-menu, uds-overflow-menu')) return;
    const r = stage.getBoundingClientRect();
    show(current + (e.clientX - r.left < r.width / 3 ? -1 : 1));
  });

  // Ignore keys while the user is typing. Use isContentEditable rather than a
  // [contenteditable] selector: browser extensions often add
  // contenteditable="false" to <body>, which a selector would match.
  const isTyping = (t) =>
    t instanceof Element && (t.isContentEditable || t.matches('input, textarea, select'));

  document.addEventListener('keydown', (e) => {
    // Interactive components on a slide (e.g. a menu) handle their own keys
    // and mark them handled.
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const k = e.key;
    // Space on a focused button or link activates it; don't also change slide.
    if (k === ' ' && e.target instanceof Element && e.target.closest('button, a, [role^="menuitem"]')) return;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') show(current + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp') show(current - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(frames.length - 1);
    else if (k === 'p' || k === 'f') document.querySelector('[data-present]').click();
    else return;
    e.preventDefault();
    wake();
  });

  // Swipe on touch screens.
  let touch = null;
  stage.addEventListener('touchstart', (e) => {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) show(current + (dx < 0 ? 1 : -1));
  });

  window.addEventListener('hashchange', () => show(fromHash(), { updateHash: false }));
  show(fromHash(), { updateHash: false });
})();
