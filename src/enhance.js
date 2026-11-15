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
        { input: 'What do you want to call this project?', value: 'timesheet-redesign' },
        { out: '<span class="t-dim">→ Project will be created as: aimeemaroney-timesheet-redesign</span>' },
        { spin: 'Checking Azure DevOps for an existing repo…', done: 'Name is available' },
        { select: 'What are you building?', options: [
          ['Prototype', 'Experiment, concept, design artifact, or one-off — deploys to Playground'],
          ['App', 'A feature headed to engineering, built on a product framework'],
        ], path: [1] },
        { select: 'Is this standalone or related to an existing product?', options: [
          ['Standalone', 'No specific product — general or new project'], ['Billstream'], ['Time'], ['Compliance'],
          ['DealCloud'], ['Termsheet'], ['Celeste'], ['Other Product'],
        ], path: [2] },
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
        { out: '  <span class="t-accent">cd aimeemaroney-timesheet-redesign</span>' },
        { out: '  <span class="t-accent">npm run dev</span>' },
        { out: '' },
        { prompt: 'aimeemaroney@Aimees-Air-2 ~ % ', end: true },
      ],
    },
  };

  // "terminal:<script>:outline" draws a white rounded outline around the
  // window instead of relying on the picture's own border.
  function terminal(frame, scriptName, variant) {
    const script = TERMINAL_SCRIPTS[scriptName] || Object.values(TERMINAL_SCRIPTS)[0];
    const slide = frame.querySelector('.slide');
    const el = pictures(slide)[0];
    const clip = el?.querySelector('.pic-clip');
    if (!clip) return;
    makeInteractive(slide);
    clip.querySelector('img').hidden = true;
    // Text scales with the window: about 64 type sizes across, like a 120-column
    // terminal shown at slide size.
    const boxW = num(el.getAttribute('style'), 'width');
    if (variant === 'outline') clip.classList.add('enh-term-outline');
    clip.insertAdjacentHTML('beforeend', `
      <div class="enh-term" style="font-size:${u(boxW / 64)}" role="img" aria-label="${esc(script.label)}">
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

  // ---------------------------------------------------------------- iconsearch
  // Portfolio slide 14: the UDS Icon Library panel in the Storybook screenshot
  // becomes live. A search is typed and the real icon list filters as it
  // would in IDS-Icons (src/icon-card.js): substring match on the class name,
  // a clear button while there's a query, a "No results" state, and skeleton
  // icons while SVGs load. Data: enhance-data/ids-icons.json (all names, plus
  // the SVGs the scripted searches show).
  const ICONSEARCH = {
    image: { w: 2048, h: 1052 },          // screenshot size in px
    panel: { x: 531, y: 171, w: 1405 },    // the icon-card panel within it
    version: 'v2.20.0',
    queries: ['calendar', 'user', 'chart'],
    shown: 20,
  };

  let fontsAdded = false;
  function addIconFonts() {
    if (fontsAdded) return;
    fontsAdded = true;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600&family=Source+Code+Pro:wght@400&display=swap';
    document.head.append(l);
  }

  function iconsearch(frame) {
    const cfg = ICONSEARCH;
    const slide = frame.querySelector('.slide');
    const el = pictures(slide)[0];
    const clip = el?.querySelector('.pic-clip');
    const img = clip?.querySelector('img');
    if (!img) return;
    makeInteractive(slide);
    addIconFonts();
    const base = document.querySelector('script[src$="enhance.js"]')?.src.replace(/enhance\.js.*$/, '') || '../';

    // A layer laid over the picture exactly as the image is, so the replica can
    // be positioned in screenshot pixels (1 --ip = 1 screenshot px).
    const boxW = num(el.getAttribute('style'), 'width');
    const imgW = boxW * (parseFloat(img.style.width) / 100);
    const layer = document.createElement('div');
    layer.className = 'enh-is-layer';
    layer.setAttribute('role', 'img');
    layer.setAttribute('aria-label', `Animated UDS Icon Library: searching ${cfg.queries.map((q) => `“${q}”`).join(', ')} filters the icon list as you type.`);
    Object.assign(layer.style, { left: img.style.left, top: img.style.top, width: img.style.width, height: img.style.height });
    layer.style.setProperty('--ip', u(imgW / cfg.image.w));
    const pct = (v, of) => `${(v / of) * 100}%`;
    layer.innerHTML = `
      <div class="enh-is" aria-hidden="true" style="left:${pct(cfg.panel.x, cfg.image.w)};top:${pct(cfg.panel.y, cfg.image.h)};width:${pct(cfg.panel.w, cfg.image.w)}">
        <div class="enh-is__header"><h3>UDS Icon Library</h3><span class="enh-is__version">${cfg.version}</span></div>
        <div class="enh-is__search">
          <span class="enh-is__search-icon"></span>
          <span class="enh-is__input"><span class="enh-is__placeholder">Search for an icon...</span><span class="enh-is__text"></span><span class="enh-is__caret"></span></span>
          <span class="enh-is__clear" hidden><svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></span>
        </div>
        <div class="enh-is__results"></div>
      </div>`;
    layer.hidden = true;
    clip.append(layer);

    const $ = (s) => layer.querySelector(s);
    const search = $('.enh-is__search');
    const text = $('.enh-is__text');
    const placeholder = $('.enh-is__placeholder');
    const clearBtn = $('.enh-is__clear');
    const results = $('.enh-is__results');

    let data = null;
    let run = 0;
    const sleep = (ms, id) => new Promise((res, rej) => setTimeout(() => (id === run ? res() : rej(new Error('stop'))), ms));

    // Render the filtered list. Cards that weren't already showing start as
    // skeletons, then their SVG "loads" (as the real page fetches them).
    let showing = [];
    function render(query, animate) {
      const list = data.names.filter((n) => n.toLowerCase().includes(query)).slice(0, cfg.shown);
      if (!list.length) {
        results.innerHTML = `<div class="enh-is__empty"><p>No results found for "${esc(query)}"</p><p class="enh-is__count">0 icons match your search</p></div>`;
        showing = [];
        return;
      }
      const before = new Set(showing);
      results.innerHTML = `<div class="enh-is__grid">${list.map((n) => {
        const fresh = animate && !before.has(n);
        return `<div class="enh-is__card${fresh ? ' is-new' : ''}"><div class="enh-is__icon${fresh ? ' is-loading' : ''}" data-icon="${n}">${fresh ? '' : data.svgs[n] || ''}</div><code>.${n}</code></div>`;
      }).join('')}</div>`;
      showing = list;
      if (animate) {
        results.querySelectorAll('.is-loading').forEach((icon, i) => setTimeout(() => {
          icon.classList.remove('is-loading');
          icon.innerHTML = data.svgs[icon.dataset.icon] || '';
        }, 160 + i * 25));
      }
    }

    function setQuery(q) {
      text.textContent = q;
      placeholder.hidden = !!q;
      clearBtn.hidden = !q;
    }

    async function play(id) {
      setQuery('');
      search.classList.remove('is-focused');
      render('', false);
      await sleep(1800, id);
      for (const q of cfg.queries) {
        search.classList.add('is-focused');
        await sleep(400, id);
        for (let i = 1; i <= q.length; i += 1) {
          setQuery(q.slice(0, i));
          render(q.slice(0, i), true);
          await sleep(170 + Math.random() * 90, id);
        }
        await sleep(2600, id);
        // Clear with the × button, as on the real page.
        clearBtn.classList.add('is-pressed');
        await sleep(260, id);
        clearBtn.classList.remove('is-pressed');
        setQuery('');
        render('', true);
        await sleep(1300, id);
      }
      search.classList.remove('is-focused');
      await sleep(1500, id);
      play(id).catch(() => {});
    }

    const start = async () => {
      run += 1;
      const id = run;
      if (!data) {
        try { data = await (await fetch(`${base}enhance-data/ids-icons.json`)).json(); } catch { return; }
        $('.enh-is__search-icon').innerHTML = data.svgs['ids-icon-search'] || '';
        layer.hidden = false; // the screenshot shows until the data arrives
      }
      if (id !== run) return;
      if (reduceMotion) { render('', false); return; }
      play(id).catch(() => {});
    };
    frame.addEventListener('deck-slide-shown', start);
    new MutationObserver(() => { if (frame.hidden) run += 1; }).observe(frame, { attributes: true, attributeFilter: ['hidden'] });
    if (!frame.hidden) start();
  }

  // ---------------------------------------------------------------- tokens
  // Portfolio slide 13: the UDS Token Visualizer (IDS packages/tokens) in the
  // screenshot becomes live, showing the Button tokens. A token card is clicked to open its detail view
  // ("Referenced by N tokens"), then the app switches to dark mode and every
  // value, alias and reference count swaps. Data comes from the app's own
  // tokenUtils (enhance-data/ids-tokens.json); sizes are the app's CSS sizes.
  const TOKENS = {
    image: { w: 2048, h: 937 },
    main: { x: 387 },        // the right panel (everything but the sidebar)
    scale: 1.38,             // screenshot px per app CSS px
  };

  function tokens(frame) {
    const cfg = TOKENS;
    const slide = frame.querySelector('.slide');
    const el = pictures(slide)[0];
    const clip = el?.querySelector('.pic-clip');
    const img = clip?.querySelector('img');
    if (!img) return;
    makeInteractive(slide);
    addIconFonts();
    const base = document.querySelector('script[src$="enhance.js"]')?.src.replace(/enhance\.js.*$/, '') || '../';

    const boxW = num(el.getAttribute('style'), 'width');
    const imgW = boxW * (parseFloat(img.style.width) / 100);
    const layer = document.createElement('div');
    layer.className = 'enh-is-layer';
    layer.hidden = true;
    layer.setAttribute('role', 'img');
    layer.setAttribute('aria-label', 'Animated UDS Token Visualizer: the Button tokens; clicking color.button.primary.text.default shows the 12 tokens that reference it, then dark mode swaps every value and alias.');
    Object.assign(layer.style, { left: img.style.left, top: img.style.top, width: img.style.width, height: img.style.height });
    // 1 --ap = 1 CSS px of the app as captured in the screenshot.
    layer.style.setProperty('--ap', u((imgW / cfg.image.w) * cfg.scale));
    layer.innerHTML = `
      <div class="enh-tk" aria-hidden="true" style="left:${(cfg.main.x / cfg.image.w) * 100}%">
        <div class="enh-tk__header"><h3>UDS Tokens</h3></div>
        <div class="enh-tk__main"></div>
        <div class="enh-tk__cursor"></div>
      </div>`;
    clip.append(layer);
    const app = layer.querySelector('.enh-tk');
    const main = layer.querySelector('.enh-tk__main');
    const cursor = layer.querySelector('.enh-tk__cursor');

    let data = null;
    let mode = 'light';
    let run = 0;
    const sleep = (ms, id) => new Promise((res, rej) => setTimeout(() => (id === run ? res() : rej(new Error('stop'))), ms));

    const card = (t, attrs = '') => `
      <div class="enh-tk__card" ${attrs}>
        <div class="enh-tk__swatch" style="background:${esc(t.value)}"></div>
        <div class="enh-tk__info">
          <div class="enh-tk__name">${esc(t.name)}</div>
          ${t.ref ? `<div class="enh-tk__ref">${esc(t.ref)}</div>` : ''}
          <div class="enh-tk__value">${esc(t.value)}</div>
          <div class="enh-tk__badges">${t.count > 0 ? `<span class="enh-tk__count">${t.count}</span>` : '<span class="enh-tk__unref">Not referenced</span>'}</div>
        </div>
      </div>`;

    function setMode(m) {
      mode = m;
      app.dataset.mode = m;
      const th = data[m].theme;
      Object.entries({
        '--tk-surface': th['surface.primary'], '--tk-bg': th['surface.secondary'], '--tk-text': th['text.primary.enabled'],
        '--tk-text-2': th['text.secondary.enabled'], '--tk-border': th['border.light'], '--tk-link': data[m].link,
      }).forEach(([k, v]) => app.style.setProperty(k, v));
    }

    function overview(changed) {
      const d = data[mode];
      main.innerHTML = `
        <div class="enh-tk__section"><h4>${esc(d.section.title)}</h4><span class="enh-tk__tag">${esc(d.section.tag)}</span></div>
        <div class="enh-tk__stats">
          <div class="enh-tk__stat"><b>${d.stats.total}</b><span>Total tokens</span></div>
          <div class="enh-tk__stat"><b>${d.stats.groups}</b><span>Groups</span></div>
        </div>
        <div class="enh-tk__group-label"><span>${esc(d.group.label)}</span><span class="enh-tk__count">${d.group.tokens.length}</span></div>
        <div class="enh-tk__grid">${d.group.tokens.map((t) => card(t, `${t.name === d.detail.selected.name ? 'data-target' : ''}${changed ? ' data-changed' : ''}`)).join('')}</div>`;
    }

    function detail() {
      const d = data[mode].detail;
      main.innerHTML = `
        <div class="enh-tk__back" data-back>← Back</div>
        <div class="enh-tk__label">Selected token</div>
        <div class="enh-tk__featured">${card(d.selected)}</div>
        <div class="enh-tk__label">Referenced by ${d.usage.length} token${d.usage.length !== 1 ? 's' : ''}</div>
        <div class="enh-tk__grid enh-tk__grid--in">${d.usage.map((t, i) => card(t, `style="animation-delay:${i * 35}ms"`)).join('')}</div>`;
    }

    // A pointer moves to an element inside the app and clicks it.
    async function clickOn(target, id) {
      const a = app.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const ap = a.width / app.offsetWidth; // rendered px per layout px
      cursor.style.left = `${(r.left - a.left + Math.min(r.width * 0.5, 120 * ap)) / ap}px`;
      cursor.style.top = `${(r.top - a.top + r.height * 0.45) / ap}px`;
      cursor.classList.add('is-visible');
      await sleep(900, id);
      target.classList.add('is-hover');
      await sleep(350, id);
      cursor.classList.add('is-down');
      await sleep(160, id);
      cursor.classList.remove('is-down');
      await sleep(120, id);
    }

    async function play(id) {
      setMode('light');
      overview(false);
      cursor.classList.remove('is-visible');
      cursor.style.left = '70%';
      cursor.style.top = '80%';
      await sleep(1600, id);
      await clickOn(main.querySelector('[data-target]'), id);
      detail();
      await sleep(3600, id);
      await clickOn(main.querySelector('[data-back]'), id);
      overview(false);
      await sleep(900, id);
      cursor.classList.remove('is-visible');
      await sleep(500, id);
      // Dark mode: a data-attribute switch, every token swaps.
      setMode('dark');
      overview(true);
      await sleep(3800, id);
      await clickOn(main.querySelector('[data-target]'), id);
      detail();
      await sleep(3200, id);
      cursor.classList.remove('is-visible');
      setMode('light');
      overview(true);
      await sleep(1200, id);
      play(id).catch(() => {});
    }

    const start = async () => {
      run += 1;
      const id = run;
      if (!data) {
        try { data = await (await fetch(`${base}enhance-data/ids-tokens.json`)).json(); } catch { return; }
        setMode('light');
        overview(false);
        layer.hidden = false; // the screenshot shows until the data arrives
      }
      if (id !== run || reduceMotion) return;
      play(id).catch(() => {});
    };
    frame.addEventListener('deck-slide-shown', start);
    new MutationObserver(() => { if (frame.hidden) run += 1; }).observe(frame, { attributes: true, attributeFilter: ['hidden'] });
    if (!frame.hidden) start();
  }

  // ---------------------------------------------------------------- screens
  // A picture of an app becomes a click-through: a pointer clicks real
  // targets and the screen crossfades to the next captured screen.
  // "screens:<flow>" picks the flow. Screens live in enhance-data/<flow>/;
  // targets are fractions of the screen (x, y, w, h), measured in the app.
  const SCREEN_FLOWS = {
    // CLI deck slide 11: the project create-intapp-app scaffolds
    // (captured from a scaffolded project at 1720 × 908).
    scaffold: {
      label: 'Animated scaffolded project: from the Your Projects landing page, Dashboard Designs opens the Generic Dashboard template, which switches to dark mode; then Patterns opens the Basic Form pattern in a modal.',
      start: 'home',
      steps: [
        { wait: 1800 },
        { click: { x: 0.079, y: 0.238, w: 0.203, h: 0.380 }, to: 'dashboards' },
        { wait: 1300 },
        { click: { x: 0.398, y: 0.282, w: 0.203, h: 0.141 }, to: 'generic' },
        { wait: 1600 },
        { click: { x: 0.965, y: 0.011, w: 0.026, h: 0.048 }, to: 'generic-dark', fade: 500 },
        { wait: 2200 },
        { go: 'home' },
        { wait: 1000 },
        { click: { x: 0.292, y: 0.238, w: 0.203, h: 0.380 }, to: 'patterns' },
        { wait: 1300 },
        { click: { x: 0.398, y: 0.282, w: 0.203, h: 0.141 }, to: 'form', fade: 400 },
        { wait: 2800 },
        { go: 'home' },
      ],
    },
  };

  function screens(frame, flowName) {
    const flow = SCREEN_FLOWS[flowName];
    const slide = frame.querySelector('.slide');
    const el = pictures(slide)[0];
    const clip = el?.querySelector('.pic-clip');
    const img = clip?.querySelector('img');
    if (!flow || !img) return;
    makeInteractive(slide);
    const base = document.querySelector('script[src$="enhance.js"]')?.src.replace(/enhance\.js.*$/, '') || '../';
    const names = [...new Set([flow.start, ...flow.steps.map((s) => s.to || s.go).filter(Boolean)])];

    const layer = document.createElement('div');
    layer.className = 'enh-sc';
    layer.setAttribute('role', 'img');
    layer.setAttribute('aria-label', flow.label);
    layer.innerHTML = names.map((n) => `<img src="${base}enhance-data/${flowName}/${n}.jpg" alt="" data-screen="${n}" decoding="async">`).join('')
      + '<span class="enh-sc__hit"></span><span class="enh-sc__cursor"></span>';
    clip.append(layer);
    const shots = Object.fromEntries([...layer.querySelectorAll('[data-screen]')].map((i) => [i.dataset.screen, i]));
    const cursor = layer.querySelector('.enh-sc__cursor');
    const hit = layer.querySelector('.enh-sc__hit');

    let run = 0;
    const sleep = (ms, id) => new Promise((res, rej) => setTimeout(() => (id === run ? res() : rej(new Error('stop'))), ms));
    const show = (name, fade = 300) => {
      for (const [n, i] of Object.entries(shots)) {
        i.style.transitionDuration = `${fade}ms`;
        i.classList.toggle('is-shown', n === name);
      }
    };
    const pct = (v) => `${v * 100}%`;

    async function play(id) {
      show(flow.start, 0);
      cursor.classList.remove('is-visible');
      Object.assign(cursor.style, { left: '62%', top: '78%' });
      for (const s of flow.steps) {
        if (s.wait) await sleep(s.wait, id);
        if (s.go) { cursor.classList.remove('is-visible'); show(s.go, 450); await sleep(450, id); }
        if (s.click) {
          const r = s.click;
          Object.assign(cursor.style, { left: pct(r.x + r.w / 2), top: pct(r.y + r.h / 2) });
          cursor.classList.add('is-visible');
          await sleep(950, id);
          // Hover outline on the target, then the click.
          Object.assign(hit.style, { left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });
          hit.classList.add('is-on');
          await sleep(350, id);
          cursor.classList.add('is-down');
          await sleep(150, id);
          cursor.classList.remove('is-down');
          hit.classList.remove('is-on');
          show(s.to, s.fade);
          await sleep(s.fade ?? 300, id);
        }
      }
      play(id).catch(() => {});
    }

    const start = () => {
      run += 1;
      const id = run;
      if (reduceMotion) { show(flow.start, 0); return; }
      play(id).catch(() => {});
    };
    frame.addEventListener('deck-slide-shown', start);
    new MutationObserver(() => { if (frame.hidden) { run += 1; show(flow.start, 0); } }).observe(frame, { attributes: true, attributeFilter: ['hidden'] });
    show(flow.start, 0);
    if (!frame.hidden) start();
  }

  const ENHANCERS = { carousel, zoom, terminal, blocked, iconsearch, tokens, screens };
  for (const frame of document.querySelectorAll('[data-enhance]')) {
    for (const spec of frame.dataset.enhance.split(/\s+/)) {
      const [name, ...args] = spec.split(':');
      ENHANCERS[name]?.(frame, ...args);
    }
  }
})();
