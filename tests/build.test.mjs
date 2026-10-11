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
  assert.match(source, /typeof workOrId==='object'/);
  assert.match(source, /<small>Bridge \$\{archiveBridgeScore\(work\)\}<\/small>/);
  assert.doesNotMatch(source, /archiveBridgeScore\(work\.id\)\*100/);
});

test('PWA shell and HTML request the same current client bundle', async () => {
  const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../dist/client/service-worker.js', import.meta.url), 'utf8');
  const version = html.match(/app\.js\?v=(\d+)/)?.[1];
  assert.ok(version);
  assert.match(worker, new RegExp(`app\\.js\\?v=${version}`));
  assert.match(worker, new RegExp(`taste-constellation-shell-v${version}`));
});

test('work details diagnose incomplete metadata and link each gap to a correction report', async () => {
  const core = await readFile(new URL('../src/client/01-core.js', import.meta.url), 'utf8');
  const events = await readFile(new URL('../src/client/04-events.js', import.meta.url), 'utf8');
  assert.match(core, /function metadataCompleteness\(w\)/);
  assert.match(core, /data-metadata-missing/);
  assert.match(events, /openMetadataReport\(button\.dataset\.metadataMissing\)/);
});

test('metadata quality queue supports title, media, missing-field, and priority controls', async () => {
  const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/client/01-core.js', import.meta.url), 'utf8');
  for (const id of ['metadataQualitySearch','metadataQualityMedia','metadataQualityField','metadataQualitySort']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(core,/function renderMetadataQuality\(\)/);
  assert.match(core,/item\.missing\.includes\(field\)/);
});

test('metadata quality gaps can preload a reviewer correction from free providers', async () => {
  const core = await readFile(new URL('../src/client/01-core.js', import.meta.url), 'utf8');
  const events = await readFile(new URL('../src/client/04-events.js', import.meta.url), 'utf8');
  assert.match(core,/data-quality-suggest/);
  assert.match(core,/async function suggestMetadataRepair\(button\)/);
  assert.match(core,/\/api\/artwork\?/);
  assert.match(core,/\/api\/search\?q=/);
  assert.match(core,/확인한 뒤 승인해 주세요/);
  assert.match(events,/suggestMetadataRepair\(suggestion\)/);
});

test('metadata repair candidates expose identity evidence before creating a proposal', async () => {
  const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/client/01-core.js', import.meta.url), 'utf8');
  const events = await readFile(new URL('../src/client/04-events.js', import.meta.url), 'utf8');
  assert.match(html,/id="metadataCandidateDialog"/);
  assert.match(html,/id="metadataCandidateList"/);
  assert.match(core,/function scoreMetadataCandidate\(item,w\)/);
  for (const label of ['제목','매체','창작자','연도']) assert.match(core,new RegExp(label));
  assert.match(core,/작품 일치 참고 점수/);
  assert.match(core,/slice\(0,6\)/);
  assert.match(events,/useMetadataCandidate/);
});

test('metadata quality queue can batch trusted candidates into review without applying them', async () => {
  const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/client/01-core.js', import.meta.url), 'utf8');
  assert.match(html,/id="metadataQualityBatch"/);
  assert.match(core,/async function batchMetadataRepair\(\)/);
  assert.match(core,/assessment\.score<55/);
  assert.match(core,/submitted>=20/);
  assert.match(core,/작품 정보는 자동 변경되지 않습니다/);
  assert.match(core,/\/api\/metadata-reports/);
});

test('review dashboard presents duplicate detection as a read-only operation', async () => {
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  assert.match(html,/id="duplicateCandidateList"/);
  assert.match(core,/\/api\/duplicate-candidates/);
  assert.match(core,/읽기 전용 탐지 결과 · 병합되지 않음/);
  assert.match(core,/각색.*리메이크.*제외/);
});

test('duplicate merge requires explicit confirmation and submits reviewed fields', async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  assert.match(html,/id="duplicatePreviewDialog"/);
  assert.match(core,/\/api\/duplicate-preview/);
  assert.match(core,/data-duplicate-confirm/);
  assert.match(core,/confirmation:'MERGE_DUPLICATES'/);
  assert.match(core,/\/api\/duplicate-merge/);
});

test('review dashboard exposes duplicate merge audit and integrity status',async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  assert.match(html,/id="duplicateMergeSummary"/);assert.match(html,/id="duplicateMergeList"/);
  assert.match(core,/\/api\/duplicate-merges/);assert.match(core,/무결성 정상/);assert.match(core,/감사 기록/);
});

test('review dashboard can safely restore a merged work catalog',async()=>{
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  const router=await readFile(new URL('../src/server/06-router.js',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261011_stage48_duplicate_merge_recovery.sql',import.meta.url),'utf8');
  assert.match(core,/confirmation:'RESTORE_CATALOG'/);assert.match(core,/개인화 데이터는 대표 작품에 유지/);
  assert.match(router,/restoreDuplicateMerge/);assert.match(migration,/restore_duplicate_work_merge/);assert.match(migration,/restored_at/);
});

test('work detail omits the generic culture bridge sentence and restored pairs stay suppressed',async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  const storage=await readFile(new URL('../src/server/02-storage.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="cultureContext"/);assert.doesNotMatch(core,/\$\('#cultureContext'\)/);
  assert.match(storage,/restoredPairs/);assert.match(core,/복구 판정/);
});
