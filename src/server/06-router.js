const SECURITY_HEADERS={
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'strict-origin-when-cross-origin',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'strict-transport-security':'max-age=31536000; includeSubDomains'
};

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

async function routeApi(request,env,url){
  const {pathname}=url;
  if(pathname==='/api/search')return request.method==='GET'?search(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/artwork')return request.method==='GET'?artwork(request,env):methodNotAllowed(['GET']);
  if(pathname==='/api/cultural-context')return request.method==='GET'?culturalContext(request):methodNotAllowed(['GET']);
  if(pathname==='/api/book-publishers')return request.method==='GET'?bookPublishers(request,env):methodNotAllowed(['GET']);
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
      const response=url.pathname.startsWith('/api/')
        ?await routeApi(request,env,url)
        :env.ASSETS?await env.ASSETS.fetch(request):new Response('Not found',{status:404});
      return finishResponse(response,id,startedAt);
    }catch(error){
      console.error('Request failed',{requestId:id,error});
      return finishResponse(json({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',requestId:id},500),id,startedAt);
    }
  }
};
