const LEXICON=[
 ['고독','MOOD',['고독','외로','lonely','loneliness','isolation','alienation','소외','홀로']],
 ['자아정체성','IDEA',['정체성','자아','identity','self','나는 누구','personhood']],
 ['기억','IDEA',['기억','memory','memories','망각','과거','회상']],
 ['상실','MOOD',['상실','loss','grief','이별','떠나','죽음','death','mourning']],
 ['성장','STORY',['성장','coming of age','youth','청춘','소년','소녀','어른']],
 ['가족','STORY',['가족','family','부모','아버지','어머니','parent','child','형제','자매']],
 ['사랑과 친밀감','MOOD',['사랑','love','romance','연인','친밀','relationship','marriage']],
 ['인간과 비인간','IDEA',['인공지능','android','robot','cyborg','ai ','인간성','non-human','비인간','artificial']],
 ['계급과 불평등','IDEA',['계급','class','poverty','가난','부자','inequality','불평등','노동','capital']],
 ['권력과 통제','IDEA',['권력','power','control','통제','독재','정부','조직','감시','surveillance']],
 ['존재와 죽음','IDEA',['존재','existence','죽음','death','삶의 의미','mortality','영혼']],
 ['연결의 실패','MOOD',['소통','연결','communication','disconnect','오해','관계','고립']],
 ['종말과 재난','STORY',['종말','apocalypse','disaster','재난','멸망','전쟁','war','end of the world']],
 ['미지와 우주','IDEA',['우주','space','alien','외계','미지','cosmic','planet','행성']],
 ['기술과 미래','IDEA',['기술','technology','future','미래','cyber','virtual','network','science fiction','sf']],
 ['꿈과 현실','VISUAL',['꿈','dream','reality','현실','환상','fantasy','surreal','초현실']],
 ['신체와 변형','VISUAL',['신체','body','body horror','변형','mutation','육체','괴물','monster']],
 ['도시적 고독','VISUAL',['도시','city','urban','metropolis','거리','아파트']],
 ['공간과 경계','VISUAL',['공간','space','집','house','room','방','경계','boundary','침입']],
 ['운명과 선택','STORY',['운명','fate','destiny','선택','choice','결정','시간','time']],
 ['정의와 죄책감','IDEA',['정의','justice','죄','guilt','복수','revenge','범죄','crime']],
 ['자연과 인간','IDEA',['자연','nature','환경','environment','생태','ecology','동물']],
 ['멜랑콜리','MOOD',['멜랑콜리','melancholy','슬픔','sad','우울','depression','쓸쓸']],
 ['불안과 공포','MOOD',['불안','anxiety','fear','공포','horror','두려','긴장']],
 ['유머와 아이러니','MOOD',['유머','humor','comedy','코미디','아이러니','satire','풍자']]
];
const FALLBACK={ANIME:['자아정체성','성장','연결의 실패','꿈과 현실','가족','불안과 공포'],FILM:['기억','사랑과 친밀감','공간과 경계','운명과 선택','상실','멜랑콜리'],TV:['가족','권력과 통제','성장','정의와 죄책감','사랑과 친밀감','연결의 실패'],BOOK:['존재와 죽음','기억','고독','성장','사랑과 친밀감','운명과 선택'],OTHER:['자아정체성','기억','연결의 실패','성장','고독','꿈과 현실']};
function stableHash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function tasteVector(tags){const scores=new Map((tags||[]).map(x=>[x.tag,Number(x.score)||0]));return`[${LEXICON.map(([tag])=>(scores.get(tag)||0).toFixed(4)).join(',')}]`}
function vectorValues(tags,category){const scores=new Map((tags||[]).map(x=>[x.tag,Number(x.score)||0]));return LEXICON.map(([tag,group])=>category&&group!==category?0:scores.get(tag)||0)}
function weightedVectorValues(tags,mode){const category=MODE_CATEGORY[mode],scores=new Map((tags||[]).map(x=>[x.tag,Number(x.score)||0]));return LEXICON.map(([tag,group])=>(scores.get(tag)||0)*(category?(group===category?1.8:.35):1))}
const vectorLiteral=values=>`[${values.map(value=>(Number(value)||0).toFixed(4)).join(',')}]`;
function cosineSimilarity(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return aa&&bb?dot/Math.sqrt(aa*bb):0}
function analyzeTaste(work,myComment,rating){const source=[work.title,work.original_title,work.creator,work.description,...(work.tags||[]),myComment].filter(Boolean).join(' ').toLowerCase();const found=[];for(const [tag,category,words] of LEXICON){let hits=0;for(const word of words)if(source.includes(word.toLowerCase()))hits++;if(hits)found.push({tag,category,score:Math.min(.96,.62+hits*.08+(myComment.toLowerCase().includes(tag.toLowerCase())?.06:0)),evidence:words.find(w=>source.includes(w.toLowerCase()))||tag})}const preferred=FALLBACK[work.media_type]||FALLBACK.OTHER;let cursor=stableHash(`${work.id}:${myComment}`)%preferred.length;while(found.length<6){const tag=preferred[cursor%preferred.length],entry=LEXICON.find(x=>x[0]===tag);if(entry&&!found.some(x=>x.tag===tag))found.push({tag,category:entry[1],score:.58+((stableHash(work.id+tag)%23)/100),evidence:(work.tags||[])[0]||work.media_type});cursor++}found.sort((a,b)=>b.score-a.score);const tags=found.slice(0,8).map((x,i)=>({...x,score:Number(Math.max(.5,x.score-i*.015).toFixed(2))}));const [a,b]=tags;const reflection=myComment?`“${myComment.slice(0,72)}${myComment.length>72?'…':''}”라는 감상에서 ${a.tag}과 ${b.tag}의 결을 읽었습니다.`:`${work.title}에서 ${a.tag}과 ${b.tag}의 결이 가장 선명하게 드러납니다.`;return{engine:'metadata-lexicon-v1',generatedAt:new Date().toISOString(),rating,tags,aiComment:reflection,summary:`${a.tag}을 중심으로 ${b.tag}과 맞닿는 작품`,cost:'free'}}
const LOCAL_AI_BLOCKED_HOSTS=new Set(['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','api.mistral.ai','api.cohere.com']);
const LOCAL_AI_CACHE=new Map;
const LOCAL_AI_USAGE_BUCKETS=new Map;
const boundedAiLimit=(value,fallback,max)=>Math.max(1,Math.min(max,Number.parseInt(value,10)||fallback));
function localAiUsagePolicy(env={}){return{daily:boundedAiLimit(env.LOCAL_AI_DAILY_LIMIT,20,200),hourly:boundedAiLimit(env.LOCAL_AI_HOURLY_PER_USER_LIMIT,5,40)}}
function localAiActor(request){return request?.headers?.get('oai-authenticated-user-id')||request?.headers?.get('oai-authenticated-user-email')||request?.headers?.get('cf-connecting-ip')||'anonymous'}
function consumeLocalAiMemoryBucket(key,limit,windowSeconds){const now=Date.now(),windowMs=windowSeconds*1000;let bucket=LOCAL_AI_USAGE_BUCKETS.get(key);if(!bucket||now-bucket.startedAt>=windowMs)bucket={startedAt:now,count:0};bucket.count++;LOCAL_AI_USAGE_BUCKETS.set(key,bucket);if(LOCAL_AI_USAGE_BUCKETS.size>1000)for(const[item,value]of LOCAL_AI_USAGE_BUCKETS)if(now-value.startedAt>=86400000)LOCAL_AI_USAGE_BUCKETS.delete(item);return{allowed:bucket.count<=limit,remaining:Math.max(0,limit-bucket.count),resetAt:new Date(bucket.startedAt+windowMs).toISOString(),policy:'local-fallback'}}
async function consumeLocalAiBucket(env,scope,identity,limit,windowSeconds){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`taste-ai-v1:${scope}:${identity}`)),key=`ai:${scope}:`+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');if(dbReady(env))try{const rows=await supabase(env,'rpc/consume_api_rate_limit',{method:'POST',body:{p_bucket_key:key,p_limit:limit,p_window_seconds:windowSeconds}}),row=Array.isArray(rows)?rows[0]:rows;if(!row||typeof row.allowed!=='boolean')throw new Error('Invalid AI usage-limit response');return{allowed:row.allowed,remaining:Math.max(0,Number(row.remaining)||0),resetAt:row.reset_at||null,policy:'distributed'}}catch(error){console.error('Distributed AI usage limit unavailable; using isolate fallback',{message:error instanceof Error?error.message:String(error)})}return consumeLocalAiMemoryBucket(key,limit,windowSeconds)}
async function consumeLocalAiUsage(env,actor='shared'){const limits=localAiUsagePolicy(env),hourly=await consumeLocalAiBucket(env,'actor-hour',actor,limits.hourly,3600);if(!hourly.allowed)return{allowed:false,reason:'hourly_user_limit',limits,hourly};const daily=await consumeLocalAiBucket(env,'service-day','all',limits.daily,86400);return{allowed:daily.allowed,reason:daily.allowed?'allowed':'daily_service_limit',limits,hourly,daily}}
function localAiConfig(env={}){const enabled=String(env.LOCAL_AI_ENABLED||'').toLowerCase()==='true',zeroCostAcknowledged=String(env.LOCAL_AI_ZERO_COST_ACK||'').toLowerCase()==='true',model=String(env.LOCAL_AI_MODEL||'').trim().slice(0,120),rawEndpoint=String(env.LOCAL_AI_CHAT_ENDPOINT||'').trim();let endpoint=null,reason='disabled';try{const url=new URL(rawEndpoint),local=['localhost','127.0.0.1','::1'].includes(url.hostname);if(!enabled)reason='disabled';else if(!zeroCostAcknowledged)reason='zero_cost_not_confirmed';else if(!model)reason='model_missing';else if(LOCAL_AI_BLOCKED_HOSTS.has(url.hostname.toLowerCase()))reason='metered_provider_blocked';else if(url.protocol!=='https:'&&!(local&&url.protocol==='http:'))reason='secure_endpoint_required';else if(!/\/chat\/completions\/?$/.test(url.pathname))reason='chat_endpoint_required';else{endpoint=url.toString();reason='ready'}}catch{if(enabled)reason='endpoint_invalid'}return{enabled:reason==='ready',configured:enabled,zeroCostAcknowledged,model:model||null,endpoint,reason,noPersonalData:true,fallbackEngine:'metadata-lexicon-v1',qualityGate:'editorial-and-lexicon-v1'}}
function localAiPublicWork(work){return{title:String(work.title||'').slice(0,180),originalTitle:String(work.original_title||'').slice(0,180),creator:String(work.creator||'').slice(0,180),mediaType:String(work.media_type||'OTHER').slice(0,20),year:work.release_year||null,description:String(work.description||'').slice(0,1200),tags:(work.tags||[]).map(String).slice(0,12)}}
function parseLocalAiJson(value){const text=String(value||'').trim().replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();try{return JSON.parse(text)}catch{const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start<0||end<=start)return null;try{return JSON.parse(text.slice(start,end+1))}catch{return null}}}
function validateLocalAiIntro(value,work){const text=String(value||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().replace(/^[“\"]|[”\"]$/g,'');if(text.length<18||text.length>100||!text.endsWith('작품.')||/[.!?。]\s+/.test(text.slice(0,-3)))return null;const banned=/생각하게 하는|질문을 던지는|여운을 남기는|선명하게 드러|존재론|인식론|변증법|기표|기의|해체주의|실존주의|내러티브|메타포|범인은|정체는|결말에서|죽는다는|모든 것을 잃|시신을 수습|근친상간|마침내|결국/;if(banned.test(text)||text.includes(`${work.title}에서`))return null;return text}
function validateLocalAiTags(value){const allowed=new Map(LEXICON.map(([tag,category])=>[tag,category])),items=Array.isArray(value)?value:[],seen=new Set,result=[];for(const item of items){const tag=String(typeof item==='string'?item:item?.tag||'').trim(),category=allowed.get(tag);if(!category||seen.has(tag))continue;seen.add(tag);result.push({tag,category,score:Number(Math.max(.5,Math.min(.92,Number(item?.score)||.72)).toFixed(2)),evidence:'공개 작품 메타데이터'});if(result.length===8)break}return result.length>=3?result:[]}
async function localAiCandidate(work,env,actor='shared'){
  const config=localAiConfig(env);
  if(!config.enabled)return null;
  const publicWork=localAiPublicWork(work),cacheKey=`${config.model}:${stableHash(JSON.stringify(publicWork))}`;
  if(LOCAL_AI_CACHE.has(cacheKey))return LOCAL_AI_CACHE.get(cacheKey);
  const task=(async()=>{
    try{
      const usage=await consumeLocalAiUsage(env,actor);
      if(!usage.allowed)return{intro:null,tags:[],model:config.model,outcome:'usage_limited',usage};
      const requestBody={
        model:config.model,
        temperature:.25,
        max_tokens:480,
        messages:[
          {role:'system',content:'너는 한국어 작품 추천 편집자다. 공개 작품 정보만 사용한다. 다른 설명이나 사고 과정 없이 유효한 JSON 객체 하나만 반환한다. intro는 작품의 도입부와 핵심 설정만 사용하고 결말·반전·인물의 최종 운명을 절대 밝히지 않는다. 구체적인 사물·공간·행동의 비유로 핵심 갈등을 18~100자의 자연스러운 한국어 단문 하나로 압축하며, 별도의 마침표 없이 문장 자체를 반드시 "작품."으로 끝낸다. 현학적 용어, 상투적 감상, 제목 반복을 피한다. tags는 허용 목록에서만 3~8개 선택한다.'},
          {role:'user',content:`/no_think\n${JSON.stringify({work:publicWork,allowedTags:LEXICON.map(([tag])=>tag),output:{intro:'string',tags:[{tag:'string',score:.5}]}})}`}
        ]
      };
      const response=await fetch(config.endpoint,{method:'POST',headers:{'content-type':'application/json',...(env.LOCAL_AI_BEARER_TOKEN?{authorization:`Bearer ${env.LOCAL_AI_BEARER_TOKEN}`}:{})},body:JSON.stringify(requestBody),signal:AbortSignal.timeout(8000)});
      if(!response.ok)return{intro:null,tags:[],model:config.model,outcome:`provider_${response.status}`};
      const data=await response.json(),parsed=parseLocalAiJson(data?.choices?.[0]?.message?.content);
      if(!parsed)return{intro:null,tags:[],model:config.model,outcome:'invalid_json'};
      const intro=validateLocalAiIntro(parsed.intro,work),tags=validateLocalAiTags(parsed.tags);
      if(!intro&&tags.length<3)return{intro:null,tags:[],model:config.model,outcome:'quality_gate_rejected'};
      return{intro,tags,model:config.model,outcome:intro?'accepted':'tags_only'};
    }catch(error){
      const name=String(error?.name||'').toLowerCase(),outcome=name.includes('timeout')?'timeout':'provider_error';
      console.warn('Optional local AI assistant unavailable; deterministic fallback retained',{outcome});
      return{intro:null,tags:[],model:config.model,outcome};
    }
  })();
  LOCAL_AI_CACHE.set(cacheKey,task);
  if(LOCAL_AI_CACHE.size>200)LOCAL_AI_CACHE.delete(LOCAL_AI_CACHE.keys().next().value);
  return task;
}
async function analyzeTasteAssisted(work,myComment,rating,env){const fallback=analyzeTaste(work,myComment,rating),candidate=await localAiCandidate(work,env);if(!candidate?.tags?.length)return fallback;const byTag=new Map(fallback.tags.map(item=>[item.tag,item])),merged=[];for(const item of candidate.tags)merged.push({...item,score:Math.max(item.score,byTag.get(item.tag)?.score||0)});for(const item of fallback.tags)if(!merged.some(candidateTag=>candidateTag.tag===item.tag))merged.push(item);const tags=merged.slice(0,8),[a,b]=tags;return{...fallback,engine:'local-ai-assisted-v1',tags,summary:`${a.tag}을 중심으로 ${b.tag}과 맞닿는 작품`,assistant:{accepted:true,model:candidate.model,personalDataSent:false},cost:'free-local'}}
async function localAiStatus(request,env){if(!await currentUser(request))return json({error:'로그인이 필요합니다.'},401);if(!metadataReviewer(request,env))return json({error:'검수 권한이 없습니다.'},403);const config=localAiConfig(env),usageLimits=localAiUsagePolicy(env);return json({enabled:config.enabled,configured:config.configured,model:config.model,reason:config.reason,guardrails:{zeroCostOnly:true,meteredProvidersBlocked:true,personalDataSent:false,publicMetadataOnly:true,deterministicFallback:true,timeoutMs:8000,qualityGate:config.qualityGate,usageLimits:{dailyService:usageLimits.daily,hourlyPerUser:usageLimits.hourly}},fallbackEngine:config.fallbackEngine})}
async function persistCatalogWorks(env,items){if(!dbReady(env)||!items?.length)return 0;const unique=new Map;for(const candidate of items.slice(0,80)){if(!isPublishedBook(candidate))continue;const work=normalizeWork(candidate);if(!work.id||!work.title||unique.has(work.id))continue;const analysis=analyzeTaste(work,'',5),editorialIntro=work.editorial_intro||editorialLine(work,analysis),catalogStatus=work.source==='Taste Constellation'?'curated':'candidate';unique.set(work.id,{...work,editorial_intro:editorialIntro,catalog_status:catalogStatus,taste_analysis:analysis,taste_vector:tasteVector(analysis.tags)})}const payload=[...unique.values()];if(!payload.length)return 0;try{return Number(await supabase(env,'rpc/upsert_work_catalog',{method:'POST',body:{p_works:payload}}))||payload.length}catch(error){console.error('Work catalog indexing unavailable',error);return 0}}
async function catalogMatches(env,analysis,excluded,mode){if(!dbReady(env)||!validTasteAnalysis(analysis))return[];try{const rows=await supabase(env,'rpc/match_work_catalog',{method:'POST',body:{p_query:vectorLiteral(weightedVectorValues(analysis.tags,mode)),p_excluded:[...excluded].slice(0,1000),p_limit:48}});return(rows||[]).map(row=>({...toClientWork(row),_catalogAnalysis:row.taste_analysis||null,_catalogSimilarity:Number(row.similarity)||0}))}catch(error){console.error('pgvector catalog matching unavailable',error);return[]}}
function stripCatalogMeta(work){const{_catalogSimilarity,_catalogAnalysis,analysis,...client}=work;return client}
const EDITORIAL_PAIRS=[
 [['고독','자아정체성'],'사람에게 다가갈수록 가시가 서로를 찌르는 순간까지 관계를 밀어붙인 작품.'],
 [['계급과 불평등','공간과 경계'],'위로 올라가고 싶은 욕망을 하나의 공간 구조로 압축한 작품.'],
 [['인간과 비인간','사랑과 친밀감'],'몸이 없는 관계 앞에서 사랑이 무엇으로 남는지 묻는 작품.'],
 [['기억','상실'],'잃어버린 것을 붙잡으려는 마음을 기억이 스스로를 배반하는 순간까지 밀어붙인 작품.'],
 [['성장','가족'],'어른이 된다는 일을 가족에게서 멀어지는 법으로 다시 묻는 작품.'],
 [['기술과 미래','자아정체성'],'몸과 이름을 모두 바꿀 수 있는 세상에서 끝내 바뀌지 않는 나를 찾는 작품.'],
 [['종말과 재난','고독'],'한 사람의 고독을 세계가 끝나는 풍경만큼 크게 확대한 작품.'],
 [['권력과 통제','정의와 죄책감'],'정의를 지키려는 선택이 또 다른 폭력이 되는 지점까지 권력의 논리를 추적한 작품.'],
 [['꿈과 현실','기억'],'기억이 만든 현실을 꿈이 침범하는 순간까지 밀어붙인 작품.'],
 [['사랑과 친밀감','상실'],'사랑이 끝난 뒤에도 관계가 사람 안에서 어떻게 계속되는지 바라보는 작품.'],
 [['존재와 죽음','운명과 선택'],'끝을 피할 수 없는 존재에게도 선택은 남는지 묻는 작품.'],
 [['자연과 인간','기술과 미래'],'진보라는 이름이 자연과 인간 사이에 남긴 균열을 끝까지 바라보는 작품.']
];
const EDITORIAL_PHRASES={'고독':'혼자 남는 두려움','자아정체성':'나는 누구인가라는 질문','기억':'사라진 기억','상실':'떠난 뒤에도 남는 마음','성장':'어른이 되어가는 일','가족':'가족이라는 가장 가까운 거리','사랑과 친밀감':'사랑받고 싶은 마음','인간과 비인간':'인간과 비인간의 경계','계급과 불평등':'위로 올라가려는 욕망','권력과 통제':'타인을 통제하려는 힘','존재와 죽음':'살아 있다는 질문','연결의 실패':'서로에게 닿지 못하는 마음','종말과 재난':'세계가 끝나는 풍경','미지와 우주':'인간보다 큰 미지','기술과 미래':'기술이 바꾸는 인간','꿈과 현실':'꿈과 현실의 얇은 경계','신체와 변형':'몸이 낯설어지는 순간','도시적 고독':'사람들 사이에서 깊어지는 고독','공간과 경계':'안과 밖을 가르는 경계','운명과 선택':'피할 수 없는 운명 앞의 선택','정의와 죄책감':'옳은 선택 뒤에 남는 죄책감','자연과 인간':'자연과 인간 사이의 긴장','멜랑콜리':'사라진 것의 온도','불안과 공포':'설명할 수 없는 불안','유머와 아이러니':'웃음 뒤에 숨은 모순'};
const CURATED_EDITORIAL=new Map(Object.entries({
 'ANIME:신세기에반게리온':'고슴도치의 딜레마를 세계의 종말까지 밀어붙인 작품.',
 'BOOK:인간실격':'웃는 얼굴을 가면으로 쓴 사람이 그 가면에 질식해 가는 작품.',
 'BOOK:유년기의끝':'인류의 졸업식이 곧 인류의 장례식이 되는 작품.',
 'BOOK:클라라와태양':'태양을 믿는 기계의 눈으로 인간의 사랑이 얼마나 계산적이고 간절한지 비추는 작품.',
 'BOOK:사랑의기술':'사랑을 번개처럼 기다리는 대신 근육처럼 단련하라고 말하는 작품.',
 'FILM:her':'목소리와 사랑에 빠진 남자를 통해 외로움이 운영체제까지 사람으로 만드는 작품.',
 'FILM:멜랑콜리아':'세상이 끝나는 날에야 마음의 날씨와 우주의 날씨가 같아지는 작품.',
 'FILM:컨택트':'외계의 언어를 배우는 일이 미래의 상실까지 사랑하는 법이 되는 작품.',
 'FILM:arrival':'외계의 언어를 배우는 일이 미래의 상실까지 사랑하는 법이 되는 작품.',
 'FILM:기생충':'반지하와 대저택 사이의 계단에 한 사회의 욕망을 올려놓은 작품.',
 'ANIME:serialexperimentslain':'인터넷에 접속할수록 내가 누구인지 로그아웃되는 작품.',
 'ANIME:공각기동대':'몸을 갈아 끼울 수 있는 시대에 영혼만은 어디에 사는지 추적하는 작품.',
 'ANIME:천사의알':'깨지면 믿음도 사라질 것 같은 알 하나로 폐허 전체를 숨 쉬게 하는 작품.',
 'ANIME:건버스터':'우주를 구한 몇 분이 지구의 수천 년이 되는, 성장의 값을 시간으로 치르는 작품.',
 'BOOK:나를보내지마':'빌려 쓴 인생에서도 사랑만큼은 자기 것이 될 수 있는지 묻는 작품.',
 'BOOK:어둠의왼손':'성별이 계절처럼 바뀌는 별에서 고정된 편견이 더 낯선 생물이 되는 작품.',
 'BOOK:빌러비드':'묻어 둔 과거가 문을 두드리며 돌아와 가족의 밥상에 앉는 작품.',
 'FILM:이터널선샤인':'사랑을 지우는 수술대 위에서 헤어진 마음이 다시 도망치기 시작하는 작품.',
 'FILM:2001스페이스오디세이':'원숭이가 던진 뼈를 우주선까지 날려 인간의 진화를 한 번의 점프로 보여주는 작품.',
 'FILM:2001aspaceodyssey':'원숭이가 던진 뼈를 우주선까지 날려 인간의 진화를 한 번의 점프로 보여주는 작품.',
 'FILM:화양연화':'좁은 복도에서 스친 두 사람이 평생 건너지 못한 문턱을 바라보는 작품.',
 'ANIME:퍼펙트블루':'스타의 얼굴을 여러 거울에 깨뜨려 진짜 내가 어느 조각인지 묻는 작품.',
 'ANIME:perfectblue':'스타의 얼굴을 여러 거울에 깨뜨려 진짜 내가 어느 조각인지 묻는 작품.',
 'ANIME:파프리카':'꿈의 문이 고장 나자 잠든 욕망들이 한낮의 거리로 쏟아지는 작품.'
}));
function curatedEditorial(work){const mediaType=String(work.media_type||work.mediaType||work.type||'').toUpperCase();for(const value of [work.title,work.original_title,work.originalTitle]){const found=CURATED_EDITORIAL.get(`${mediaType}:${searchKey(value)}`);if(found)return found}return null}
function koreanParticle(value,withBatchim,withoutBatchim){const last=[...String(value||'').trim()].at(-1),code=last?.charCodeAt(0)||0;return code>=0xAC00&&code<=0xD7A3?(code-0xAC00)%28?withBatchim:withoutBatchim:withoutBatchim}
function editorialLine(work,analysis){const curated=curatedEditorial(work);if(curated)return curated;const tags=(analysis?.tags||[]).map(item=>item.tag),set=new Set(tags);for(const[pair,line]of EDITORIAL_PAIRS)if(pair.every(tag=>set.has(tag)))return line;const a=EDITORIAL_PHRASES[tags[0]]||'마음속에 숨겨 둔 질문',b=EDITORIAL_PHRASES[tags[1]]||'무너지는 세계',aObject=`${a}${koreanParticle(a,'을','를')}`,aAnd=`${a}${koreanParticle(a,'과','와')}`,bObject=`${b}${koreanParticle(b,'을','를')}`,templates=[`${aObject} ${b}가 모습을 드러내는 순간까지 따라가는 작품.`,`${aAnd} ${bObject} 한 장면 안에서 충돌시키는 작품.`,`${aObject} 손에 쥔 채 ${b} 앞에서 마지막 선택을 기다리는 작품.`];return templates[stableHash(`${work.id}:${work.title}`)%templates.length]}
async function editorialIntro(request,env){let payload;try{payload=await request.json()}catch{return json({error:'JSON 요청 본문이 올바르지 않습니다.'},400)}const work=normalizeWork(payload?.work||payload||{});if(!work.id||!work.title)return json({error:'소개할 작품 정보가 올바르지 않습니다.'},400);const analysis=analyzeTaste(work,'',5),curated=curatedEditorial(work),controlText=curated||editorialLine(work,analysis);if(curated)return json({text:curated,controlText,tags:analysis.tags.slice(0,3).map(item=>item.tag),engine:'curated-editorial-v2',cost:'free'});const candidate=await localAiCandidate(work,env,localAiActor(request));return json({text:candidate?.intro||controlText,controlText,tags:(candidate?.tags?.length?candidate.tags:analysis.tags).slice(0,3).map(item=>item.tag),engine:candidate?.intro?'local-ai-editorial-v1':'metadata-editorial-v2',cost:candidate?.intro?'free-local':'free',guardrails:{personalDataSent:false,qualityChecked:true,fallback:!candidate?.intro,aiOutcome:candidate?.outcome||'not_attempted',usageLimit:candidate?.usage||null}})}
