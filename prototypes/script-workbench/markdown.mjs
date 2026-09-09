/** Markdown preview uses an inert HTML subset; source files remain unchanged. */
import { marked } from './browser/marked.mjs';
import DOMPurify from './browser/purify.mjs';

/** Render common Markdown and tables without active HTML, links or remote media. */
export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true }), {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote',
      'ul', 'ol', 'li', 'strong', 'em', 'del', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['start'],
  });
}
