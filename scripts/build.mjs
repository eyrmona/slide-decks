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
  return `<div class="slide" style="--w:${deck.width};--h:${deck.height};${esc(bg)}"${label ? ` role="img" aria-label="Slide ${i + 1}"` : ' aria-hidden="true"'}>${html}</div>`;
}

function fontLinks(urls) {
  if (!urls.length) return '';
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    ...urls.map((u) => `<link rel="stylesheet" href="${esc(u)}">`),
  ].join('\n    ');
}

function page({ title, description, fonts, body, css, scriptTag = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${esc(title)}</title>
    ${description ? `<meta name="description" content="${esc(description)}">` : ''}
    ${fontLinks(fonts)}
    <link rel="stylesheet" href="${css}">
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
  const entries = listed.filter((d) => {
    if (!files.includes(d.file)) {
      console.warn(`! decks.json lists "${d.file}" but it is not in decks/ — skipped`);
      return false;
    }
    return !d.hidden;
  });
  for (const f of files) if (!listed.some((d) => d.file === f)) entries.push({ file: f });

  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(dist, { recursive: true });
  await fs.copyFile(path.join(srcDir, 'styles.css'), path.join(dist, 'styles.css'));
  await fs.copyFile(path.join(srcDir, 'viewer.js'), path.join(dist, 'viewer.js'));

  const built = [];
  for (const entry of entries) {
    const buf = await fs.readFile(path.join(decksDir, entry.file));
    const deck = await convertPptx(buf, { mediaPrefix: MEDIA });
    const slug = entry.slug || slugify(entry.file);
    const title = entry.title || deck.meta.title || entry.file.replace(/\.pptx$/i, '');
    const outDir = path.join(dist, slug);
    await fs.mkdir(path.join(outDir, 'media'), { recursive: true });
    for (const m of deck.media) await fs.writeFile(path.join(outDir, 'media', m.name), m.data);

    const fonts = googleFontsUrls(deck.fonts);
    const slidesHtml = deck.slides
      .map((s, i) => `      <section class="slide-frame" id="${i + 1}" data-index="${i}"${i ? ' hidden' : ''}>
        ${slideMarkup(deck, s, i, 'media/')}
        <p class="sr-only">${esc(s.text)}</p>
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
        body,
        scriptTag: '<script src="../viewer.js" defer></script>',
        bodyClass: 'deck-page',
      }),
    );

    built.push({ slug, title, entry, deck, fonts });
    console.log(`✓ ${entry.file} → dist/${slug}/  (${deck.slides.length} slides, ${deck.media.length} images)`);
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
    page({ title: siteTitle, description: site.tagline, fonts: allFonts, css: 'styles.css', body: landing, bodyClass: 'home-page' }),
  );
  console.log(`✓ dist/index.html (${built.length} decks)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
