// Builds the static site into dist/:
//   dist/index.html              landing page listing every deck
//   dist/<slug>/index.html       the deck itself
//   dist/<slug>/media/*          images used by the deck
//
// Decks are the .pptx files in decks/. Titles, descriptions and order come
// from decks/decks.json; any .pptx not listed there is still included.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertPptx, googleFontsUrls } from './pptx.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const decksDir = path.join(root, 'decks');
const srcDir = path.join(root, 'src');
const dist = path.join(root, 'dist');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (s) => s.toLowerCase().replace(/\.pptx$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const MEDIA = '__MEDIA__/';

async function readJson(p, fallback) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Could not parse ${path.relative(root, p)}: ${e.message}`);
  }
}

function slideMarkup(deck, slide, i, mediaPrefix, { label = true } = {}) {
  const html = slide.html.split(MEDIA).join(mediaPrefix);
  const bg = slide.background.split(MEDIA).join(mediaPrefix);
  // Converted .pptx slides are pictures of text (with a text alternative);
  // HTML-authored slides are real, interactive content and keep their roles.
  const a11y = !label ? ' aria-hidden="true" inert' : deck.interactive ? ` aria-label="Slide ${i + 1}"` : ` role="img" aria-label="Slide ${i + 1}"`;
  return `<div class="slide" style="--w:${deck.width};--h:${deck.height};${esc(bg)}"${a11y}>${html}</div>`;
}

// HTML-authored decks: decks/<dir>/slides.html holds one top-level
// <section> per slide (class="dark" for the dark theme), laid out on a
// 1280 × 720 canvas with the classes in src/html-deck.css. Files in
// decks/<dir>/media/ are published next to the deck and referenced as
// "media/…". Interactive components from src/components/ can be used freely.
const HTML_DECK_FONTS = new Map([
  ['Inter', new Set(['0,400', '0,500', '0,600', '0,700', '1,400'])],
  ['Poppins', new Set(['0,600', '0,700'])],
  ['Manrope', new Set(['0,400', '0,600'])],
  ['Cousine', new Set(['0,400', '0,700'])],
]);

async function loadHtmlDeck(dir) {
  const src = await fs.readFile(path.join(decksDir, dir, 'slides.html'), 'utf8');
  const slides = [];
  for (const m of src.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/g)) {
    const cls = /class="([^"]*)"/.exec(m[1])?.[1] || '';
    const dark = /\bdark\b/.test(cls);
    slides.push({
      html: `<div class="hd ${esc(cls)}">${m[2].replaceAll('media/', MEDIA)}</div>`,
      background: `background:${dark ? '#1a1a1a' : '#f0efeb'}`,
      text: '',
    });
  }
  const media = [];
  const mediaDir = path.join(decksDir, dir, 'media');
  for (const name of await fs.readdir(mediaDir).catch(() => [])) {
    if (!name.startsWith('.')) media.push({ name, data: await fs.readFile(path.join(mediaDir, name)) });
  }
  return { width: 1280, height: 720, slides, media, fonts: HTML_DECK_FONTS, meta: {}, warnings: [], interactive: true };
}

const componentHead = (root) => `<link rel="stylesheet" href="${root}html-deck.css">
    <link rel="stylesheet" href="${root}components/menu/menu.css">
    <script src="${root}components/menu/menu.js" defer></script>
    <script src="${root}html-deck.js" defer></script>`;

function fontLinks(urls) {
  if (!urls.length) return '';
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    ...urls.map((u) => `<link rel="stylesheet" href="${esc(u)}">`),
  ].join('\n    ');
}

function page({ title, description, fonts, body, css, head = '', scriptTag = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${esc(title)}</title>
    ${description ? `<meta name="description" content="${esc(description)}">` : ''}
    ${fontLinks(fonts)}
    <link rel="stylesheet" href="${css}">
    ${head}
  </head>
  <body class="${bodyClass}">
${body}
    ${scriptTag}
  </body>
</html>
`;
}

async function main() {
  const site = await readJson(path.join(decksDir, 'site.json'), {});
  const listed = await readJson(path.join(decksDir, 'decks.json'), []);
  const files = (await fs.readdir(decksDir)).filter((f) => f.toLowerCase().endsWith('.pptx') && !f.startsWith('~$'));
  const entries = [];
  for (const d of listed) {
    const ok = d.dir
      ? await fs.access(path.join(decksDir, d.dir, 'slides.html')).then(() => true, () => false)
      : files.includes(d.file);
    if (!ok) console.warn(`! decks.json lists "${d.dir ? `${d.dir}/slides.html` : d.file}" but it is not in decks/ — skipped`);
    else if (!d.hidden) entries.push(d);
  }
  for (const f of files) if (!listed.some((d) => d.file === f)) entries.push({ file: f });

  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(dist, { recursive: true });
  await fs.copyFile(path.join(srcDir, 'styles.css'), path.join(dist, 'styles.css'));
  await fs.copyFile(path.join(srcDir, 'viewer.js'), path.join(dist, 'viewer.js'));
  await fs.copyFile(path.join(srcDir, 'html-deck.css'), path.join(dist, 'html-deck.css'));
  await fs.copyFile(path.join(srcDir, 'html-deck.js'), path.join(dist, 'html-deck.js'));
  await fs.copyFile(path.join(srcDir, 'enhance.js'), path.join(dist, 'enhance.js'));
  await fs.cp(path.join(srcDir, 'components'), path.join(dist, 'components'), { recursive: true });

  const built = [];
  for (const entry of entries) {
    const deck = entry.dir
      ? await loadHtmlDeck(entry.dir)
      : await convertPptx(await fs.readFile(path.join(decksDir, entry.file)), { mediaPrefix: MEDIA });
    const source = entry.dir ? `${entry.dir}/slides.html` : entry.file;
    const slug = entry.slug || slugify(entry.dir || entry.file);
    const title = entry.title || deck.meta.title || source.replace(/\.pptx$/i, '');
    const outDir = path.join(dist, slug);
    await fs.mkdir(path.join(outDir, 'media'), { recursive: true });
    for (const m of deck.media) await fs.writeFile(path.join(outDir, 'media', m.name), m.data);

    const fonts = googleFontsUrls(deck.fonts);
    const slidesHtml = deck.slides
      .map((s, i) => `      <section class="slide-frame" id="${i + 1}" data-index="${i}"${entry.enhance?.[i + 1] ? ` data-enhance="${esc(entry.enhance[i + 1])}"` : ''}${i ? ' hidden' : ''}>
        ${slideMarkup(deck, s, i, 'media/')}
        ${s.text ? `<p class="sr-only">${esc(s.text)}</p>` : ''}
      </section>`)
      .join('\n');

    const body = `    <header class="deck-bar">
      <a class="back" href="../" aria-label="All decks"><span aria-hidden="true">←</span> <span class="back-label">All decks</span></a>
      <h1 class="deck-title">${esc(title)}</h1>
      <span class="deck-count">${deck.slides.length} slides</span>
      <button class="present-btn" type="button" data-present>Present</button>
    </header>
    <main class="deck" data-deck style="--w:${deck.width};--h:${deck.height}">
      <div class="stage">
${slidesHtml}
      </div>
      <nav class="deck-nav" aria-label="Slide navigation">
        <button type="button" data-prev aria-label="Previous slide">‹</button>
        <span data-counter aria-live="polite">1 / ${deck.slides.length}</span>
        <button type="button" data-next aria-label="Next slide">›</button>
      </nav>
    </main>`;

    await fs.writeFile(
      path.join(outDir, 'index.html'),
      page({
        title: `${title}${site.title ? ` · ${site.title}` : ''}`,
        description: entry.description,
        fonts,
        css: '../styles.css',
        head: deck.interactive ? componentHead('../') : '',
        body,
        scriptTag: `<script src="../viewer.js" defer></script>${entry.enhance ? '\n    <script src="../enhance.js" defer></script>' : ''}`,
        bodyClass: 'deck-page',
      }),
    );

    built.push({ slug, title, entry, deck, fonts });
    console.log(`✓ ${source} → dist/${slug}/  (${deck.slides.length} slides, ${deck.media.length} images)`);
    for (const w of deck.warnings) console.log(`    note: ${w}`);
  }

  // Landing page.
  const allFonts = [...new Set(built.flatMap((b) => b.fonts))];
  const cards = built
    .map(({ slug, title, entry, deck }) => {
      const cover = deck.slides[0] ? slideMarkup(deck, deck.slides[0], 0, `${slug}/media/`, { label: false }) : '';
      return `        <li class="card">
          <a href="${slug}/">
            <div class="card-thumb">${cover}</div>
            <div class="card-body">
              <h2>${esc(title)}</h2>
              ${entry.description ? `<p>${esc(entry.description)}</p>` : ''}
              <span class="meta">${[entry.date, `${deck.slides.length} slides`].filter(Boolean).map(esc).join(' · ')}</span>
            </div>
          </a>
        </li>`;
    })
    .join('\n');

  const siteTitle = site.title || 'Slide Decks';
  const landing = `    <main class="home">
      <header class="home-header">
        <h1>${esc(siteTitle)}</h1>
        ${site.tagline ? `<p>${esc(site.tagline)}</p>` : ''}
      </header>
      <ul class="cards">
${cards}
      </ul>
    </main>`;
  await fs.writeFile(
    path.join(dist, 'index.html'),
    page({
      title: siteTitle,
      description: site.tagline,
      fonts: allFonts,
      css: 'styles.css',
      head: built.some((b) => b.deck.interactive) ? componentHead('') : '',
      body: landing,
      bodyClass: 'home-page',
    }),
  );
  console.log(`✓ dist/index.html (${built.length} decks)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
