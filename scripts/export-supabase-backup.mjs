import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const help=process.argv.includes('--help');
if(help){
  console.log('SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-supabase-backup.mjs [--output <directory>]');
  process.exit(0);
}

const base=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!base||!key)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
const outputFlag=process.argv.indexOf('--output'),outputDir=resolve(outputFlag>=0?process.argv[outputFlag+1]:'.backups');
const tables=[
  'profiles','works','archive_items','taste_tags','connections','recommendation_feedback',
  'metadata_reports','metadata_changes','duplicate_work_merges','work_identity_exceptions',
  'health_check_runs','health_alert_events','health_alert_actions'
];
const stable=value=>JSON.stringify(value,Object.keys(value||{}).sort());
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

async function exportTable(table){
  const rows=[];
  for(let from=0;;from+=1000){
    const response=await fetch(`${base}/rest/v1/${table}?select=*`,{headers:{apikey:key,authorization:`Bearer ${key}`,range:`${from}-${from+999}`,'accept-profile':'public'}});
    if(!response.ok)throw new Error(`${table} export failed (${response.status})`);
    const page=await response.json();rows.push(...page);
    if(page.length<1000)break;
  }
  rows.sort((left,right)=>stable(left).localeCompare(stable(right)));
  return rows;
}

const data={};
for(const table of tables)data[table]=await exportTable(table);
const tableManifest=Object.fromEntries(tables.map(table=>[table,{rows:data[table].length,sha256:digest(data[table])}]));
const exportedAt=new Date().toISOString(),payload={
  format:'taste-constellation-supabase-logical-backup',version:1,exportedAt,
  sourceHost:new URL(base).host,tables:tableManifest,data
};
const body=JSON.stringify(payload),archive=gzipSync(body,{level:9}),archiveHash=digest(archive),stamp=exportedAt.replace(/[:.]/g,'-');
await mkdir(outputDir,{recursive:true});
const archivePath=resolve(outputDir,`taste-constellation-${stamp}.json.gz`),manifestPath=`${archivePath}.sha256`;
await writeFile(archivePath,archive,{flag:'wx',mode:0o600});
await writeFile(manifestPath,`${archiveHash}  ${archivePath.split(/[\\/]/).at(-1)}\n`,{flag:'wx',mode:0o600});
console.log(JSON.stringify({archivePath,manifestPath,sha256:archiveHash,tables:tableManifest},null,2));
