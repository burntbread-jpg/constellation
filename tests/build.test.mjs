import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {bundles, compose} from '../scripts/build.mjs';

const normalize = value => value.replace(/\r\n/g, '\n');

test('client deployment artifact matches the modular source', async () => {
  const generated = await compose(bundles.client);
  const deployed = await readFile(new URL('../dist/client/app.js', import.meta.url), 'utf8');
  assert.equal(normalize(deployed), normalize(generated));
});

test('server deployment artifact matches the modular source', async () => {
  const generated = await compose(bundles.server);
  const deployed = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
  assert.equal(normalize(deployed), normalize(generated));
});
