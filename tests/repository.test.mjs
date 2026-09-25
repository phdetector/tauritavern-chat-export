import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const requiredFiles = [
  'manifest.json',
  'index.js',
  'export-core.mjs',
  'style.css',
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  '.github/workflows/ci.yml',
  'preview/index.html',
  'preview/demo.html',
  'preview/demo.txt',
];

function allFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...allFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

test('repository contains the standalone plugin entry points and release docs', () => {
  for (const file of requiredFiles) {
    assert.equal(existsSync(join(root, file)), true, `missing ${file}`);
  }

  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.display_name, '聊天导出（单文件）');
  assert.equal(manifest.js, 'index.js');
  assert.equal(manifest.css, 'style.css');
  assert.equal(manifest.version, '0.1.0');
});

test('repository has no chat archives or obvious credentials', () => {
  const files = allFiles(root);
  const forbiddenNames = files.filter(file => /(?:\\|\/)(?:.*\.jsonl|secrets\.json|credentials\.json|\.env(?:\..*)?)$/i.test(file));
  assert.deepEqual(forbiddenNames, [], forbiddenNames.map(file => relative(root, file)).join(', '));

  const secretPatterns = [
    /-----BEGIN (?:RSA|OPENSSH|EC|DSA)? ?PRIVATE KEY-----/i,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /\bBearer\s+[A-Za-z0-9._-]{24,}\b/i,
  ];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of secretPatterns) {
      assert.equal(pattern.test(content), false, `possible secret in ${relative(root, file)}`);
    }
  }
});
