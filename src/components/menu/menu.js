// UDS Menu as custom elements: the basic menu and its expanded abilities.
// Visuals come from the Figma "🟢 Menu" page (basic menu and list item states),
// the Billstream "User Profile" menu (header, back navigation, search,
// eyebrow/description rows, dividers, check marks) and the "🟢 Toggle" page.
// Behaviour follows the IDS web components (packages/web-components/menu):
// arrow-key navigation with wrap, toggles as menuitemcheckbox that never close
// the menu, and focus returned to the trigger only after keyboard activation.
//
// ── Basic ───────────────────────────────────────────────────────────────
//   <uds-overflow-menu label="More actions">   (orientation="right" | "left", type="tertiary" | "secondary", disabled, closed)
//     <uds-menu-item>Edit</uds-menu-item>
//     <uds-menu-item type="disabled">Archive</uds-menu-item>
//     <uds-menu-item type="destructive">Delete</uds-menu-item>
//   </uds-overflow-menu>
//
// ── Expanded ────────────────────────────────────────────────────────────
//   <uds-menu header="User profile" width="280">
//     <uds-menu-item icon="user-single" description="hana@…" opens="users" reflect>Hana Park</uds-menu-item>
//     <uds-menu-divider></uds-menu-divider>
//     <uds-menu-item toggle checked description="Applies immediately">Compact rows</uds-menu-item>
//     <uds-menu-panel id="users" title="Switch user" searchable selectable scroll-after="5">
//       <uds-menu-item selected description="joe@…">Joe Smith</uds-menu-item> …
//     </uds-menu-panel>
//     <div slot="footer">…</div>
//   </uds-menu>
//
// Menu attributes: header, label, width, selectable, searchable, search-placeholder.
// Item attributes: type (default | destructive | disabled), selected, value,
//   eyebrow, description, icon (leading icon name), right-icon (name | none),
//   toggle + checked, opens (panel id), reflect (show the panel's choice as
//   this item's description), stay-open.
// Slots (child elements with slot=…): header, top (above the list), footer.
// Events (bubbling): uds-select { label, value, type, panel },
//   uds-toggle-change { label, value, checked }.

(() => {
  const base = new URL('.', document.currentScript.src).href;
  const asset = (name) => base + name;
  const ICON_FILES = {
    add: 'icon-add.svg',
    'add-destructive': 'icon-add-destructive.svg',
    'add-disabled': 'icon-add-disabled.svg',
    'chevron-right': 'icon-chevron-right.svg',
    'check-solid': 'icon-check-solid.svg',
    'user-single': 'icon-user-single.svg',
    'multiple-users': 'icon-multiple-users.svg',
    'time-clock-circle': 'icon-time-clock-circle.svg',
    layers: 'icon-layers.svg',
    search: 'icon-search.svg',
    'arrow-left': 'icon-arrow-left.svg',
  };

  const el = (tag, cls, attrs = {}) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    return n;
  };
  const icon = (name, cls) => {
    const wrap = el('span', cls);
    const img = el('img', null, { src: asset(ICON_FILES[name] || `icon-${name}.svg`), alt: '' });
    wrap.append(img);
    return wrap;
  };
  const toggleVisual = () => {
    const t = el('span', 'uds-toggle', { 'aria-hidden': 'true' });
    t.innerHTML = `<img class="uds-toggle__off" src="${asset('toggle-sm-off.svg')}" alt="">
      <img class="uds-toggle__knob-off" src="${asset('toggle-selector-off-hover.svg')}" alt="">
      <span class="uds-toggle__check"><img src="${asset('toggle-check-on.svg')}" alt=""></span>
      <img class="uds-toggle__knob-on" src="${asset('toggle-selector-on.svg')}" alt="">`;
    return t;
  };

  // Tracks whether the last interaction was the keyboard, so focus only
  // returns to the trigger after keyboard activation (as in IDS).
  let keyboardMode = false;
  document.addEventListener('keydown', () => { keyboardMode = true; }, true);
  document.addEventListener('pointerdown', () => { keyboardMode = false; }, true);

  let uid = 0;

  // ------------------------------------------------------------------ render
  function render(host) {
    const sources = [...host.children];
    const slots = (name) => sources.filter((n) => n.getAttribute('slot') === name);
    const panelsSrc = sources.filter((n) => n.localName === 'uds-menu-panel');
    const rich = host.hasAttribute('header') || slots('header').length || slots('footer').length
      || panelsSrc.length || host.hasAttribute('searchable')
      || sources.some((n) => n.localName === 'uds-menu-item' && ['icon', 'eyebrow', 'description', 'toggle', 'opens'].some((a) => n.hasAttribute(a)));

    const menu = el('div', `uds-menu${rich ? ' uds-menu--rich' : ''}`);
    if (host.hasAttribute('width')) menu.style.setProperty('--menu-width', host.getAttribute('width'));
    const viewport = el('div', 'uds-menu__viewport');
    menu.append(viewport);

    const root = buildPanel({
      id: 'root',
      title: host.getAttribute('header'),
      headerSlot: slots('header'),
      topSlot: slots('top'),
      items: sources.filter((n) => n.localName === 'uds-menu-item' || n.localName === 'uds-menu-divider'),
      label: host.getAttribute('label') || host.getAttribute('header'),
      selectable: host.hasAttribute('selectable'),
      searchable: host.hasAttribute('searchable'),
      placeholder: host.getAttribute('search-placeholder'),
      scrollAfter: host.getAttribute('scroll-after'),
      rich,
    });
    viewport.append(root);
    for (const p of panelsSrc) {
      viewport.append(buildPanel({
        id: p.id,
        title: p.getAttribute('title') || 'Back',
        nested: true,
        items: [...p.children].filter((n) => n.localName === 'uds-menu-item' || n.localName === 'uds-menu-divider'),
        topSlot: [...p.children].filter((n) => n.getAttribute('slot') === 'top'),
        label: p.getAttribute('label') || p.getAttribute('title'),
        selectable: p.hasAttribute('selectable'),
        searchable: p.hasAttribute('searchable'),
        placeholder: p.getAttribute('search-placeholder'),
        scrollAfter: p.getAttribute('scroll-after'),
        rich: true,
      }));
    }
    const footer = slots('footer');
    if (footer.length) {
      const f = el('div', 'uds-menu__footer');
      footer.forEach((n) => { n.removeAttribute('slot'); f.append(n); });
      menu.append(f);
    }
    host.replaceChildren(menu);
    return menu;
  }

  function buildPanel(o) {
    const panel = el('section', 'uds-menu__panel', { 'data-panel': o.id });
    if (o.nested) {
      const header = el('div', 'uds-menu__header');
      const back = el('button', 'uds-menu__back', { type: 'button', 'aria-label': o.label && o.label !== o.title ? `${o.title}, ${o.label}` : o.title });
      back.append(icon('arrow-left', 'uds-menu__header-icon'), el('span', 'uds-menu__title'));
      back.lastChild.textContent = o.title;
      header.append(back);
      panel.append(header);
    } else if (o.title || (o.headerSlot && o.headerSlot.length)) {
      const header = el('div', 'uds-menu__header');
      if (o.title) {
        const t = el('span', 'uds-menu__title');
        t.textContent = o.title;
        header.append(t);
      }
      o.headerSlot?.forEach((n) => { n.removeAttribute('slot'); header.append(n); });
      panel.append(header);
    }

    const body = el('div', 'uds-menu__body');
    const listId = `uds-menu-list-${++uid}`;
    if (o.searchable) {
      const search = el('label', 'uds-menu__search');
      search.append(icon('search', 'uds-menu__search-icon'));
      const input = el('input', 'uds-menu__search-input', {
        type: 'search',
        placeholder: o.placeholder || 'Search',
        'aria-label': `Search ${o.label || 'menu'}`,
        'aria-controls': listId,
        autocomplete: 'off',
        spellcheck: 'false',
      });
      search.append(input);
      body.append(search);
    }
    o.topSlot?.forEach((n) => { n.removeAttribute('slot'); body.append(n); });

    const list = el('div', 'uds-menu__list', { role: 'menu', id: listId, 'aria-label': o.label });
    if (o.scrollAfter) list.dataset.scrollAfter = o.scrollAfter;
    for (const src of o.items) {
      if (src.localName === 'uds-menu-divider') {
        list.append(el('div', 'uds-menu__divider', { role: 'separator' }));
        continue;
      }
      list.append(buildItem(src, o));
    }
    const empty = el('p', 'uds-menu__empty', { hidden: true });
    empty.textContent = 'No results';
    body.append(list, empty);
    panel.append(body);
    return panel;
  }

  function buildItem(src, o) {
    const type = src.getAttribute('type') || 'default';
    const isToggle = src.hasAttribute('toggle');
    if (src.hasAttribute('static')) {
      // Read-only information row (e.g. "User roles"): not a menu action.
      const row = el('div', 'uds-menu-item uds-menu-item--static', { role: 'none' });
      if (src.hasAttribute('icon')) row.append(icon(src.getAttribute('icon'), 'uds-menu-item__lead'));
      const st = el('span', 'uds-menu-item__stack');
      const lb = el('span', 'uds-menu-item__label');
      lb.textContent = src.textContent.trim();
      st.append(lb);
      if (src.hasAttribute('description')) {
        const d = el('span', 'uds-menu-item__description uds-menu-item__description--wrap');
        d.textContent = src.getAttribute('description').replace(/\s*\|\s*/g, '\n');
        st.append(d);
      }
      row.append(st);
      return row;
    }
    const opens = src.getAttribute('opens');
    const radio = o.selectable && type !== 'destructive' && !isToggle && !opens;
    const role = isToggle ? 'menuitemcheckbox' : radio ? 'menuitemradio' : 'menuitem';
    const item = el('div', 'uds-menu-item', {
      role,
      tabindex: '-1',
      'data-type': type,
      'data-value': src.getAttribute('value') || src.textContent.trim(),
      'aria-disabled': type === 'disabled' ? 'true' : null,
      'aria-checked': isToggle ? String(src.hasAttribute('checked')) : radio ? String(src.hasAttribute('selected')) : null,
      'aria-haspopup': opens ? 'menu' : null,
      'data-opens': opens,
      'data-reflect': src.hasAttribute('reflect') ? src.getAttribute('reflect') || 'description' : null,
      'data-stay-open': src.hasAttribute('stay-open') ? '' : null,
      'data-selected': !radio && src.hasAttribute('selected') ? '' : null,
    });

    if (src.hasAttribute('icon')) item.append(icon(src.getAttribute('icon'), 'uds-menu-item__lead'));

    const stack = el('span', 'uds-menu-item__stack');
    if (src.hasAttribute('eyebrow')) {
      const e = el('span', 'uds-menu-item__eyebrow');
      e.textContent = src.getAttribute('eyebrow');
      stack.append(e);
    }
    const label = el('span', 'uds-menu-item__label');
    label.textContent = src.textContent.trim();
    stack.append(label);
    if (src.hasAttribute('description')) {
      const d = el('span', 'uds-menu-item__description');
      d.textContent = src.getAttribute('description');
      stack.append(d);
    }
    item.append(stack);

    // Right side: toggle, chevron (opens a panel), explicit icon, a check mark
    // for selectable rich menus, or the basic menu's default icon.
    const right = src.getAttribute('right-icon');
    const hasMeta = ['icon', 'eyebrow', 'description'].some((a) => src.hasAttribute(a));
    if (isToggle) item.append(toggleVisual());
    else if (right === 'none') { /* nothing */ }
    else if (opens) item.append(icon('chevron-right', 'uds-menu-item__icon'));
    else if (right) item.append(icon(right, 'uds-menu-item__icon'));
    else if (radio && o.rich) item.append(icon('check-solid', 'uds-menu-item__icon uds-menu-item__check'));
    else if (!o.rich && !hasMeta) item.append(icon(type === 'default' ? 'add' : `add-${type}`, 'uds-menu-item__icon'));
    return item;
  }

  // ------------------------------------------------------------------ behaviour
  function wire(host, menu, { onClose } = {}) {
    const panels = new Map([...menu.querySelectorAll('.uds-menu__panel')].map((p) => [p.dataset.panel, p]));
    const history = ['root'];
    let active = null;
    const current = () => panels.get(history.at(-1));

    const navigable = (panel = current()) =>
      [...panel.querySelectorAll('.uds-menu-item:not(.uds-menu-item--static)')].filter((i) => i.getAttribute('aria-disabled') !== 'true' && !i.hidden);

    function setActive(item, { focus = true } = {}) {
      if (active) delete active.dataset.active;
      active = item;
      if (!item) return;
      item.dataset.active = '';
      current().querySelectorAll('.uds-menu-item').forEach((i) => { i.tabIndex = i === item ? 0 : -1; });
      if (focus) item.focus({ preventScroll: true });
      item.scrollIntoView({ block: 'nearest' });
    }

    function layoutPanels() {
      const order = history;
      for (const [id, p] of panels) {
        const depth = order.indexOf(id);
        const pos = depth === order.length - 1 ? 'center' : depth >= 0 ? 'left' : 'right';
        p.dataset.pos = pos;
        p.inert = pos !== 'center';
        p.setAttribute('aria-hidden', String(pos !== 'center'));
      }
      sizeScrollLists();
    }

    function showPanel(id, { focus } = {}) {
      if (!panels.has(id)) return;
      history.push(id);
      layoutPanels();
      setActive(null);
      if (focus) {
        const p = current();
        const search = p.querySelector('.uds-menu__search-input');
        if (search) search.focus({ preventScroll: true });
        else setActive(navigable(p)[0]);
      }
    }

    function back({ focus } = {}) {
      if (history.length < 2) return false;
      const leaving = history.pop();
      layoutPanels();
      const opener = current().querySelector(`[data-opens="${CSS.escape(leaving)}"]`);
      if (focus && opener) setActive(opener);
      else setActive(null);
      const input = panels.get(leaving).querySelector('.uds-menu__search-input');
      if (input && input.value) { input.value = ''; filter(panels.get(leaving), ''); }
      return true;
    }

    function reset() {
      history.length = 1;
      layoutPanels();
      setActive(null);
      menu.querySelectorAll('.uds-menu__search-input').forEach((i) => { i.value = ''; filter(i.closest('.uds-menu__panel'), ''); });
    }

    function filter(panel, q) {
      const query = q.trim().toLowerCase();
      let shown = 0;
      panel.querySelectorAll('.uds-menu-item').forEach((i) => {
        const hit = !query || i.textContent.toLowerCase().includes(query);
        i.hidden = !hit;
        if (hit) shown++;
      });
      panel.querySelectorAll('.uds-menu__divider').forEach((d) => { d.hidden = !!query; });
      panel.querySelector('.uds-menu__empty').hidden = shown > 0;
    }

    // "scroll-after=N": cap the list at N visible items (Billstream: "Scrollable past 5 items").
    function sizeScrollLists() {
      menu.querySelectorAll('.uds-menu__list[data-scroll-after]').forEach((list) => {
        const n = Number(list.dataset.scrollAfter);
        const items = [...list.querySelectorAll('.uds-menu-item')];
        if (items.length <= n) return;
        const unit = menu.getBoundingClientRect().width / (parseFloat(getComputedStyle(menu).getPropertyValue('--menu-width')) || 220);
        if (!unit) return;
        const first = items[0].getBoundingClientRect();
        const last = items[n - 1].getBoundingClientRect();
        if (!first.height) return;
        const designPx = (last.bottom - first.top) / unit + 6 + 8 + 4;
        list.style.maxHeight = `calc(${Math.ceil(designPx)} * var(--mu))`;
        list.classList.add('uds-menu__list--scroll');
      });
    }
    requestAnimationFrame(sizeScrollLists);

    function choose(item) {
      if (!item || item.getAttribute('aria-disabled') === 'true' || item.classList.contains('uds-menu-item--static')) return;
      const panel = item.closest('.uds-menu__panel');
      const label = item.querySelector('.uds-menu-item__label').textContent;
      if (item.dataset.opens) { showPanel(item.dataset.opens, { focus: keyboardMode }); return; }

      if (item.getAttribute('role') === 'menuitemcheckbox') {
        const on = item.getAttribute('aria-checked') !== 'true';
        item.setAttribute('aria-checked', String(on));
        host.dispatchEvent(new CustomEvent('uds-toggle-change', { bubbles: true, detail: { label, value: item.dataset.value, checked: on } }));
        return; // toggles never close the menu
      }
      if (item.getAttribute('role') === 'menuitemradio') {
        panel.querySelectorAll('[role="menuitemradio"]').forEach((i) => i.setAttribute('aria-checked', String(i === item)));
      }
      host.dispatchEvent(new CustomEvent('uds-select', {
        bubbles: true,
        detail: { label, value: item.dataset.value, type: item.dataset.type, panel: panel.dataset.panel },
      }));

      // A choice inside a nested panel updates the row that opened it and slides back.
      if (panel.dataset.panel !== 'root') {
        const opener = menu.querySelector(`[data-opens="${CSS.escape(panel.dataset.panel)}"]`);
        if (opener?.hasAttribute('data-reflect')) {
          // reflect="description" (default): show the choice under the opener's label.
          // reflect="label": replace the label. reflect="item": copy label and description.
          const mode = opener.dataset.reflect;
          const stack = opener.querySelector('.uds-menu-item__stack');
          let d = opener.querySelector('.uds-menu-item__description');
          const chosenDesc = item.querySelector('.uds-menu-item__description')?.textContent;
          if (mode === 'label' || mode === 'item') opener.querySelector('.uds-menu-item__label').textContent = label;
          const text = mode === 'label' ? null : mode === 'item' ? chosenDesc : label;
          if (text != null) {
            if (!d) { d = el('span', 'uds-menu-item__description'); stack.append(d); }
            d.textContent = text;
          }
        }
        back({ focus: keyboardMode });
        return;
      }
      if (!item.hasAttribute('data-stay-open')) onClose?.({ restoreFocus: keyboardMode });
    }

    menu.addEventListener('click', (e) => {
      const backBtn = e.target.closest('.uds-menu__back');
      if (backBtn) { e.stopPropagation(); back({ focus: keyboardMode }); return; }
      const item = e.target.closest('.uds-menu-item');
      if (item) { e.stopPropagation(); choose(item); }
    });
    menu.addEventListener('pointermove', (e) => {
      const item = e.target.closest('.uds-menu-item:not(.uds-menu-item--static)');
      if (item && item !== active && item.getAttribute('aria-disabled') !== 'true') setActive(item, { focus: false });
    });
    menu.addEventListener('pointerleave', () => { if (active && document.activeElement !== active) setActive(null); });
    menu.addEventListener('focusin', (e) => {
      const item = e.target.closest('.uds-menu-item');
      if (item && item !== active) setActive(item, { focus: false });
    });
    menu.addEventListener('input', (e) => {
      if (e.target.matches('.uds-menu__search-input')) filter(e.target.closest('.uds-menu__panel'), e.target.value);
    });

    menu.addEventListener('keydown', (e) => {
      const inSearch = e.target.matches('.uds-menu__search-input');
      const onBack = e.target.closest('.uds-menu__back');
      const items = navigable();
      const i = items.indexOf(active);
      const k = e.key;

      if (inSearch) {
        if (k === 'ArrowDown') setActive(items[0]);
        else if (k === 'Escape' && e.target.value) { e.target.value = ''; filter(current(), ''); }
        else if (k === 'Escape') { if (!back({ focus: true })) onClose?.({ restoreFocus: true }); }
        else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.stopPropagation(); return; } // move the caret, not the slide
        else return;
      } else if (onBack) {
        if (k === 'ArrowDown') setActive(items[0]);
        else if (k === 'Escape' || k === 'ArrowLeft') back({ focus: true });
        else if (k === 'ArrowRight') { /* stay */ }
        else return;
      } else {
        switch (k) {
          case 'ArrowDown': setActive(items[(i + 1) % items.length]); break;
          case 'ArrowUp': {
            const search = current().querySelector('.uds-menu__search-input');
            if (i <= 0 && search) search.focus();
            else setActive(items[(i - 1 + items.length) % items.length]);
            break;
          }
          case 'Home': setActive(items[0]); break;
          case 'End': setActive(items.at(-1)); break;
          case 'Enter':
          case ' ': choose(active); break;
          case 'ArrowRight': if (active?.dataset.opens) showPanel(active.dataset.opens, { focus: true }); break;
          case 'ArrowLeft': back({ focus: true }); break;
          case 'Escape': if (!back({ focus: true })) onClose?.({ restoreFocus: true }); break;
          default: return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
    });

    layoutPanels();
    return {
      focusFirst: () => setActive(navigable()[0]),
      focusLast: () => setActive(navigable().at(-1)),
      reset,
      firstTabStop: () => navigable()[0],
      resize: sizeScrollLists,
    };
  }

  class UdsMenu extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const menu = render(this);
      const ctl = wire(this, menu);
      const first = menu.querySelector('.uds-menu__panel[data-pos="center"] [aria-checked="true"]') || ctl.firstTabStop();
      if (first) first.tabIndex = 0;
    }
  }

  class UdsOverflowMenu extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      // Open by default (add `closed` to start closed). A slide deck re-opens
      // it whenever its slide is shown again (see the deck-slide-shown event).
      const startOpen = !this.hasAttribute('closed') && !this.hasAttribute('disabled');
      const menu = render(this);
      const id = `uds-menu-${++uid}`;
      menu.id = id;

      const trigger = el('button', 'uds-overflow__trigger', {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        'aria-controls': id,
        'aria-label': this.getAttribute('label') || 'More actions',
      });
      // Type: tertiary (default) or secondary. Each state has its own icon colour in Figma.
      const kind = this.getAttribute('type') === 'secondary' ? 'secondary' : 'tertiary';
      const file = (state) => (kind === 'secondary' ? `overflow-secondary-${state}.svg` : `overflow-${state}.svg`);
      trigger.dataset.type = kind;
      if (this.hasAttribute('disabled')) trigger.disabled = true;
      trigger.innerHTML = `<span class="uds-overflow__icon">
        <img class="is-default" src="${asset(file('default'))}" alt="">
        <img class="is-hover" src="${asset(file('hover'))}" alt="">
        <img class="is-active" src="${asset(file('active'))}" alt="">
        <img class="is-disabled" src="${asset(file('disabled'))}" alt="">
      </span>`;
      this.prepend(trigger);

      const open = (focus) => {
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        ctl.resize();
        if (focus === 'first') ctl.focusFirst();
        if (focus === 'last') ctl.focusLast();
      };
      const close = ({ restoreFocus = false } = {}) => {
        if (menu.hidden) return;
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        ctl.reset();
        if (restoreFocus) trigger.focus({ preventScroll: true });
      };
      const ctl = wire(this, menu, { onClose: close });

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.hidden) open(e.detail === 0 ? 'first' : null);
        else close();
      });
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') open(e.key === 'ArrowDown' ? 'first' : 'last');
        else if (e.key === 'Enter' || e.key === ' ') { if (menu.hidden) open('first'); else close(); }
        else if (e.key === 'Escape' && !menu.hidden) close();
        else return;
        e.preventDefault();
        e.stopPropagation();
      });

      this.addEventListener('focusout', (e) => {
        if (e.relatedTarget && !this.contains(e.relatedTarget)) close();
      });
      document.addEventListener('pointerdown', (e) => {
        if (!this.contains(e.target)) close();
      });

      menu.hidden = true;
      if (startOpen) {
        open();
        document.addEventListener('deck-slide-shown', (e) => {
          if (e.target.contains(this)) { ctl.reset(); open(); }
        });
      }
    }
  }

  customElements.define('uds-menu', UdsMenu);
  customElements.define('uds-overflow-menu', UdsOverflowMenu);
})();
