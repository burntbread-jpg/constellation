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

test('saved archive metadata cannot overwrite curated launch copy', async () => {
  const archive = await readFile(new URL('../src/client/03-archive.js', import.meta.url), 'utf8');
  assert.match(archive, /works\[w\.id\]=\{\.\.\.w,\.\.\.works\[w\.id\]\}/);
  assert.match(archive, /works\[current\]=\{\.\.\.data\.work,\.\.\.works\[current\]\}/);
});

test('catalog migration stores editorial hooks and repairs verified anime covers', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261026_stage72_catalog_artwork_editorial.sql', import.meta.url), 'utf8');
  assert.match(migration, /add column if not exists editorial_intro text/);
  assert.match(migration, /고슴도치의 딜레마를 세계의 종말까지 밀어붙인 작품/);
  assert.match(migration, /fallback:anime:perfect-blue/);
  assert.match(migration, /editorial_intro = coalesce\(excluded\.editorial_intro/);
});

test('reviewed Korean book editions have durable cover repairs', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261027_stage72_korean_book_covers.sql', import.meta.url), 'utf8');
  assert.match(migration, /fallback:book:never-let-me-go/);
  assert.match(migration, /fallback:book:beloved/);
  assert.match(migration, /books\.google\.com\/books\/content/);
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

test('stage 73 keeps AI optional, zero-cost, private, and quality-gated', async () => {
  const engine=await readFile(new URL('../src/server/03-taste-engine.js',import.meta.url),'utf8');
  const archive=await readFile(new URL('../src/server/04-archive.js',import.meta.url),'utf8');
  const router=await readFile(new URL('../src/server/06-router.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  const policy=await readFile(new URL('../quality/AI_ASSIST.md',import.meta.url),'utf8');
  assert.match(engine,/LOCAL_AI_ZERO_COST_ACK/);
  assert.match(engine,/LOCAL_AI_BLOCKED_HOSTS/);
  assert.match(engine,/personalDataSent:false/);
  assert.match(engine,/AbortSignal\.timeout\(8000\)/);
  assert.match(engine,/\/no_think/);
  assert.match(engine,/max_tokens:480/);
  assert.match(engine,/replace\(\/<think>/);
  assert.match(engine,/validateLocalAiIntro/);
  assert.match(engine,/validateLocalAiTags/);
  assert.match(engine,/controlText/);
  assert.match(engine,/모든 것을 잃/);
  assert.match(engine,/aiOutcome:candidate\?\.outcome\|\|'not_attempted'/);
  assert.match(await readFile(new URL('../src/client/01-core.js',import.meta.url),'utf8'),/dataset\.editorialEngine=data\.engine/);
  assert.match(archive,/analyzeTasteAssisted/);
  assert.match(router,/\/api\/ai-assist\/status/);
  assert.match(html,/OPTIONAL AI ASSIST/);
  assert.match(policy,/개인 감상문은 기존 엔진에서만 처리/);
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

test('GitHub Actions blocks build, recommendation, security, accessibility, and performance regressions',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/quality.yml',import.meta.url),'utf8');
  const codeql=await readFile(new URL('../.github/workflows/codeql.yml',import.meta.url),'utf8');
  const secretScan=await readFile(new URL('../.github/workflows/secret-scan.yml',import.meta.url),'utf8');
  const sbom=await readFile(new URL('../.github/workflows/sbom.yml',import.meta.url),'utf8');
  const provenance=await readFile(new URL('../.github/workflows/provenance.yml',import.meta.url),'utf8');
  const dependabot=await readFile(new URL('../.github/dependabot.yml',import.meta.url),'utf8');
  assert.match(workflow,/pull_request:/);
  assert.match(workflow,/push:\s*\n\s*branches:\s*\n\s*- master/);
  assert.match(workflow,/permissions:\s*\n\s*contents: read/);
  assert.match(workflow,/timeout-minutes: 15/);
  assert.match(workflow,/run: npm run check/);
  assert.match(workflow,/run: npm run eval:recommendations/);
  assert.match(workflow,/run: npm run perf:baseline/);
  assert.match(workflow,/run: npm run dr:verify/);
  assert.match(workflow,/pnpm install --frozen-lockfile/);
  assert.match(workflow,/pnpm run audit:dependencies/);
  assert.match(workflow,/playwright install --with-deps chromium/);
  assert.match(workflow,/run: pnpm run test:e2e/);
  assert.match(workflow,/Build, test, security, accessibility, and performance/);
  assert.match(workflow,/git diff --exit-code -- dist quality\/reports/);
  assert.match(codeql,/name: CodeQL Security Analysis/);
  assert.match(codeql,/pull_request:[\s\S]*branches:[\s\S]*- master/);
  assert.match(codeql,/schedule:[\s\S]*cron: "35 0 \* \* 1"/);
  assert.match(codeql,/permissions:\s*\n\s*contents: read\s*\n\s*security-events: write/);
  assert.match(codeql,/languages: javascript-typescript/);
  assert.match(codeql,/build-mode: none/);
  assert.match(codeql,/queries: security-extended/);
  assert.match(codeql,/github\/codeql-action\/init@[0-9a-f]{40}/i);
  assert.match(codeql,/github\/codeql-action\/analyze@[0-9a-f]{40}/i);
  assert.match(secretScan,/name: Secret Leak Scan/);
  assert.match(secretScan,/pull_request:[\s\S]*branches:[\s\S]*- master/);
  assert.match(secretScan,/schedule:[\s\S]*cron: "5 1 \* \* 1"/);
  assert.match(secretScan,/permissions:\s*\n\s*contents: read/);
  assert.match(secretScan,/fetch-depth: 0/);
  assert.match(secretScan,/gitleaks\/gitleaks-action@[0-9a-f]{40}/i);
  assert.match(secretScan,/GITLEAKS_ENABLE_COMMENTS: "false"/);
  assert.match(secretScan,/GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"/);
  assert.match(sbom,/name: Software Bill of Materials/);
  assert.match(sbom,/format: cyclonedx-json/);
  assert.match(sbom,/output-file: sbom\.cdx\.json/);
  assert.match(sbom,/syft-version: v1\.55\.0/);
  assert.match(sbom,/dependency-snapshot: "false"/);
  assert.match(sbom,/upload-release-assets: "false"/);
  assert.match(sbom,/retention-days: 30/);
  assert.match(sbom,/if-no-files-found: error/);
  assert.match(sbom,/anchore\/sbom-action@[0-9a-f]{40}/i);
  assert.match(sbom,/actions\/upload-artifact@[0-9a-f]{40}/i);
  assert.match(provenance,/name: Build Provenance/);
  assert.match(provenance,/permissions:\s*\n\s*contents: read\s*\n\s*id-token: write\s*\n\s*attestations: write/);
  assert.doesNotMatch(provenance,/pull_request:/);
  assert.match(provenance,/git diff --exit-code -- dist/);
  assert.match(provenance,/--sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner/);
  assert.match(provenance,/sha256sum site-dist\.tar\.gz/);
  assert.match(provenance,/actions\/attest-build-provenance@[0-9a-f]{40}/i);
  assert.match(provenance,/subject-path: site-dist\.tar\.gz/);
  assert.match(provenance,/retention-days: 30/);
  assert.match(provenance,/compression-level: 0/);
  const actionReferences=[...`${workflow}\n${codeql}\n${secretScan}\n${sbom}\n${provenance}`.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map(match=>match[1]);
  assert.ok(actionReferences.length>=15,'expected all workflow actions to be enumerated');
  for(const reference of actionReferences)assert.match(reference,/@[0-9a-f]{40}$/i,`GitHub Action must be pinned to a commit SHA: ${reference}`);
  assert.match(dependabot,/package-ecosystem: "npm"/);
  assert.match(dependabot,/package-ecosystem: "github-actions"/);
  assert.match(dependabot,/interval: "weekly"/);
  assert.match(dependabot,/open-pull-requests-limit: 5/);
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

test('distributed rate limiting is atomic, private, and shared through Supabase',async()=>{
  const router=await readFile(new URL('../src/server/06-router.js',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261027_stage68_distributed_rate_limit.sql',import.meta.url),'utf8');
  assert.match(router,/rpc\/consume_api_rate_limit/);
  assert.match(router,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(router,/x-ratelimit-policy/);
  assert.match(router,/local-fallback/);
  assert.match(migration,/on conflict \(bucket_key\) do update/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.api_rate_limit_buckets from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.consume_api_rate_limit\(text, integer, integer\) to service_role/);
  assert.match(migration,/set search_path = ''/);
});

test('performance baseline covers API concurrency and production database plans',async()=>{
  const script=await readFile(new URL('../scripts/performance-baseline.mjs',import.meta.url),'utf8');
  const budgets=await readFile(new URL('../quality/performance-budgets.md',import.meta.url),'utf8');
  const database=await readFile(new URL('../quality/reports/database-performance-baseline.md',import.meta.url),'utf8');
  for(const path of ['health','search','archive','recommendations'])assert.match(script,new RegExp(`${path}:`));
  assert.match(script,/\[1,10,50\]/);
  assert.match(script,/p95/);assert.match(script,/p99/);
  assert.match(budgets,/Any p95 or p99 breach fails CI/);
  assert.match(database,/EXPLAIN \(ANALYZE, BUFFERS\)/);
  assert.match(database,/works_taste_vector_idx/);
});

test('disaster recovery has private logical exports, checksum verification, and a tested runbook',async()=>{
  const exporter=await readFile(new URL('../scripts/export-supabase-backup.mjs',import.meta.url),'utf8');
  const verifier=await readFile(new URL('../scripts/verify-recovery-readiness.mjs',import.meta.url),'utf8');
  const runbook=await readFile(new URL('../quality/DISASTER_RECOVERY.md',import.meta.url),'utf8');
  const ignore=await readFile(new URL('../.gitignore',import.meta.url),'utf8');
  assert.match(exporter,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(exporter,/gzipSync/);assert.match(exporter,/sha256/);assert.match(exporter,/mode:0o600/);
  assert.match(exporter,/console\.log\(JSON\.stringify\(\{archivePath,manifestPath,sha256:archiveHash,tables:tableManifest\},null,2\)\)/);
  assert.match(verifier,/recovery readiness report is stale/);
  assert.match(runbook,/목표 RPO/);assert.match(runbook,/목표 RTO/);assert.match(runbook,/격리 환경/);
  assert.match(runbook,/Storage 객체/);assert.match(runbook,/쓰기를 재개하지 않고/);
  assert.match(ignore,/\.backups\//);
});

test('privacy retention is bounded, scheduled, documented, and atomically deletes user data',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261027132839_stage70_privacy_retention.sql',import.meta.url),'utf8');
  const policy=await readFile(new URL('../quality/PRIVACY_RETENTION.md',import.meta.url),'utf8');
  const privacy=await readFile(new URL('../dist/client/privacy.html',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/server/04-archive.js',import.meta.url),'utf8');
  assert.match(migration,/function public\.delete_user_private_data\(p_user_id uuid\)/);
  assert.match(migration,/function public\.run_data_retention/);
  assert.match(migration,/limit v_batch for update skip locked/);
  assert.match(migration,/180 days/);assert.match(migration,/730 days/);assert.match(migration,/1095 days/);
  assert.match(migration,/taste-constellation-data-retention/);assert.match(migration,/40 3 \* \* \*/);
  assert.match(migration,/revoke all on function public\.delete_user_private_data\(uuid\) from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.run_data_retention\(timestamptz, integer\) to service_role/);
  assert.match(server,/rpc\/delete_user_private_data/);
  assert.match(policy,/사용자가 삭제할 때까지/);assert.match(policy,/한 테이블당 최대 5,000행/);
  assert.match(privacy,/보존 정책 v1/);assert.match(privacy,/추천 연결은 마지막 갱신 후 180일/);
});

test('stage 71 catalog quality gate quarantines weak candidates and serves verified metadata only',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261028071619_stage71_catalog_quality.sql',import.meta.url),'utf8');
  const recommendations=await readFile(new URL('../src/server/05-recommendations.js',import.meta.url),'utf8');
  assert.match(migration,/catalog_status/);assert.match(migration,/metadata_quality_score/);
  assert.match(migration,/works_catalog_ready_idx/);assert.match(migration,/catalog_metadata_quality/);
  assert.match(migration,/catalog_status in \('curated','verified'\)/);
  assert.match(migration,/create function public\.match_work_catalog/);
  assert.match(recommendations,/curated-metadata-cross-media-v2/);
  assert.match(recommendations,/recommendationReady/);
  assert.match(recommendations,/fallback:manga:parasite/);
  assert.match(recommendations,/fallback:manga:fullmetal-alchemist/);
});

test('stage 72 recommendation metrics are aggregate-only, private, retained, and visible to reviewers',async()=>{
  const migration=await readFile(new URL('../supabase/migrations/20261028075520_stage72_recommendation_learning_metrics.sql',import.meta.url),'utf8');
  const policy=await readFile(new URL('../quality/RECOMMENDATION_METRICS.md',import.meta.url),'utf8');
  const client=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  assert.match(migration,/create table if not exists public\.recommendation_metrics_daily/);
  assert.match(migration,/primary key \(metric_date, connection_mode, source_media_type, target_media_type, event_type\)/);
  assert.doesNotMatch(migration,/recommendation_metrics_daily[\s\S]{0,800}user_id/);
  assert.doesNotMatch(migration,/recommendation_metrics_daily[\s\S]{0,800}work_id/);
  assert.match(migration,/enable row level security/);assert.match(migration,/to anon, authenticated using \(false\)/);
  assert.match(migration,/revoke all on function public\.record_recommendation_metrics\(jsonb\) from public, anon, authenticated/);
  assert.match(migration,/current_date - 730/);assert.match(migration,/taste-constellation-recommendation-metrics-retention/);
  assert.match(policy,/사용자 ID, 작품 ID, 이메일, IP/);assert.match(client,/recommendationMetricsSummary/);
});
