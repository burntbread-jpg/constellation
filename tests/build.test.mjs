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

test('review dashboard exposes protected operational health checks', async () => {
  const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8');
  const core = await readFile(new URL('../src/client/01-core.js', import.meta.url), 'utf8');
  const events = await readFile(new URL('../src/client/04-events.js', import.meta.url), 'utf8');
  assert.match(html, /id="operationsHealthSummary"/);
  assert.match(html, /id="operationsHealthRefresh"/);
  assert.match(core, /\/api\/health\/deep/);
  assert.match(core, /cache:'no-store'/);
  assert.match(core, /loadOperationalHealth\(\)/);
  assert.match(core, /scheduleOperationalHealth/);
  assert.match(core, /60000/);
  assert.match(core, /API 5XX/);
  assert.match(core, /24시간 점검 이력/);
  assert.match(core, /consecutiveIssues/);
  assert.match(events, /operationsHealthRefresh/);
});

test('health check history is private, indexed, and retained by the service', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261014_stage58_health_check_history.sql', import.meta.url), 'utf8');
  assert.match(migration, /create table if not exists public\.health_check_runs/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.health_check_runs from anon, authenticated/);
  assert.match(migration, /grant all on public\.health_check_runs to service_role/);
  assert.match(migration, /health_check_runs_checked_at_idx/);
});

test('scheduled health alerts are private, durable, and use Vault-backed cron secrets', async () => {
  const migration=await readFile(new URL('../supabase/migrations/20261019_stage59_health_alerts.sql',import.meta.url),'utf8');
  const schedule=await readFile(new URL('../supabase/stage59_schedule_health_monitor.sql',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/server/06-router.js',import.meta.url),'utf8');
  assert.match(migration,/create table if not exists public\.health_alert_events/);
  assert.match(migration,/where delivered_at is null/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.health_alert_events from anon, authenticated/);
  assert.match(schedule,/vault\.decrypted_secrets/);
  assert.match(schedule,/OAI-Sites-Authorization/);
  assert.match(schedule,/\*\/5 \* \* \* \*/);
  assert.doesNotMatch(schedule,/Bearer [A-Za-z0-9_-]{12,}/);
  assert.match(server,/\/api\/health\/scheduled/);
  assert.match(server,/HEALTH_MONITOR_TOKEN/);
  assert.match(server,/HEALTH_ALERT_WEBHOOK_URL/);
});

test('reviewer operations dashboard renders durable health alert history', async () => {
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../dist/metadata.css',import.meta.url),'utf8');
  assert.match(core,/healthAlertLabels/);
  assert.match(core,/data\.alerts/);
  assert.match(core,/전송 실패/);
  assert.match(css,/\.operations-alerts/);
});

test('operational alerts support private reviewer acknowledgement and resolution notes', async () => {
  const server=await readFile(new URL('../src/server/06-router.js',import.meta.url),'utf8');
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  const events=await readFile(new URL('../src/client/04-events.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../dist/client/metadata.css',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261019_stage61_alert_acknowledgement.sql',import.meta.url),'utf8');
  assert.match(server,/updateHealthAlertLifecycle/);
  assert.match(server,/ACKNOWLEDGE_ALERT/);
  assert.match(server,/record_health_alert_action/);
  assert.match(core,/data-health-alert-action/);
  assert.match(events,/updateHealthAlertLifecycle/);
  assert.match(css,/article\.acknowledged/);
  assert.match(migration,/health_alert_events_unacknowledged_idx/);
  assert.match(migration,/revoke all on public\.health_alert_events from anon, authenticated/);
});

test('operational incidents have atomic resolve and reopen lifecycle history',async()=>{
  const server=await readFile(new URL('../src/server/06-router.js',import.meta.url),'utf8');
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261022022950_stage62_incident_lifecycle.sql',import.meta.url),'utf8');
  assert.match(server,/RESOLVE_ALERT/);assert.match(server,/REOPEN_ALERT/);assert.match(server,/health_alert_actions/);
  assert.match(core,/해결 처리/);assert.match(core,/재개방/);assert.match(core,/alert-action-history/);
  assert.match(migration,/create table if not exists public\.health_alert_actions/);assert.match(migration,/for update/);assert.match(migration,/security invoker/);assert.match(migration,/revoke all on function public\.record_health_alert_action/);
});

test('public leaderboard uses an invoker view over a private sanitized projection',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261022150541_stage63_secure_leaderboard.sql',import.meta.url),'utf8');
  assert.match(migration,/create table if not exists private\.leaderboard_entries/);
  assert.match(migration,/security_invoker = true/);
  assert.match(migration,/revoke all on public\.leaderboard from public, anon, authenticated/);
  assert.match(migration,/grant select on public\.leaderboard to anon, authenticated, service_role/);
  assert.doesNotMatch(migration,/grant select on public\.game_scores to anon/);
  assert.match(migration,/security definer\s+set search_path = ''/);
  assert.match(migration,/revoke all on function private\.sync_leaderboard_score\(\)/);
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
  assert.match(storage,/restoredPairs/);assert.match(core,/구분 예외/);
});

test('review dashboard manages persistent work identity exceptions',async()=>{
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const core=await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8');
  const router=await readFile(new URL('../src/server/06-router.js',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261012_stage50_identity_exceptions.sql',import.meta.url),'utf8');
  assert.match(html,/id="identityExceptionList"/);assert.match(core,/서로 다른 작품/);assert.match(core,/\/api\/identity-exceptions/);
  assert.match(router,/identityExceptions/);assert.match(migration,/work_identity_exceptions_pair_idx/);
});

test('metadata provenance trigger runs with least privilege',async()=>{
  const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261013_stage51_harden_metadata_trigger.sql',import.meta.url),'utf8');
  assert.match(schema,/fill_metadata_change_provenance\(\)[\s\S]*security invoker set search_path = ''/);
  assert.match(schema,/revoke execute on function public\.fill_metadata_change_provenance\(\) from public, anon, authenticated/);
  assert.match(migration,/alter function public\.fill_metadata_change_provenance\(\) security invoker/);
  assert.match(migration,/grant execute on function public\.fill_metadata_change_provenance\(\) to service_role/);
});

test('foreign key paths have covering indexes',async()=>{
  const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261013_stage52_index_foreign_keys.sql',import.meta.url),'utf8');
  for(const source of [schema,migration]){
    assert.match(source,/archive_items_work_idx[\s\S]*archive_items\s*\(work_id\)/);
    assert.match(source,/metadata_changes_report_idx[\s\S]*metadata_changes\s*\(report_id\)/);
    assert.match(source,/metadata_reports_user_idx[\s\S]*metadata_reports\s*\(user_id\)/);
  }
});

test('server-only tables explicitly deny direct client access',async()=>{
  const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261013_stage53_explicit_client_denies.sql',import.meta.url),'utf8');
  const tables=[
    'archive_items','connections','duplicate_work_merges','metadata_changes',
    'metadata_reports','recommendation_feedback','taste_tags',
    'work_identity_exceptions','works'
  ];
  for(const source of [schema,migration]){
    for(const table of tables) assert.match(source,new RegExp(`'${table}'`));
    assert.match(source,/for all to anon, authenticated using \(false\) with check \(false\)/);
  }
});

test('privileged database functions use only fixed trusted search paths',async()=>{
  const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261013_stage54_harden_privileged_functions.sql',import.meta.url),'utf8');
  const functions=[
    'backfill_taste_graph','match_work_catalog','merge_duplicate_works',
    'restore_duplicate_work_merge','save_archive_analysis','save_connections',
    'taste_similarity_edges','upsert_work_catalog'
  ];
  assert.doesNotMatch(schema,/security definer set search_path = public(?:\s|,)/);
  assert.doesNotMatch(schema,/security definer[\s\S]{0,40}set search_path = public(?:\s|,)/);
  for(const name of functions){
    assert.match(migration,new RegExp(`alter function public\\.${name}\\([\\s\\S]*?set search_path = (?:''|pg_catalog, extensions)`));
    assert.match(migration,new RegExp(`revoke all on function public\\.${name}\\(`));
  }
});
