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

test('archive analysis SQL deduplicates taste tags with the declared alias', async () => {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261009_fix_save_archive_analysis.sql', import.meta.url), 'utf8');
  for (const sql of [schema, migration]) {
    assert.match(sql, /select distinct on \(tag->>'tag'\)/);
    assert.doesNotMatch(sql, /select distinct on \(item->>'id'\)/);
  }
});

test('Sites identities are not constrained to Supabase Auth users', async () => {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20261009_support_sites_profiles.sql', import.meta.url), 'utf8');
  for (const sql of [schema, migration]) {
    assert.match(sql, /alter table public\.profiles drop constraint if exists profiles_id_fkey/);
  }
});

test('archive library displays the editorial Bridge Score instead of graph centrality', async () => {
  const source = await readFile(new URL('../src/client/03-archive.js', import.meta.url), 'utf8');
  assert.match(source, /return work\?bridgeProfile\(work\)\.score:0/);
  assert.match(source, /<small>Bridge \$\{archiveBridgeScore\(work\.id\)\}<\/small>/);
  assert.doesNotMatch(source, /archiveBridgeScore\(work\.id\)\*100/);
});
