import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url))),migrationDir=resolve(root,'supabase/migrations');
const hash=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');
const migrations=(await readdir(migrationDir)).filter(name=>name.endsWith('.sql')).sort(),entries=[];
for(const name of migrations){const source=await readFile(resolve(migrationDir,name),'utf8');entries.push({name,sha256:hash(source),bytes:Buffer.byteLength(source)})}
const schema=await readFile(resolve(root,'supabase/schema.sql'),'utf8'),client=await readFile(resolve(root,'src/client/03-archive.js'),'utf8'),runbook=await readFile(resolve(root,'quality/DISASTER_RECOVERY.md'),'utf8');
const requiredTables=['profiles','works','archive_items','taste_tags','connections','recommendation_feedback','metadata_reports','metadata_changes','data_retention_runs'],requiredFunctions=['save_archive_analysis','match_work_catalog','taste_similarity_edges','consume_api_rate_limit','delete_user_private_data','run_data_retention'],failures=[];
for(const table of requiredTables)if(!new RegExp(`create table if not exists public\\.${table}\\b`).test(schema))failures.push(`schema missing table ${table}`);
for(const fn of requiredFunctions)if(!new RegExp(`function public\\.${fn}\\b`).test(schema))failures.push(`schema missing function ${fn}`);
for(const token of ['taste-constellation-archive','validateArchiveBackup','importArchiveJson','exportArchiveJson'])if(!client.includes(token))failures.push(`archive recovery contract missing ${token}`);
for(const token of ['RPO','RTO','Supabase','Sites','복구 검증'])if(!runbook.includes(token))failures.push(`runbook missing ${token}`);
if(new Set(migrations).size!==migrations.length)failures.push('duplicate migration filenames');
const report={version:1,migrationCount:entries.length,migrations:entries,schemaSha256:hash(schema),requiredTables,requiredFunctions,archiveBackupVersion:1,passed:failures.length===0,failures};
const reportPath=resolve(root,'quality/reports/recovery-readiness.json');
if(process.argv.includes('--write')){await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`)}
else{
  const committed=JSON.parse(await readFile(reportPath,'utf8'));
  if(JSON.stringify(committed)!==JSON.stringify(report))failures.push('committed recovery readiness report is stale; run npm run dr:verify:write');
}
console.log(JSON.stringify({...report,passed:failures.length===0,failures},null,2));
if(failures.length)process.exitCode=1;
