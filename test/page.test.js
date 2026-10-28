import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../tools/page.js';

test('importmap vem antes do modulepreload (senao /sim/ e /shared/ carregam sem versao)', () => {
  const html = '<head><link rel="modulepreload" href="/host/main.js"></head>';
  const out = renderPage(html, './', undefined, 'v1');
  assert.ok(out.indexOf('type="importmap"') < out.indexOf('rel="modulepreload"'));
  assert.ok(out.includes('./_v/v1/host/main.js'));
});
