import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync('quality/catalog-review-100.json', 'utf8'));
const report = JSON.parse(fs.readFileSync('quality/reports/catalog-review-100.json', 'utf8'));

test('stage 5 fixes exactly 100 unique reviewed works', () => {
  assert.equal(manifest.length, 100);
  const identities = new Set(manifest.map(item => `${item.mediaType}:${item.title.normalize('NFKC').toLowerCase()}`));
  assert.equal(identities.size, 100);
  assert.deepEqual(
    Object.fromEntries(['BOOK','FILM','ANIME','MANGA'].map(type => [type, manifest.filter(item => item.mediaType === type).length])),
    {BOOK:30,FILM:30,ANIME:25,MANGA:15}
  );
});

test('stage 5 report passes every catalog and poster gate', () => {
  assert.equal(report.audit.total, 100);
  assert.equal(report.audit.minimumCompletion, 100);
  assert.equal(report.audit.duplicateIdentityCount, 0);
  assert.deepEqual(report.audit.unreachablePosters, []);
  assert.deepEqual(report.audit.unresolved, []);
  assert.ok(report.items.every(item => item.posterReachable && /^https:\/\//.test(item.posterUrl)));
});

test('stage 5 migrations preserve reviewed identities and explicit quarantine', () => {
  const seed = [
    'supabase/migrations/20261110120000_stage5_catalog_review_100_a.sql',
    'supabase/migrations/20261110120100_stage5_catalog_review_100_b.sql'
  ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const quarantine = fs.readFileSync('supabase/migrations/20261110120200_stage5_preserve_explicit_quarantine.sql', 'utf8');
  assert.match(seed, /resolved_id/);
  assert.match(seed, /'verified',now\(\)/);
  assert.match(quarantine, /new\.catalog_status = 'quarantined'/);
});
