import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MODES = ['story', 'mood', 'idea', 'visual', 'deep'];
const MODE_LABELS = {story: 'Story', mood: 'Mood', idea: 'Idea', visual: 'Visual', deep: 'Deep Cut'};
const FORBIDDEN_EDITORIAL = ['장르는 달라도', '취향의 중심이 연결', '에서 읽힌', '무료 메타데이터'];

const ratio = (value, total) => total ? Number((value / total).toFixed(4)) : 0;
const titleKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const familyKey = value => titleKey(String(value || '')
  .replace(/\[[^\]]*\]|\([^)]*(?:판|권|세트|edition|volume|vol)[^)]*\)/gi, ' ')
  .replace(/(?:전\s*)?\d+\s*권(?:\s*완결)?|\bvol(?:ume)?\.?\s*\d+\b|\bbook\s*\d+\b/gi, ' ')
  .replace(/(?:개정|한정|리미티드|양장|합본|세트|완결)판?/g, ' '));

function editorialPass(item, sourceTitle) {
  const line = String(item.editorialIntro || '').trim();
  return line.length >= 18 && line.length <= 120 && line.endsWith('작품.')
    && !line.includes(sourceTitle)
    && !FORBIDDEN_EDITORIAL.some(phrase => line.includes(phrase))
    && /(묻는|밀어붙인|키워낸|바라보는|추적한|확대한|드러낸|응시하는)/.test(line);
}

function scenarioChecks(source, items, expectedCount) {
  const ids = items.map(item => item.id);
  const families = items.map(item => familyKey(item.title));
  const sourceFamily = familyKey(source.title);
  return {
    count: items.length === expectedCount,
    unique: new Set(ids).size === items.length && new Set(families).size === items.length,
    excludesSource: items.every(item => item.id !== source.id && titleKey(item.title) !== titleKey(source.title) && familyKey(item.title) !== sourceFamily),
    mediaDiversity: new Set(items.map(item => item.mediaType)).size >= 2,
    metadata: items.every(item => Number.isInteger(item.year) && item.year >= 1800 && item.creator),
    editorial: items.every(item => editorialPass(item, source.title))
  };
}

export async function evaluateRecommendations({write = false} = {}) {
  const [cases, thresholds] = await Promise.all([
    readFile(resolve(root, 'quality/recommendation-eval-set.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'quality/recommendation-thresholds.json'), 'utf8').then(JSON.parse)
  ]);
  if (cases.length < thresholds.minimumCases) throw new Error(`평가 세트가 ${thresholds.minimumCases}개보다 적습니다.`);

  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input instanceof Request ? input.url : input);
    if (/themoviedb|googleapis|openlibrary|anilist|wikidata|wikipedia/i.test(url)) {
      return new Response(JSON.stringify({error: 'quality-eval-offline'}), {status: 503, headers: {'content-type': 'application/json'}});
    }
    return nativeFetch(input);
  };

  const worker = (await import(`${pathToFileURL(resolve(root, 'dist/server/index.js')).href}?eval=${Date.now()}`)).default;
  const scenarios = [];
  try {
    for (const source of cases) {
      for (const mode of MODES) {
        const response = await worker.fetch(new Request('https://quality.test/api/recommendations', {
          method: 'POST',
          headers: {'content-type': 'application/json', 'oai-authenticated-user-id': `quality-${source.id}-${mode}`},
          body: JSON.stringify({work: source, mode})
        }), {});
        const data = await response.json();
        if (!response.ok) throw new Error(`${source.title}/${mode}: ${data.error || response.status}`);
        const items = data.items || [];
        const checks = scenarioChecks(source, items, thresholds.recommendationsPerScenario);
        const aligned = items.filter(item => (item.sharedTags || []).some(tag => source.expectedTags.includes(tag))).length;
        scenarios.push({sourceId: source.id, sourceTitle: source.title, sourceMedia: source.mediaType, mode, engine: data.engine, items, checks, aligned});
      }
    }
  } finally {
    globalThis.fetch = nativeFetch;
  }

  const totalItems = scenarios.reduce((sum, scenario) => sum + scenario.items.length, 0);
  const passedScenarios = scenarios.filter(scenario => Object.values(scenario.checks).every(Boolean)).length;
  const alignedItems = scenarios.reduce((sum, scenario) => sum + scenario.aligned, 0);
  const crossMediaItems = scenarios.reduce((sum, scenario) => sum + scenario.items.filter(item => item.mediaType !== scenario.sourceMedia).length, 0);
  const editorialItems = scenarios.reduce((sum, scenario) => sum + scenario.items.filter(item => editorialPass(item, scenario.sourceTitle)).length, 0);
  const caseMetrics = cases.map(source => {
    const rows = scenarios.filter(scenario => scenario.sourceId === source.id);
    const signatures = new Set(rows.map(row => row.items.map(item => familyKey(item.title)).join('|')));
    const ids = rows.flatMap(row => row.items.map(item => item.id));
    return {id: source.id, title: source.title, modeDifferentiation: ratio(signatures.size, MODES.length), uniqueRate: ratio(new Set(ids).size, ids.length)};
  });
  const perMode = Object.fromEntries(MODES.map(mode => {
    const rows = scenarios.filter(scenario => scenario.mode === mode);
    const count = rows.reduce((sum, row) => sum + row.items.length, 0);
    return [mode, {
      scenarios: rows.length,
      passRate: ratio(rows.filter(row => Object.values(row.checks).every(Boolean)).length, rows.length),
      tagAlignment: ratio(rows.reduce((sum, row) => sum + row.aligned, 0), count),
      crossMediaRate: ratio(rows.reduce((sum, row) => sum + row.items.filter(item => item.mediaType !== row.sourceMedia).length, 0), count)
    }];
  }));
  const metrics = {
    cases: cases.length,
    modes: MODES.length,
    scenarios: scenarios.length,
    recommendations: totalItems,
    scenarioPassRate: ratio(passedScenarios, scenarios.length),
    tagAlignment: ratio(alignedItems, totalItems),
    crossMediaRate: ratio(crossMediaItems, totalItems),
    modeDifferentiation: Number((caseMetrics.reduce((sum, item) => sum + item.modeDifferentiation, 0) / caseMetrics.length).toFixed(4)),
    editorialQuality: ratio(editorialItems, totalItems),
    perCaseUniqueRate: Number((caseMetrics.reduce((sum, item) => sum + item.uniqueRate, 0) / caseMetrics.length).toFixed(4))
  };
  const gates = {
    cases: metrics.cases >= thresholds.minimumCases,
    scenarioPassRate: metrics.scenarioPassRate >= thresholds.minimumScenarioPassRate,
    tagAlignment: metrics.tagAlignment >= thresholds.minimumTagAlignment,
    crossMediaRate: metrics.crossMediaRate >= thresholds.minimumCrossMediaRate,
    modeDifferentiation: metrics.modeDifferentiation >= thresholds.minimumModeDifferentiation,
    editorialQuality: metrics.editorialQuality >= thresholds.minimumEditorialQuality,
    perCaseUniqueRate: metrics.perCaseUniqueRate >= thresholds.minimumPerCaseUniqueRate
  };
  const report = {version: 1, dataset: 'recommendation-eval-set-v1', thresholds, metrics, perMode, gates, passed: Object.values(gates).every(Boolean), failures: scenarios.filter(row => !Object.values(row.checks).every(Boolean)).map(row => ({source: row.sourceTitle, mode: row.mode, checks: row.checks})), cases: caseMetrics};

  if (write) {
    const reportDir = resolve(root, 'quality/reports');
    await mkdir(reportDir, {recursive: true});
    await writeFile(resolve(reportDir, 'recommendation-quality.json'), `${JSON.stringify(report, null, 2)}\n`);
    const rows = MODES.map(mode => `| ${MODE_LABELS[mode]} | ${(perMode[mode].passRate * 100).toFixed(1)}% | ${(perMode[mode].tagAlignment * 100).toFixed(1)}% | ${(perMode[mode].crossMediaRate * 100).toFixed(1)}% |`).join('\n');
    const markdown = `# Recommendation quality baseline\n\n- 평가 작품: ${metrics.cases}개\n- 평가 시나리오: ${metrics.scenarios}개\n- 추천 결과: ${metrics.recommendations}개\n- 최종 판정: **${report.passed ? 'PASS' : 'FAIL'}**\n\n| 지표 | 결과 | 기준 |\n| --- | ---: | ---: |\n| 시나리오 통과율 | ${(metrics.scenarioPassRate * 100).toFixed(1)}% | ${(thresholds.minimumScenarioPassRate * 100).toFixed(0)}% |\n| Taste DNA 정렬 | ${(metrics.tagAlignment * 100).toFixed(1)}% | ${(thresholds.minimumTagAlignment * 100).toFixed(0)}% |\n| 교차 매체 비율 | ${(metrics.crossMediaRate * 100).toFixed(1)}% | ${(thresholds.minimumCrossMediaRate * 100).toFixed(0)}% |\n| 모드 차별화 | ${(metrics.modeDifferentiation * 100).toFixed(1)}% | ${(thresholds.minimumModeDifferentiation * 100).toFixed(0)}% |\n| 한줄평 품질 | ${(metrics.editorialQuality * 100).toFixed(1)}% | ${(thresholds.minimumEditorialQuality * 100).toFixed(0)}% |\n| 작품별 추천 다양성 | ${(metrics.perCaseUniqueRate * 100).toFixed(1)}% | ${(thresholds.minimumPerCaseUniqueRate * 100).toFixed(0)}% |\n\n## Connection Mode별 결과\n\n| 모드 | 통과율 | Taste DNA 정렬 | 교차 매체 |\n| --- | ---: | ---: | ---: |\n${rows}\n\n## 판정 규칙\n\n동일 작품·동일 시리즈·이미 입력된 작품의 재추천, 결과 내 중복, 연도·창작자 누락, 매체 편중, 재귀적 한줄평을 실패로 처리합니다. 외부 제공처 장애와 무관한 재현 가능한 기준선을 위해 내장 무료 카탈로그로 측정합니다.\n`;
    await writeFile(resolve(reportDir, 'recommendation-quality.md'), markdown);
  }
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await evaluateRecommendations({write: process.argv.includes('--write')});
  console.log(JSON.stringify({passed: report.passed, metrics: report.metrics, gates: report.gates, perMode: report.perMode}, null, 2));
  if (!report.passed) process.exitCode = 1;
}
