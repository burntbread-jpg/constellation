import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const source=await readFile(resolve(root,'dist/server/index.js'),'utf8');
const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const originalFetch=globalThis.fetch;
const json=(value,status=200)=>new Response(status===204?null:JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

globalThis.fetch=async(url,init={})=>{
  const target=new URL(String(url));
  if(target.hostname==='mock.supabase.test'){
    const table=target.pathname.split('/').at(-1);
    if(table==='consume_api_rate_limit')return json([{allowed:true,request_count:1,limit_value:180,remaining:179,retry_after:0,reset_at:new Date(Date.now()+60000).toISOString()}]);
    if(table==='profiles'||table==='save_connections')return json(null,204);
    if(table==='upsert_work_catalog')return json(0);
    return json([]);
  }
  if(target.hostname.includes('themoviedb.org'))return json({results:[]});
  if(target.hostname.includes('googleapis.com'))return json({items:[]});
  if(target.hostname.includes('openlibrary.org'))return json({docs:[]});
  if(target.hostname.includes('anilist.co'))return json({data:{Page:{media:[]}}});
  return originalFetch(url,init);
};

const env={SUPABASE_URL:'https://mock.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'performance-only-key'};
const auth={'oai-authenticated-user-id':'11111111-1111-4111-8111-111111111111','oai-authenticated-user-email':'baseline@example.test'};
const sourceWork={id:'baseline:evangelion',title:'신세기 에반게리온',creator:'안노 히데아키',year:1995,mediaType:'ANIME',description:'고슴도치의 딜레마를 세계의 종말까지 밀어붙인 작품.'};
const cases={
  health:()=>new Request('https://site.test/api/health'),
  search:()=>new Request('https://site.test/api/search?q=%EA%B8%B0%EC%96%B5'),
  archive:()=>new Request('https://site.test/api/archive',{headers:auth}),
  recommendations:()=>new Request('https://site.test/api/recommendations',{method:'POST',headers:{...auth,'content-type':'application/json',origin:'https://site.test'},body:JSON.stringify({work:sourceWork,mode:'deep'})})
};
const budgets={health:{p95:25,p99:50},search:{p95:75,p99:150},archive:{p95:60,p99:120},recommendations:{p95:150,p99:300}};
const percentile=(values,value)=>values[Math.min(values.length-1,Math.ceil(values.length*value)-1)];
const round=value=>Number(value.toFixed(2));

async function measure(name,concurrency,samples=60){
  const durations=[],statuses=[];
  for(let offset=0;offset<samples;offset+=concurrency){
    await Promise.all(Array.from({length:Math.min(concurrency,samples-offset)},async()=>{
      const started=performance.now(),response=await worker.fetch(cases[name](),env);
      durations.push(performance.now()-started);statuses.push(response.status);await response.arrayBuffer();
    }));
  }
  durations.sort((a,b)=>a-b);
  if(statuses.some(status=>status>=500))throw new Error(`${name} returned server errors: ${statuses.filter(status=>status>=500).join(',')}`);
  return{samples:durations.length,concurrency,p50:round(percentile(durations,.5)),p95:round(percentile(durations,.95)),p99:round(percentile(durations,.99)),max:round(durations.at(-1)),statuses:[...new Set(statuses)]};
}

try{
  for(const create of Object.values(cases))await worker.fetch(create(),env);
  const results={};
  for(const name of Object.keys(cases)){
    results[name]={};
    for(const concurrency of [1,10,50])results[name][`c${concurrency}`]=await measure(name,concurrency);
  }
  const failures=[];
  for(const[name,levels]of Object.entries(results))for(const[label,result]of Object.entries(levels)){
    if(result.p95>budgets[name].p95)failures.push(`${name}/${label} p95 ${result.p95}ms > ${budgets[name].p95}ms`);
    if(result.p99>budgets[name].p99)failures.push(`${name}/${label} p99 ${result.p99}ms > ${budgets[name].p99}ms`);
  }
  const report={version:1,kind:'deterministic-worker-baseline',generatedAt:new Date().toISOString(),runtime:process.version,budgets,results,passed:failures.length===0,failures};
  if(process.argv.includes('--write')){
    const reportDir=resolve(root,'quality/reports');await mkdir(reportDir,{recursive:true});
    await writeFile(resolve(reportDir,'performance-baseline.json'),`${JSON.stringify(report,null,2)}\n`);
    const rows=Object.entries(results).flatMap(([name,levels])=>Object.entries(levels).map(([level,value])=>`| ${name} | ${level.slice(1)} | ${value.p50} | ${value.p95} | ${value.p99} | ${value.max} |`));
    await writeFile(resolve(reportDir,'performance-baseline.md'),`# Stage 67 performance baseline\n\nDeterministic Worker benchmark with mocked upstream I/O. All values are milliseconds. Production database plans are documented separately.\n\n| Endpoint | Concurrency | p50 | p95 | p99 | max |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows.join('\n')}\n\nResult: **${report.passed?'PASS':'FAIL'}**\n`);
  }
  console.log(JSON.stringify(report,null,2));
  if(failures.length)process.exitCode=1;
}finally{globalThis.fetch=originalFetch}
