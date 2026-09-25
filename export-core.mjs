const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_FILENAME_LENGTH = 120;

export const DEFAULT_HTML_CSS = `
:root{color-scheme:light;--bg:#f4f6fa;--panel:#fff;--text:#202735;--muted:#667085;--line:#dfe4ec;--accent:#4f6fd8;--user:#eef3ff;--assistant:#fff;--code:#172033}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
body{padding:24px 14px 48px}.chat-export{width:min(900px,100%);margin:0 auto}.export-header{margin-bottom:22px}.export-title{margin:0 0 4px;font-size:clamp(22px,4vw,32px);line-height:1.25}.export-meta{color:var(--muted);font-size:13px}.export-floor{margin:0 0 22px}.export-floor-heading{display:flex;align-items:center;gap:10px;margin:0 0 9px;color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.04em}.export-floor-heading:after{content:"";height:1px;flex:1;background:var(--line)}.export-message{padding:14px 16px;margin:8px 0;border:1px solid var(--line);border-radius:14px;background:var(--assistant);box-shadow:0 4px 14px #1b2a4a0b}.export-message.is-user{background:var(--user)}.export-message.is-alternative{border-style:dashed}.export-message-meta{display:flex;flex-wrap:wrap;gap:6px 10px;margin-bottom:7px;color:var(--muted);font-size:12px}.export-message-meta .current{color:#1d806b;font-weight:700}.export-message-content> :first-child{margin-top:0}.export-message-content> :last-child{margin-bottom:0}.export-message-content img{max-width:100%;height:auto;border-radius:10px}.export-message-content pre{padding:12px;overflow:auto;border-radius:9px;background:var(--code);color:#e3ecff}.export-message-content code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.export-message-content a{color:var(--accent);overflow-wrap:anywhere}.export-message-content [data-export-external="true"]{outline:1px dashed #d99435;outline-offset:2px}.export-footer{margin-top:28px;color:var(--muted);font-size:12px}
@media(max-width:600px){body{padding:14px 10px 30px}.export-message{padding:12px}.export-message-meta{font-size:11px}}
`;

function asText(value) {
  return value == null ? '' : String(value);
}

export function escapeHtml(value) {
  return asText(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function decodeBasicEntities(value) {
  return asText(value)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : '';
    })
    .replace(/&#([0-9]+);?/g, (_match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) && codePoint > 0 ? String.fromCodePoint(codePoint) : '';
    });
}

function normalizeLineEndings(value) {
  return asText(value).replace(/\r\n?/g, '\n');
}

function markdownToPlainText(value) {
  let text = normalizeLineEndings(value);
  const protectedTags = [];

  text = text.replace(/<\/?(?:think|thinking|reasoning|analysis)\b[^>]*>/gi, tag => {
    const token = `\uE000TTE${protectedTags.length}\uE001`;
    protectedTags.push([token, tag]);
    return token;
  });

  text = text
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '\n$1\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<(?:p|div|section|article|li|h[1-6]|blockquote|pre|tr)\b[^>]*>/gi, '')
    .replace(/<\/(?:strong|em|b|i|u|code|span)>/gi, '')
    .replace(/<(?:strong|em|b|i|u|code|span)\b[^>]*>/gi, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/&(?:amp|lt|gt|quot|#39|apos);/gi, entity => decodeBasicEntities(entity));

  for (const [token, tag] of protectedTags) {
    text = text.replaceAll(token, tag);
  }

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeChatForExport(chat, { includeSystem = false } = {}) {
  if (!Array.isArray(chat)) {
    return [];
  }

  const messages = [];
  chat.forEach((rawMessage, floor) => {
    if (!rawMessage || (rawMessage.is_system && !includeSystem)) {
      return;
    }

    const role = rawMessage.is_system ? 'system' : rawMessage.is_user ? 'user' : 'assistant';
    const name = asText(rawMessage.name) || (role === 'user' ? '用户' : role === 'system' ? '系统' : '角色');
    const sourceSwipes = Array.isArray(rawMessage.swipes) && rawMessage.swipes.length > 0
      ? rawMessage.swipes
      : [rawMessage.mes ?? ''];
    const rawSwipeId = Number.isInteger(rawMessage.swipe_id) ? rawMessage.swipe_id : 0;
    const currentSwipeId = Math.min(Math.max(rawSwipeId, 0), sourceSwipes.length - 1);

    sourceSwipes.forEach((text, swipeIndex) => {
      messages.push({
        floor,
        name,
        role,
        sendDate: asText(rawMessage.send_date),
        swipeIndex,
        swipeCount: sourceSwipes.length,
        isCurrent: swipeIndex === currentSwipeId,
        text: asText(text),
      });
    });
  });

  return messages;
}

function branchLabel(message) {
  const parts = [`第 ${message.floor + 1} 楼`];
  if (message.swipeCount > 1) {
    parts.push(`swipe ${message.swipeIndex + 1}/${message.swipeCount}`);
    if (message.isCurrent) {
      parts.push('当前');
    }
  }
  return parts.join(' · ');
}

export function buildPlainTextExport(messages, metadata = {}) {
  const title = asText(metadata.title) || '聊天导出';
  const exportedAt = asText(metadata.exportedAt) || new Date().toISOString();
  const lines = [title, `导出时间：${exportedAt}`, ''];

  for (const message of Array.isArray(messages) ? messages : []) {
    const timestamp = message.sendDate || '未记录时间';
    lines.push(`【${message.name || '角色'}｜${timestamp}｜${branchLabel(message)}】`);
    lines.push(markdownToPlainText(message.text));
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderBasicMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_match, language, code) => {
    const className = language.trim() ? ` class="language-${escapeHtml(language.trim())}"` : '';
    return `<pre><code${className}>${code.trimEnd()}</code></pre>`;
  });
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

function removeBlockedTags(html) {
  return asText(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(?:script|iframe|object|embed|form|base|link|meta|style|svg|math|template)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|iframe|object|embed|form|base|link|meta|style|svg|math|template)\s*>/gi, '')
    .replace(/<\s*(?:script|iframe|object|embed|form|base|link|meta|style|svg|math|template)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:srcset|imagesrcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

function isSafeRasterImageDataUrl(value) {
  return /^data:image\/(?:png|gif|jpe?g|webp|bmp|avif);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function sanitizeUrlAttribute(attribute, quote, value) {
  const decoded = decodeBasicEntities(value).replace(/[\u0000-\u0020]+/g, ' ').trim();
  const compact = decoded.replace(/[\u0000-\u0020]+/g, '');
  const attributeName = attribute.toLowerCase();
  const unsafe = /^(?:javascript:|vbscript:)/i.test(compact)
    || (/^data:/i.test(compact) && !(attributeName === 'src' && isSafeRasterImageDataUrl(compact)));
  if (unsafe) {
    return ` ${attribute}=${quote}#${quote}`;
  }
  return ` ${attribute}=${quote}${escapeHtml(value)}${quote}`;
}

export function sanitizeRenderedHtml(html) {
  let output = removeBlockedTags(html);
  output = output.replace(/\s+(href|xlink:href|src|action|formaction|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_match, attribute, doubleQuoted, singleQuoted, unquoted) => {
    const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : '"';
    const value = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
    return sanitizeUrlAttribute(attribute, quote, value);
  });
  return output;
}

async function inlineImages(html, inlineImage) {
  const imagePattern = /<img\b[^>]*>/gi;
  const externalMarker = ' data-export-external="true" title="图片未能内嵌，打开文件时需要网络或原始地址可用"';
  let result = '';
  let cursor = 0;

  for (const match of html.matchAll(imagePattern)) {
    const tag = match[0];
    const index = match.index ?? 0;
    result += html.slice(cursor, index);
    cursor = index + tag.length;

    const sourceMatch = tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    if (!sourceMatch) {
      result += tag;
      continue;
    }

    const source = sourceMatch[2];
    if (/^data:image\//i.test(source) || typeof inlineImage !== 'function') {
      result += typeof inlineImage === 'function' || /^data:image\//i.test(source)
        ? tag
        : tag.replace(/>$/, `${externalMarker}>`);
      continue;
    }

    let embedded = null;
    try {
      embedded = await inlineImage(source);
    } catch {
      embedded = null;
    }

    if (typeof embedded === 'string' && /^data:image\//i.test(embedded)) {
      result += tag.replace(sourceMatch[0], `src=${sourceMatch[1]}${escapeHtml(embedded)}${sourceMatch[1]}`);
    } else if (/data-export-external\s*=/.test(tag)) {
      result += tag;
    } else {
      result += tag.replace(/>$/, `${externalMarker}>`);
    }
  }

  return result + html.slice(cursor);
}

function groupByFloor(messages) {
  const groups = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!groups.has(message.floor)) {
      groups.set(message.floor, []);
    }
    groups.get(message.floor).push(message);
  }
  return groups;
}

export async function buildHtmlExport(messages, metadata = {}, options = {}) {
  const title = asText(metadata.title) || '聊天导出';
  const exportedAt = asText(metadata.exportedAt) || new Date().toISOString();
  const css = asText(options.css) || DEFAULT_HTML_CSS;
  const renderMessage = typeof options.renderMessage === 'function' ? options.renderMessage : renderBasicMarkdown;
  const groups = groupByFloor(messages);
  const floors = [];

  for (const [floor, group] of groups) {
    const entries = [];
    for (const message of group) {
      let content = await renderMessage(message.text, message);
      content = await inlineImages(sanitizeRenderedHtml(content), options.inlineImage);
      const classes = [
        'export-message',
        message.role === 'user' ? 'is-user' : '',
        message.isCurrent ? 'is-current' : 'is-alternative',
      ].filter(Boolean).join(' ');
      const currentMark = message.isCurrent && message.swipeCount > 1 ? '<span class="current">当前</span>' : '';
      entries.push(`
<article class="${classes}" data-floor="${floor}" data-swipe="${message.swipeIndex}">
  <div class="export-message-meta"><span>${escapeHtml(message.name || '角色')}</span><span>${escapeHtml(message.sendDate || '未记录时间')}</span><span>${escapeHtml(branchLabel(message))}</span>${currentMark}</div>
  <div class="export-message-content">${content}</div>
</article>`);
    }
    floors.push(`<section class="export-floor" data-floor="${floor}"><div class="export-floor-heading">第 ${Number(floor) + 1} 楼</div>${entries.join('')}</section>`);
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="TauriTavern Chat Export 0.1.0">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
<main class="chat-export">
  <header class="export-header"><h1 class="export-title">${escapeHtml(title)}</h1><div class="export-meta">导出时间：${escapeHtml(exportedAt)} · reasoning 字段未导出</div></header>
  ${floors.join('\n')}
  <footer class="export-footer">由 TauriTavern Chat Export 生成</footer>
</main>
</body>
</html>
`;
}

export function safeFileName(value, fallback = 'chat-export') {
  const cleaned = asText(value)
    .replace(INVALID_FILENAME_CHARS, '')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned || fallback;
}

export function exportFileBaseName(title, date = new Date()) {
  const stamp = date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 16).replace(/[T:]/g, '-')
    : 'export';
  return `${safeFileName(title)}-${stamp}`;
}

