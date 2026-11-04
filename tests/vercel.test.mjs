import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Vercel serves the built client and deploys the Worker API adapter', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, 'pnpm run build');
  assert.equal(config.outputDirectory, 'dist/client');

  const api = await import(new URL('../api/[...path].js', import.meta.url));
  const response = await api.GET(new Request('https://example.vercel.app/api/health'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.runtime, 'production-hardening-v1');
});
