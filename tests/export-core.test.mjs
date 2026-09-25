import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildHtmlExport,
  buildPlainTextExport,
  exportFileBaseName,
  normalizeChatForExport,
  safeFileName,
  sanitizeRenderedHtml,
} from '../export-core.mjs';

function makeFixture() {
  return [
    {
      is_user: true,
      is_system: false,
      mes: '你好，**星野**。',
      name: '用户',
      send_date: '2026-09-25T11:40:00.000Z',
      extra: { reasoning: 'never export this field' },
    },
    {
      is_user: false,
      is_system: false,
      mes: '当前回复',
      name: '星野',
      send_date: '2026-09-25T11:41:00.000Z',
      swipe_id: 1,
      swipes: ['第一条候选回复', '当前回复'],
      extra: { reasoning: 'private model reasoning' },
    },
    {
      is_user: false,
      is_system: true,
      mes: '内部系统提示，不应该导出',
      name: '系统',
      send_date: '2026-09-25T11:41:30.000Z',
      extra: { reasoning: 'hidden' },
    },
    {
      is_user: true,
      is_system: false,
      mes: '请保留正文中的 <think> 标签文本。',
      name: '用户',
      send_date: '2026-09-25T11:42:00.000Z',
      extra: { reasoning: 'omit only this field' },
    },
  ];
}

test('normalizes visible messages and every swipe without mutating chat', () => {
  const chat = makeFixture();
  const snapshot = JSON.stringify(chat);
  const messages = normalizeChatForExport(chat);

  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map(message => [message.floor, message.swipeIndex, message.isCurrent]), [
    [0, 0, true],
    [1, 0, false],
    [1, 1, true],
    [3, 0, true],
  ]);
  assert.equal(messages[1].text, '第一条候选回复');
  assert.equal(messages[2].text, '当前回复');
  assert.equal('reasoning' in messages[0], false);
  assert.equal(JSON.stringify(chat), snapshot);
});

test('can explicitly include system floors while defaulting missing fields safely', () => {
  const chat = [{ is_system: true, mes: '系统内容' }, { is_user: true, mes: '用户内容' }];
  const messages = normalizeChatForExport(chat, { includeSystem: true });

  assert.deepEqual(messages.map(message => [message.floor, message.name, message.sendDate]), [
    [0, '系统', ''],
    [1, '用户', ''],
  ]);
});

test('builds readable plain text with metadata and branch markers', () => {
  const messages = normalizeChatForExport(makeFixture());
  const output = buildPlainTextExport(messages, {
    title: '夜航日志',
    exportedAt: '2026-09-25T12:00:00.000Z',
  });

  assert.match(output, /^夜航日志/m);
  assert.match(output, /导出时间：2026-09-25T12:00:00.000Z/);
  assert.match(output, /第 2 楼 · swipe 1\/2/);
  assert.match(output, /第 2 楼 · swipe 2\/2 · 当前/);
  assert.match(output, /请保留正文中的 <think> 标签文本。/);
  assert.doesNotMatch(output, /private model reasoning|never export this field/);
  assert.doesNotMatch(output, /内部系统提示/);
});

test('keeps paragraph, list, and code-block line structure in plain text', () => {
  const messages = normalizeChatForExport([{ is_user: true, mes: '**标题**\n\n- 一\n- 二\n\n```js\nconst x = 1;\n```' }]);
  const output = buildPlainTextExport(messages, { title: '结构' });

  assert.match(output, /标题\n\n- 一\n- 二\n\nconst x = 1;/);
});

test('builds a self-contained sanitized HTML document and inlines images', async () => {
  const messages = normalizeChatForExport(makeFixture());
  const output = await buildHtmlExport(messages, {
    title: '<夜航日志>',
    exportedAt: '2026-09-25T12:00:00.000Z',
  }, {
    renderMessage(text) {
      return `<p>${text}</p><script>alert('x')</script><img src="https://example.com/a.png" onerror="alert(1)"><a href="javascript:alert(1)">bad</a>`;
    },
    inlineImage: async source => source.endsWith('a.png') ? 'data:image/png;base64,AA==' : null,
    css: '.export-message{color:red}',
  });

  assert.match(output, /^<!doctype html>/i);
  assert.match(output, /&lt;夜航日志&gt;/);
  assert.match(output, /data:image\/png;base64,AA==/);
  assert.match(output, /\.export-message\{color:red\}/);
  assert.doesNotMatch(output, /<script/i);
  assert.doesNotMatch(output, /onerror/i);
  assert.doesNotMatch(output, /javascript:/i);
  assert.doesNotMatch(output, /内部系统提示|private model reasoning/);
});

test('marks images that cannot be embedded instead of dropping their source', async () => {
  const output = await buildHtmlExport(normalizeChatForExport(makeFixture()), { title: '测试' }, {
    renderMessage: () => '<img src="https://example.com/unavailable.png">',
    inlineImage: async () => null,
  });

  assert.match(output, /data-export-external="true"/);
  assert.match(output, /图片未能内嵌/);
  assert.match(output, /https:\/\/example\.com\/unavailable\.png/);
});

test('removes dangerous tags, event handlers, and URL schemes without damaging safe attributes', () => {
  const output = sanitizeRenderedHtml(`
    <p>ok</p>
    <script>alert(1)</script>
    <iframe src="https://evil.example"></iframe>
    <img src="https://example.com/a.png" onload="alert(1)" srcset="javascript:alert(2)">
    <a href="&#x6a;avascript:alert(3)" onclick=alert(4)>bad</a>
    <a href=javascript:alert(5)>unquoted bad</a>
    <a href="java&#x0a;script:alert(6)">split scheme bad</a>
    <svg onload=alert(7)><a xlink:href="javascript:alert(8)">svg bad</a></svg>
    <a href="https://example.com/docs">safe</a>
  `);

  assert.match(output, /<p>ok<\/p>/);
  assert.match(output, /<img src="https:\/\/example\.com\/a\.png">/);
  assert.match(output, /<a href="#">bad<\/a>/);
  assert.match(output, /<a href="#">unquoted bad<\/a>/);
  assert.match(output, /<a href="#">split scheme bad<\/a>/);
  assert.match(output, /<a href="https:\/\/example\.com\/docs">safe<\/a>/);
  assert.doesNotMatch(output, /<script|<iframe|<svg|onload|onclick|srcset|xlink:href|javascript:/i);
});

test('sanitizes Windows filenames and creates stable export names', () => {
  const filename = safeFileName('  a<>:"/\\|?*  ');
  assert.equal(filename, 'a');
  assert.equal(exportFileBaseName('聊天/测试', new Date('2026-09-25T12:34:00.000Z')), '聊天测试-2026-09-25-12-34');
});
