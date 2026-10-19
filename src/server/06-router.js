const SECURITY_HEADERS={
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'strict-origin-when-cross-origin',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'strict-transport-security':'max-age=31536000; includeSubDomains'
};
const RATE_BUCKETS=new Map;
const API_HEALTH_METRICS={windowMs:300000,events:[]};

function recordApiHealth(status,durationMs){
  const now=Date.now();
  API_HEALTH_METRICS.events.push({at:now,error:status>=500,slow:durationMs>=2000});
  API_HEALTH_METRICS.events=API_HEALTH_METRICS.events.filter(event=>now-event.at<=API_HEALTH_METRICS.windowMs).slice(-500);
}

function apiHealthSnapshot(){
  const now=Date.now(),events=API_HEALTH_METRICS.events.filter(event=>now-event.at<=API_HEALTH_METRICS.windowMs),total=events.length,errors=events.filter(event=>event.error).length,slow=events.filter(event=>event.slow).length;
  return{windowMinutes:5,total,errors,slow,errorRate:total?Number((errors/total).toFixed(3)):0};
}

async function healthHistory(env,snapshot){
  try{
    const checkedAt=new Date().toISOString(),retentionCutoff=new Date(Date.now()-30*86400000).toISOString();
    const inserted=await supabase(env,'health_check_runs',{method:'POST',prefer:'return=representation',body:{status:snapshot.status,database_ready:snapshot.checks.database,pgvector_ready:snapshot.checks.pgvector,provider_failures:Object.values(snapshot.providers).filter(value=>value==='error').length,providers:snapshot.providers,traffic:snapshot.traffic,latency_ms:snapshot.latencyMs,checked_at:checkedAt}}),runId=inserted?.[0]?.id||null;
    await supabase(env,`health_check_runs?checked_at=lt.${encodeURIComponent(retentionCutoff)}`,{method:'DELETE',prefer:'return=minimal'});
    const since=new Date(Date.now()-86400000).toISOString(),rows=await supabase(env,`health_check_runs?checked_at=gte.${encodeURIComponent(since)}&select=id,status,database_ready,pgvector_ready,provider_failures,latency_ms,checked_at&order=checked_at.desc&limit=1440`),items=(rows||[]).slice(0,12),issues=(rows||[]).filter(row=>row.status!=='ready').length;
    let consecutiveIssues=0;for(const row of rows||[]){if(row.status==='ready')break;consecutiveIssues++}
    const previousStatus=(rows||[]).find(row=>String(row.id)!==String(runId))?.status||null;
    return{available:true,windowHours:24,total:(rows||[]).length,issues,consecutiveIssues,lastRecoveredAt:(rows||[]).find(row=>row.status==='ready')?.checked_at||null,items,currentRunId:runId,previousStatus};
  }catch(error){
    console.error('Health history unavailable',{message:error instanceof Error?error.message:String(error)});
    return{available:false,windowHours:24,total:0,issues:0,consecutiveIssues:0,lastRecoveredAt:null,items:[],currentRunId:null,previousStatus:null};
  }
}

function healthAlert(snapshot,history){
  if(!history.available||!history.currentRunId)return null;
  if(snapshot.status==='degraded'&&history.previousStatus!=='degraded')return{kind:'service_degraded',message:'취향 성좌 핵심 서비스 점검에서 장애가 감지됐습니다.'};
  if(snapshot.status==='warning'&&history.consecutiveIssues===3)return{kind:'sustained_warning',message:'취향 성좌 외부 제공처 또는 API 상태가 3회 연속 주의 단계입니다.'};
  if(snapshot.status==='ready'&&history.previousStatus&&history.previousStatus!=='ready')return{kind:'recovered',message:'취향 성좌 서비스가 정상 상태로 복구됐습니다.'};
  return null;
}

async function queueHealthAlert(env,snapshot,history){
  const alert=healthAlert(snapshot,history);
  if(!alert)return null;
  try{
    const rows=await supabase(env,'health_alert_events?on_conflict=health_check_run_id',{method:'POST',prefer:'resolution=ignore-duplicates,return=representation',body:{health_check_run_id:history.currentRunId,kind:alert.kind,status:snapshot.status,message:alert.message,details:{checks:snapshot.checks,providers:snapshot.providers,traffic:snapshot.traffic,latencyMs:snapshot.latencyMs}}});
    return rows?.[0]||null;
  }catch(error){
    console.error('Health alert queue unavailable',{message:error instanceof Error?error.message:String(error)});
    return null;
  }
}

async function deliverHealthAlerts(env){
  if(!env.HEALTH_ALERT_WEBHOOK_URL)return{configured:false,delivered:0,pending:0};
  let alerts=[];
  try{alerts=await supabase(env,'health_alert_events?delivered_at=is.null&select=id,kind,status,message,details,created_at,delivery_attempts&order=created_at.asc&limit=5')||[]}catch(error){console.error('Pending health alerts unavailable',{message:error instanceof Error?error.message:String(error)});return{configured:true,delivered:0,pending:0,error:true}}
  let delivered=0;
  for(const alert of alerts){
    const text=`[취향 성좌] ${alert.message}`;
    try{
      const response=await timedFetch(env.HEALTH_ALERT_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,content:text,event:'taste_constellation_health',kind:alert.kind,status:alert.status,occurredAt:alert.created_at,details:alert.details})},8000);
      if(!response.ok)throw new Error(`Webhook ${response.status}`);
      await supabase(env,`health_alert_events?id=eq.${encodeURIComponent(alert.id)}`,{method:'PATCH',prefer:'return=minimal',body:{delivered_at:new Date().toISOString(),delivery_attempts:Number(alert.delivery_attempts||0)+1,last_delivery_error:null}});delivered++;
    }catch(error){
      const message=String(error instanceof Error?error.message:error).slice(0,300);
      try{await supabase(env,`health_alert_events?id=eq.${encodeURIComponent(alert.id)}`,{method:'PATCH',prefer:'return=minimal',body:{delivery_attempts:Number(alert.delivery_attempts||0)+1,last_delivery_error:message}})}catch{}
      console.error('Health alert delivery failed',{alertId:alert.id,message});
    }
  }
  return{configured:true,delivered,pending:Math.max(0,alerts.length-delivered)};
}

function secureTokenMatch(left,right){
  const a=String(left||''),b=String(right||'');if(!a||!b||a.length!==b.length)return false;let mismatch=0;for(let index=0;index<a.length;index++)mismatch|=a.charCodeAt(index)^b.charCodeAt(index);return mismatch===0;
}

function monitorAuthorized(request,env){
  const header=request.headers.get('authorization')||'',bearer=header.startsWith('Bearer ')?header.slice(7):'',token=request.headers.get('x-health-monitor-token')||bearer;
  return secureTokenMatch(token,env.HEALTH_MONITOR_TOKEN);
}

function requestId(request){
  const supplied=request.headers.get('x-request-id');
  if(supplied&&/^[a-zA-Z0-9._:-]{8,80}$/.test(supplied))return supplied;
  return crypto.randomUUID();
}

function finishResponse(response,id,startedAt){
  const headers=new Headers(response.headers);
  for(const[key,value]of Object.entries(SECURITY_HEADERS))headers.set(key,value);
  headers.set('x-request-id',id);
  headers.set('server-timing',`app;dur=${Math.max(0,performance.now()-startedAt).toFixed(1)}`);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

function methodNotAllowed(allowed){
  const response=json({error:'지원하지 않는 요청 방식입니다.',allowed},405);
  response.headers.set('allow',allowed.join(', '));
  return response;
}

function validateMutation(request,url){
  if(!['POST','PATCH','DELETE'].includes(request.method))return null;
  const origin=request.headers.get('origin');
  if(origin&&origin!==url.origin)return json({error:'허용되지 않은 출처의 요청입니다.'},403);
  const length=Number(request.headers.get('content-length')||0);
  if(Number.isFinite(length)&&length>262144)return json({error:'요청 데이터가 너무 큽니다.'},413);
  return null;
}

function rateLimit(request){
  const mutating=['POST','PATCH','DELETE'].includes(request.method),limit=mutating?30:180,windowMs=60000;
  const identity=request.headers.get('oai-authenticated-user-id')||request.headers.get('oai-authenticated-user-email')||request.headers.get('cf-connecting-ip')||'anonymous';
  const key=`${mutating?'write':'read'}:${identity}`,now=Date.now();
  let bucket=RATE_BUCKETS.get(key);
  if(!bucket||now-bucket.startedAt>=windowMs)bucket={startedAt:now,count:0};
  bucket.count++;RATE_BUCKETS.set(key,bucket);
  if(RATE_BUCKETS.size>2000)for(const[item,value]of RATE_BUCKETS)if(now-value.startedAt>=windowMs)RATE_BUCKETS.delete(item);
  if(bucket.count<=limit)return null;
  const retryAfter=Math.max(1,Math.ceil((windowMs-(now-bucket.startedAt))/1000)),response=json({error:'요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',retryAfter},429);
  response.headers.set('retry-after',String(retryAfter));
  return response;
}

async function publicMetadata(response,maxAge){
  if(!response.ok)return response;
  const headers=new Headers(response.headers);
  headers.set('cache-control',`public, max-age=${maxAge}, stale-while-revalidate=${Math.max(60,maxAge*2)}`);
  headers.set('vary','Accept-Encoding');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

async function operationalHealth(env,{emitAlerts=false}={}){
  if(!dbReady(env))return json({ok:false,status:'unconfigured',checks:{database:false,pgvector:false}},503);
  const startedAt=performance.now(),zeroVector=`[${Array(LEXICON.length).fill('0').join(',')}]`,providerJobs={
    openLibrary:openLibrary('The Little Prince'),
    aniList:aniList('Cowboy Bebop'),
    ...(env.TMDB_READ_TOKEN?{tmdb:tmdb('Inception',env)}:{}),
    ...(env.GOOGLE_BOOKS_API_KEY?{googleBooks:googleBooks('1984',env)}:{})
  };
  const [catalogResult,vectorResult,...providerResults]=await Promise.allSettled([
    supabase(env,'works?select=id&limit=1'),
    supabase(env,'rpc/match_work_catalog',{method:'POST',body:{p_query:zeroVector,p_excluded:[],p_limit:1}}),
    ...Object.values(providerJobs)
  ]),providerNames=Object.keys(providerJobs),providers={openLibrary:'error',aniList:'error',tmdb:env.TMDB_READ_TOKEN?'error':'not_configured',googleBooks:env.GOOGLE_BOOKS_API_KEY?'error':'not_configured'};
  providerResults.forEach((result,index)=>providers[providerNames[index]]=result.status==='fulfilled'?'ok':'error');
  const database=catalogResult.status==='fulfilled'&&Array.isArray(catalogResult.value),pgvector=vectorResult.status==='fulfilled'&&Array.isArray(vectorResult.value),traffic=apiHealthSnapshot(),providerFailures=Object.values(providers).filter(value=>value==='error').length,trafficWarning=traffic.total>=5&&traffic.errorRate>=.1,coreReady=database&&pgvector,status=!coreReady?'degraded':providerFailures||trafficWarning?'warning':'ready';
  if(!coreReady)console.error('Deep health check failed',{database,pgvector});
  const snapshot={
    ok:coreReady,
    status,
    checks:{database,pgvector,catalogReadable:database,vectorRpcReadable:pgvector},
    providers,
    traffic,
    latencyMs:Math.round(performance.now()-startedAt),
    dimensions:LEXICON.length,
    checkedAt:new Date().toISOString()
  },history=await healthHistory(env,snapshot);
  if(emitAlerts)await queueHealthAlert(env,snapshot,history);
  const notifications=emitAlerts?await deliverHealthAlerts(env):undefined;
  const publicHistory={...history,items:(history.items||[]).map(({id,...item})=>item)};delete publicHistory.currentRunId;delete publicHistory.previousStatus;
  return json({...snapshot,history:publicHistory,...(notifications?{notifications}:{})},coreReady?200:503);
}

async function deepHealth(request,env){
  if(!await currentUser(request))return json({error:'로그인이 필요합니다.'},401);
  if(!metadataReviewer(request,env))return json({error:'검수 권한이 없습니다.'},403);
  return operationalHealth(env);
}

async function scheduledHealth(request,env){
  if(!monitorAuthorized(request,env))return json({error:'모니터 인증에 실패했습니다.'},401);
  return operationalHealth(env,{emitAlerts:true});
}

async function routeApi(request,env,url){
  const {pathname}=url;
  if(pathname==='/api/search')return request.method==='GET'?publicMetadata(await search(request,env),300):methodNotAllowed(['GET']);
  if(pathname==='/api/artwork')return request.method==='GET'?publicMetadata(await artwork(request,env),86400):methodNotAllowed(['GET']);
  if(pathname==='/api/cultural-context')return request.method==='GET'?publicMetadata(await culturalContext(request),86400):methodNotAllowed(['GET']);
  if(pathname==='/api/book-publishers')return request.method==='GET'?publicMetadata(await bookPublishers(request,env),21600):methodNotAllowed(['GET']);
  if(pathname==='/api/editorial-intro')return request.method==='POST'?editorialIntro(request):methodNotAllowed(['POST']);
  if(pathname==='/api/metadata-reports')return request.method==='POST'?metadataReport(request,env):request.method==='GET'?metadataReportQueue(request,env):methodNotAllowed(['GET','POST']);
  if(pathname==='/api/my-metadata-reports')return request.method==='GET'?myMetadataReports(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/metadata-quality')return request.method==='GET'?metadataQualityDashboard(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/duplicate-candidates')return request.method==='GET'?duplicateWorkCandidates(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/duplicate-preview')return request.method==='GET'?duplicateMergePreviewGuarded(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/duplicate-merge')return request.method==='POST'?mergeDuplicateWorksGuarded(request,env):methodNotAllowed(['POST']);
  if(pathname==='/api/identity-exceptions')return ['GET','POST'].includes(request.method)?identityExceptions(request,env):methodNotAllowed(['GET','POST']);
  if(pathname.startsWith('/api/identity-exceptions/')){const id=pathname.slice('/api/identity-exceptions/'.length);return request.method==='DELETE'?removeIdentityException(request,env,id):methodNotAllowed(['DELETE'])}
  if(pathname==='/api/duplicate-merges')return request.method==='GET'?duplicateMergeHistory(request,env):methodNotAllowed(['GET']);
  if(pathname.startsWith('/api/duplicate-merges/')){const id=pathname.slice('/api/duplicate-merges/'.length);return request.method==='PATCH'?restoreDuplicateMerge(request,env,id):methodNotAllowed(['PATCH'])}
  if(pathname==='/api/metadata-provenance')return request.method==='GET'?publicMetadata(await publicMetadataProvenance(request,env),300):methodNotAllowed(['GET']);
  if(pathname.startsWith('/api/metadata-reports/')){const id=pathname.slice('/api/metadata-reports/'.length);return request.method==='PATCH'?reviewMetadataReport(request,env,id):methodNotAllowed(['PATCH'])}
  if(pathname==='/api/metadata-changes')return request.method==='GET'?metadataChangeHistory(request,env):methodNotAllowed(['GET']);
  if(pathname.startsWith('/api/metadata-changes/')){const id=pathname.slice('/api/metadata-changes/'.length);return request.method==='PATCH'?rollbackMetadataChange(request,env,id):methodNotAllowed(['PATCH'])}
  if(pathname==='/api/recommendations')return request.method==='POST'?recommendationsV5(request,env):methodNotAllowed(['POST']);
  if(pathname==='/api/recommendation-feedback')return request.method==='POST'?recommendationFeedbackV2(request,env):methodNotAllowed(['POST']);
  if(pathname==='/api/connections')return request.method==='GET'?connections(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/constellation')return request.method==='GET'?constellationMap(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/archive')return ['GET','POST'].includes(request.method)?archive(request,env):methodNotAllowed(['GET','POST']);
  if(pathname==='/api/account-data')return request.method==='DELETE'?removeAccountData(request,env):methodNotAllowed(['DELETE']);
  if(pathname==='/api/taste-profile')return request.method==='GET'?tasteProfileV2(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/taste-similarities')return request.method==='GET'?tasteSimilarities(request,env):methodNotAllowed(['GET']);
  if(pathname.startsWith('/api/archive/')){
    let id;
    try{id=decodeURIComponent(pathname.slice(13))}catch{return json({error:'작품 ID가 올바르지 않습니다.'},400)}
    if(request.method==='PATCH')return updateArchive(request,env,id);
    if(request.method==='DELETE')return removeArchive(request,env,id);
    return methodNotAllowed(['PATCH','DELETE']);
  }
  if(pathname==='/api/health/deep')return request.method==='GET'?deepHealth(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/health/scheduled')return request.method==='POST'?scheduledHealth(request,env):methodNotAllowed(['POST']);
  if(pathname==='/api/health'){
    if(request.method!=='GET')return methodNotAllowed(['GET']);
    return json({
      ok:true,
      runtime:'production-hardening-v1',
      sources:{
        tmdb:!!env.TMDB_READ_TOKEN,googleBooks:!!env.GOOGLE_BOOKS_API_KEY,openLibrary:true,aniList:true,wikidata:true,
        supabase:dbReady(env),culturalContext:'wikidata-authority-catalog-v2',publisherEngine:'korean-editions-v1',
        editorialEngine:'metadata-editorial-v1',artworkEngine:'official-artwork-ranking-v1',
        awardCatalog:{literature:10,film:12,animation:7},tasteEngine:'taste-profile-feedback-v2',
        similarityEngine:'pgvector-cosine-v1',recommendationEngine:'pgvector-catalog-feedback-v1',
        archiveEngine:'archive-management-v1',catalogDimensions:LEXICON.length
      }
    });
  }
  return json({error:'API 경로를 찾을 수 없습니다.'},404);
}

export default{
  async fetch(request,env){
    const startedAt=performance.now(),id=requestId(request);
    try{
      const url=new URL(request.url);
      const rejected=url.pathname.startsWith('/api/')?(rateLimit(request)||validateMutation(request,url)):null;
      const response=url.pathname.startsWith('/api/')
        ?rejected||await routeApi(request,env,url)
        :env.ASSETS?await env.ASSETS.fetch(request):new Response('Not found',{status:404});
      const duration=performance.now()-startedAt;
      if(url.pathname.startsWith('/api/'))recordApiHealth(response.status,duration);
      return finishResponse(response,id,startedAt);
    }catch(error){
      console.error('Request failed',{
        requestId:id,
        message:error instanceof Error?error.message:String(error),
        stack:error instanceof Error?error.stack:undefined
      });
      const response=json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',requestId:id},500);
      recordApiHealth(response.status,performance.now()-startedAt);
      return finishResponse(response,id,startedAt);
    }
  }
};
