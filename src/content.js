const sanitizeHtml = require('sanitize-html');
const { marked } = require('marked');
const mammoth = require('mammoth');
const path = require('node:path');

const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MB of HTML per document
const MAX_TITLE_LENGTH = 200;
const SUPPORTED_UPLOADS = ['.txt', '.md', '.markdown', '.docx'];

// The editor (Quill) only produces this subset, and imports are reduced to it too,
// so stored HTML is always something the editor can render and round-trip.
const SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3',
    'ol', 'ul', 'li', 'blockquote', 'pre', 'code', 'a', 'span'],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    li: ['data-list', 'class'],
    p: ['class'], h1: ['class'], h2: ['class'], h3: ['class'], pre: ['class', 'data-language'],
    span: ['class'],
  },
  allowedClasses: { '*': ['ql-*'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    h4: 'h3', h5: 'h3', h6: 'h3',
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
};

function sanitizeContent(html) {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
    .join('');
}

class UnsupportedFileError extends Error {}

/** Converts an uploaded file buffer to sanitized editor HTML. */
async function fileToHtml(originalName, buffer) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (!SUPPORTED_UPLOADS.includes(ext)) {
    throw new UnsupportedFileError(`Unsupported file type "${ext || 'none'}". Supported: ${SUPPORTED_UPLOADS.join(', ')}`);
  }
  let html;
  if (ext === '.docx') {
    try {
      ({ value: html } = await mammoth.convertToHtml({ buffer }));
    } catch {
      throw new UnsupportedFileError('Could not read this .docx file. Is it a valid Word document?');
    }
  } else {
    const text = buffer.toString('utf8');
    if (text.includes('\u0000')) throw new UnsupportedFileError('File does not look like text.');
    html = ext === '.txt' ? textToHtml(text) : marked.parse(text);
  }
  return sanitizeContent(html);
}

function titleFromFilename(name) {
  const base = path.basename(name || '', path.extname(name || '')).trim();
  return (base || 'Imported document').slice(0, MAX_TITLE_LENGTH);
}

function plainText(html) {
  return sanitizeHtml(html.replace(/<\/(p|h[1-3]|li|blockquote|pre)>/g, ' '), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

module.exports = {
  sanitizeContent, fileToHtml, titleFromFilename, plainText, UnsupportedFileError,
  MAX_CONTENT_BYTES, MAX_TITLE_LENGTH, SUPPORTED_UPLOADS,
};
