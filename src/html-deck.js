// Small behaviours shared by HTML-authored decks.
(() => {
  const demoOf = (node) => node.closest?.('.hd-demo');
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // [data-menu-status]: echo the last menu choice or toggle in this demo.
  function status(e, text) {
    const el = demoOf(e.target)?.querySelector('[data-menu-status]');
    if (el) el.innerHTML = text;
  }
  document.addEventListener('uds-select', (e) => {
    const { label, type } = e.detail;
    status(e, `${type === 'destructive' ? 'Would ask to confirm' : 'Chose'} <b>${escapeHtml(label)}</b>`);
  });
  document.addEventListener('uds-toggle-change', (e) => {
    status(e, `<b>${escapeHtml(e.detail.label)}</b> turned ${e.detail.checked ? 'on' : 'off'} · menu stays open`);
  });

  // [data-event-log]: show the event payload a product engineer would receive,
  // named as in the IDS web components (udsClick / udsToggleChange).
  function logEvent(e, name, detail) {
    const log = demoOf(e.target)?.querySelector('[data-event-log]');
    if (!log) return;
    const body = Object.entries(detail).map(([k, v]) => `  ${k}: ${typeof v === 'string' ? `'${escapeHtml(v)}'` : v}`).join(',\n');
    log.innerHTML = `<span class="hd-code-ev">${name}</span> {\n${body}\n}`;
  }
  document.addEventListener('uds-select', (e) => logEvent(e, 'udsClick', {
    value: e.detail.value, label: e.detail.label, isDestructive: e.detail.type === 'destructive', isToggle: false,
  }));
  document.addEventListener('uds-toggle-change', (e) => logEvent(e, 'udsToggleChange', {
    menuItemValue: e.detail.value, checked: e.detail.checked,
  }));

  // [data-key-log]: show each key pressed inside the demo and where focus went.
  const KEY_NAMES = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', ' ': 'Space', Escape: 'Esc', Tab: 'Tab', Home: 'Home', End: 'End' };
  document.addEventListener('keydown', (e) => {
    const demo = demoOf(e.target);
    const log = demo?.querySelector('[data-key-log]');
    if (!log || !KEY_NAMES[e.key]) return;
    setTimeout(() => {
      const a = document.activeElement;
      let where = 'outside the menu';
      if (demo.contains(a)) {
        if (a.matches('.uds-menu-item')) where = `“${a.querySelector('.uds-menu-item__label')?.textContent}” ${a.getAttribute('role')}`;
        else if (a.matches('.uds-overflow__trigger')) where = `trigger (${a.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed'})`;
        else if (a.matches('.uds-menu__search-input')) where = 'search field';
        else if (a.matches('.uds-menu__back')) where = 'back button';
        else where = a.textContent.trim() || a.localName;
      }
      log.innerHTML = `<kbd>${KEY_NAMES[e.key]}</kbd> → ${escapeHtml(where)}`;
    });
  }, true);

  // ---------------------------------------------------------------- playgrounds
  // [data-playground]: a control menu drives a live preview menu.
  const USERS = [
    ['Maya Chen', 'maya.chen@northwind.example'],
    ['Joe Smith', 'joe.smith@northwind.example'],
    ['Priya Raman', 'priya.raman@northwind.example'],
    ['Daniel Patel', 'dan.patel@northwind.example'],
    ['Sofia Lopez', 'sofia.lopez@northwind.example'],
    ['Ken Ito', 'ken.ito@northwind.example'],
  ];
  const userItems = (selected) => USERS.map(([n, m]) =>
    `<uds-menu-item description="${m}"${n === selected ? ' selected' : ''}>${n}</uds-menu-item>`).join('');

  function previewMarkup(f) {
    const attrs = [f.header ? 'header="User profile"' : '', f.search && !f.nesting ? 'searchable' : '', 'label="Preview"'].join(' ');
    const meta = (eyebrow) => (f.eyebrow ? ` eyebrow="${eyebrow}"` : '');
    const items = [
      `<uds-menu-item${meta('Viewing as')} ${f.nesting ? 'opens="pv-users" reflect="label"' : ''}>Maya Chen</uds-menu-item>`,
      `<uds-menu-item${meta('Language')} ${f.nesting ? 'opens="pv-lang" reflect="label"' : ''}>English (US)</uds-menu-item>`,
      f.toggle ? '<uds-menu-divider></uds-menu-divider><uds-menu-item toggle checked>Email reminders</uds-menu-item>' : '<uds-menu-item>Preferences</uds-menu-item>',
    ];
    const panels = f.nesting ? `
      <uds-menu-panel id="pv-users" title="Back" label="View as" selectable ${f.search ? 'searchable' : ''} scroll-after="4">${userItems('Maya Chen')}</uds-menu-panel>
      <uds-menu-panel id="pv-lang" title="Back" label="Language" selectable>
        <uds-menu-item selected>English (US)</uds-menu-item><uds-menu-item>Français</uds-menu-item><uds-menu-item>Deutsch</uds-menu-item>
      </uds-menu-panel>` : '';
    const footer = f.footer ? '<div slot="footer"><button type="button" class="uds-menu-footer-btn">Sign out</button></div>' : '';
    return `<uds-menu ${attrs}>${items.join('')}${panels}${footer}</uds-menu>`;
  }

  const CONFIGS = {
    basic: () => `<uds-menu label="Row actions">
        <uds-menu-item>Edit</uds-menu-item><uds-menu-item>Duplicate</uds-menu-item>
        <uds-menu-item>Share</uds-menu-item><uds-menu-item type="destructive">Delete</uds-menu-item></uds-menu>`,
    settings: () => `<uds-menu header="Display" label="Display settings">
        <uds-menu-item toggle checked description="Fits more rows on screen">Compact rows</uds-menu-item>
        <uds-menu-item toggle description="Saturday and Sunday columns">Show weekends</uds-menu-item>
        <uds-menu-item toggle checked>Email reminders</uds-menu-item></uds-menu>`,
    profile: () => previewMarkup({ header: true, search: true, eyebrow: true, toggle: true, nesting: true, footer: true }),
  };

  for (const pg of document.querySelectorAll('[data-playground]')) {
    const preview = pg.querySelector('[data-preview]');
    const kind = pg.dataset.playground;
    const render = (markup) => { preview.innerHTML = markup; };
    if (kind === 'properties') {
      // Plain switches (outside any menu) drive the preview menu.
      const switches = [...pg.querySelectorAll('[data-controls] [role="switch"]')];
      const flags = () => Object.fromEntries(switches.map((b) => [b.dataset.value, b.getAttribute('aria-checked') === 'true']));
      for (const b of switches) {
        b.addEventListener('click', () => {
          b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
          render(previewMarkup(flags()));
        });
      }
      render(previewMarkup(flags()));
    } else if (kind === 'configs') {
      pg.addEventListener('uds-select', (e) => {
        if (!e.target.closest('[data-controls]')) return;
        render(CONFIGS[e.detail.value]());
      });
      render(CONFIGS[pg.dataset.initial || 'basic']());
    }
  }
})();
