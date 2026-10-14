import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChatEndpoint, normalizeWorkspacePath, parseToolArguments } from './mobile-agent';

test('normalizes OmniRoute URL with or without the chat completion suffix', () => {
  assert.equal(normalizeChatEndpoint('https://gateway.example/v1/'), 'https://gateway.example/v1/chat/completions');
  assert.equal(normalizeChatEndpoint('https://gateway.example/v1/chat/completions/'), 'https://gateway.example/v1/chat/completions');
});

test('normalizes safe relative workspace paths and permits root only when requested', () => {
  assert.equal(normalizeWorkspacePath('src/../README.md'), 'README.md');
  assert.equal(normalizeWorkspacePath('', true), '');
  assert.throws(() => normalizeWorkspacePath(''), /path is required/i);
});

test('rejects absolute paths, drive paths, null bytes, and traversal outside the workspace', () => {
  for (const path of ['/data/private.txt', 'C:\\private.txt', '../escape.txt', 'a/../../escape.txt', 'bad\0name']) {
    assert.throws(() => normalizeWorkspacePath(path), /relative path|stay inside/i);
  }
});

test('parses only JSON object tool arguments', () => {
  assert.deepEqual(parseToolArguments('{"path":"src/App.tsx"}'), { path: 'src/App.tsx' });
  assert.throws(() => parseToolArguments('{broken'), /invalid tool arguments/i);
  assert.throws(() => parseToolArguments('["not","an","object"]'), /JSON object/i);
});
