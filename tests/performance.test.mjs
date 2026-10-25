import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';

const root = process.cwd();
const client = join(root, 'dist', 'client');

async function bytes(file) {
  return (await stat(join(client, file))).size;
}

test('the initial application shell stays within explicit transfer budgets', async () => {
  const html = await readFile(join(client, 'index.html'), 'utf8');
  const stylesheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"?]+)/g)].map(match => match[1]);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map(match => match[1]);
  const cssBytes = (await Promise.all(stylesheets.map(bytes))).reduce((sum, size) => sum + size, 0);
  const jsBytes = (await Promise.all(scripts.map(bytes))).reduce((sum, size) => sum + size, 0);
  const htmlBytes = Buffer.byteLength(html);

  assert.ok(htmlBytes <= 30_000, `HTML budget exceeded: ${htmlBytes} > 30000 bytes`);
  assert.ok(cssBytes <= 60_000, `CSS budget exceeded: ${cssBytes} > 60000 bytes`);
  assert.ok(jsBytes <= 125_000, `JavaScript budget exceeded: ${jsBytes} > 125000 bytes`);
  assert.ok(htmlBytes + cssBytes + jsBytes <= 215_000, `Shell budget exceeded: ${htmlBytes + cssBytes + jsBytes} > 215000 bytes`);
});
