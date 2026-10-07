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
async function persistCatalogWorks(env,items){if(!dbReady(env)||!items?.length)return 0;const unique=new Map;for(const candidate of items.slice(0,80)){if(!isPublishedBook(candidate))continue;const work=normalizeWork(candidate);if(!work.id||!work.title||unique.has(work.id))continue;const analysis=analyzeTaste(work,'',5);unique.set(work.id,{...work,taste_analysis:analysis,taste_vector:tasteVector(analysis.tags)})}const payload=[...unique.values()];if(!payload.length)return 0;try{return Number(await supabase(env,'rpc/upsert_work_catalog',{method:'POST',body:{p_works:payload}}))||payload.length}catch(error){console.error('Work catalog indexing unavailable',error);return 0}}
async function catalogMatches(env,analysis,excluded,mode){if(!dbReady(env)||!validTasteAnalysis(analysis))return[];try{const rows=await supabase(env,'rpc/match_work_catalog',{method:'POST',body:{p_query:vectorLiteral(weightedVectorValues(analysis.tags,mode)),p_excluded:[...excluded].slice(0,1000),p_limit:48}});return(rows||[]).map(row=>({...toClientWork(row),_catalogAnalysis:row.taste_analysis||null,_catalogSimilarity:Number(row.similarity)||0}))}catch(error){console.error('pgvector catalog matching unavailable',error);return[]}}
function stripCatalogMeta(work){const{_catalogSimilarity,_catalogAnalysis,analysis,...client}=work;return client}
const EDITORIAL_PAIRS=[
 [['고독','자아정체성'],'타인에게 닿고 싶은 마음을 자아의 경계가 무너지는 순간까지 밀어붙인 작품.'],
 [['계급과 불평등','공간과 경계'],'위로 올라가고 싶은 욕망을 하나의 공간 구조로 압축한 작품.'],
 [['인간과 비인간','사랑과 친밀감'],'몸이 없는 관계 앞에서 사랑이 무엇으로 남는지 묻는 작품.'],
 [['기억','상실'],'잃어버린 것을 붙잡으려는 마음을 기억이 스스로를 배반하는 순간까지 밀어붙인 작품.'],
 [['성장','가족'],'어른이 된다는 일을 가족에게서 멀어지는 법으로 다시 묻는 작품.'],
 [['기술과 미래','자아정체성'],'기술이 몸을 넘어선 자리에서 인간을 인간답게 만드는 것이 무엇인지 묻는 작품.'],
 [['종말과 재난','고독'],'한 사람의 고독을 세계가 끝나는 풍경만큼 크게 확대한 작품.'],
 [['권력과 통제','정의와 죄책감'],'정의를 지키려는 선택이 또 다른 폭력이 되는 지점까지 권력의 논리를 추적한 작품.'],
 [['꿈과 현실','기억'],'기억이 만든 현실을 꿈이 침범하는 순간까지 밀어붙인 작품.'],
 [['사랑과 친밀감','상실'],'사랑이 끝난 뒤에도 관계가 사람 안에서 어떻게 계속되는지 바라보는 작품.'],
 [['존재와 죽음','운명과 선택'],'끝을 피할 수 없는 존재에게도 선택은 남는지 묻는 작품.'],
 [['자연과 인간','기술과 미래'],'진보라는 이름이 자연과 인간 사이에 남긴 균열을 끝까지 바라보는 작품.']
];
const EDITORIAL_PHRASES={'고독':'혼자 남는 두려움','자아정체성':'나는 누구인가라는 질문','기억':'사라진 기억','상실':'떠난 뒤에도 남는 마음','성장':'어른이 되어가는 일','가족':'가족이라는 가장 가까운 거리','사랑과 친밀감':'사랑받고 싶은 마음','인간과 비인간':'인간과 비인간의 경계','계급과 불평등':'위로 올라가려는 욕망','권력과 통제':'타인을 통제하려는 힘','존재와 죽음':'살아 있다는 질문','연결의 실패':'서로에게 닿지 못하는 마음','종말과 재난':'세계가 끝나는 풍경','미지와 우주':'인간보다 큰 미지','기술과 미래':'기술이 바꾸는 인간','꿈과 현실':'꿈과 현실의 얇은 경계','신체와 변형':'몸이 낯설어지는 순간','도시적 고독':'사람들 사이에서 깊어지는 고독','공간과 경계':'안과 밖을 가르는 경계','운명과 선택':'피할 수 없는 운명 앞의 선택','정의와 죄책감':'옳은 선택 뒤에 남는 죄책감','자연과 인간':'자연과 인간 사이의 긴장','멜랑콜리':'사라진 것의 온도','불안과 공포':'설명할 수 없는 불안','유머와 아이러니':'웃음 뒤에 숨은 모순'};
function editorialLine(work,analysis){const tags=(analysis?.tags||[]).map(item=>item.tag),set=new Set(tags);for(const[pair,line]of EDITORIAL_PAIRS)if(pair.every(tag=>set.has(tag)))return line;const a=EDITORIAL_PHRASES[tags[0]]||'한 사람의 마음',b=EDITORIAL_PHRASES[tags[1]]||'세계의 균열',templates=[`${a}을 ${b}의 끝까지 밀어붙인 작품.`,`${a}과 ${b} 사이의 균열을 하나의 세계로 키워낸 작품.`,`${a}을 붙잡고, ${b} 앞에서 우리가 무엇을 선택하는지 묻는 작품.`];return templates[stableHash(`${work.id}:${work.title}`)%templates.length]}
async function editorialIntro(request){let payload;try{payload=await request.json()}catch{return json({error:'JSON 요청 본문이 올바르지 않습니다.'},400)}const work=normalizeWork(payload?.work||payload||{});if(!work.id||!work.title)return json({error:'소개할 작품 정보가 올바르지 않습니다.'},400);const analysis=analyzeTaste(work,'',5);return json({text:editorialLine(work,analysis),tags:analysis.tags.slice(0,3).map(item=>item.tag),engine:'metadata-editorial-v1',cost:'free'})}
