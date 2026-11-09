// Text extraction for uploaded resumes, plus content-based file validation.
// The file type is decided by magic bytes, never by the client's extension or
// MIME header alone.

import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export const MIME_BY_EXT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

/** Returns 'pdf' | 'docx' | 'doc' | null from the file's content. */
export function sniffType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  // PDFs may have a few junk bytes before the header; spec allows 1024.
  if (buf.subarray(0, 1024).indexOf(PDF_MAGIC) !== -1) return 'pdf';
  if (buf.subarray(0, 4).equals(ZIP_MAGIC)) {
    // A DOCX is a zip that contains word/document.xml (name appears in the central directory).
    return buf.includes(Buffer.from('word/document.xml')) || buf.includes(Buffer.from('word/')) ? 'docx' : null;
  }
  if (buf.subarray(0, 8).equals(OLE_MAGIC)) return 'doc';
  return null;
}

let pdfjsPromise = null;
async function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function pdfText(buf) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  const pages = [];
  const maxPages = Math.min(doc.numPages, 15);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from y-coordinates so section headings stay on their own line.
    let lastY = null;
    let line = '';
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line.trim());
        line = '';
      }
      line += (line && !line.endsWith(' ') && item.str && !item.str.startsWith(' ') ? ' ' : '') + item.str;
      lastY = y;
      if (item.hasEOL) { lines.push(line.trim()); line = ''; lastY = null; }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push(lines.filter(Boolean).join('\n'));
  }
  await doc.destroy();
  return pages.join('\n\n');
}

async function docxText(buf) {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value;
}

async function docText(buf) {
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buf);
  return doc.getBody();
}

export async function extractText(buf, type) {
  let text = '';
  if (type === 'pdf') text = await pdfText(buf);
  else if (type === 'docx') text = await docxText(buf);
  else if (type === 'doc') text = await docText(buf);
  else throw new Error('unsupported file type');
  return text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
