// Extracts text lines from the saved resume PDF, entirely on this page, using the vendored pdf.js
// (lib/vendor/pdfjs, pdfjs-dist 6.3.289). Nothing is fetched from the network.
import * as pdfjs from '../lib/vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../lib/vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const MAX_PAGES = 10;

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Rebuild visual lines from positioned text items. Items on the same baseline are joined; a wide
// horizontal gap becomes three spaces so the parser can tell columns apart.
function pageLines(items) {
  const rows = [];
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const h = it.height || Math.abs(it.transform[3]) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, h * 0.4));
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, w: it.width || 0, h, str: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      let line = '';
      let lastEnd = null;
      for (const it of row.items) {
        if (lastEnd !== null) {
          const gap = it.x - lastEnd;
          if (gap > it.h * 1.5) line += '   ';
          else if (gap > it.h * 0.15 && !line.endsWith(' ') && !it.str.startsWith(' ')) line += ' ';
        }
        line += it.str;
        lastEnd = it.x + it.w;
      }
      return line.replace(/\s+$/, '');
    })
    .filter((l) => l.trim());
}

export async function extractResumeLines(base64) {
  const task = pdfjs.getDocument({
    data: base64ToBytes(base64),
    isEvalSupported: false, // no eval/new Function (also blocked by the extension CSP)
    disableFontFace: true, // text only; no font loading
    useSystemFonts: false,
    enableXfa: false,
  });
  const doc = await task.promise;
  try {
    const lines = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      lines.push(...pageLines(content.items));
      page.cleanup();
    }
    return lines;
  } finally {
    await task.destroy();
  }
}
