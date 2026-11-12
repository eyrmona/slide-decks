# slide-decks

A personal library of slide decks. Each `.pptx` in `decks/` is converted into a
responsive web page that reproduces the slides as designed, with real
(selectable, searchable) text, the original web fonts, and images. A landing page
lists every deck.

## Usage

```bash
npm install
npm run dev      # build, then serve at http://localhost:4321
```

- `npm run build` converts the decks and writes the static site to `dist/`.
- `npm run serve` serves `dist/` locally.

`dist/` is plain static HTML/CSS/JS, so any static host works (GitHub Pages, Netlify, Vercel, S3…).

## Adding a deck

1. Export the deck as `.pptx` (from Google Slides: *File → Download → Microsoft PowerPoint*).
2. Put it in `decks/`.
3. Optionally add an entry to `decks/decks.json` for its title, description, date and order:

   ```json
   { "file": "my-talk.pptx", "slug": "my-talk", "title": "My Talk", "description": "…", "date": "2026" }
   ```

   A deck that isn't listed is still included, titled from its filename. Add `"hidden": true` to leave one out.
4. Run `npm run build`.

The landing page title and tagline live in `decks/site.json`.

### Interactive extras on converted slides

A converted slide can be made interactive from `decks/decks.json` without changing the `.pptx`:

```json
{ "file": "portfolio.pptx", "slug": "portfolio", "enhance": { "5": "carousel" } }
```

- `carousel`: the slide's pictures rotate through their original positions (automatically, with ‹ › controls, or by
  clicking a picture to bring it forward). Clicking the front picture opens it full screen; `Esc` closes it.
- `zoom`: every picture on the slide opens full screen when clicked (or with `Enter`); `Esc` closes it.

- `terminal:<script>`: the slide's terminal screenshot becomes a live terminal that plays a scripted CLI
  session and loops (e.g. `"3": "terminal:create-intapp-app"`). Scripts live in `TERMINAL_SCRIPTS`.

- `blocked`: each card on the slide (a filled box) gets a "not allowed" icon in its top-right corner.

Combine them per slide, e.g. `"enhance": { "5": "carousel", "6": "zoom" }`. Code: `src/enhance.js`.

### HTML decks with live components

A deck can also be written in HTML, which lets slides contain working UI. See
`decks/menu-component/` for an example.

- Put one `<section>` per slide in `decks/<name>/slides.html` (add `class="dark"` for the dark theme).
  Slides use a 1280 × 720 canvas styled by `src/html-deck.css`, which matches the converted decks.
- Images go in `decks/<name>/media/` and are referenced as `media/…`.
- Register it in `decks/decks.json` with `"dir": "<name>"` instead of `"file"`.
- Live components live in `src/components/`. The UDS Menu (built from the Figma "🟢 Menu" page):

  ```html
  <uds-overflow-menu orientation="left" label="More actions">
    <uds-menu-item>Edit</uds-menu-item>
    <uds-menu-item type="disabled">Archive</uds-menu-item>
    <uds-menu-item type="destructive">Delete</uds-menu-item>
  </uds-overflow-menu>

  <uds-menu selectable>
    <uds-menu-item selected>Most recent</uds-menu-item>
    <uds-menu-item>Name</uds-menu-item>
  </uds-menu>
  ```

  The expanded menu adds a header and footer, nested panels that slide in place, search,
  eyebrows/descriptions, leading icons and toggle rows:

  ```html
  <uds-menu header="User profile" width="280">
    <uds-menu-item icon="user-single" eyebrow="Viewing as" opens="users" reflect="label">Maya Chen</uds-menu-item>
    <uds-menu-divider></uds-menu-divider>
    <uds-menu-item toggle checked>Email reminders</uds-menu-item>
    <uds-menu-panel id="users" title="Back" label="View as" selectable searchable scroll-after="5">
      <uds-menu-item selected description="maya@…">Maya Chen</uds-menu-item>
    </uds-menu-panel>
    <div slot="footer"><button class="uds-menu-footer-btn">Sign out</button></div>
  </uds-menu>
  ```

  The full attribute list is at the top of `src/components/menu/menu.js`.

## Viewing a deck

- One slide at a time, scaled to fit the screen from phone to desktop.
- `←` / `→` (or swipe, or the ‹ › buttons) move between slides. Each slide has its own link (`/portfolio/#5`).
- **Present** (or `P`) goes full screen. While a live menu has focus, the arrow keys drive the menu instead.

## How the conversion works

`scripts/pptx.mjs` reads the slide XML and positions every shape, text box, line and
image exactly where it sits in the deck, in design pixels. CSS container units then scale the
whole slide to its rendered width, so the layout stays the same at any size.

Supported: text styling (fonts, weights, sizes, colours, spacing, alignment, bullets, links),
rectangles, rounded rectangles, ellipses, triangles and other common shapes, lines and arrows,
fills and gradients, borders, shadows, cropped images, groups, tables and slide backgrounds.
Charts, SmartArt and embedded video are skipped; the build prints a note when it finds one.

Fonts come from Google Fonts. Proprietary fonts fall back to close matches (Calibri → Carlito,
Arial → Arimo, Avenir → Nunito Sans).
