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

  // ---------------------------------------------------------------- terminal
  // Replaces a terminal screenshot with a live terminal that plays a scripted
  // CLI session, then loops. "terminal:<script>" picks the script.
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const TERMINAL_SCRIPTS = {
    // create-intapp-app's guided interview (CLI case study, slides 7–9, 15).
    'create-intapp-app': {
      title: 'aimeemaroney — node ~/.nvm/versions/node/v24.19.0/bin/create-intapp-app — 120×30',
      label: 'Animated terminal: create-intapp-app asks whether you work solo or with a team, the project name, '
        + 'what you are building, the product and framework, a layout, Vitest and the Azure DevOps project, '
        + 'then scaffolds the project with the design system and AI context files.',
      steps: [
        { out: 'Last login: Tue Aug 25 17:02:22 on ttys000' },
        { cmd: 'create-intapp-app', prompt: 'aimeemaroney@Aimees-Air-2 ~ % ' },
        { out: '' },
        { out: '  <span class="t-accent t-b">create-intapp-app</span>' },
        { out: '  <span class="t-dim">Scaffold a new Intapp frontend project</span>' },
        { out: '<span class="t-rule"></span>' },
        { out: '  <span class="t-b">Let\'s set up your project</span>' },
        { out: '<span class="t-rule"></span>', wait: 500 },
        { select: 'Will anyone else be working in this repo with you?', options: [
          ['Individual', 'This project will be managed by me with no other contributors to the code base'],
          ['Team', 'Teammates will contribute, so you\'ll get branching and review guidance'],
        ], path: [1, 0] },
        { input: 'Project name:', value: 'aimee-timesheet-redesign' },
        { spin: 'Checking Azure DevOps for an existing repo…', done: 'Name is available' },
        { select: 'What are you building?', options: [
          ['Prototype', 'Explore an idea quickly. Vanilla JS is recommended'],
          ['App', 'A feature headed to engineering, built on a product framework'],
        ], path: [1] },
        { select: 'Which product is it for?', options: [
          ['Time'], ['DealCloud'], ['Billstream'], ['Compliance'], ['Termsheet'], ['Celeste'], ['Standalone'], ['Other'],
        ], path: [] },
        { select: 'Framework', options: [
          ['React 18 (Vite)', 'Recommended for Time'],
          ['Next.js (App Router)'],
          ['Vanilla JS'],
        ], path: [] },
        { select: 'Layout template', options: [['Dashboard'], ['Blank canvas']], path: [] },
        { input: 'Add Vitest for unit tests? <span class="t-dim">(y/N)</span>', value: 'y', answer: 'Yes' },
        { select: 'Which Azure DevOps project?', options: [['Time'], ['Platform'], ['Design Prototypes']], path: [] },
        { out: '' },
        { spin: 'Copying the React 18 template…', done: 'Template copied' },
        { spin: 'Installing @uds/* design system packages…', done: 'Design system installed', ms: 1400 },
        { out: '<span class="t-ok">✔</span> CLAUDE.md written', wait: 220 },
        { out: '<span class="t-ok">✔</span> .github/copilot-instructions.md written', wait: 220 },
        { out: '<span class="t-ok">✔</span> .cursor/rules/ids.mdc written', wait: 220 },
        { out: '<span class="t-ok">✔</span> PreToolUse UDS guard hook wired', wait: 220 },
        { spin: 'Registering the Azure DevOps repo and pipeline…', done: 'Repo and pipeline registered' },
        { out: '' },
        { out: '<span class="t-ok t-b">Done!</span> Next steps:' },
        { out: '  <span class="t-accent">cd aimee-timesheet-redesign</span>' },
        { out: '  <span class="t-accent">npm run dev</span>' },
        { out: '' },
        { prompt: 'aimeemaroney@Aimees-Air-2 ~ % ', end: true },
      ],
    },
  };

  function terminal(frame, scriptName) {
    const script = TERMINAL_SCRIPTS[scriptName] || Object.values(TERMINAL_SCRIPTS)[0];
    const slide = frame.querySelector('.slide');
    const el = pictures(slide)[0];
    const clip = el?.querySelector('.pic-clip');
    if (!clip) return;
    makeInteractive(slide);
    clip.querySelector('img').hidden = true;
    clip.insertAdjacentHTML('beforeend', `
      <div class="enh-term" role="img" aria-label="${esc(script.label)}">
        <div class="enh-term__bar" aria-hidden="true"><i></i><i></i><i></i><span>${esc(script.title)}</span></div>
        <div class="enh-term__body" aria-hidden="true"><div class="enh-term__lines"></div></div>
      </div>`);
    const linesEl = clip.querySelector('.enh-term__lines');
    const body = clip.querySelector('.enh-term__body');
    // Follow the newest output.
    new ResizeObserver(() => { body.scrollTop = body.scrollHeight; }).observe(linesEl);
    const CURSOR = '<span class="t-cursor"></span>';

    let run = 0; // bumping this cancels the session in progress
    const sleep = (ms, id) => new Promise((res, rej) => setTimeout(() => (id === run ? res() : rej(new Error('stop'))), ms));
    const add = (html = '') => { const d = document.createElement('div'); d.innerHTML = html || '&nbsp;'; linesEl.append(d); return d; };
    // Keep the last screenful, like a real terminal scrolling.
    const trim = () => { while (linesEl.children.length > 80) linesEl.firstChild.remove(); };

    async function play(id, fast) {
      const t = (ms) => (fast ? Promise.resolve() : sleep(ms, id));
      linesEl.textContent = '';
      for (const s of script.steps) {
        if (id !== run) return;
        trim();
        if ('out' in s) { add(s.out); await t(s.wait ?? 90); }
        else if (s.cmd) {
          const line = add(esc(s.prompt) + CURSOR);
          await t(700);
          for (let i = 1; i <= s.cmd.length; i += 1) { line.innerHTML = esc(s.prompt) + esc(s.cmd.slice(0, i)) + CURSOR; await t(55 + Math.random() * 60); }
          await t(450);
          line.innerHTML = esc(s.prompt) + esc(s.cmd);
          await t(500);
        } else if (s.select) {
          // An @inquirer/prompts-style list: the cursor moves along `path`, then
          // the prompt collapses into its answer.
          const block = add();
          let at = 0;
          const draw = () => {
            const desc = s.options[at][1];
            block.innerHTML = [`<span class="t-accent">?</span> <span class="t-b">${s.select}</span>`,
              ...s.options.map(([o], i) => (i === at ? `<span class="t-accent">❯ ${esc(o)}</span>` : `  ${esc(o)}`)),
              desc ? `<span class="t-accent">${esc(desc)}</span>` : null,
              '<span class="t-dim"><b>↑↓</b> navigate • <b>⏎</b> select</span>'].filter((x) => x !== null).join('\n');
          };
          draw();
          await t(1100);
          for (const target of s.path) {
            while (at !== target) { at += target > at ? 1 : -1; draw(); await t(380); }
            await t(650);
          }
          await t(350);
          block.innerHTML = `<span class="t-ok">✔</span> <span class="t-b">${s.select}</span> <span class="t-accent">${esc(s.options[at][0])}</span>`;
          await t(300);
        } else if (s.input) {
          const line = add();
          const head = `<span class="t-accent">?</span> <span class="t-b">${s.input}</span> `;
          line.innerHTML = head + CURSOR;
          await t(600);
          for (let i = 1; i <= s.value.length; i += 1) { line.innerHTML = head + esc(s.value.slice(0, i)) + CURSOR; await t(45 + Math.random() * 55); }
          await t(500);
          const asked = s.input.replace(/\s*<span class="t-dim">.*?<\/span>/, ''); // drop hints like (y/N)
          line.innerHTML = `<span class="t-ok">✔</span> <span class="t-b">${asked}</span> <span class="t-accent">${esc(s.answer || s.value)}</span>`;
          await t(300);
        } else if (s.spin) {
          const line = add();
          const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
          const end = s.ms ?? 1000;
          for (let n = 0; n * 80 < end && !fast; n += 1) { line.innerHTML = `<span class="t-accent">${frames[n % frames.length]}</span> ${esc(s.spin)}`; await t(80); }
          line.innerHTML = `<span class="t-ok">✔</span> ${esc(s.done)}`;
          await t(200);
        } else if (s.end) {
          add(esc(s.prompt) + CURSOR);
        }
      }
      if (fast) return;
      await t(5000);
      play(id, false).catch(() => {}); // loop
    }

    const start = () => {
      run += 1;
      const id = run;
      play(id, reduceMotion).catch(() => {});
    };
    const stop = () => { run += 1; };
    frame.addEventListener('deck-slide-shown', start);
    // The viewer hides other slides; stop playing when this one is hidden.
    new MutationObserver(() => { if (frame.hidden) stop(); }).observe(frame, { attributes: true, attributeFilter: ['hidden'] });
    if (!frame.hidden) start();
  }

  // ---------------------------------------------------------------- blocked
  // Marks every card on the slide (a filled rectangle at least 100 × 60) with
  // a "not allowed" icon in its top-right corner.
  function blocked(frame) {
    const slide = frame.querySelector('.slide');
    const box = (el) => { const s = el.getAttribute('style'); return { x: num(s, 'left'), y: num(s, 'top'), w: num(s, 'width'), h: num(s, 'height') }; };
    const W = Number(slide.style.getPropertyValue('--w')) || 960;
    const cards = [...slide.querySelectorAll(':scope > .el')]
      .filter((el) => el.querySelector(':scope > svg.geom rect:not([fill="none"])'))
      .map(box)
      .filter((b) => b.w >= 100 && b.h >= 60 && b.w < W * 0.9);
    const names = [];
    for (const c of cards) {
      // The card's title is the first text box inside it.
      const title = [...slide.querySelectorAll(':scope > .el')].find((el) => {
        const b = box(el);
        return el.querySelector('.tx') && b.x >= c.x && b.y >= c.y && b.x < c.x + c.w && b.y < c.y + c.h;
      });
      if (title) names.push(title.textContent.trim());
      const size = 26;
      slide.insertAdjacentHTML('beforeend', `
        <div class="el enh-blocked" aria-hidden="true" style="left:${u(c.x + c.w - size - 18)};top:${u(c.y + 18)};width:${u(size)};height:${u(size)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/>
          </svg>
        </div>`);
    }
    const sr = frame.querySelector('.sr-only');
    if (sr && names.length) sr.textContent += ` Marked as not a fit: ${names.join(', ')}.`;
  }

  const ENHANCERS = { carousel, zoom, terminal, blocked };
  for (const frame of document.querySelectorAll('[data-enhance]')) {
    for (const spec of frame.dataset.enhance.split(/\s+/)) {
      const [name, arg] = spec.split(':');
      ENHANCERS[name]?.(frame, arg);
    }
  }
})();
