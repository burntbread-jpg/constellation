const SECURITY_HEADERS={
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'strict-origin-when-cross-origin',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'strict-transport-security':'max-age=31536000; includeSubDomains'
};
const RATE_BUCKETS=new Map;

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

async function routeApi(request,env,url){
  const {pathname}=url;
  if(pathname==='/api/search')return request.method==='GET'?publicMetadata(await search(request,env),300):methodNotAllowed(['GET']);
  if(pathname==='/api/artwork')return request.method==='GET'?publicMetadata(await artwork(request,env),86400):methodNotAllowed(['GET']);
  if(pathname==='/api/cultural-context')return request.method==='GET'?publicMetadata(await culturalContext(request),86400):methodNotAllowed(['GET']);
  if(pathname==='/api/book-publishers')return request.method==='GET'?publicMetadata(await bookPublishers(request,env),21600):methodNotAllowed(['GET']);
  if(pathname==='/api/editorial-intro')return request.method==='POST'?editorialIntro(request):methodNotAllowed(['POST']);
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
      return finishResponse(response,id,startedAt);
    }catch(error){
      console.error('Request failed',{
        requestId:id,
        message:error instanceof Error?error.message:String(error),
        stack:error instanceof Error?error.stack:undefined
      });
      return finishResponse(json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',requestId:id},500),id,startedAt);
    }
  }
};
