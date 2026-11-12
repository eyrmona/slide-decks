// Converts a .pptx file into absolutely-positioned HTML/SVG slides.
//
// Every slide is rendered at its design size in "units" (1 unit = 1 CSS px at
// 96 dpi, i.e. 9525 EMU). The stylesheet defines --u as (slide width / design
// width), so the slide scales with its container while keeping its layout.

import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import path from 'node:path';

const EMU_PER_PX = 9525;
const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};

// ---------------------------------------------------------------- helpers

const px = (emu) => Number(emu || 0) / EMU_PER_PX;
const r2 = (n) => Math.round(n * 100) / 100;
const u = (n) => `calc(${r2(n)} * var(--u))`;
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function kids(el, local) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!local || n.localName === local)) out.push(n);
  }
  return out;
}
const kid = (el, local) => kids(el, local)[0] || null;
function path_(el, ...locals) {
  let cur = el;
  for (const l of locals) {
    cur = kid(cur, l);
    if (!cur) return null;
  }
  return cur;
}
const attr = (el, name, dflt = null) => (el && el.hasAttribute(name) ? el.getAttribute(name) : dflt);
const num = (el, name, dflt = 0) => (el && el.hasAttribute(name) ? Number(el.getAttribute(name)) : dflt);

// ---------------------------------------------------------------- fonts

const WEIGHT_WORDS = [
  ['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600],
  ['extrabold', 800], ['ultrabold', 800], ['thin', 100], ['light', 300],
  ['regular', 400], ['medium', 500], ['bold', 700], ['black', 900], ['heavy', 900],
];

// Fonts that Google Fonts can serve, and metric-compatible stand-ins for
// common proprietary fonts. Anything else falls back to system fonts.
export const GOOGLE_FONTS = new Set([
  'Inter', 'Poppins', 'Funnel Sans', 'Funnel Display', 'Roboto', 'Open Sans', 'Lato',
  'Montserrat', 'Source Sans 3', 'Nunito', 'Nunito Sans', 'Raleway', 'Work Sans', 'DM Sans',
  'Playfair Display', 'Merriweather', 'Oswald', 'Rubik', 'Manrope', 'IBM Plex Sans', 'IBM Plex Mono',
  'Space Grotesk', 'Roboto Mono', 'Carlito', 'Arimo', 'Tinos', 'Cousine', 'Caladea',
]);
const STAND_INS = {
  Calibri: ['Carlito'],
  Cambria: ['Caladea'],
  Arial: ['Arimo'],
  Helvetica: ['Arimo'],
  'Times New Roman': ['Tinos'],
  'Courier New': ['Cousine'],
  Avenir: ['Nunito Sans'],
};
const GENERIC = { 'Courier New': 'monospace', Cousine: 'monospace', 'Roboto Mono': 'monospace', 'IBM Plex Mono': 'monospace' };

function parseFont(typeface) {
  let name = (typeface || '').trim();
  let weight = null;
  const words = name.split(/\s+/);
  while (words.length > 1) {
    const w = words[words.length - 1].toLowerCase();
    const hit = WEIGHT_WORDS.find(([k]) => k === w);
    if (!hit) break;
    weight = hit[1];
    words.pop();
  }
  return { family: words.join(' '), weight };
}

// ---------------------------------------------------------------- colors

function hexToRgb(hex) {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
}

// ---------------------------------------------------------------- converter

export async function convertPptx(buffer, { mediaPrefix = 'media/' } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser({ onError: () => {} });
  const xmlCache = new Map();
  async function xml(p) {
    if (!xmlCache.has(p)) {
      const f = zip.file(p);
      xmlCache.set(p, f ? parser.parseFromString(await f.async('string'), 'text/xml') : null);
    }
    return xmlCache.get(p);
  }
  async function rels(partPath) {
    const dir = path.posix.dirname(partPath);
    const relPath = `${dir}/_rels/${path.posix.basename(partPath)}.rels`;
    const doc = await xml(relPath);
    const map = {};
    if (!doc) return map;
    for (const r of kids(doc.documentElement, 'Relationship')) {
      const target = r.getAttribute('Target');
      const external = r.getAttribute('TargetMode') === 'External';
      map[r.getAttribute('Id')] = {
        type: r.getAttribute('Type').split('/').pop(),
        target: external ? target : path.posix.normalize(path.posix.join(dir, target)),
        external,
      };
    }
    return map;
  }

  const presPath = 'ppt/presentation.xml';
  const pres = await xml(presPath);
  const presRels = await rels(presPath);
  const sldSz = path_(pres.documentElement, 'sldSz');
  const W = px(attr(sldSz, 'cx')), H = px(attr(sldSz, 'cy'));

  // Core properties (title / author) for metadata fallback.
  const core = await xml('docProps/core.xml');
  const coreText = (tag) => {
    if (!core) return null;
    const el = core.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() || null : null;
  };

  const presTextStyle = path_(pres.documentElement, 'defaultTextStyle');

  const fontsUsed = new Map(); // family -> Set("ital,wght")
  const media = new Map(); // zip path -> output filename
  const warnings = new Set();

  function useFont(family, weight, italic) {
    if (!fontsUsed.has(family)) fontsUsed.set(family, new Set());
    fontsUsed.get(family).add(`${italic ? 1 : 0},${weight}`);
  }
  function fontStack(family) {
    const list = [family, ...(STAND_INS[family] || [])];
    const generic = GENERIC[family] || 'sans-serif';
    return [...list.map((f) => `'${f}'`), generic].join(', ');
  }
  function mediaUrl(zipPath) {
    if (!media.has(zipPath)) media.set(zipPath, path.posix.basename(zipPath));
    return mediaPrefix + media.get(zipPath);
  }

  const slideIds = kids(path_(pres.documentElement, 'sldIdLst'), 'sldId');
  const slides = [];

  for (const sldId of slideIds) {
    const rid = sldId.getAttributeNS(NS.r, 'id') || sldId.getAttribute('r:id');
    const slidePath = presRels[rid].target;
    const slideDoc = await xml(slidePath);
    const slideRels = await rels(slidePath);
    const layoutPath = Object.values(slideRels).find((r) => r.type === 'slideLayout')?.target;
    const layoutRels = layoutPath ? await rels(layoutPath) : {};
    const masterPath = Object.values(layoutRels).find((r) => r.type === 'slideMaster')?.target;
    const masterDoc = masterPath ? await xml(masterPath) : null;
    const masterRels = masterPath ? await rels(masterPath) : {};
    const themePath = Object.values(masterRels).find((r) => r.type === 'theme')?.target;
    const themeDoc = themePath ? await xml(themePath) : null;
    const layoutDoc = layoutPath ? await xml(layoutPath) : null;

    // Theme colours + master colour map.
    const scheme = {};
    const clrScheme = themeDoc?.getElementsByTagNameNS(NS.a, 'clrScheme')[0];
    for (const c of kids(clrScheme)) {
      const v = kid(c, 'srgbClr') ? attr(kid(c, 'srgbClr'), 'val') : attr(kid(c, 'sysClr'), 'lastClr');
      if (v) scheme[c.localName] = v;
    }
    const clrMapEl = masterDoc ? path_(masterDoc.documentElement, 'clrMap') : null;
    const clrMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
    if (clrMapEl) for (const a of Array.from(clrMapEl.attributes)) clrMap[a.name] = a.value;

    // Resolves a colour element (srgbClr, schemeClr, ...) to {rgb, alpha}.
    function color(el) {
      if (!el) return null;
      let hex = null;
      switch (el.localName) {
        case 'srgbClr': hex = attr(el, 'val'); break;
        case 'schemeClr': {
          const v = attr(el, 'val');
          hex = scheme[clrMap[v] || v] || scheme[v] || '000000';
          break;
        }
        case 'sysClr': hex = attr(el, 'lastClr') || '000000'; break;
        case 'prstClr': hex = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000' }[attr(el, 'val')] || '000000'; break;
        case 'scrgbClr': hex = [num(el, 'r'), num(el, 'g'), num(el, 'b')].map((v) => Math.round((v / 100000) * 255).toString(16).padStart(2, '0')).join(''); break;
        default: return null;
      }
      let rgb = hexToRgb(hex);
      let alpha = 1;
      for (const m of kids(el)) {
        const val = num(m, 'val') / 100000;
        if (m.localName === 'alpha') alpha = val;
        else if (m.localName === 'lumMod' || m.localName === 'lumOff') {
          const hsl = rgbToHsl(rgb);
          hsl[2] = m.localName === 'lumMod' ? hsl[2] * val : hsl[2] + val;
          hsl[2] = Math.min(1, Math.max(0, hsl[2]));
          rgb = hslToRgb(hsl);
        } else if (m.localName === 'tint') rgb = rgb.map((c) => Math.round(255 - (255 - c) * val));
        else if (m.localName === 'shade') rgb = rgb.map((c) => Math.round(c * val));
      }
      return { rgb, alpha };
    }
    const css = (c) => (!c ? 'transparent' : c.alpha >= 1 ? `rgb(${c.rgb.join(' ')})` : `rgb(${c.rgb.join(' ')} / ${r2(c.alpha)})`);
    const colorIn = (el) => {
      if (!el) return null;
      for (const c of kids(el)) {
        const v = color(c);
        if (v) return v;
      }
      return null;
    };

    // ------------------------------------------------ fills & lines
    let defId = 0;
    const slideNo = slides.length + 1;
    const nextId = (p) => `s${slideNo}-${p}${++defId}`;

    function fill(spPr, relMap) {
      if (!spPr) return { kind: 'none' };
      const solid = kid(spPr, 'solidFill');
      if (solid) return { kind: 'solid', color: colorIn(solid) };
      const grad = kid(spPr, 'gradFill');
      if (grad) {
        const stops = kids(path_(grad, 'gsLst'), 'gs').map((gs) => ({ pos: num(gs, 'pos') / 1000, color: colorIn(gs) }));
        const lin = kid(grad, 'lin');
        return { kind: 'grad', stops, angle: lin ? num(lin, 'ang') / 60000 : 90 };
      }
      const blip = kid(spPr, 'blipFill');
      if (blip) {
        const embed = path_(blip, 'blip')?.getAttributeNS(NS.r, 'embed');
        const rel = relMap[embed];
        if (rel) return { kind: 'image', url: mediaUrl(rel.target) };
      }
      return { kind: 'none' };
    }

    function line(spPr) {
      const ln = spPr && kid(spPr, 'ln');
      if (!ln || kid(ln, 'noFill')) return null;
      const c = colorIn(kid(ln, 'solidFill'));
      if (!c) return null;
      const dash = attr(kid(ln, 'prstDash'), 'val', 'solid');
      return {
        color: c,
        width: Math.max(px(attr(ln, 'w', 12700)), 0.5),
        dash,
        cap: attr(ln, 'cap', 'flat'),
        head: attr(kid(ln, 'headEnd'), 'type', 'none'),
        tail: attr(kid(ln, 'tailEnd'), 'type', 'none'),
        headSize: [attr(kid(ln, 'headEnd'), 'w', 'med'), attr(kid(ln, 'headEnd'), 'len', 'med')],
        tailSize: [attr(kid(ln, 'tailEnd'), 'w', 'med'), attr(kid(ln, 'tailEnd'), 'len', 'med')],
      };
    }

    function dashArray(dash, w) {
      const d = {
        dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3],
        dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1],
      }[dash];
      return d ? d.map((v) => r2(v * w)).join(' ') : null;
    }

    function shadow(spPr) {
      const sh = path_(spPr, 'effectLst', 'outerShdw');
      if (!sh) return null;
      const dist = px(attr(sh, 'dist', 0));
      const dir = (num(sh, 'dir') / 60000) * (Math.PI / 180);
      const blur = px(attr(sh, 'blurRad', 0));
      const c = colorIn(sh) || { rgb: [0, 0, 0], alpha: 0.5 };
      return `drop-shadow(${u(Math.cos(dir) * dist)} ${u(Math.sin(dir) * dist)} ${u(blur / 2)} ${css(c)})`;
    }

    // ------------------------------------------------ geometry
    function geometry(prst, w, h, avLst) {
      const adj = {};
      for (const gd of kids(avLst, 'gd')) {
        const m = /val\s+(-?\d+)/.exec(attr(gd, 'fmla', ''));
        if (m) adj[attr(gd, 'name')] = Number(m[1]);
      }
      const a = (name, d) => (adj[name] ?? d) / 100000;
      const m = Math.min(w, h);
      switch (prst) {
        case 'rect':
        case undefined:
        case null:
          return { tag: 'rect', a: { x: 0, y: 0, width: w, height: h } };
        case 'roundRect': {
          const r = a('adj', 16667) * m;
          return { tag: 'rect', a: { x: 0, y: 0, width: w, height: h, rx: r, ry: r }, radius: r };
        }
        case 'ellipse':
          return { tag: 'ellipse', a: { cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2 }, radius: '50%' };
        case 'triangle': {
          const x = a('adj', 50000) * w;
          return { tag: 'polygon', a: { points: `${x},0 ${w},${h} 0,${h}` } };
        }
        case 'rtTriangle':
          return { tag: 'polygon', a: { points: `0,0 ${w},${h} 0,${h}` } };
        case 'diamond':
          return { tag: 'polygon', a: { points: `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}` } };
        case 'hexagon': {
          const x = a('adj', 25000) * m;
          return { tag: 'polygon', a: { points: `${x},0 ${w - x},0 ${w},${h / 2} ${w - x},${h} ${x},${h} 0,${h / 2}` } };
        }
        case 'chevron': {
          const x = a('adj', 50000) * m;
          return { tag: 'polygon', a: { points: `0,0 ${w - x},0 ${w},${h / 2} ${w - x},${h} 0,${h} ${x},${h / 2}` } };
        }
        case 'homePlate': {
          const x = a('adj', 50000) * m;
          return { tag: 'polygon', a: { points: `0,0 ${w - x},0 ${w},${h / 2} ${w - x},${h} 0,${h}` } };
        }
        case 'rightArrow': {
          const a1 = a('adj1', 50000), a2 = a('adj2', 50000);
          const t = (h * (1 - a1)) / 2, x = w - a2 * m;
          return { tag: 'polygon', a: { points: `0,${t} ${x},${t} ${x},0 ${w},${h / 2} ${x},${h} ${x},${h - t} 0,${h - t}` } };
        }
        case 'line':
        case 'straightConnector1':
        case 'bentConnector1':
          return { tag: 'line', a: { x1: 0, y1: 0, x2: w, y2: h } };
        default:
          warnings.add(`Unsupported shape "${prst}" drawn as a rectangle`);
          return { tag: 'rect', a: { x: 0, y: 0, width: w, height: h } };
      }
    }

    function marker(type, [wSz, lenSz], lnW, color, id) {
      if (!type || type === 'none') return '';
      const scale = { sm: 2, med: 3, lg: 5 };
      const mw = scale[wSz] || 3, ml = scale[lenSz] || 3;
      const shapes = {
        triangle: `<path d="M0,0 L${ml},${mw / 2} L0,${mw} z" fill="${color}"/>`,
        arrow: `<path d="M0,0 L${ml},${mw / 2} L0,${mw}" fill="none" stroke="${color}" stroke-width="${r2(1 / lnW)}"/>`,
        stealth: `<path d="M0,0 L${ml},${mw / 2} L0,${mw} L${ml / 3},${mw / 2} z" fill="${color}"/>`,
        diamond: `<path d="M0,${mw / 2} L${ml / 2},0 L${ml},${mw / 2} L${ml / 2},${mw} z" fill="${color}"/>`,
        oval: `<ellipse cx="${ml / 2}" cy="${mw / 2}" rx="${ml / 2}" ry="${mw / 2}" fill="${color}"/>`,
      };
      const body = shapes[type] || shapes.triangle;
      const refX = type === 'oval' || type === 'diamond' ? ml / 2 : ml * 0.8;
      return `<marker id="${id}" viewBox="0 0 ${ml} ${mw}" refX="${refX}" refY="${mw / 2}" markerWidth="${ml}" markerHeight="${mw}" orient="auto-start-reverse" markerUnits="strokeWidth" overflow="visible">${body}</marker>`;
    }

    function svgShape(prst, avLst, w, h, f, ln, flipH, flipV) {
      const g = geometry(prst, w, h, avLst);
      const defs = [];
      const at = { ...g.a };
      if (g.tag === 'line') {
        if (flipH) [at.x1, at.x2] = [at.x2, at.x1];
        if (flipV) [at.y1, at.y2] = [at.y2, at.y1];
      }
      let fillAttr = 'none';
      if (g.tag !== 'line') {
        if (f.kind === 'solid') fillAttr = css(f.color);
        else if (f.kind === 'grad') {
          const id = nextId('g');
          const ang = (f.angle * Math.PI) / 180;
          const x2 = 0.5 + Math.cos(ang) / 2, y2 = 0.5 + Math.sin(ang) / 2;
          defs.push(`<linearGradient id="${id}" x1="${r2(1 - x2)}" y1="${r2(1 - y2)}" x2="${r2(x2)}" y2="${r2(y2)}">${f.stops
            .map((s) => `<stop offset="${s.pos}%" stop-color="${css(s.color)}"/>`).join('')}</linearGradient>`);
          fillAttr = `url(#${id})`;
        } else if (f.kind === 'image') {
          const id = nextId('p');
          defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${r2(w)}" height="${r2(h)}"><image href="${esc(f.url)}" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="none"/></pattern>`);
          fillAttr = `url(#${id})`;
        }
      }
      at.fill = fillAttr;
      if (ln) {
        at.stroke = css(ln.color);
        at['stroke-width'] = r2(ln.width);
        const da = dashArray(ln.dash, ln.width);
        if (da) at['stroke-dasharray'] = da;
        if (ln.cap === 'rnd') at['stroke-linecap'] = 'round';
        if (g.tag === 'line') {
          const col = css(ln.color);
          if (ln.head !== 'none') {
            const id = nextId('m');
            defs.push(marker(ln.head, ln.headSize, ln.width, col, id));
            at['marker-start'] = `url(#${id})`;
          }
          if (ln.tail !== 'none') {
            const id = nextId('m');
            defs.push(marker(ln.tail, ln.tailSize, ln.width, col, id));
            at['marker-end'] = `url(#${id})`;
          }
        }
      }
      if (fillAttr === 'none' && !ln) return '';
      for (const k of Object.keys(at)) if (typeof at[k] === 'number') at[k] = r2(at[k]);
      const attrs = Object.entries(at).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
      const flip = g.tag !== 'line' && (flipH || flipV)
        ? ` transform="translate(${flipH ? r2(w) : 0} ${flipV ? r2(h) : 0}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1})"`
        : '';
      const pad = 20;
      const box = `left:${u(-pad)};top:${u(-pad)};width:${u(w + pad * 2)};height:${u(h + pad * 2)}`;
      return `<svg class="geom" style="${box}" viewBox="${-pad} ${-pad} ${r2(w + pad * 2)} ${r2(h + pad * 2)}" aria-hidden="true">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<${g.tag} ${attrs}${flip}/></svg>`;
    }

    // ------------------------------------------------ text
    function runStyle(rPr, endPara = false) {
      const s = {};
      if (!rPr) return s;
      if (rPr.hasAttribute('sz')) s.size = num(rPr, 'sz') / 100;
      if (rPr.hasAttribute('b')) s.bold = attr(rPr, 'b') === '1' || attr(rPr, 'b') === 'true';
      if (rPr.hasAttribute('i')) s.italic = attr(rPr, 'i') === '1' || attr(rPr, 'i') === 'true';
      if (rPr.hasAttribute('u')) s.underline = attr(rPr, 'u') !== 'none';
      if (rPr.hasAttribute('strike')) s.strike = attr(rPr, 'strike') !== 'noStrike';
      if (rPr.hasAttribute('cap')) s.cap = attr(rPr, 'cap');
      if (rPr.hasAttribute('spc')) s.spacing = num(rPr, 'spc') / 100;
      if (rPr.hasAttribute('baseline')) s.baseline = num(rPr, 'baseline') / 1000;
      const fillEl = kid(rPr, 'solidFill');
      if (fillEl) s.color = colorIn(fillEl);
      const hl = kid(rPr, 'highlight');
      if (hl) s.highlight = colorIn(hl);
      const latin = kid(rPr, 'latin');
      if (latin && attr(latin, 'typeface')) s.font = attr(latin, 'typeface');
      if (!endPara) {
        const link = kid(rPr, 'hlinkClick');
        if (link) s.link = link.getAttributeNS(NS.r, 'id');
      }
      return s;
    }

    function themeFont(name) {
      // +mj-lt / +mn-lt theme font references.
      if (!name || !name.startsWith('+')) return name;
      const kind = name.startsWith('+mj') ? 'majorFont' : 'minorFont';
      const el = themeDoc?.getElementsByTagNameNS(NS.a, kind)[0];
      return attr(kid(el, 'latin'), 'typeface', 'Calibri');
    }

    function runCss(s, scale) {
      const out = [];
      const { family, weight: nameWeight } = parseFont(themeFont(s.font || 'Calibri'));
      const weight = nameWeight ? (s.bold && nameWeight < 700 ? 700 : nameWeight) : s.bold ? 700 : 400;
      useFont(family, weight, !!s.italic);
      out.push(`font-family:${fontStack(family)}`);
      if (weight !== 400) out.push(`font-weight:${weight}`);
      if (s.italic) out.push('font-style:italic');
      const size = (s.size || 18) * scale;
      out.push(`font-size:${u((size * 96) / 72)}`);
      if (s.color) out.push(`color:${css(s.color)}`);
      const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean);
      if (deco.length) out.push(`text-decoration:${deco.join(' ')}`);
      if (s.cap === 'all') out.push('text-transform:uppercase');
      if (s.cap === 'small') out.push('font-variant:small-caps');
      if (s.spacing) out.push(`letter-spacing:${u((s.spacing * 96) / 72)}`);
      if (s.baseline) out.push(`vertical-align:${r2(s.baseline * 100)}%`, `font-size:${u(((size * 96) / 72) * 0.7)}`);
      if (s.highlight) out.push(`background:${css(s.highlight)}`);
      return out.join(';');
    }

    function textBody(txBody, relMap, box, extraLst = []) {
      const bodyPr = kid(txBody, 'bodyPr');
      const ins = {
        l: px(attr(bodyPr, 'lIns', 91440)), r: px(attr(bodyPr, 'rIns', 91440)),
        t: px(attr(bodyPr, 'tIns', 45720)), b: px(attr(bodyPr, 'bIns', 45720)),
      };
      const anchor = attr(bodyPr, 'anchor', 't');
      const wrap = attr(bodyPr, 'wrap', 'square') !== 'none';
      const norm = kid(bodyPr, 'normAutofit');
      const fontScale = norm ? num(norm, 'fontScale', 100000) / 100000 : 1;
      const lnReduce = norm ? num(norm, 'lnSpcReduction', 0) / 100000 : 0;
      const vert = attr(bodyPr, 'vert', 'horz');

      // Paragraph/run defaults, lowest priority first: presentation default
      // text style, master "other" style, then the shape's own lstStyle.
      const masterOther = masterDoc ? path_(masterDoc.documentElement, 'txStyles', 'otherStyle') : null;
      const lst = kid(txBody, 'lstStyle');
      const levelChain = (lvl) =>
        [presTextStyle, masterOther, ...extraLst, lst].flatMap((st) => [kid(st, 'defPPr'), kid(st, `lvl${lvl + 1}pPr`)]).filter(Boolean);

      const paras = kids(txBody, 'p');
      if (!paras.some((p) => kids(p).some((n) => ['r', 'fld'].includes(n.localName) && n.textContent.length))) return '';

      const autoNum = {};
      const html = [];
      for (const p of paras) {
        const pPr = kid(p, 'pPr');
        const lvl = num(pPr, 'lvl', 0);
        const chain = levelChain(lvl);
        const def = chain[chain.length - 1] || null;
        const pick = (name) => (pPr && pPr.hasAttribute(name) ? pPr : [...chain].reverse().find((d) => d.hasAttribute(name)) || null);
        const algn = attr(pick('algn'), 'algn', 'l');
        const marL = px(attr(pick('marL'), 'marL', 0));
        const indent = px(attr(pick('indent'), 'indent', 0));
        const defRPr = Object.assign({}, ...chain.map((d) => runStyle(kid(d, 'defRPr'), true)));
        const pDefRPr = runStyle(kid(pPr, 'defRPr'));
        const endStyle = runStyle(kid(p, 'endParaRPr'), true);

        const spacing = (name) => {
          const el = kid(pPr, name) || [...chain].reverse().map((d) => kid(d, name)).find(Boolean);
          if (!el) return null;
          if (kid(el, 'spcPts')) return { pts: num(kid(el, 'spcPts'), 'val') / 100 };
          if (kid(el, 'spcPct')) return { pct: num(kid(el, 'spcPct'), 'val') / 100000 };
          return null;
        };
        const lnSpc = spacing('lnSpc');
        const before = spacing('spcBef');
        const after = spacing('spcAft');

        const runs = [];
        let firstSize = null;
        for (const n of kids(p)) {
          if (n.localName === 'r' || n.localName === 'fld') {
            const s = { ...defRPr, ...pDefRPr, ...runStyle(kid(n, 'rPr')) };
            const text = kid(n, 't')?.textContent ?? '';
            if (firstSize == null) firstSize = s.size || 18;
            let span = `<span style="${runCss(s, fontScale)}">${esc(text)}</span>`;
            const rel = s.link && relMap[s.link];
            if (rel && rel.external) span = `<a href="${esc(rel.target)}" target="_blank" rel="noopener">${span}</a>`;
            runs.push(span);
          } else if (n.localName === 'br') {
            const s = { ...defRPr, ...pDefRPr, ...runStyle(kid(n, 'rPr')) };
            runs.push(`<br><span style="${runCss(s, fontScale)}">​</span>`);
          }
        }
        const baseStyle = { ...defRPr, ...pDefRPr, ...endStyle };
        const baseSize = firstSize ?? baseStyle.size ?? 18;
        if (!runs.length) runs.push(`<span style="${runCss(baseStyle, fontScale)}">​</span>`);

        // Bullets.
        let bullet = '';
        if (pPr && !kid(pPr, 'buNone')) {
          const fromChain = (n) => kid(pPr, n) || [...chain].reverse().map((d) => kid(d, n)).find(Boolean);
          const buChar = fromChain('buChar');
          const buAuto = fromChain('buAutoNum');
          let ch = null;
          if (buChar) ch = attr(buChar, 'char', '•');
          else if (buAuto) {
            autoNum[lvl] = (autoNum[lvl] || num(buAuto, 'startAt', 1) - 1) + 1;
            const t = attr(buAuto, 'type', 'arabicPeriod');
            const n = autoNum[lvl];
            const label = t.startsWith('alphaLc') ? String.fromCharCode(96 + n) : t.startsWith('alphaUc') ? String.fromCharCode(64 + n) : t.startsWith('romanLc') ? toRoman(n).toLowerCase() : t.startsWith('romanUc') ? toRoman(n) : String(n);
            ch = t.endsWith('ParenR') ? `${label})` : t.endsWith('ParenBoth') ? `(${label})` : `${label}.`;
          }
          if (ch) {
            const bs = { ...baseStyle, ...(runStyle(kid(p, 'r') && kid(kid(p, 'r'), 'rPr'))) };
            const buClr = colorIn(kid(pPr, 'buClr'));
            if (buClr) bs.color = buClr;
            const buFont = kid(pPr, 'buFont');
            if (buFont && !/wingdings|symbol/i.test(attr(buFont, 'typeface', ''))) bs.font = attr(buFont, 'typeface');
            const buSzPct = kid(pPr, 'buSzPct');
            if (buSzPct) bs.size = (bs.size || 18) * (num(buSzPct, 'val') / 100000);
            bullet = `<span class="bu" style="${runCss(bs, fontScale)};width:${u(Math.max(-indent, 0))}">${esc(ch)}</span>`;
          }
        }

        const sizePx = (baseSize * fontScale * 96) / 72;
        // The paragraph's own font size sets the line "strut"; match the text.
        const st = [`font-size:${u(sizePx)}`];
        if (algn !== 'l') st.push(`text-align:${{ ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[algn] || 'left'}`);
        if (marL) st.push(`padding-left:${u(marL)}`);
        if (indent) st.push(`text-indent:${u(indent)}`);
        if (lnSpc?.pct) st.push(`line-height:${r2(Math.max(lnSpc.pct - lnReduce, 0.5) * 1.2)}`);
        else if (lnSpc?.pts) st.push(`line-height:${u((lnSpc.pts * 96) / 72)}`);
        const sp = (s) => (s?.pts ? (s.pts * 96) / 72 : s?.pct ? s.pct * sizePx * 1.2 : 0);
        const mt = sp(before), mb = sp(after);
        if (mt) st.push(`margin-top:${u(mt)}`);
        if (mb) st.push(`margin-bottom:${u(mb)}`);
        html.push(`<p${st.length ? ` style="${st.join(';')}"` : ''}>${bullet}${runs.join('')}</p>`);
      }

      const st = [
        `padding:${u(ins.t)} ${u(ins.r)} ${u(ins.b)} ${u(ins.l)}`,
        `justify-content:${{ t: 'flex-start', ctr: 'center', b: 'flex-end', just: 'center', dist: 'center' }[anchor] || 'flex-start'}`,
      ];
      if (!wrap) st.push('white-space:pre');
      if (vert === 'vert' || vert === 'eaVert') st.push('writing-mode:vertical-rl');
      if (vert === 'vert270') st.push('writing-mode:vertical-rl;transform:rotate(180deg)');
      return `<div class="tx" style="${st.join(';')}">${html.join('')}</div>`;
    }

    // ------------------------------------------------ elements
    function xfrmBox(spPr, parent) {
      const x = path_(spPr, 'xfrm');
      if (!x) return null;
      const off = kid(x, 'off'), ext = kid(x, 'ext');
      let box = {
        x: px(attr(off, 'x')), y: px(attr(off, 'y')), w: px(attr(ext, 'cx')), h: px(attr(ext, 'cy')),
        rot: num(x, 'rot') / 60000, flipH: attr(x, 'flipH') === '1', flipV: attr(x, 'flipV') === '1',
      };
      if (parent) box = parent(box);
      return box;
    }

    function wrapperStyle(box, extra = []) {
      const st = [`left:${u(box.x)}`, `top:${u(box.y)}`, `width:${u(box.w)}`, `height:${u(box.h)}`];
      if (box.rot) st.push(`transform:rotate(${r2(box.rot)}deg)`);
      return [...st, ...extra].join(';');
    }

    function renderTree(tree, relMap, parent) {
      const out = [];
      for (const el of kids(tree)) {
        const name = el.localName;
        if (name === 'sp' || name === 'cxnSp') out.push(renderShape(el, relMap, parent));
        else if (name === 'pic') out.push(renderPic(el, relMap, parent));
        else if (name === 'grpSp') out.push(renderGroup(el, relMap, parent));
        else if (name === 'graphicFrame') out.push(renderFrame(el, relMap, parent));
        else if (name === 'AlternateContent') {
          const fb = kid(el, 'Fallback');
          if (fb) out.push(renderTree(fb, relMap, parent));
        }
      }
      return out.join('');
    }

    function shapeLink(nvPr, relMap, html) {
      const link = nvPr && path_(nvPr, 'cNvPr', 'hlinkClick');
      const rel = link && relMap[link.getAttributeNS(NS.r, 'id')];
      if (rel && rel.external) return `<a class="el-link" href="${esc(rel.target)}" target="_blank" rel="noopener">${html}</a>`;
      return html;
    }

    function renderShape(el, relMap, parent) {
      const nv = kid(el, 'nvSpPr') || kid(el, 'nvCxnSpPr');
      if (nv && path_(nv, 'nvPr', 'ph') && !kid(el, 'txBody')) return '';
      const spPr = kid(el, 'spPr');
      const box = xfrmBox(spPr, parent);
      if (!box) {
        if (nv && path_(nv, 'nvPr', 'ph')) warnings.add('Placeholder without its own position skipped');
        return '';
      }
      const prstEl = kid(spPr, 'prstGeom');
      const prst = prstEl ? attr(prstEl, 'prst') : kid(spPr, 'custGeom') ? 'rect' : 'rect';
      if (kid(spPr, 'custGeom')) warnings.add('Custom geometry drawn as its bounding rectangle');
      const f = fill(spPr, relMap);
      const ln = line(spPr);
      const geom = svgShape(prst, kid(prstEl, 'avLst'), box.w, box.h, f, ln, box.flipH, box.flipV);
      const txBody = kid(el, 'txBody');
      const text = txBody ? textBody(txBody, relMap, box) : '';
      if (!geom && !text) return '';
      const sh = shadow(spPr);
      const st = sh ? [`filter:${sh}`] : [];
      return shapeLink(nv, relMap, `<div class="el" style="${wrapperStyle(box, st)}">${geom}${text}</div>`);
    }

    function renderPic(el, relMap, parent) {
      const spPr = kid(el, 'spPr');
      const box = xfrmBox(spPr, parent);
      if (!box) return '';
      const blipFill = kid(el, 'blipFill');
      const blip = kid(blipFill, 'blip');
      const embed = blip?.getAttributeNS(NS.r, 'embed');
      const rel = relMap[embed];
      if (!rel) return '';
      const nv = kid(el, 'nvPicPr');
      const alt = attr(path_(nv, 'cNvPr'), 'descr', '') || '';
      const src = rel.target.toLowerCase().endsWith('.emf') || rel.target.toLowerCase().endsWith('.wmf') ? null : mediaUrl(rel.target);
      if (!src) {
        warnings.add('EMF/WMF image skipped (browsers cannot display it)');
        return '';
      }
      const crop = kid(blipFill, 'srcRect');
      const c = { l: num(crop, 'l') / 100000, t: num(crop, 't') / 100000, r: num(crop, 'r') / 100000, b: num(crop, 'b') / 100000 };
      const iw = 1 - c.l - c.r, ih = 1 - c.t - c.b;
      const alphaEl = kid(blip, 'alphaModFix');
      const opacity = alphaEl && alphaEl.hasAttribute('amt') ? num(alphaEl, 'amt') / 100000 : 1;
      const imgSt = [
        `left:${r2((-c.l / iw) * 100)}%`, `top:${r2((-c.t / ih) * 100)}%`,
        `width:${r2((1 / iw) * 100)}%`, `height:${r2((1 / ih) * 100)}%`,
      ];
      const flip = [box.flipH && 'scaleX(-1)', box.flipV && 'scaleY(-1)'].filter(Boolean).join(' ');
      const prst = attr(kid(spPr, 'prstGeom'), 'prst', 'rect');
      const g = geometry(prst, box.w, box.h, path_(spPr, 'prstGeom', 'avLst'));
      const wrapSt = ['overflow:hidden'];
      if (g.radius) wrapSt.push(`border-radius:${typeof g.radius === 'number' ? u(g.radius) : g.radius}`);
      if (opacity < 1) wrapSt.push(`opacity:${r2(opacity)}`);
      if (flip) wrapSt.push(`--flip:${flip}`);
      const ln = line(spPr);
      const border = ln ? `<span class="pic-line" style="box-shadow:inset 0 0 0 ${u(ln.width)} ${css(ln.color)}${g.radius ? `;border-radius:${typeof g.radius === 'number' ? u(g.radius) : g.radius}` : ''}"></span>` : '';
      const sh = shadow(spPr);
      const img = `<img class="pic${flip ? ' flip' : ''}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" style="${imgSt.join(';')}">${border}`;
      let html = `<div class="el" style="${wrapperStyle(box, wrapSt)}">${img}</div>`;
      if (sh) html = `<div class="el" style="${wrapperStyle({ ...box, rot: 0 }, [`filter:${sh}`])}"><div class="el" style="left:0;top:0;width:100%;height:100%;${box.rot ? `transform:rotate(${r2(box.rot)}deg);` : ''}${wrapSt.join(';')}">${img}</div></div>`;
      return shapeLink(nv, relMap, html);
    }

    function renderGroup(el, relMap, parent) {
      const x = path_(el, 'grpSpPr', 'xfrm');
      if (!x) return renderTree(el, relMap, parent);
      const off = kid(x, 'off'), ext = kid(x, 'ext'), chOff = kid(x, 'chOff'), chExt = kid(x, 'chExt');
      const g = { x: px(attr(off, 'x')), y: px(attr(off, 'y')), w: px(attr(ext, 'cx')), h: px(attr(ext, 'cy')) };
      const ch = { x: px(attr(chOff, 'x')), y: px(attr(chOff, 'y')), w: px(attr(chExt, 'cx')) || g.w, h: px(attr(chExt, 'cy')) || g.h };
      const sx = ch.w ? g.w / ch.w : 1, sy = ch.h ? g.h / ch.h : 1;
      const map = (b) => {
        const nb = { ...b, x: g.x + (b.x - ch.x) * sx, y: g.y + (b.y - ch.y) * sy, w: b.w * sx, h: b.h * sy };
        return parent ? parent(nb) : nb;
      };
      const rot = num(x, 'rot') / 60000;
      if (rot) warnings.add('Rotated group: children rendered unrotated');
      return renderTree(el, relMap, map);
    }

    function renderFrame(el, relMap, parent) {
      const box = xfrmBox(el, parent) || (() => {
        const x = kid(el, 'xfrm');
        if (!x) return null;
        const off = kid(x, 'off'), ext = kid(x, 'ext');
        const b = { x: px(attr(off, 'x')), y: px(attr(off, 'y')), w: px(attr(ext, 'cx')), h: px(attr(ext, 'cy')), rot: 0 };
        return parent ? parent(b) : b;
      })();
      const tbl = el.getElementsByTagNameNS(NS.a, 'tbl')[0];
      if (!box || !tbl) {
        warnings.add('Chart/SmartArt/embedded object skipped');
        return '';
      }
      const cols = kids(path_(tbl, 'tblGrid'), 'gridCol').map((c) => px(attr(c, 'w')));
      const rows = kids(tbl, 'tr').map((tr) => {
        const cells = kids(tr, 'tc').map((tc) => {
          if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') return '';
          const tcPr = kid(tc, 'tcPr');
          const f = fill(tcPr, relMap);
          const bg = f.kind === 'solid' ? `background:${css(f.color)};` : '';
          const borders = ['lnL', 'lnR', 'lnT', 'lnB'].map((b) => {
            const lnEl = kid(tcPr, b);
            if (!lnEl || kid(lnEl, 'noFill')) return '';
            const c = colorIn(kid(lnEl, 'solidFill'));
            if (!c) return '';
            const side = { lnL: 'left', lnR: 'right', lnT: 'top', lnB: 'bottom' }[b];
            return `border-${side}:${u(Math.max(px(attr(lnEl, 'w', 12700)), 0.5))} solid ${css(c)};`;
          }).join('');
          const span = `${attr(tc, 'gridSpan') ? ` colspan="${attr(tc, 'gridSpan')}"` : ''}${attr(tc, 'rowSpan') ? ` rowspan="${attr(tc, 'rowSpan')}"` : ''}`;
          const txBody = kid(tc, 'txBody');
          const inner = txBody ? textBody(txBody, relMap, box) : '';
          return `<td${span} style="${bg}${borders}">${inner}</td>`;
        });
        return `<tr style="height:${u(px(attr(tr, 'h')))}">${cells.join('')}</tr>`;
      });
      return `<div class="el" style="${wrapperStyle(box)}"><table class="tbl"><colgroup>${cols.map((c) => `<col style="width:${u(c)}">`).join('')}</colgroup>${rows.join('')}</table></div>`;
    }

    // ------------------------------------------------ background
    function background(doc, relMap) {
      const bg = doc && path_(doc.documentElement, 'cSld', 'bg');
      if (!bg) return null;
      const bgPr = kid(bg, 'bgPr');
      if (bgPr) {
        const f = fill(bgPr, relMap);
        if (f.kind === 'solid') return `background:${css(f.color)}`;
        if (f.kind === 'image') return `background:url('${f.url}') center/cover`;
        if (f.kind === 'grad') return `background:linear-gradient(${r2(f.angle + 90)}deg, ${f.stops.map((s) => `${css(s.color)} ${s.pos}%`).join(', ')})`;
      }
      const bgRef = kid(bg, 'bgRef');
      if (bgRef) {
        const c = colorIn(bgRef);
        if (c) return `background:${css(c)}`;
      }
      return null;
    }
    const bgCss =
      background(slideDoc, slideRels) || background(layoutDoc, layoutRels) || background(masterDoc, masterRels) || 'background:#fff';

    // Master / layout decorations (non-placeholder shapes), unless hidden.
    const showMaster = attr(slideDoc.documentElement, 'showMasterSp', '1') !== '0';
    const layoutShowMaster = layoutDoc ? attr(layoutDoc.documentElement, 'showMasterSp', '1') !== '0' : true;
    const deco = (doc, relMap) => {
      const tree = doc && path_(doc.documentElement, 'cSld', 'spTree');
      if (!tree) return '';
      const clone = tree.cloneNode(true);
      for (const n of kids(clone)) if (n.getElementsByTagNameNS(NS.p, 'ph').length) clone.removeChild(n);
      return renderTree(clone, relMap);
    };
    let body = '';
    if (showMaster && layoutShowMaster) body += deco(masterDoc, masterRels);
    if (showMaster) body += deco(layoutDoc, layoutRels);
    body += renderTree(path_(slideDoc.documentElement, 'cSld', 'spTree'), slideRels);

    const hidden = attr(slideDoc.documentElement, 'show', '1') === '0';
    const text = Array.from(slideDoc.getElementsByTagNameNS(NS.a, 't')).map((t) => t.textContent).join(' ').replace(/\s+/g, ' ').trim();

    slides.push({ html: body, background: bgCss, hidden, text });
  }

  // Collect media buffers.
  const mediaFiles = [];
  for (const [zipPath, name] of media) {
    const f = zip.file(zipPath);
    if (f) mediaFiles.push({ name, data: await f.async('nodebuffer') });
  }

  return {
    width: W,
    height: H,
    slides: slides.filter((s) => !s.hidden),
    fonts: fontsUsed,
    media: mediaFiles,
    meta: { title: coreText('dc:title'), author: coreText('dc:creator') },
    warnings: [...warnings],
  };
}

function toRoman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}

// What each Google family actually offers. Requesting a weight or italic a
// family lacks makes Google reject the request, so requests are clamped.
// Families not listed are requested as regular/bold only.
const FONT_CAPS = {
  Inter: { range: [100, 900], italic: true },
  'Funnel Sans': { range: [300, 800], italic: true },
  'Funnel Display': { range: [300, 800], italic: false },
  Poppins: { weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], italic: true },
  Montserrat: { range: [100, 900], italic: true },
  'Open Sans': { range: [300, 800], italic: true },
  Roboto: { range: [100, 900], italic: true },
  'DM Sans': { range: [100, 1000], italic: true },
  'Nunito Sans': { range: [200, 1000], italic: true },
  Manrope: { range: [200, 800], italic: false },
  'Space Grotesk': { range: [300, 700], italic: false },
  Carlito: { weights: [400, 700], italic: true },
  Caladea: { weights: [400, 700], italic: true },
  Arimo: { range: [400, 700], italic: true },
  Tinos: { weights: [400, 700], italic: true },
  Cousine: { weights: [400, 700], italic: true },
};

// Returns one Google Fonts stylesheet URL per family (so one bad family can
// never break the others).
export function googleFontsUrls(fonts) {
  const families = new Map();
  for (const [family, combos] of fonts) {
    for (const fam of [family, ...(STAND_INS[family] || [])]) {
      if (!GOOGLE_FONTS.has(fam)) continue;
      if (!families.has(fam)) families.set(fam, new Set());
      combos.forEach((c) => families.get(fam).add(c));
    }
  }
  return [...families].sort(([a], [b]) => a.localeCompare(b)).map(([fam, set]) => {
    const caps = FONT_CAPS[fam] || { weights: [400, 700], italic: false };
    const clamp = (w) => {
      if (caps.range) return Math.min(caps.range[1], Math.max(caps.range[0], w));
      return caps.weights.reduce((best, v) => (Math.abs(v - w) < Math.abs(best - w) ? v : best), caps.weights[0]);
    };
    const tuples = new Set(['0,400', '0,700']);
    for (const c of set) {
      const [i, w] = c.split(',').map(Number);
      tuples.add(`${caps.italic ? i : 0},${clamp(w)}`);
      if (i && caps.italic) tuples.add(`1,${clamp(400)}`);
    }
    const sorted = [...tuples].map((t) => t.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const spec = caps.italic
      ? `ital,wght@${sorted.map((t) => t.join(',')).join(';')}`
      : `wght@${[...new Set(sorted.map((t) => t[1]))].join(';')}`;
    return `https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, '+')}:${spec}&display=swap`;
  });
}
