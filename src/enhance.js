// Optional interactive enhancements for converted (.pptx) slides.
// Turned on per slide in decks/decks.json, e.g.
//   "enhance": { "5": "carousel", "6": "zoom" }
// carousel: pictures rotate through their positions; the front one zooms.
// zoom:     every picture opens full size when clicked.
// which the build turns into data-enhance="carousel" on that slide.
(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const num = (style, prop) => Number(new RegExp(`${prop}:calc\\((-?[\\d.]+) \\*`).exec(style)?.[1]);
  const u = (n) => `calc(${Math.round(n * 100) / 100} * var(--u))`;

  // ---------------------------------------------------------------- lightbox
  function openLightbox(deck, img) {
    const prevFocus = document.activeElement;
    const box = document.createElement('div');
    box.className = 'enh-lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', img.alt || 'Enlarged image');
    box.innerHTML = `<img src="${img.currentSrc || img.src}" alt="${(img.alt || '').replace(/"/g, '&quot;')}">
      <button type="button" class="enh-lightbox__close" aria-label="Close enlarged image">✕</button>`;
    const close = () => {
      box.remove();
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.({ preventScroll: true });
    };
    // While open, Esc closes it, focus stays on the close button, and the
    // slide navigation keys do nothing (so the deck doesn't change slides).
    const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'PageUp', 'PageDown', 'Home', 'End', 'p', 'f'];
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'Tab') box.querySelector('button').focus();
      else if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.enh-lightbox__close')) close();
      else if (!NAV_KEYS.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.enh-lightbox__close')) close(); });
    document.addEventListener('keydown', onKey, true);
    // Inside the deck element so it also shows in full-screen presenting.
    deck.append(box);
    box.querySelector('button').focus({ preventScroll: true });
  }

  // A picture's positioned box is its .el wrapper, or the outer wrapper when
  // the converter added one for a drop shadow.
  const pictures = (slide) => [...slide.querySelectorAll('.el')]
    .filter((el) => el.querySelector(':scope > .pic-clip > img.pic'))
    .map((el) => (el.parentElement.classList.contains('el') ? el.parentElement : el));

  // The slide gains interactive content, so it can't stay a single image to
  // assistive technology; keep its label.
  const makeInteractive = (slide) => slide.setAttribute('role', 'group');

  // ---------------------------------------------------------------- zoom
  // Every picture on the slide opens full size when clicked.
  function zoom(frame) {
    const deck = frame.closest('[data-deck]') || document.body;
    const slide = frame.querySelector('.slide');
    const items = pictures(slide);
    if (!items.length) return;
    makeInteractive(slide);
    for (const el of items) {
      const img = el.querySelector('img');
      el.classList.add('enh-zoomable');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Enlarge ${img.alt || 'image'}`);
      el.addEventListener('click', (e) => { e.stopPropagation(); openLightbox(deck, img); });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openLightbox(deck, img); }
      });
    }
  }

  // ---------------------------------------------------------------- carousel
  function carousel(frame) {
    const deck = frame.closest('[data-deck]') || document.body;
    const slide = frame.querySelector('.slide');
    const items = pictures(slide);
    items.forEach((el) => el.classList.add('enh-item'));
    if (items.length < 2) return;

    // Slots are the original picture boxes, in z-order (last = front).
    const parse = (el) => {
      const s = el.getAttribute('style');
      return { x: num(s, 'left'), y: num(s, 'top'), w: num(s, 'width'), h: num(s, 'height') };
    };
    const slots = items.map((el) => {
      const b = parse(el);
      return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, area: b.w * b.h };
    });
    // Each image keeps its own shape wherever it goes.
    const aspects = items.map((el) => { const b = parse(el); return b.w / b.h; });
    const W = Number(slide.style.getPropertyValue('--w')) || 960;
    const H = Number(slide.style.getPropertyValue('--h')) || 540;

    let order = items.map((_, i) => i); // order[slot] = item index
    const front = () => items[order[order.length - 1]];

    function place() {
      order.forEach((itemIndex, slotIndex) => {
        const el = items[itemIndex];
        const slot = slots[slotIndex];
        const a = aspects[itemIndex];
        let w = Math.sqrt(slot.area * a);
        let h = w / a;
        let x = slot.cx - w / 2;
        let y = slot.cy - h / 2;
        // Keep inside the slide with a small margin.
        x = Math.min(Math.max(x, 24), W - 24 - w);
        y = Math.min(Math.max(y, 24), H - 24 - h);
        Object.assign(el.style, { left: u(x), top: u(y), width: u(w), height: u(h) });
        el.style.zIndex = String(slotIndex + 1);
        const isFront = slotIndex === order.length - 1;
        el.classList.toggle('enh-front', isFront);
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        const alt = el.querySelector('img').alt;
        el.setAttribute('aria-label', isFront ? `Enlarge ${alt || 'image'}` : `Bring ${alt || 'image'} to the front`);
      });
    }

    function rotate(dir = 1) {
      // Every image moves one slot; the front image moves to the back.
      order = dir > 0 ? [order.at(-1), ...order.slice(0, -1)] : [...order.slice(1), order[0]];
      place();
    }
    function bringToFront(el) {
      const idx = items.indexOf(el);
      while (order.at(-1) !== idx) rotate(1);
    }

    // Arrows on either side of the pictures, vertically centred on them.
    const bounds = slots.map((sl) => sl.cy);
    const midY = (Math.min(...bounds) + Math.max(...bounds)) / 2;
    const arrow = (dir, label, glyph) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `enh-carousel-arrow enh-carousel-arrow--${dir}`;
      b.setAttribute('aria-label', label);
      b.style.top = u(midY);
      b.textContent = glyph;
      slide.append(b);
      return b;
    };
    const prevBtn = arrow('prev', 'Previous image', '‹');
    const nextBtn = arrow('next', 'Next image', '›');
    slide.classList.add('enh-carousel');
    makeInteractive(slide);

    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); rotate(-1); restart(); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); rotate(1); restart(); });
    for (const el of items) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el === front()) openLightbox(deck, el.querySelector('img'));
        else { bringToFront(el); restart(); }
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); el.click(); }
      });
    }

    // Auto-rotate while the slide is shown; pause on hover or focus.
    let timer = null;
    let paused = false;
    const visible = () => !frame.hidden && document.visibilityState === 'visible';
    function restart() {
      clearInterval(timer);
      if (reduceMotion) return;
      timer = setInterval(() => { if (!paused && visible() && !deck.querySelector('.enh-lightbox')) rotate(1); }, 3500);
    }
    slide.addEventListener('pointerenter', () => { paused = true; });
    slide.addEventListener('pointerleave', () => { paused = false; });
    slide.addEventListener('focusin', () => { paused = true; });
    slide.addEventListener('focusout', () => { paused = false; });

    place();
    restart();
  }

  const ENHANCERS = { carousel, zoom };
  for (const frame of document.querySelectorAll('[data-enhance]')) {
    for (const name of frame.dataset.enhance.split(/\s+/)) ENHANCERS[name]?.(frame);
  }
})();
