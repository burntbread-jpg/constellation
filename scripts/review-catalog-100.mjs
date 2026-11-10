import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(root, 'quality', 'catalog-review-100.json');
const reportJsonPath = path.join(root, 'quality', 'reports', 'catalog-review-100.json');
const reportMarkdownPath = path.join(root, 'quality', 'reports', 'catalog-review-100.md');
const migrationPaths = [
  path.join(root, 'supabase', 'migrations', '20261110120000_stage5_catalog_review_100_a.sql'),
  path.join(root, 'supabase', 'migrations', '20261110120100_stage5_catalog_review_100_b.sql')
];
const productionOrigin = process.env.CATALOG_REVIEW_ORIGIN || 'https://constellation-swart.vercel.app';
const write = process.argv.includes('--write');
const resume = process.argv.includes('--resume');

const filmIds = new Map(Object.entries({
  'Her':'152601','멜랑콜리아':'62215','컨택트':'329865','기생충':'496243','이터널 선샤인':'38',
  '2001 스페이스 오디세이':'62','화양연화':'843','블레이드 러너':'78','스토커':'1398','솔라리스':'593',
  '동경 이야기':'18148','현기증':'426','멀홀랜드 드라이브':'1018','대부':'238','문라이트':'376867',
  '타오르는 여인의 초상':'531428','드라이브 마이 카':'758866','버닝':'491584','올드보이':'670','살인의 추억':'11423',
  '아가씨':'290098','마더':'30018','어느 가족':'505192','애프터썬':'965150','패스트 라이브즈':'666277',
  '에브리씽 에브리웨어 올 앳 원스':'545611','매트릭스':'603','칠드런 오브 맨':'9693','판의 미로':'1417','트리 오브 라이프':'8967'
}));

const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[äáàâãå]/gu, 'a').replace(/[éèêë]/gu, 'e').replace(/[íìîï]/gu, 'i')
  .replace(/[óòôõö]/gu, 'o').replace(/[úùûü]/gu, 'u')
  .replace(/[^a-z0-9가-힣ぁ-んァ-ン一-龯]/gu, '');
const slug = value => normalize(value).slice(0, 120) || 'untitled';
const mediaLabel = {BOOK:'책', FILM:'영화', ANIME:'애니메이션', MANGA:'만화'};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bookFallbacks = new Map(Object.entries({
  '인간 실격':'https://books.google.com/books/content?id=8DW4EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '유년기의 끝':'https://books.google.com/books/content?id=uQKKDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '클라라와 태양':'https://books.google.com/books/content?id=SFgmEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '사랑의 기술':'https://books.google.com/books/content?id=iS2sDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '나를 보내지 마':'https://books.google.com/books/content?id=CAFDEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '어둠의 왼손':'https://books.google.com/books/content?id=r1_PEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '빌러비드':'https://books.google.com/books/content?id=LKUN0AEACAAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '눈먼 자들의 도시':'https://books.google.com/books/content?id=5iHEAwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '백년의 고독':'https://books.google.com/books/content?id=L8rcswEACAAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api',
  '변신':'https://books.google.com/books/content?id=Bo7VDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  '설국':'https://books.google.com/books/content?id=FG98DwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
}));
const bookOriginalTitles = new Map(Object.entries({
  '남아 있는 나날':'The Remains of the Day','파친코':'Pachinko','멋진 신세계':'Brave New World',
  '프랑켄슈타인':'Frankenstein','시녀 이야기':"The Handmaid's Tale",'로드':'The Road Cormac McCarthy',
  '데미안':'Demian Hermann Hesse','죄와 벌':'Crime and Punishment Dostoevsky',
  '안드로이드는 전기양의 꿈을 꾸는가?':'Do Androids Dream of Electric Sheep',
  '솔라리스':'Solaris Stanislaw Lem','듄':'Dune Frank Herbert'
}));

async function fetchJson(url, init, attempts = 3) {
  let error;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {...init, signal: AbortSignal.timeout(15_000)});
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (caught) {
      error = caught;
      await sleep(350 * (attempt + 1));
    }
  }
  throw error;
}

async function artworkFromProduction(item) {
  const url = new URL('/api/artwork', productionOrigin);
  url.searchParams.set('title', item.title);
  url.searchParams.set('originalTitle', item.query.replace(/\s+(?:anime|film|movie).*$/iu, '').trim());
  url.searchParams.set('creator', item.creator);
  url.searchParams.set('mediaType', item.mediaType);
  const externalId = filmIds.get(item.title);
  if (externalId) url.searchParams.set('externalId', externalId);
  const data = await fetchJson(url);
  if (!data.posterUrl) throw new Error(data.selection || 'poster unavailable');
  return {posterUrl:data.posterUrl, artworkSource:data.source || 'Artwork API', evidenceUrl:data.referenceUrl || url.href, externalId:externalId || null};
}

function googleBookImage(links) {
  const value = links?.extraLarge || links?.large || links?.medium || links?.small || links?.thumbnail || links?.smallThumbnail;
  return value ? String(value).replace(/^http:/, 'https:').replace('&zoom=1', '&zoom=2') : null;
}

async function bookArtwork(item) {
  const fallback = bookFallbacks.get(item.title);
  if (fallback) return {posterUrl:fallback, artworkSource:'Google Books', evidenceUrl:`https://books.google.com/books?q=${encodeURIComponent(item.title)}`, externalId:new URL(fallback).searchParams.get('id')};
  const attempts = [
    `intitle:${item.title} inauthor:${item.creator.split(/[·,]/u)[0]}`,
    `intitle:${item.title}`,
    item.title
  ];
  let candidates = [];
  for (const query of attempts) {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '40');
    url.searchParams.set('printType', 'books');
    try {
      const data = await fetchJson(url);
      candidates.push(...(data.items || []).map(volume => ({id:volume.id, ...(volume.volumeInfo || {})})));
    } catch (error) {
      if (!String(error.message).startsWith('429')) throw error;
      break;
    }
    if (candidates.some(candidate => googleBookImage(candidate.imageLinks))) break;
  }
  const titleKey = normalize(item.title), creatorParts = normalize(item.creator).match(/.{2,4}/gu) || [];
  const ranked = candidates.filter(candidate => googleBookImage(candidate.imageLinks)).map(candidate => {
    const candidateTitle = normalize(candidate.title), authorKey = normalize((candidate.authors || []).join(' '));
    const exact = candidateTitle === titleKey;
    const near = candidateTitle.includes(titleKey) || titleKey.includes(candidateTitle);
    const creator = creatorParts.some(part => authorKey.includes(part));
    const korean = candidate.language === 'ko' || /[가-힣]/u.test(candidate.title || '');
    return {candidate, score:(exact ? 100 : near ? 55 : 0) + (creator ? 30 : 0) + (korean ? 20 : 0) + (candidate.imageLinks?.large || candidate.imageLinks?.extraLarge ? 12 : 4)};
  }).sort((a,b) => b.score - a.score);
  const chosen = ranked[0];
  if (!chosen || chosen.score < 70) return openLibraryBookArtwork(item);
  return {posterUrl:googleBookImage(chosen.candidate.imageLinks), artworkSource:'Google Books', externalId:chosen.candidate.id, evidenceUrl:`https://books.google.com/books?id=${chosen.candidate.id}`};
}

async function openLibraryBookArtwork(item) {
  const title = bookOriginalTitles.get(item.title) || item.title;
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('q', title);
  url.searchParams.set('limit', '20');
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,cover_i');
  const data = await fetchJson(url, {headers:{'user-agent':'TasteConstellation/1.0 (catalog review)'}});
  const wanted = normalize(title.replace(/\s+(?:Cormac McCarthy|Hermann Hesse|Dostoevsky|Stanislaw Lem|Frank Herbert)$/iu, ''));
  const ranked = (data.docs || []).filter(doc => doc.cover_i).map(doc => {
    const key = normalize(doc.title), exact = key === wanted, near = key.includes(wanted) || wanted.includes(key);
    return {doc, score:(exact ? 100 : near ? 60 : 0) + (doc.first_publish_year && Math.abs(doc.first_publish_year - item.year) <= 2 ? 20 : 0)};
  }).sort((a,b) => b.score - a.score);
  const chosen = ranked[0];
  if (!chosen || chosen.score < 60) throw new Error('Open Library에서도 동일 출판 작품 표지를 찾지 못함');
  return {posterUrl:`https://covers.openlibrary.org/b/id/${chosen.doc.cover_i}-L.jpg`, artworkSource:'Open Library', externalId:chosen.doc.key, evidenceUrl:`https://openlibrary.org${chosen.doc.key}`};
}

async function mangaArtwork(item) {
  const query = `query($search:String){Page(page:1,perPage:8){media(search:$search,type:MANGA,sort:SEARCH_MATCH){id title{romaji english native userPreferred} startDate{year} coverImage{extraLarge large}}}}`;
  const data = await fetchJson('https://graphql.anilist.co', {
    method:'POST', headers:{'content-type':'application/json','accept':'application/json'},
    body:JSON.stringify({query, variables:{search:item.query.replace(/\s+manga.*$/iu, '')}})
  });
  const candidates = data.data?.Page?.media || [];
  const queryTitle = item.query.replace(/\s+manga.*$/iu, '').trim();
  const wanted = [normalize(item.title), normalize(queryTitle)];
  const ranked = candidates.map(candidate => {
    const aliases = Object.values(candidate.title || {}).filter(Boolean).map(normalize);
    const exact = aliases.some(alias => wanted.includes(alias));
    const near = aliases.some(alias => wanted.some(value => alias.length >= 4 && value.length >= 4 && (alias.includes(value) || value.includes(alias))));
    const yearDistance = candidate.startDate?.year ? Math.abs(candidate.startDate.year - item.year) : 99;
    return {candidate, score:(exact ? 100 : near ? 65 : 0) + (yearDistance === 0 ? 30 : yearDistance <= 2 ? 12 : 0)};
  }).sort((a,b) => b.score - a.score);
  const chosen = ranked[0];
  if (!chosen || chosen.score < 65 || !chosen.candidate.coverImage?.extraLarge && !chosen.candidate.coverImage?.large) {
    throw new Error('AniList에서 동일 만화 시리즈를 확인하지 못함');
  }
  return {
    posterUrl:chosen.candidate.coverImage.extraLarge || chosen.candidate.coverImage.large,
    artworkSource:'AniList', externalId:String(chosen.candidate.id),
    evidenceUrl:`https://anilist.co/manga/${chosen.candidate.id}`
  };
}

async function posterReachable(url) {
  try {
    let response = await fetch(url, {method:'HEAD', redirect:'follow', signal:AbortSignal.timeout(12_000)});
    if (!response.ok || !String(response.headers.get('content-type') || '').startsWith('image/')) {
      response = await fetch(url, {headers:{range:'bytes=0-1023'}, redirect:'follow', signal:AbortSignal.timeout(12_000)});
    }
    return response.ok && String(response.headers.get('content-type') || '').startsWith('image/');
  } catch {
    return false;
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({length:limit}, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function canonicalKey(item) {
  return `${item.mediaType.toLowerCase()}:${slug(item.title)}:${item.mediaType === 'MANGA' ? 'series' : item.year}`;
}

function description(item) {
  return `${item.year}년 ${item.creator}의 ${mediaLabel[item.mediaType]}로, ${item.intro}`;
}

function audit(items) {
  const fields = ['title','mediaType','year','creator','posterUrl','intro'];
  const counts = Object.fromEntries(fields.map(field => [field, items.filter(item => {
    if (field === 'year') return Number.isInteger(item.year) && item.year >= 1800 && item.year <= new Date().getFullYear() + 2;
    if (field === 'posterUrl') return /^https:\/\//.test(item.posterUrl || '') && item.posterReachable;
    return Boolean(String(item[field] || '').trim());
  }).length]));
  const identity = new Set(items.map(item => `${item.mediaType}:${normalize(item.title)}:${item.mediaType === 'MANGA' ? 'series' : item.year}`));
  const completion = Object.fromEntries(Object.entries(counts).map(([field,count]) => [field, Number((count / items.length * 100).toFixed(1))]));
  return {
    total:items.length, counts, completion,
    minimumCompletion:Math.min(...Object.values(completion)),
    duplicateIdentityCount:items.length - identity.size,
    unreachablePosters:items.filter(item => !item.posterReachable).map(item => item.title),
    unresolved:items.filter(item => item.error).map(item => ({title:item.title,mediaType:item.mediaType,error:item.error}))
  };
}

function sqlLiteralJson(value) {
  const json = JSON.stringify(value).replace(/\$catalog\$/g, '$ catalog $');
  return `$catalog$${json}$catalog$::jsonb`;
}

function migrationSql(items) {
  const payload = items.map(item => ({
    id:`reviewed:${item.mediaType.toLowerCase()}:${slug(item.title)}`, external_id:item.externalId,
    title:item.title, creator:item.creator, release_year:item.year, media_type:item.mediaType,
    poster_url:item.posterUrl, description:item.description, editorial_intro:item.intro,
    source:`Editorial review · ${item.artworkSource}`, canonical_key:item.canonicalKey,
    evidence_url:item.evidenceUrl
  }));
  return `-- Stage 5: fixed 100-work human-reviewed catalog.\n-- Evidence source: quality/catalog-review-100.json and quality/reports/catalog-review-100.json\nwith incoming as (\n  select * from jsonb_to_recordset(${sqlLiteralJson(payload)}) as x(\n    id text, external_id text, title text, creator text, release_year integer, media_type text,\n    poster_url text, description text, editorial_intro text, source text, canonical_key text, evidence_url text\n  )\n), resolved as (\n  select coalesce((\n    select w.id from public.works w\n    where upper(w.media_type)=i.media_type\n      and w.release_year=i.release_year\n      and regexp_replace(lower(w.title),'[^a-z0-9가-힣]+','','g')=regexp_replace(lower(i.title),'[^a-z0-9가-힣]+','','g')\n    order by (w.catalog_status in ('verified','curated')) desc, w.created_at asc limit 1\n  ), i.id) id, i.* from incoming i\n)\ninsert into public.works (\n  id,external_id,title,creator,release_year,media_type,poster_url,description,editorial_intro,source,canonical_key,\n  catalog_status,metadata_verified_at,edition_verified,tags\n)\nselect id,external_id,title,creator,release_year,media_type,poster_url,description,editorial_intro,source,canonical_key,\n       'verified',now(),media_type in ('BOOK','MANGA'),'[]'::jsonb\nfrom resolved\non conflict (id) do update set\n  external_id=coalesce(excluded.external_id,public.works.external_id), title=excluded.title, creator=excluded.creator,\n  release_year=excluded.release_year, media_type=excluded.media_type, poster_url=excluded.poster_url,\n  description=excluded.description, editorial_intro=excluded.editorial_intro, source=excluded.source,\n  canonical_key=excluded.canonical_key, catalog_status='verified', metadata_verified_at=now(),\n  edition_verified=excluded.edition_verified, updated_at=now();\n\n-- Keep duplicates for audit history, but remove them from recommendation eligibility.\nupdate public.works candidate\nset catalog_status='quarantined', updated_at=now()\nwhere candidate.catalog_status='candidate'\n  and exists (\n    select 1 from public.works verified\n    where verified.catalog_status='verified'\n      and verified.id<>candidate.id\n      and verified.canonical_key=candidate.canonical_key\n  );\n`;
}

function reportMarkdown(auditResult, items) {
  const media = Object.fromEntries(['BOOK','FILM','ANIME','MANGA'].map(type => [type, items.filter(item => item.mediaType === type).length]));
  return `# Stage 5 catalog and poster review\n\n- Reviewed: **${auditResult.total} works** (${Object.entries(media).map(([k,v]) => `${k} ${v}`).join(', ')})\n- Minimum required-field completion: **${auditResult.minimumCompletion}%**\n- Duplicate identities in the fixed review set: **${auditResult.duplicateIdentityCount}**\n- Unreachable posters: **${auditResult.unreachablePosters.length}**\n- Unresolved artworks: **${auditResult.unresolved.length}**\n\n## Required fields\n\n| Field | Complete | Rate |\n|---|---:|---:|\n${Object.keys(auditResult.counts).map(field => `| ${field} | ${auditResult.counts[field]}/${auditResult.total} | ${auditResult.completion[field]}% |`).join('\n')}\n\n## Method\n\nThe fixed manifest records title, medium, original release year, creator and a human-written spoiler-safe introduction. Film posters use explicit TMDB work IDs; anime uses the AniList/TMDB/Wikipedia fallback chain; manga uses an exact-title AniList series identity; books use title-and-author matching with Korean-edition cover preference. Every selected image URL is requested and must return an image content type before the gate passes.\n\n## Exceptions\n\n${auditResult.unresolved.length ? auditResult.unresolved.map(item => `- ${item.mediaType} ${item.title}: ${item.error}`).join('\n') : '- None'}\n`;
}

function migrationSqlBatch(items) {
  return migrationSql(items)
    .replace('human-reviewed catalog', 'editorially reviewed catalog')
    .replace('), i.id) id, i.*', '), i.id) resolved_id, i.*')
    .replace('select id,external_id,title,creator', 'select resolved_id,external_id,title,creator');
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
if (manifest.length !== 100) throw new Error(`review manifest must contain exactly 100 works; got ${manifest.length}`);
const identityKeys = new Set(manifest.map(item => `${item.mediaType}:${normalize(item.title)}`));
if (identityKeys.size !== manifest.length) throw new Error('review manifest contains duplicate title/media identities');

let previousByIdentity = new Map();
if (resume) try {
  const previous = JSON.parse(await fs.readFile(reportJsonPath, 'utf8'));
  previousByIdentity = new Map((previous.items || []).filter(item => item.posterReachable && !item.error).map(item => [`${item.mediaType}:${normalize(item.title)}`, item]));
} catch {}
const resolved = await mapLimit(manifest, 4, async (item, index) => {
  const previous = previousByIdentity.get(`${item.mediaType}:${normalize(item.title)}`);
  if (previous) {
    process.stdout.write(`[${index + 1}/100] ${item.mediaType} ${item.title}: cached ok\n`);
    return {...previous, ...item, canonicalKey:canonicalKey(item), description:description(item)};
  }
  try {
    const artwork = item.mediaType === 'MANGA' ? await mangaArtwork(item) : item.mediaType === 'BOOK' ? await bookArtwork(item) : await artworkFromProduction(item);
    const posterOk = await posterReachable(artwork.posterUrl);
    process.stdout.write(`[${index + 1}/100] ${item.mediaType} ${item.title}: ${posterOk ? 'ok' : 'poster unreachable'}\n`);
    return {...item, ...artwork, posterReachable:posterOk, canonicalKey:canonicalKey(item), description:description(item)};
  } catch (error) {
    process.stdout.write(`[${index + 1}/100] ${item.mediaType} ${item.title}: ${error.message}\n`);
    return {...item, posterUrl:null, posterReachable:false, canonicalKey:canonicalKey(item), description:description(item), error:error.message};
  }
});
const auditResult = audit(resolved);
console.log(JSON.stringify(auditResult, null, 2));

if (write) {
  await fs.writeFile(reportJsonPath, `${JSON.stringify({generatedAt:new Date().toISOString(),origin:productionOrigin,audit:auditResult,items:resolved}, null, 2)}\n`);
  await fs.writeFile(reportMarkdownPath, reportMarkdown(auditResult, resolved).replace('human-written spoiler-safe introduction', 'editorially reviewed spoiler-safe introduction'));
  if (!auditResult.unresolved.length && !auditResult.unreachablePosters.length && auditResult.minimumCompletion >= 98 && !auditResult.duplicateIdentityCount) {
    const halves = [resolved.slice(0, 50), resolved.slice(50)];
    for (let index = 0; index < migrationPaths.length; index++) {
      await fs.writeFile(migrationPaths[index], migrationSqlBatch(halves[index]));
      console.log(`wrote ${path.relative(root, migrationPaths[index])}`);
    }
  } else {
    console.log('migration not written: review gate has unresolved failures');
    process.exitCode = 1;
  }
}
