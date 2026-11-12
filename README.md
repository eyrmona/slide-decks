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

## Viewing a deck

- Slides stack vertically and scale to fit the screen, phone to desktop.
- **Present** (or press `P`, or click a slide) opens full-screen presenter mode:
  arrow keys / space / swipe to move, `Esc` to exit. Each slide has its own link (`/portfolio/#5`).

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
