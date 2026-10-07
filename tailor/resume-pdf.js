// Builds a one-page, single-column, ATS-friendly resume PDF on this device with the vendored
// pdf-lib (lib/vendor/pdf-lib, 1.17.1). Real text in the standard Helvetica fonts: no tables,
// images, columns or embedded fonts.
//
// resume: {
//   name, contact: [strings],
//   sections: [{ heading, entries: [{ left, right, sub, subRight, bullets: [] }] } | { heading, lines: [] }]
// }
// Returns { bytes, fontSize, trimmed } where trimmed is how many bullets were dropped to fit.
import { PDFDocument, StandardFonts, rgb } from '../lib/vendor/pdf-lib/pdf-lib.esm.min.js';

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN_X = 46;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 38;
const TEXT_W = PAGE_W - MARGIN_X * 2;
const BULLET_INDENT = 11;
const FONT_SIZES = [10.5, 10, 9.5];

// The standard fonts only cover Windows-1252. Map common typography, drop the rest.
const WIN_ANSI_EXTRA = '–—‘’“”•…€™';
function pdfText(value) {
  return String(value || '')
    .replace(/[‐‑‒]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[●▪◦‣∙]/g, '•')
    .replace(/\s+/g, ' ')
    .trim()
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch) ? ch : '';
    })
    .join('');
}

function wrap(text, font, size, width) {
  const words = pdfText(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Lays the resume out; draws only when `page` is given. Returns the y reached.
function layout(resume, fonts, size, page) {
  const lh = size * 1.28;
  const ink = rgb(0.1, 0.1, 0.1);
  let y = PAGE_H - MARGIN_TOP;
  const text = (str, x, font, sz) => {
    if (page) page.drawText(str, { x, y: y - sz, size: sz, font, color: ink });
  };
  const centered = (str, font, sz) => {
    for (const line of wrap(str, font, sz, TEXT_W)) {
      text(line, (PAGE_W - font.widthOfTextAtSize(line, sz)) / 2, font, sz);
      y -= sz * 1.3;
    }
  };

  centered(resume.name, fonts.bold, size + 8);
  y -= 2;
  if (resume.contact.length) centered(resume.contact.map(pdfText).filter(Boolean).join('  |  '), fonts.regular, size - 1);

  for (const section of resume.sections) {
    const hasContent = section.lines ? section.lines.some(Boolean) : section.entries.length > 0;
    if (!hasContent) continue;
    y -= size * 0.7;
    text(pdfText(section.heading).toUpperCase(), MARGIN_X, fonts.bold, size + 1);
    y -= (size + 1) * 1.2 + 2;
    if (page) page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 0.6, color: ink });
    y -= 4;

    if (section.lines) {
      for (const para of section.lines) {
        for (const line of wrap(para, fonts.regular, size, TEXT_W)) {
          text(line, MARGIN_X, fonts.regular, size);
          y -= lh;
        }
      }
      continue;
    }

    for (const entry of section.entries) {
      // Title line: bold on the left, dates on the right.
      const right = pdfText(entry.right);
      const rightW = right ? fonts.regular.widthOfTextAtSize(right, size) + 12 : 0;
      const leftLines = wrap(entry.left, fonts.bold, size, TEXT_W - rightW);
      leftLines.forEach((line, i) => {
        text(line, MARGIN_X, fonts.bold, size);
        if (i === 0 && right) text(right, PAGE_W - MARGIN_X - fonts.regular.widthOfTextAtSize(right, size), fonts.regular, size);
        y -= lh;
      });
      if (entry.sub || entry.subRight) {
        const subRight = pdfText(entry.subRight);
        const subRightW = subRight ? fonts.italic.widthOfTextAtSize(subRight, size) + 12 : 0;
        wrap(entry.sub, fonts.italic, size, TEXT_W - subRightW).forEach((line, i) => {
          text(line, MARGIN_X, fonts.italic, size);
          if (i === 0 && subRight) text(subRight, PAGE_W - MARGIN_X - fonts.italic.widthOfTextAtSize(subRight, size), fonts.italic, size);
          y -= lh;
        });
        if (!entry.sub && subRight) {
          text(subRight, PAGE_W - MARGIN_X - fonts.italic.widthOfTextAtSize(subRight, size), fonts.italic, size);
          y -= lh;
        }
      }
      for (const bullet of entry.bullets || []) {
        wrap(bullet, fonts.regular, size, TEXT_W - BULLET_INDENT).forEach((line, i) => {
          if (i === 0) text('•', MARGIN_X + 2, fonts.regular, size);
          text(line, MARGIN_X + BULLET_INDENT, fonts.regular, size);
          y -= lh;
        });
      }
      y -= size * 0.35;
    }
  }
  return y;
}

// Drop one bullet to save space: from the lowest section first (projects, then older jobs),
// always leaving each entry at least one bullet. Returns false when nothing more can go.
function dropOneBullet(resume) {
  for (let s = resume.sections.length - 1; s >= 0; s--) {
    const entries = resume.sections[s].entries;
    if (!entries) continue;
    for (let e = entries.length - 1; e >= 0; e--) {
      if ((entries[e].bullets || []).length > 1) {
        entries[e].bullets.pop();
        return true;
      }
    }
  }
  return false;
}

// The contact line under your name, the same on your resume and cover letters.
export function contactParts(profile) {
  const bare = (u) => String(u || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return [
    [profile.city, profile.state].filter(Boolean).join(', '),
    profile.phone,
    profile.email,
    bare(profile.linkedin),
    bare(profile.github),
    bare(profile.portfolio),
  ].filter(Boolean);
}

export async function buildResumePdf(input, meta) {
  const resume = JSON.parse(JSON.stringify(input));
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };

  let size = FONT_SIZES[0];
  let trimmed = 0;
  const fits = (sz) => layout(resume, fonts, sz, null) >= MARGIN_BOTTOM;
  const smallest = FONT_SIZES[FONT_SIZES.length - 1];
  size = FONT_SIZES.find(fits) || smallest;
  while (!fits(size) && dropOneBullet(resume)) trimmed++;

  const page = pdf.addPage([PAGE_W, PAGE_H]);
  layout(resume, fonts, size, page);

  pdf.setTitle(pdfText(`${resume.name} - Resume`));
  pdf.setAuthor(pdfText(resume.name));
  if (meta && meta.subject) pdf.setSubject(pdfText(meta.subject));
  pdf.setCreator('JobScript');
  pdf.setProducer('JobScript');
  return { bytes: await pdf.save(), fontSize: size, trimmed, overflow: !fits(size) };
}
