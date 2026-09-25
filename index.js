import {
  buildHtmlExport,
  buildPlainTextExport,
  DEFAULT_HTML_CSS,
  exportFileBaseName,
  normalizeChatForExport,
  renderBasicMarkdown,
} from './export-core.mjs';

const EXTENSION_ID = 'tauritavern-chat-export';
const APP_VERSION = '0.1.0';
const INITIALIZED_MARKER = '__TAURITAVERN_CHAT_EXPORT_INITIALIZED__';

const state = {
  menu: null,
  modal: null,
  previewPre: null,
  previewFrame: null,
  previewTabs: null,
  previewInfo: null,
  pendingExports: [],
  activePreviewKind: null,
  hostModulePromise: null,
};

function getContext() {
  try {
    if (typeof globalThis.SillyTavern?.getContext === 'function') {
      return globalThis.SillyTavern.getContext();
    }
    if (typeof globalThis.sillyTavern?.getContext === 'function') {
      return globalThis.sillyTavern.getContext();
    }
  } catch (error) {
    console.warn(`[${EXTENSION_ID}] failed to read host context`, error);
  }
  return globalThis;
}

function showNotice(message, level = 'info') {
  const toastrMethod = globalThis.toastr?.[level];
  if (typeof toastrMethod === 'function') {
    toastrMethod.call(globalThis.toastr, message);
    return;
  }
  const consoleMethod = console[level] || console.log;
  consoleMethod(`[${EXTENSION_ID}] ${message}`);
}

function snapshotChat(chat) {
  return JSON.stringify(chat);
}

async function readCurrentChat() {
  const context = getContext();
  const candidates = [
    context?.chat,
    context?.messages,
    globalThis.chat,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const getters = [context?.getCurrentChat, context?.getChat];
  for (const getter of getters) {
    if (typeof getter !== 'function') {
      continue;
    }
    try {
      const candidate = await getter.call(context);
      if (Array.isArray(candidate)) {
        return candidate;
      }
    } catch (error) {
      console.warn(`[${EXTENSION_ID}] chat getter failed`, error);
    }
  }

  return null;
}

function getChatTitle() {
  const context = getContext();
  const metadata = context?.chat_metadata || context?.chatMetadata || globalThis.chat_metadata || {};
  const candidates = [
    metadata.chat_title,
    metadata.title,
    context?.chat_title,
    context?.chatTitle,
    context?.name2,
    globalThis.name2,
    '当前聊天',
  ];
  return candidates.find(value => typeof value === 'string' && value.trim())?.trim() || '当前聊天';
}

function normalizeRenderedValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value.innerHTML === 'string') {
    return value.innerHTML;
  }
  if (value && typeof value.outerHTML === 'string') {
    return value.outerHTML;
  }
  return value == null ? null : String(value);
}

async function loadHostModule() {
  if (!state.hostModulePromise) {
    state.hostModulePromise = (async () => {
      const candidates = [
        '/script.js',
        '../../../../script.js',
      ];
      for (const candidate of candidates) {
        try {
          return await import(candidate);
        } catch {
          // The extension can still operate with its built-in Markdown renderer.
        }
      }
      return null;
    })();
  }
  return state.hostModulePromise;
}

async function renderWithHost(text, message) {
  const context = getContext();
  const module = await loadHostModule();
  const candidates = [
    context?.messageFormatting,
    context?.renderMarkdown,
    context?.markdownToHtml,
    globalThis.messageFormatting,
    globalThis.renderMarkdown,
    module?.messageFormatting,
    module?.renderMarkdown,
    module?.markdownToHtml,
    module?.default?.messageFormatting,
    module?.default?.renderMarkdown,
  ].filter(candidate => typeof candidate === 'function');

  const seen = new Set();
  for (const renderer of candidates) {
    if (seen.has(renderer)) {
      continue;
    }
    seen.add(renderer);
    const args = [
      text,
      message.name,
      message.role === 'system',
      message.role === 'user',
      -1,
      false,
      message,
    ];
    try {
      const result = await renderer.apply(context, args);
      const html = normalizeRenderedValue(result);
      if (html !== null) {
        return html;
      }
    } catch {
      try {
        const result = await renderer.call(context, text);
        const html = normalizeRenderedValue(result);
        if (html !== null) {
          return html;
        }
      } catch {
        // Try the next compatible host renderer.
      }
    }
  }

  return null;
}

function bytesToBase64(bytes) {
  if (typeof globalThis.btoa !== 'function') {
    return null;
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return globalThis.btoa(binary);
}

async function inlineImage(source) {
  if (!source || /^data:image\//i.test(source) || /^(?:javascript|vbscript):/i.test(source)) {
    return null;
  }

  try {
    const url = new URL(source, globalThis.location?.href || undefined);
    const response = await fetch(url.href, { credentials: 'same-origin' });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    if (!blob.type.toLowerCase().startsWith('image/')) {
      return null;
    }
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    return base64 ? `data:${blob.type};base64,${base64}` : null;
  } catch {
    return null;
  }
}

function downloadText(filename, content, mime) {
  if (typeof Blob !== 'function' || !globalThis.URL?.createObjectURL) {
    throw new Error('当前环境不支持 Blob 下载');
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createMenu() {
  if (state.menu) {
    return state.menu;
  }
  const menu = document.createElement('div');
  menu.id = 'tt-chat-export-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="tt-chat-export-menu-title">选择导出格式</div>
    <button type="button" role="menuitem" data-export-kind="txt">导出 TXT 对话稿</button>
    <button type="button" role="menuitem" data-export-kind="html">导出单文件 HTML</button>
    <button type="button" role="menuitem" data-export-kind="both">同时导出 TXT + HTML</button>
  `;
  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-export-kind]');
    if (!button) {
      return;
    }
    hideMenu();
    document.getElementById('tt-chat-export-launcher')?.setAttribute('aria-expanded', 'false');
    prepareExport(button.dataset.exportKind).catch(error => {
      console.error(`[${EXTENSION_ID}] export failed`, error);
      showNotice(`导出失败：${error.message || error}`, 'error');
    });
  });
  document.body.append(menu);
  state.menu = menu;
  return menu;
}

function showMenu() {
  const menu = createMenu();
  menu.hidden = false;
}

function hideMenu() {
  if (state.menu) {
    state.menu.hidden = true;
  }
}

function createModal() {
  if (state.modal) {
    return state.modal;
  }
  const modal = document.createElement('div');
  modal.id = 'tt-chat-export-modal';
  modal.hidden = true;
  modal.setAttribute('role', 'presentation');
  modal.innerHTML = `
    <section class="tt-chat-export-dialog" role="dialog" aria-modal="true" aria-labelledby="tt-chat-export-title">
      <header class="tt-chat-export-dialog-header">
        <div>
          <h2 id="tt-chat-export-title">导出预览</h2>
          <p data-export-preview-info></p>
        </div>
        <button type="button" class="tt-chat-export-icon-button" data-action="close" aria-label="关闭预览">关闭</button>
      </header>
      <nav class="tt-chat-export-tabs" data-export-preview-tabs hidden aria-label="预览格式">
        <button type="button" data-preview-tab="txt">TXT</button>
        <button type="button" data-preview-tab="html">HTML</button>
      </nav>
      <div class="tt-chat-export-preview">
        <pre data-export-preview-text hidden></pre>
        <iframe data-export-preview-html title="HTML 导出预览" sandbox=""></iframe>
      </div>
      <footer class="tt-chat-export-dialog-actions">
        <button type="button" class="tt-chat-export-secondary-button" data-action="close">取消</button>
        <button type="button" class="tt-chat-export-primary-button" data-action="download">下载</button>
      </footer>
    </section>
  `;
  modal.addEventListener('click', event => {
    if (event.target === modal || event.target.closest('[data-action="close"]')) {
      closePreview();
      return;
    }
    const tab = event.target.closest('[data-preview-tab]');
    if (tab) {
      setActivePreview(tab.dataset.previewTab);
      return;
    }
    if (event.target.closest('[data-action="download"]')) {
      downloadPendingExports();
    }
  });
  document.body.append(modal);
  state.modal = modal;
  state.previewPre = modal.querySelector('[data-export-preview-text]');
  state.previewFrame = modal.querySelector('[data-export-preview-html]');
  state.previewTabs = modal.querySelector('[data-export-preview-tabs]');
  state.previewInfo = modal.querySelector('[data-export-preview-info]');
  return modal;
}

function setActivePreview(kind) {
  const entry = state.pendingExports.find(item => item.kind === kind);
  if (!entry || !state.previewPre || !state.previewFrame) {
    return;
  }
  state.activePreviewKind = kind;
  state.previewPre.hidden = kind !== 'txt';
  state.previewFrame.hidden = kind !== 'html';
  if (kind === 'txt') {
    state.previewPre.textContent = entry.content;
    state.previewFrame.srcdoc = '';
  } else {
    state.previewFrame.srcdoc = entry.content;
    state.previewPre.textContent = '';
  }
  for (const tab of state.previewTabs?.querySelectorAll('[data-preview-tab]') || []) {
    tab.classList.toggle('is-active', tab.dataset.previewTab === kind);
  }
}

function openPreview(exports) {
  const modal = createModal();
  state.pendingExports = exports;
  state.activePreviewKind = exports[0]?.kind || null;
  state.previewTabs.hidden = exports.length < 2;
  state.previewInfo.textContent = exports.map(item => `${item.label} · ${item.filename}`).join('　');
  if (exports.length >= 2) {
    for (const tab of state.previewTabs.querySelectorAll('[data-preview-tab]')) {
      tab.hidden = !exports.some(item => item.kind === tab.dataset.previewTab);
    }
  }
  modal.hidden = false;
  setActivePreview(state.activePreviewKind);
  modal.querySelector('[data-action="close"]')?.focus();
}

function closePreview() {
  if (!state.modal) {
    return;
  }
  state.modal.hidden = true;
  if (state.previewFrame) {
    state.previewFrame.srcdoc = '';
  }
  state.pendingExports = [];
}

function downloadPendingExports() {
  if (!state.pendingExports.length) {
    return;
  }
  try {
    state.pendingExports.forEach((item, index) => {
      setTimeout(() => {
        try {
          downloadText(item.filename, item.content, item.mime);
        } catch (error) {
          showNotice(`下载失败：${error.message || error}`, 'error');
        }
      }, index * 140);
    });
    showNotice(state.pendingExports.length > 1 ? '已开始下载两个导出文件' : '已开始下载导出文件', 'success');
    closePreview();
  } catch (error) {
    showNotice(`下载失败：${error.message || error}`, 'error');
  }
}

async function prepareExport(kind) {
  const chat = await readCurrentChat();
  if (!Array.isArray(chat)) {
    throw new Error('没有找到当前打开的聊天');
  }

  const before = snapshotChat(chat);
  const title = getChatTitle();
  const exportedAtDate = new Date();
  const metadata = {
    title,
    exportedAt: exportedAtDate.toISOString(),
  };
  const messages = normalizeChatForExport(chat);
  const baseName = exportFileBaseName(title, exportedAtDate);
  const exports = [];

  if (kind === 'txt' || kind === 'both') {
    exports.push({
      kind: 'txt',
      label: 'TXT',
      filename: `${baseName}.txt`,
      mime: 'text/plain;charset=utf-8',
      content: buildPlainTextExport(messages, metadata),
    });
  }

  if (kind === 'html' || kind === 'both') {
    const content = await buildHtmlExport(messages, metadata, {
      css: DEFAULT_HTML_CSS,
      renderMessage: async (text, message) => (await renderWithHost(text, message)) ?? renderBasicMarkdown(text),
      inlineImage,
    });
    exports.push({
      kind: 'html',
      label: 'HTML',
      filename: `${baseName}.html`,
      mime: 'text/html;charset=utf-8',
      content,
    });
  }

  const after = snapshotChat(chat);
  if (before !== after) {
    throw new Error('导出过程检测到聊天数据被修改，已取消下载');
  }

  openPreview(exports);
}

function createLauncher() {
  if (document.getElementById('tt-chat-export-launcher')) {
    return;
  }
  const button = document.createElement('button');
  button.id = 'tt-chat-export-launcher';
  button.type = 'button';
  button.title = '导出当前聊天';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span aria-hidden="true">⇩</span><span>导出聊天</span>';
  button.addEventListener('click', () => {
    const menu = createMenu();
    const isHidden = menu.hidden;
    if (isHidden) {
      showMenu();
    } else {
      hideMenu();
    }
    button.setAttribute('aria-expanded', String(isHidden));
  });
  document.body.append(button);
}

function installGlobalHandlers() {
  document.addEventListener('click', event => {
    const launcher = document.getElementById('tt-chat-export-launcher');
    if (!launcher || state.menu?.hidden) {
      return;
    }
    if (!event.target.closest('#tt-chat-export-menu') && !event.target.closest('#tt-chat-export-launcher')) {
      hideMenu();
      launcher.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideMenu();
      closePreview();
    }
  });
}

function init() {
  if (typeof document === 'undefined' || globalThis[INITIALIZED_MARKER]) {
    return;
  }
  globalThis[INITIALIZED_MARKER] = true;
  createLauncher();
  createModal();
  installGlobalHandlers();
  globalThis.TauriTavernChatExport = {
    version: APP_VERSION,
    open: showMenu,
    prepare: prepareExport,
  };
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
}
