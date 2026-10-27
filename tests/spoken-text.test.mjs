import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseHTML } from 'linkedom';
import { harness } from './helpers/voice-harness.mjs';

// Render the real production MessageItem/Markdown paths, then run the real extractor in a DOM.
const exports = {};
const source = ts.transpileModule(readFileSync('src/components/Message.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const Icon = () => React.createElement('span');
const dependencies = {
  react: React, 'react/jsx-runtime': jsxRuntime,
  clsx: { default: (...args) => args.filter(value => typeof value === 'string').join(' ') },
  'react-markdown': { default: ReactMarkdown }, 'remark-gfm': { default: remarkGfm },
  'lucide-react': new Proxy({}, { get: () => Icon }),
  '@/lib/client/api': { api: {} },
  '@/lib/client/format': { timeLabel: () => '', formatTokens: String, formatCost: () => null },
  './OpenDuetApp': { useApp: () => ({ state: { liveViews: {} }, inspector: {} }) },
  './ReadAloud': { ReadAloud: () => React.createElement('button', null, 'Read aloud') },
  './ui': { BotAvatar: Icon, Button: 'button', inputClass: '' },
};
vm.runInNewContext(`(function(require, exports) {${source}\n})`)(name => {
  assert.ok(name in dependencies, `Unexpected dependency ${name}`);
  return dependencies[name];
}, exports);

function rendered({ status = 'done', role = 'bot', parts }) {
  const message = { id: 'reply', conversationId: 'dm:bot', createdAt: '2026-10-27T10:00:00Z', status, role, parts };
  const html = renderToStaticMarkup(React.createElement(exports.MessageItem, { message, showAuthor: false }));
  const { document } = parseHTML(`<main>${html}</main>`);
  return document.querySelector('main');
}

test('real Markdown extraction retains links, inline code and block pauses; skips both code block forms', () => {
  const root = rendered({ parts: [{ kind: 'text', text: '# Heading\n\nA [label](https://example.com) and `inline()` code.\n\n- Parent\n  - Child\n- Sibling\n\n```js\nSECRET_FENCE\n```\n\n    SECRET_INDENT\n\nAfter code.\n\n| Name | Value |\n| --- | --- |\n| A | B |' }] });
  const before = root.innerHTML;
  const text = harness().text.spokenText(root);
  assert.match(text, /Heading\n/);
  assert.match(text, /A label and inline\(\) code\./);
  assert.match(text, /Parent\s*\n\s*Child\s*\n\s*Sibling/);
  assert.match(text, /After code\./);
  assert.match(text, /A B/);
  assert.doesNotMatch(text, /SECRET|https:|```/);
  assert.equal(root.innerHTML, before, 'Extraction must not modify the live reply');
  root.querySelectorAll('.prose-chat').forEach(el => el.removeAttribute('class'));
  assert.equal(harness().text.spokenText(root), text, 'Styling must not determine speakable content');
});

test('completed text markers exclude actual reasoning, tool labels and other messages', () => {
  const root = rendered({ parts: [
    { kind: 'reasoning', text: 'SECRET_REASONING' },
    { kind: 'text', text: 'Visible reply.' },
    { kind: 'tool', name: 'web_search', label: 'SECRET_TOOL', toolCallId: 'tool', status: 'done' },
    { kind: 'text', text: 'Final paragraph.' },
  ] });
  const text = harness().text.spokenText(root);
  assert.equal(text, 'Visible reply.\nFinal paragraph.');
  for (const options of [{ status: 'streaming' }, { status: 'error' }, { status: 'stopped' }, { role: 'user' }, { role: 'notice' }]) {
    assert.equal(harness().text.spokenText(rendered({ ...options, parts: [{ kind: 'text', text: 'Do not speak' }] })), '');
  }
});

test('hidden descendants, image alt text, line breaks and code-only replies', () => {
  const { document } = parseHTML('<main><div data-read-aloud-text><p>First<br>Second <code>inline</code><img alt="diagram"></p><p hidden>SECRET</p><span aria-hidden="true">SECRET</span></div></main>');
  const text = harness().text.spokenText(document.querySelector('main'));
  assert.match(text, /First\nSecond inline.*diagram/);
  assert.doesNotMatch(text, /SECRET/);
  assert.equal(harness().text.spokenText(rendered({ parts: [{ kind: 'text', text: '```\ncode only\n```' }] })), '');
});
