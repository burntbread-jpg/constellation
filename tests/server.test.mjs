import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
const {default: worker} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const originalFetch = globalThis.fetch;
const userId = '11111111-1111-4111-8111-111111111111';
const headers = {
  'oai-authenticated-user-id': userId,
  'oai-authenticated-user-email': 'reader@example.com'
};
const env = {
  SUPABASE_URL: 'https://mock.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-only-key'
};

const state = {
  works: new Map(),
  archive: new Map(),
  tags: [],
  connections: [],
  feedback: new Map(),
  metadataReports: [],
  catalogQueries: [],
  profileWrites: 0,
  backfillCalls: 0,
  failProfiles: false,
  failProviders: false
};

function response(data, status = 200) {
  return new Response(data == null ? null : JSON.stringify(data), {
    status,
    headers: {'content-type': 'application/json'}
  });
}

function vector(value) {
  return String(value || '[]').slice(1, -1).split(',').filter(Boolean).map(Number);
}

function cosine(a, b) {
  const dot = a.reduce((sum, value, index) => sum + value * (b[index] || 0), 0);
  const magnitude = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  const denominator = magnitude(a) * magnitude(b);
  return denominator ? dot / denominator : 0;
}

function catalogVector(entries = {}) {
  const axes = ['고독','자아정체성','기억','상실','성장','가족','사랑과 친밀감','인간과 비인간','계급과 불평등','권력과 통제','존재와 죽음','연결의 실패','종말과 재난','미지와 우주','기술과 미래','꿈과 현실','신체와 변형','도시적 고독','공간과 경계','운명과 선택','정의와 죄책감','자연과 인간','멜랑콜리','불안과 공포','유머와 아이러니'];
  return `[${axes.map(axis => Number(entries[axis] || 0).toFixed(4)).join(',')}]`;
}

function mockSupabase(url, init = {}) {
  const parsed = new URL(url);
  const table = parsed.pathname.split('/').at(-1);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;

  if (method === 'POST' && table === 'profiles') {
    if (state.failProfiles) return response({message: 'profile storage unavailable'}, 500);
    state.profileWrites++;
    assert.match(body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    return response(null, 204);
  }
  if (method === 'POST' && table === 'backfill_taste_graph') {
    state.backfillCalls++;
    const items = [...state.archive.values()].filter(item => item.user_id === body.p_user_id);
    let vectors = 0;
    for (const item of items) if (!item.taste_vector && item.analysis_json?.tags) {
      const scores = new Map(item.analysis_json.tags.map(tag => [tag.tag, tag.score]));
      item.taste_vector = `[${Array.from({length: 25}, (_, index) => Number(scores.get(['기억', '상실'][index]) || (index < 2 ? .8 : 0)).toFixed(4)).join(',')}]`;
      vectors++;
    }
    let connections = 0;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const exists = state.connections.some(row => row.user_id === body.p_user_id && row.from_work_id === items[i].work_id && row.to_work_id === items[j].work_id && row.connection_type === 'archive');
      if (!exists && items[i].taste_vector && items[j].taste_vector) {
        state.connections.push({user_id: body.p_user_id, from_work_id: items[i].work_id, to_work_id: items[j].work_id, connection_type: 'archive', reason: '복원된 연결', score: cosine(vector(items[i].taste_vector), vector(items[j].taste_vector)), shared_tags: [], work_json: items[j].work_json});
        connections++;
      }
    }
    return response({vectors, connections, version: 1});
  }
  if (method === 'POST' && table === 'upsert_work_catalog') {
    const ids = (body.p_works || []).map(work => work.id);
    if (new Set(ids).size !== ids.length) return response({code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time'}, 400);
    for (const work of body.p_works || []) {
      const previous = state.works.get(work.id) || {};
      state.works.set(work.id, {
        ...work,
        ...previous,
        taste_analysis: work.taste_analysis,
        taste_vector: work.taste_vector
      });
    }
    return response((body.p_works || []).length);
  }
  if (method === 'POST' && table === 'match_work_catalog') {
    state.catalogQueries.push(body.p_query);
    const query = vector(body.p_query);
    const excluded = new Set(body.p_excluded || []);
    const matches = [...state.works.values()]
      .filter(work => work.taste_vector && !excluded.has(work.id))
      .map(work => ({...work, similarity: cosine(query, vector(work.taste_vector))}))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, body.p_limit || 48);
    return response(matches);
  }
  if (method === 'POST' && table === 'save_archive_analysis') {
    const {p_work: work, p_item: item, p_tags: tags} = body;
    if (!state.works.has(work.id)) state.works.set(work.id, work);
    state.archive.set(`${item.user_id}:${item.work_id}`, item);
    state.tags = state.tags.filter(tag => !(tag.user_id === item.user_id && tag.work_id === item.work_id));
    state.tags.push(...tags);
    return response(null, 204);
  }
  if (method === 'POST' && table === 'taste_similarity_edges') {
    const items = [...state.archive.values()].filter(item => item.user_id === body.p_user_id && item.taste_vector);
    const edges = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      edges.push({
        source_work_id: items[i].work_id,
        target_work_id: items[j].work_id,
        similarity: cosine(vector(items[i].taste_vector), vector(items[j].taste_vector))
      });
    }
    return response(edges.sort((a, b) => b.similarity - a.similarity).slice(0, body.p_limit || 24));
  }
  if (method === 'POST' && table === 'save_connections') {
    for (const item of body.p_connections) {
      state.connections = state.connections.filter(row => !(row.user_id === body.p_user_id && row.from_work_id === item.from_work_id && row.to_work_id === item.to_work_id && row.connection_type === item.connection_type));
      state.connections.push({...item, user_id: body.p_user_id});
    }
    return response(null, 204);
  }
  if (method === 'POST' && table === 'recommendation_feedback') {
    state.feedback.set(`${body.user_id}:${body.from_work_id}:${body.to_work_id}:${body.connection_mode}`, body);
    return response(null, 204);
  }
  if (method === 'POST' && table === 'metadata_reports') {
    const row = {...body, id: state.metadataReports.length + 1};
    state.metadataReports.push(row);
    return response([row], 201);
  }
  if (method === 'POST' && table === 'works') {
    state.works.set(body.id, body);
    return response(null, 204);
  }
  if (method === 'POST' && table === 'archive_items') {
    state.archive.set(`${body.user_id}:${body.work_id}`, body);
    return response(null, 204);
  }
  if (method === 'PATCH' && table === 'archive_items') {
    const value = key => parsed.searchParams.get(key)?.replace(/^eq\./, '');
    const key = `${value('user_id')}:${value('work_id')}`;
    const item = state.archive.get(key);
    if (item) state.archive.set(key, {...item, ...body});
    return response(null, 204);
  }
  if (method === 'POST' && table === 'taste_tags') {
    state.tags.push(...body);
    return response(null, 204);
  }
  if (method === 'DELETE' && table === 'taste_tags') {
    const workId = parsed.searchParams.get('work_id')?.replace(/^eq\./, '');
    state.tags = state.tags.filter(tag => tag.work_id !== workId);
    return response(null, 204);
  }
  if (method === 'DELETE' && table === 'archive_items') {
    const workId = parsed.searchParams.get('work_id')?.replace(/^eq\./, '');
    const filteredUserId = parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
    state.archive.delete(`${filteredUserId}:${workId}`);
    state.tags = state.tags.filter(tag => !(tag.user_id === filteredUserId && tag.work_id === workId));
    return response(null, 204);
  }
  if (method === 'DELETE' && table === 'profiles') {
    const deletedUserId = parsed.searchParams.get('id')?.replace(/^eq\./, '');
    for (const [key, item] of state.archive) if (item.user_id === deletedUserId) state.archive.delete(key);
    state.tags = state.tags.filter(tag => tag.user_id !== deletedUserId);
    state.connections = state.connections.filter(row => row.user_id !== deletedUserId);
    for (const [key, item] of state.feedback) if (item.user_id === deletedUserId) state.feedback.delete(key);
    return response(null, 204);
  }
  if (method === 'DELETE' && table === 'connections') {
    const value = key => parsed.searchParams.get(key)?.replace(/^eq\./, '');
    const user = value('user_id');
    const from = value('from_work_id');
    const to = value('to_work_id');
    const type = value('connection_type');
    state.connections = state.connections.filter(row => !(row.user_id === user && (!from || row.from_work_id === from) && (!to || row.to_work_id === to) && (!type || row.connection_type === type)));
    return response(null, 204);
  }
  if (method === 'GET' && table === 'archive_items') {
    const filteredUserId = parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
    const filteredWorkId = parsed.searchParams.get('work_id')?.replace(/^eq\./, '');
    return response([...state.archive.values()].filter(item => item.user_id === filteredUserId && (!filteredWorkId || item.work_id === filteredWorkId)).map(item => ({
      ...item,
      created_at: '2026-09-30T00:00:00.000Z',
      works: state.works.get(item.work_id)
    })));
  }
  if (method === 'GET' && table === 'taste_tags') {
    const filteredUserId = parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
    return response(state.tags.filter(tag => tag.user_id === filteredUserId));
  }
  if (method === 'GET' && table === 'connections') {
    const filteredUserId = parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
    const fromWorkId = parsed.searchParams.get('from_work_id')?.replace(/^eq\./, '');
    const connectionType = parsed.searchParams.get('connection_type')?.replace(/^eq\./, '');
    return response(state.connections.filter(row => row.user_id === filteredUserId && (!fromWorkId || row.from_work_id === fromWorkId) && (!connectionType || row.connection_type === connectionType)));
  }
  if (method === 'GET' && table === 'recommendation_feedback') {
    const value = key => parsed.searchParams.get(key)?.replace(/^eq\./, '');
    const fromWorkId = value('from_work_id');
    const connectionMode = value('connection_mode');
    return response([...state.feedback.values()].filter(row => row.user_id === value('user_id') && (!fromWorkId || row.from_work_id === fromWorkId) && (!connectionMode || row.connection_mode === connectionMode)));
  }
  if (method === 'GET' && table === 'works') {
    const id = parsed.searchParams.get('id')?.replace(/^eq\./, '');
    return response([...state.works.values()].filter(work => !id || work.id === id).map(work => ({id: work.id, title: work.title})));
  }
  return response({message: `Unhandled mock request: ${method} ${table}`}, 500);
}

test.before(() => {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(env.SUPABASE_URL)) return mockSupabase(url, init);
    if (state.failProviders) throw new Error(`Provider unavailable: ${url}`);
    if (url.startsWith('https://api.themoviedb.org/3/search/movie')) {
      const query = new URL(url).searchParams.get('query');
      if (query === '멜랑콜리아') return response({results: []});
      return response({results: [{id: 496243, poster_path: '/default.jpg'}]});
    }
    if (url.startsWith('https://api.themoviedb.org/3/search/multi')) {
      const query = new URL(url).searchParams.get('query');
      if (query === '동일 제목') return response({results: [
        {id: 10, media_type: 'movie', title: '동일 제목', original_title: 'Same Title', release_date: '1995-01-01', overview: '원작'},
        {id: 20, media_type: 'movie', title: '동일 제목', original_title: 'Same Title', release_date: '2015-01-01', overview: '리메이크'},
        {id: 30, media_type: 'tv', name: '동일 제목', original_name: 'Same Title', first_air_date: '2015-01-01', overview: 'TV판'}
      ]});
      return response({results: []});
    }
    if (url.startsWith('https://api.themoviedb.org/3/movie/496243/images')) {
      return response({posters: [
        {file_path: '/english.jpg', iso_639_1: 'en', height: 1500, vote_average: 9, vote_count: 100},
        {file_path: '/korean.jpg', iso_639_1: 'ko', height: 3000, vote_average: 8, vote_count: 80}
      ]});
    }
    if (url.startsWith('https://www.googleapis.com/books/v1/volumes')) {
      const query = new URL(url).searchParams.get('q') || '';
      if (query === '기생수') return response({items: [
        {id: 'parasite-16', volumeInfo: {title: '기생수 16(완결)', authors: ['Hitoshi Iwaaki'], publishedDate: '2016', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/parasite-16.jpg'}}},
        {id: 'parasite-12', volumeInfo: {title: '기생수 12', authors: ['Hitoshi Iwaaki'], publishedDate: '2016', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/parasite-12.jpg'}}},
        {id: 'parasite-set', volumeInfo: {title: '[세트] 기생수 (전16권/완결)', authors: ['Hitoshi Iwaaki'], publishedDate: '2016', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/parasite-set.jpg'}}},
        {id: 'parasite-reversi', volumeInfo: {title: '기생수 리버시. 3', authors: ['Hitoshi Iwaaki'], publishedDate: '2021', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/reversi.jpg'}}}
      ]});
      if (query === '강철의 연금술사') return response({items: [
        {id: 'fma-base', volumeInfo: {title: '강철의 연금술사 1', authors: ['Hiromu Arakawa'], publishedDate: '2005', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/fma-1.jpg'}}},
        {id: 'fma-perfect', volumeInfo: {title: '강철의 연금술사. 11(완전판)', authors: ['Hiromu Arakawa'], publishedDate: '2013', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/fma-perfect.jpg'}}},
        {id: 'fma-limited', volumeInfo: {title: '강철의 연금술사. 13(초회한정특별판)', authors: ['Hiromu Arakawa'], publishedDate: '2006', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/fma-limited.jpg'}}},
        {id: 'fma-omake', volumeInfo: {title: '강철의 연금술사 4컷만화', authors: ['Hiromu Arakawa'], publishedDate: '2019', language: 'ko', categories: ['Comics & Graphic Novels'], imageLinks: {large: 'http://books.test/fma-omake.jpg'}}}
      ]});
      return response({items: [
        {id: 'ordinary', volumeInfo: {title: '기억의 책', authors: ['작가'], language: 'ko', publisher: '일반출판사', imageLinks: {thumbnail: 'http://books.test/ordinary.jpg'}}},
        {id: 'literary', volumeInfo: {title: '기억의 책', authors: ['작가'], language: 'ko', publisher: '민음사', industryIdentifiers: [{type: 'ISBN_13', identifier: '9780000000001'}], imageLinks: {large: 'http://books.test/literary.jpg?zoom=1'}}},
        {id: 'web-novel', volumeInfo: {title: '기억의 웹소설', authors: ['작가'], language: 'ko', publisher: '가상출판사', categories: ['웹소설'], imageLinks: {large: 'http://books.test/web-novel.jpg'}}},
        {id: 'no-publisher', volumeInfo: {title: '출판 정보 없는 책', authors: ['작가'], language: 'ko', imageLinks: {large: 'http://books.test/no-publisher.jpg'}}}
      ]});
    }
    if (url.startsWith('https://openlibrary.org/')) {
      if (['기생수', '강철의 연금술사'].includes(new URL(url).searchParams.get('q') || '')) return response({docs: []});
      return response({docs: [{key: '/works/OL1W', title: '기억의 책', author_name: ['작가'], first_publish_year: 2020, subject: ['Memory'], publisher: ['문학동네', '민음사'], language: ['kor']}]});
    }
    if (url.startsWith('https://ko.wikipedia.org/w/api.php')) {
      const title = new URL(url).searchParams.get('gpssearch');
      if (title === '기생수') return response({query: {pages: [{pageid: 100, title: '기생수', terms: {description: ['일본의 만화 작품']}, original: {source: 'http://upload.wikimedia.org/parasyte-volume-1.jpg'}}]}});
      if (title === '강철의 연금술사') return response({query: {pages: [{pageid: 200, title: '강철의 연금술사', terms: {description: ['일본의 만화 작품']}, original: {source: 'https://upload.wikimedia.org/fma-volume-1.jpg'}}]}});
      return response({query: {pages: []}});
    }
    if (url === 'https://graphql.anilist.co') {
      const search = JSON.parse(init.body).variables.search;
      if (search === '건버스터') return response({data: {Page: {media: []}}});
      if (search === 'Top wo Nerae! Gunbuster') return response({data: {Page: {media: [{id: 949, title: {userPreferred: 'Gunbuster', native: 'トップをねらえ!'}, description: '우주와 성장', startDate: {year: 1988}, coverImage: {extraLarge: 'https://images.test/gunbuster.jpg'}, genres: ['Drama'], tags: [], staff: {nodes: []}}]}}});
      if (search === '기생수') return response({data: {Page: {media: [{id: 20623, title: {userPreferred: '기생수', native: '寄生獣 セイの格率'}, description: '기생 생물과 인간의 공존', startDate: {year: 2014}, coverImage: {extraLarge: 'https://images.test/parasyte-anime.jpg'}, genres: ['Action', 'Horror'], tags: [], staff: {nodes: []}}]}}});
      if (search === '강철의 연금술사') return response({data: {Page: {media: [{id: 121, title: {userPreferred: '강철의 연금술사', native: '鋼の錬金術師'}, description: '두 형제의 연금술 여정', startDate: {year: 2003}, coverImage: {extraLarge: 'https://images.test/fma-anime.jpg'}, genres: ['Action', 'Adventure'], tags: [], staff: {nodes: []}}]}}});
      return response({data: {Page: {media: [{id: 1, title: {userPreferred: '별의 아이', native: '星の子'}, description: '우주와 가족', startDate: {year: 2021}, coverImage: {}, genres: ['Drama'], tags: [], staff: {nodes: []}}]}}});
    }
    if (url.startsWith('https://www.wikidata.org/w/api.php')) {
      const request = new URL(url);
      if (request.searchParams.get('action') === 'wbsearchentities') {
        const id = request.searchParams.get('search') === '다른 책' ? 'Q999' : 'Q100';
        return response({search: [{id}]});
      }
      const ids = request.searchParams.get('ids') || '';
      if (ids.includes('Q200') || ids.includes('Q300')) return response({entities: {
        Q200: {labels: {ko: {value: '부커상'}}},
        Q300: {labels: {ko: {value: '대한민국'}}}
      }});
      if (ids === 'Q999') return response({entities: {Q999: {
        id: 'Q999', labels: {ko: {value: '전혀 다른 작품'}}, descriptions: {ko: {value: '1990년 영화'}}, claims: {
          P577: [{rank: 'normal', mainsnak: {datavalue: {value: {time: '+1990-01-01T00:00:00Z'}}}}]
        }
      }}});
      return response({entities: {Q100: {
        id: 'Q100', labels: {ko: {value: '기억의 책'}, en: {value: 'The Book of Memory'}}, aliases: {en: [{value: 'Book of Memory'}]}, descriptions: {ko: {value: '2020년 소설'}}, claims: {
          P166: [{rank: 'normal', mainsnak: {datavalue: {value: {id: 'Q200'}}}}, {rank: 'normal', mainsnak: {datavalue: {value: {id: 'Q201'}}}}],
          P495: [{rank: 'normal', mainsnak: {datavalue: {value: {id: 'Q300'}}}}],
          P577: [{rank: 'normal', mainsnak: {datavalue: {value: {time: '+2020-01-01T00:00:00Z'}}}}]
        }
      }}});
    }
    throw new Error(`Unexpected external request: ${url}`);
  };
});

test.beforeEach(() => {
  state.works.clear();
  state.archive.clear();
  state.tags = [];
  state.connections = [];
  state.feedback.clear();
  state.metadataReports = [];
  state.profileWrites = 0;
  state.backfillCalls = 0;
  state.failProfiles = false;
  state.failProviders = false;
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('health reports free providers and configured persistence', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/health'), env);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(result.headers.get('x-frame-options'), 'DENY');
  assert.match(result.headers.get('x-request-id'), /^[a-f0-9-]{36}$/);
  assert.match(result.headers.get('server-timing'), /^app;dur=\d+\.\d$/);
  const data = await result.json();
  assert.equal(data.ok, true);
  assert.equal(data.runtime, 'production-hardening-v1');
  assert.equal(data.sources.openLibrary, true);
  assert.equal(data.sources.aniList, true);
  assert.equal(data.sources.supabase, true);
  assert.equal(data.sources.wikidata, true);
  assert.equal(data.sources.culturalContext, 'wikidata-authority-catalog-v2');
  assert.equal(data.sources.publisherEngine, 'korean-editions-v1');
  assert.equal(data.sources.editorialEngine, 'metadata-editorial-v1');
  assert.equal(data.sources.artworkEngine, 'official-artwork-ranking-v1');
  assert.deepEqual(data.sources.awardCatalog, {literature: 10, film: 12, animation: 7});
  assert.equal(data.sources.tasteEngine, 'taste-profile-feedback-v2');
  assert.equal(data.sources.recommendationEngine, 'pgvector-catalog-feedback-v1');
  assert.equal(data.sources.archiveEngine, 'archive-management-v1');
  assert.equal(data.sources.catalogDimensions, 25);
});

test('API routing distinguishes missing paths and unsupported methods', async () => {
  const missing = await worker.fetch(new Request('https://site.test/api/does-not-exist'), env);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {error: 'API 경로를 찾을 수 없습니다.'});

  const unsupported = await worker.fetch(new Request('https://site.test/api/search', {method: 'POST'}), env);
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET');
  assert.deepEqual(await unsupported.json(), {error: '지원하지 않는 요청 방식입니다.', allowed: ['GET']});
});

test('public metadata is cacheable while personal data remains private', async () => {
  const searchResult = await worker.fetch(new Request('https://site.test/api/search?q=기억'), env);
  assert.equal(searchResult.status, 200);
  assert.equal(searchResult.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=600');
  assert.equal(searchResult.headers.get('vary'), 'Accept-Encoding');

  const archiveResult = await worker.fetch(new Request('https://site.test/api/archive', {headers}), env);
  assert.equal(archiveResult.status, 200);
  assert.equal(archiveResult.headers.get('cache-control'), 'no-store');
});

test('mutation guard rejects cross-origin and oversized requests', async () => {
  const crossOrigin = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST', headers: {...headers, origin: 'https://evil.example', 'content-type': 'application/json'}, body: '{}'
  }), env);
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), {error: '허용되지 않은 출처의 요청입니다.'});

  const oversized = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST', headers: {...headers, origin: 'https://site.test', 'content-type': 'application/json', 'content-length': '262145'}, body: '{}'
  }), env);
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), {error: '요청 데이터가 너무 큽니다.'});
});

test('mutation rate limit returns a retry window', async () => {
  let result;
  for (let index = 0; index < 31; index++) result = await worker.fetch(new Request('https://site.test/api/does-not-exist', {
    method: 'POST', headers: {'cf-connecting-ip': '203.0.113.27', origin: 'https://site.test', 'content-type': 'application/json'}, body: '{}'
  }), env);
  assert.equal(result.status, 429);
  assert.match(result.headers.get('retry-after'), /^\d+$/);
  assert.equal((await result.json()).retryAfter > 0, true);
});

test('artwork chooses a high resolution Korean official film poster', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/artwork?title=%EA%B8%B0%EC%83%9D%EC%B6%A9&mediaType=FILM'), {...env, TMDB_READ_TOKEN: 'test-token'});
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.posterUrl, 'https://image.tmdb.org/t/p/original/korean.jpg');
  assert.equal(data.source, 'TMDB');
  assert.equal(data.kind, 'official-poster');
  assert.equal(data.alternatives.length, 1);
});

test('film artwork prefers an original title for provider matching', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/artwork?title=%EB%A9%9C%EB%9E%91%EC%BD%9C%EB%A6%AC%EC%95%84&originalTitle=Melancholia&mediaType=FILM'), {...env, TMDB_READ_TOKEN: 'test-token'});
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.posterUrl, 'https://image.tmdb.org/t/p/original/korean.jpg');
});

test('artwork prefers a documented Korean literary edition for books', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/artwork?title=%EA%B8%B0%EC%96%B5%EC%9D%98%20%EC%B1%85&creator=%EC%9E%91%EA%B0%80&mediaType=BOOK'), {...env, GOOGLE_BOOKS_API_KEY: 'test-key'});
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.posterUrl, 'https://books.test/literary.jpg?zoom=1');
  assert.equal(data.publisher, '민음사');
  assert.equal(data.isbn, '9780000000001');
  assert.match(data.note, /번역의 질/);
});

test('anime artwork uses the original title when the Korean title is not indexed', async () => {
  const result = await worker.fetch(new Request("https://site.test/api/artwork?title=%EA%B1%B4%EB%B2%84%EC%8A%A4%ED%84%B0&originalTitle=Top%20wo%20Nerae%21%20Gunbuster&mediaType=ANIME"), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.posterUrl, 'https://images.test/gunbuster.jpg');
  assert.equal(data.source, 'AniList');
});

test('cultural context enriches a verified work with Wikidata awards and country', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/cultural-context?title=%EA%B8%B0%EC%96%B5%EC%9D%98%20%EC%B1%85&year=2020&mediaType=BOOK'), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.matched, true);
  assert.equal(data.entityId, 'Q100');
  assert.equal(data.confidence, 1);
  assert.deepEqual(data.awards, [{id: 'Q200', label: '부커상', canonical: 'Booker Prize', tier: 'top'}]);
  assert.equal(data.excludedAwardCount, 1);
  assert.equal(data.catalogVersion, 2);
  assert.deepEqual(data.countries, [{id: 'Q300', label: '대한민국'}]);
  assert.equal(data.properties.awards, 'P166');
  assert.equal(data.properties.countries, 'P495');
  assert.deepEqual(data.awardCatalog, {literature: 10, film: 12, animation: 7});
});

test('book publishers returns deduplicated Korean edition publishers', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/book-publishers?title=%EA%B8%B0%EC%96%B5%EC%9D%98%20%EC%B1%85&creator=%EC%9E%91%EA%B0%80'), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data.publishers, [
    {name: '문학동네', sources: ['Open Library']},
    {name: '민음사', sources: ['Open Library']}
  ]);
  assert.equal(data.language, 'ko');
});

test('editorial intro compresses a work into conflict, motif, and escalation', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/editorial-intro', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({work: {
      id: 'book:memory', title: '기억의 책', creator: '작가', mediaType: 'BOOK',
      description: '잃어버린 기억과 가족의 상실을 따라가는 소설', tags: ['기억', '상실']
    }})
  }), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.text, '잃어버린 것을 붙잡으려는 마음을 기억이 스스로를 배반하는 순간까지 밀어붙인 작품.');
  assert.equal(data.engine, 'metadata-editorial-v1');
  assert.equal(data.cost, 'free');
});

test('cultural context rejects an ambiguous Wikidata candidate', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/cultural-context?title=%EB%8B%A4%EB%A5%B8%20%EC%B1%85&year=2020&mediaType=BOOK'), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.matched, false);
  assert.equal(data.source, 'Wikidata');
});

test('search combines free Open Library and AniList results without paid keys', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/search?q=기억'), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.sources['Open Library'], 'ok');
  assert.equal(data.sources.AniList, 'ok');
  assert.equal(data.sources.TMDB, 'needs_key');
  assert.equal(data.sources['Google Books'], 'needs_key');
  assert.deepEqual(data.items.map(item => item.source).sort(), ['AniList', 'Open Library']);
});

test('book search excludes web novels and records without a published edition', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/search?q=기억'), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.bookPolicy, 'published-editions-only');
  const books = data.items.filter(item => item.mediaType === 'BOOK');
  assert.ok(books.length > 0);
  assert.ok(books.every(item => item.publishers.length > 0));
  assert.ok(books.every(item => !/웹\s*소설|web\s*novel/iu.test(`${item.title} ${(item.tags || []).join(' ')}`)));
  assert.ok(!state.works.has('googlebooks:web-novel'));
  assert.ok(!state.works.has('googlebooks:no-publisher'));
});

test('search groups manga volumes and sets while keeping the anime adaptation separate', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/search?q=기생수'), {...env, GOOGLE_BOOKS_API_KEY: 'test-key'});
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data.items.map(item => [item.title, item.mediaType]), [['기생수', 'MANGA'], ['기생수', 'ANIME']]);
  const manga = data.items[0];
  assert.equal(manga.editionCount, 3);
  assert.equal(manga.posterUrl, 'https://upload.wikimedia.org/parasyte-volume-1.jpg');
  assert.equal(manga.artworkSource, 'Wikipedia');
  assert.equal(data.items.some(item => item.title.includes('리버시')), false);
});

test('search groups complete and limited manga editions without title-specific rules', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/search?q=강철의%20연금술사'), {...env, GOOGLE_BOOKS_API_KEY: 'test-key'});
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.deepEqual(data.items.map(item => [item.title, item.mediaType]), [['강철의 연금술사', 'MANGA'], ['강철의 연금술사', 'ANIME']]);
  assert.equal(data.items[0].editionCount, 3);
  assert.equal(data.items[0].posterUrl, 'https://upload.wikimedia.org/fma-volume-1.jpg');
  assert.equal(data.items[0].artworkSource, 'Wikipedia');
  assert.equal(data.items.some(item => item.title.includes('4컷')), false);
});

test('identity keeps remakes and media adaptations separate while exposing stable keys', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/search?q=%EB%8F%99%EC%9D%BC%20%EC%A0%9C%EB%AA%A9'), {...env, TMDB_READ_TOKEN: 'test-token'});
  assert.equal(result.status, 200);
  const items = (await result.json()).items.filter(item => item.source === 'TMDB');
  assert.deepEqual(items.map(item => [item.mediaType, item.year]), [['FILM', '1995'], ['FILM', '2015'], ['TV', '2015']]);
  assert.equal(new Set(items.map(item => item.canonicalKey)).size, 3);
  assert.ok(items.every(item => item.identityAliases.includes('sametitle')));
});

test('metadata correction reports require login and stay pending for review', async () => {
  const body = JSON.stringify({work:{id:'tmdb:movie:10',title:'동일 제목',year:1995,mediaType:'FILM'},issueType:'year',suggestedValue:'1996',note:'공식 자료 확인'});
  const anonymous = await worker.fetch(new Request('https://site.test/api/metadata-reports',{method:'POST',headers:{'content-type':'application/json'},body}),env);
  assert.equal(anonymous.status,401);
  const reportHeaders = {'oai-authenticated-user-id':'22222222-2222-4222-8222-222222222222','oai-authenticated-user-email':'reporter@example.com','content-type':'application/json'};
  const saved = await worker.fetch(new Request('https://site.test/api/metadata-reports',{method:'POST',headers:reportHeaders,body}),env);
  assert.equal(saved.status,201);
  assert.equal((await saved.json()).status,'pending');
  assert.equal(state.metadataReports[0].current_value,1995);
  assert.equal(state.metadataReports[0].suggested_value,'1996');
});

test('archive lifecycle creates Taste DNA, aggregates it, and deletes it', async () => {
  const work = {
    id: 'openlibrary:/works/OL1W',
    externalId: '/works/OL1W',
    title: '기억의 책',
    creator: '작가',
    year: 2020,
    mediaType: 'BOOK',
    description: '기억과 상실, 가족에 관한 이야기',
    tags: ['Memory'],
    source: 'Open Library'
  };
  const save = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({work, rating: 4, myComment: '잊힌 기억과 가족의 상실이 오래 남았다.'})
  }), env);
  assert.equal(save.status, 201);
  const saved = await save.json();
  assert.equal(saved.work.rating, 4);
  assert.equal(saved.work.analysis.engine, 'metadata-lexicon-v1');
  assert.ok(saved.work.analysis.tags.length >= 6);
  assert.ok(saved.work.analysis.tags.some(tag => tag.tag === '기억'));

  const archive = await worker.fetch(new Request('https://site.test/api/archive', {headers}), env);
  assert.equal(archive.status, 200);
  assert.equal((await archive.json()).items.length, 1);

  const profile = await worker.fetch(new Request('https://site.test/api/taste-profile', {headers}), env);
  assert.equal(profile.status, 200);
  const profileData = await profile.json();
  assert.ok(profileData.tags.length >= 1);
  assert.match(profileData.statement, /당신/);

  state.connections.push(
    {user_id: userId, from_work_id: work.id, to_work_id: 'other:1', connection_type: 'archive', reason: 'outgoing', score: .8, shared_tags: [], work_json: {id: 'other:1', title: '다른 작품'}},
    {user_id: userId, from_work_id: 'other:2', to_work_id: work.id, connection_type: 'archive', reason: 'incoming', score: .7, shared_tags: [], work_json: state.works.get(work.id)},
    {user_id: userId, from_work_id: 'other:1', to_work_id: 'other:2', connection_type: 'archive', reason: 'unrelated', score: .6, shared_tags: [], work_json: {id: 'other:2', title: '남은 작품'}}
  );

  const remove = await worker.fetch(new Request(`https://site.test/api/archive/${encodeURIComponent(work.id)}`, {
    method: 'DELETE',
    headers
  }), env);
  assert.equal(remove.status, 200);
  assert.equal(state.archive.size, 0);
  assert.equal(state.tags.length, 0);
  assert.equal(state.connections.length, 1);
  assert.equal(state.connections[0].reason, 'unrelated');
});

test('account data deletion removes only the signed-in user personal data', async () => {
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  state.works.set('shared:work', {id: 'shared:work', title: '공용 작품'});
  state.archive.set(`${userId}:mine`, {user_id: userId, work_id: 'mine'});
  state.archive.set(`${otherUserId}:theirs`, {user_id: otherUserId, work_id: 'theirs'});
  state.tags.push({user_id: userId, work_id: 'mine', tag: '기억'}, {user_id: otherUserId, work_id: 'theirs', tag: '성장'});
  state.connections.push({user_id: userId, from_work_id: 'mine'}, {user_id: otherUserId, from_work_id: 'theirs'});
  state.feedback.set(`${userId}:mine:target:deep`, {user_id: userId});
  state.feedback.set(`${otherUserId}:theirs:target:deep`, {user_id: otherUserId});

  const wrongConfirmation = await worker.fetch(new Request('https://site.test/api/account-data', {
    method: 'DELETE', headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({confirmation: 'delete'})
  }), env);
  assert.equal(wrongConfirmation.status, 400);
  assert.equal(state.archive.size, 2);

  const result = await worker.fetch(new Request('https://site.test/api/account-data', {
    method: 'DELETE', headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({confirmation: 'DELETE'})
  }), env);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).deleted, true);
  assert.equal([...state.archive.values()].every(item => item.user_id === otherUserId), true);
  assert.equal(state.tags.every(item => item.user_id === otherUserId), true);
  assert.equal(state.connections.every(item => item.user_id === otherUserId), true);
  assert.equal([...state.feedback.values()].every(item => item.user_id === otherUserId), true);
  assert.equal(state.works.has('shared:work'), true);
});

test('archive management updates review, status, and Taste DNA', async () => {
  const work = {id: 'book:managed', title: '관리할 책', creator: '작가', mediaType: 'BOOK', description: '기억과 성장에 관한 책', source: 'Open Library'};
  let response = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({work, rating: 3, myComment: '처음 기록'})
  }), env);
  assert.equal(response.status, 201);

  response = await worker.fetch(new Request(`https://site.test/api/archive/${encodeURIComponent(work.id)}`, {
    method: 'PATCH', headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({rating: 5, myComment: '기억과 성장이 오래 남았다.', archiveState: 'planned'})
  }), env);
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.work.rating, 5);
  assert.equal(updated.work.myComment, '기억과 성장이 오래 남았다.');
  assert.equal(updated.work.archiveState, 'planned');
  assert.ok(updated.work.analysis.tags.some(tag => tag.tag === '기억'));

  response = await worker.fetch(new Request('https://site.test/api/archive', {headers}), env);
  const data = await response.json();
  assert.equal(data.engine, 'archive-management-v1');
  assert.equal(data.items[0].archiveState, 'planned');
  assert.ok(data.items[0].updatedAt);
});

test('connection graph normalizes archived snake_case work metadata', async () => {
  state.connections.push({
    user_id: userId,
    from_work_id: 'book:source',
    to_work_id: 'anime:target',
    connection_type: 'archive',
    reason: 'Taste DNA 연결',
    score: .91,
    shared_tags: ['기억'],
    work_json: {id: 'anime:target', external_id: '300', title: '대상 작품', original_title: 'Target', creator: '감독', release_year: 1995, media_type: 'ANIME', poster_url: 'https://images.test/poster.jpg', description: '설명', tags: ['기억'], source: 'AniList'}
  });
  const result = await worker.fetch(new Request('https://site.test/api/connections', {headers}), env);
  assert.equal(result.status, 200);
  const item = (await result.json()).items[0];
  assert.equal(item.mediaType, 'ANIME');
  assert.equal(item.year, 1995);
  assert.equal(item.externalId, '300');
  assert.equal(item.posterUrl, 'https://images.test/poster.jpg');
  assert.equal(item.fromWorkId, 'book:source');
});

test('archive endpoints reject unauthenticated requests', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/archive'), env);
  assert.equal(result.status, 401);
});

test('external Sites user IDs map to a stable UUID and archive GET stays read-only', async () => {
  const externalHeaders = {
    'oai-authenticated-user-id': 'appgprj_example~external_visitor_123',
    'oai-authenticated-user-email': 'external@example.com',
    'content-type': 'application/json'
  };
  const empty = await worker.fetch(new Request('https://site.test/api/archive', {headers: externalHeaders}), env);
  assert.equal(empty.status, 200);
  assert.equal(state.profileWrites, 0);

  const save = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST',
    headers: externalHeaders,
    body: JSON.stringify({work: {id: 'anilist:30', externalId: '30', title: '신세기 에반게리온', creator: '안노 히데아키', year: 1995, mediaType: 'ANIME'}, rating: 5, myComment: '정체성과 고독'})
  }), env);
  assert.equal(save.status, 201);
  assert.equal(state.profileWrites, 1);
  const savedUserId = [...state.archive.values()][0].user_id;
  assert.match(savedUserId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  const archive = await worker.fetch(new Request('https://site.test/api/archive', {headers: externalHeaders}), env);
  const data = await archive.json();
  assert.equal(archive.status, 200);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].title, '신세기 에반게리온');
  assert.equal(state.profileWrites, 1);
});

test('Sites email-only authentication maps to a stable private UUID', async () => {
  const emailOnly = {'oai-authenticated-user-email': 'email-only@example.com'};
  const first = await worker.fetch(new Request('https://site.test/api/archive', {headers: emailOnly}), env);
  const second = await worker.fetch(new Request('https://site.test/api/archive', {headers: emailOnly}), env);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(state.profileWrites, 0);
});

test('hostile media types are normalized and cannot trap Taste DNA generation', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({
      work: {id: 'hostile:1', title: 'x', mediaType: 'constructor', year: 1e12, posterUrl: 'javascript:alert(1)'},
      rating: 3.5
    })
  }), env);
  assert.equal(result.status, 201);
  const saved = await result.json();
  assert.equal(saved.work.mediaType, 'OTHER');
  assert.equal(saved.work.year, null);
  assert.equal(saved.work.posterUrl, null);
  assert.equal(saved.work.rating, 4);
  assert.ok(saved.work.analysis.tags.length >= 6);
});

test('manga series keep their media type and Wikipedia cover when archived', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({work: {id: 'googlebooks:fma', title: '강철의 연금술사', creator: 'Hiromu Arakawa', mediaType: 'MANGA', posterUrl: 'https://upload.wikimedia.org/fma-volume-1.jpg'}, rating: 5})
  }), env);
  assert.equal(result.status, 201);
  const saved = await result.json();
  assert.equal(saved.work.mediaType, 'MANGA');
  assert.equal(saved.work.posterUrl, 'https://upload.wikimedia.org/fma-volume-1.jpg');
});

test('shared work metadata is immutable after the first insert', async () => {
  const firstWork = {id: 'book:shared', title: '원래 제목', mediaType: 'BOOK'};
  const secondWork = {id: 'book:shared', title: '<img src=x onerror=alert(1)>', mediaType: 'BOOK'};
  const secondHeaders = {...headers, 'oai-authenticated-user-id': '22222222-2222-4222-8222-222222222222'};
  for (const [work, requestHeaders] of [[firstWork, headers], [secondWork, secondHeaders]]) {
    const result = await worker.fetch(new Request('https://site.test/api/archive', {
      method: 'POST',
      headers: {...requestHeaders, 'content-type': 'application/json'},
      body: JSON.stringify({work, rating: 5})
    }), env);
    assert.equal(result.status, 201);
  }
  assert.equal(state.works.get('book:shared').title, '원래 제목');
  const firstArchive = await worker.fetch(new Request('https://site.test/api/archive', {headers}), env);
  const secondArchive = await worker.fetch(new Request('https://site.test/api/archive', {headers: secondHeaders}), env);
  assert.equal((await firstArchive.json()).items[0].title, '원래 제목');
  assert.equal((await secondArchive.json()).items[0].title, '<img src=x onerror=alert(1)>');
});

test('malformed JSON is reported as a client error', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: '{'
  }), env);
  assert.equal(result.status, 400);
});

test('JSON null and malformed archive IDs are reported as client errors', async () => {
  const nullBody = await worker.fetch(new Request('https://site.test/api/archive', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: 'null'
  }), env);
  assert.equal(nullBody.status, 400);

  const malformedId = await worker.fetch(new Request('https://site.test/api/archive/%E0%A4%A', {
    method: 'DELETE',
    headers
  }), env);
  assert.equal(malformedId.status, 400);
});

test('Taste DNA is stored as a 25-dimensional vector and similarities are returned', async () => {
  const works = [
    {id: 'book:memory', title: '기억의 책', mediaType: 'BOOK', description: '기억과 상실, 가족'},
    {id: 'film:memory', title: '기억의 영화', mediaType: 'FILM', description: '기억과 상실, 사랑'}
  ];
  for (const work of works) {
    const result = await worker.fetch(new Request('https://site.test/api/archive', {
      method: 'POST',
      headers: {...headers, 'content-type': 'application/json'},
      body: JSON.stringify({work, rating: 5, myComment: '기억과 상실이 좋았다'})
    }), env);
    assert.equal(result.status, 201);
  }
  for (const item of state.archive.values()) assert.equal(vector(item.taste_vector).length, 25);

  const result = await worker.fetch(new Request('https://site.test/api/taste-similarities', {headers}), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.engine, 'pgvector-cosine-v1');
  assert.equal(data.dimensions, 25);
  assert.equal(data.edges.length, 1);
  assert.ok(data.edges[0].similarity > 0 && data.edges[0].similarity <= 1);
});

test('archive GET remains read-only and returns legacy work_json without backfill', async () => {
  for (const [index, title] of ['오래된 기억', '잊힌 기억'].entries()) {
    const id = `legacy:${index}`;
    const work = {id, title, creator: '작가', media_type: index ? 'FILM' : 'BOOK', tags: [], source: 'legacy'};
    state.works.set(id, work);
    state.archive.set(`${userId}:${id}`, {user_id: userId, work_id: id, work_json: work, analysis_json: {tags: [{tag: '기억', score: .8}, {tag: '상실', score: .7}]}});
  }
  const first = await worker.fetch(new Request('https://site.test/api/archive', {headers}), env);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).items.length, 2);
  assert.ok([...state.archive.values()].every(item => !item.taste_vector));
  assert.equal(state.connections.length, 0);
  assert.equal(state.profileWrites, 0);

  const second = await worker.fetch(new Request('https://site.test/api/archive', {headers}), env);
  assert.equal(second.status, 200);
  assert.equal(state.connections.length, 0);
  assert.equal(state.profileWrites, 0);
});

test('live recommendations cross media and explain the shared Taste DNA', async () => {
  state.archive.set(`${userId}:openlibrary:/works/OL1W`, {
    user_id: userId,
    work_id: 'openlibrary:/works/OL1W',
    work_json: {id: 'openlibrary:/works/OL1W', title: '기억의 책', media_type: 'BOOK'}
  });
  state.works.set('catalog:film:memory', {
    id: 'catalog:film:memory', title: '기억의 영화', original_title: null, creator: '감독',
    release_year: 2024, media_type: 'FILM', poster_url: null,
    description: '기억과 상실, 가족과 우주를 다루는 영화', tags: ['기억', '상실'], source: 'Catalog',
    taste_analysis: {engine: 'metadata-lexicon-v1', tags: [
      {tag: '기억', category: 'STORY', score: .94}, {tag: '상실', category: 'MOOD', score: .91},
      {tag: '가족', category: 'STORY', score: .83}, {tag: '미지와 우주', category: 'IDEA', score: .8}
    ]},
    taste_vector: catalogVector({기억: .94, 상실: .91, 가족: .83, '미지와 우주': .8})
  });
  const result = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({
      work: {id: 'book:source', title: '기억을 걷는 사람', mediaType: 'BOOK', description: '기억과 상실, 가족과 우주'},
      mode: 'deep'
    })
  }), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.engine, 'pgvector-catalog-feedback-v1');
  assert.ok(data.diagnostics.pgvectorCandidates >= 1);
  assert.equal(data.diagnostics.dimensions, 25);
  assert.ok(data.items.every(item => typeof item.personalization === 'number'));
  assert.ok(data.diagnostics.queries.length >= 1 && data.diagnostics.queries.length <= 3);
  assert.ok(data.diagnostics.mediaTypes.length >= 1);
  assert.ok(data.items.length >= 1);
  assert.ok(data.items.some(item => item.mediaType !== 'BOOK'));
  assert.ok(data.items.every(item => item.id !== 'openlibrary:/works/OL1W'));
  assert.equal(data.diagnostics.excludedSaved, 1);
  assert.ok(data.items.every(item => item.reason && item.similarity > 0));
  assert.ok(data.items.every(item => item.editorialIntro && !item.editorialIntro.includes('기억을 걷는 사람에서')));
  assert.ok(data.items.every(item => item.persisted));
  assert.equal(state.connections.length, data.items.length);

  const cached = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({work: {id: 'book:source', title: '기억을 걷는 사람', mediaType: 'BOOK'}, mode: 'deep'})
  }), env);
  const cachedData = await cached.json();
  assert.equal(cachedData.cached, true);
  assert.equal(cachedData.items.length, data.items.length);
  assert.ok(cachedData.items.every(item => item.editorialIntro));

  const graph = await worker.fetch(new Request('https://site.test/api/connections', {headers}), env);
  assert.equal(graph.status, 200);
  assert.equal((await graph.json()).items.length, data.items.length);
});

test('negative recommendation feedback is persisted and excludes the work', async () => {
  const work = {id: 'book:source', title: '기억을 걷는 사람', mediaType: 'BOOK', description: '기억과 상실, 가족과 우주'};
  const first = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({work, mode: 'deep'})
  }), env);
  const firstData = await first.json();
  assert.ok(firstData.items.length > 0);
  const rejected = firstData.items[0];

  const feedback = await worker.fetch(new Request('https://site.test/api/recommendation-feedback', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({fromWorkId: work.id, toWorkId: rejected.id, mode: 'deep', value: -1, sharedTags: rejected.sharedTags})
  }), env);
  assert.equal(feedback.status, 200);
  assert.equal((await feedback.json()).learnedTags, rejected.sharedTags.length);
  assert.equal(state.feedback.size, 1);

  const next = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({work, mode: 'deep'})
  }), env);
  const nextData = await next.json();
  assert.ok(nextData.items.every(item => item.id !== rejected.id));
  assert.equal(nextData.diagnostics.rejected, 1);
  assert.equal(nextData.diagnostics.globalFeedbackSignals, 1);
  assert.equal(nextData.diagnostics.preferenceTags, rejected.sharedTags.length);
  assert.equal(state.backfillCalls, 0);
});

test('hiding every visible recommendation backfills with different works', async () => {
  const work = {id: 'book:hide-all', title: '숨김 회귀 테스트', mediaType: 'BOOK', description: '기억과 상실, 가족과 우주'};
  const first = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({work, mode: 'deep'})
  }), env);
  const firstData = await first.json();
  assert.equal(first.status, 200);
  assert.ok(firstData.items.length > 0);
  const rejected = new Set(firstData.items.map(item => item.id));

  for (const item of firstData.items) {
    const feedback = await worker.fetch(new Request('https://site.test/api/recommendation-feedback', {
      method: 'POST', headers: {...headers, 'content-type': 'application/json'},
      body: JSON.stringify({fromWorkId: work.id, toWorkId: item.id, mode: 'deep', value: -1, sharedTags: item.sharedTags})
    }), env);
    assert.equal(feedback.status, 200);
  }

  const next = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({work, mode: 'deep'})
  }), env);
  const nextData = await next.json();
  assert.equal(next.status, 200);
  assert.ok(nextData.items.length > 0);
  assert.ok(nextData.items.every(item => !rejected.has(item.id)));
  assert.ok(state.connections.every(row => !rejected.has(row.to_work_id)));
  assert.equal(state.backfillCalls, 0);
});

test('Taste profile exposes preference signals learned from recommendation feedback', async () => {
  state.feedback.set('positive', {user_id: userId, from_work_id: 'a', to_work_id: 'b', connection_mode: 'deep', value: 1, shared_tags: ['기억', '고독']});
  state.feedback.set('negative', {user_id: userId, from_work_id: 'a', to_work_id: 'c', connection_mode: 'deep', value: -1, shared_tags: ['폭력']});
  const result = await worker.fetch(new Request('https://site.test/api/taste-profile', {headers}), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.engine, 'taste-profile-feedback-v2');
  assert.equal(data.feedbackCount, 2);
  assert.deepEqual(data.learnedTags.map(item => [item.tag, item.sentiment]), [['기억', 'more'], ['고독', 'more'], ['폭력', 'less']]);
});

test('recommendations remain available for an unsaved work without sign-in', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({work: {id: 'googlebooks:norwegian-wood', title: '노르웨이의 숲', mediaType: 'BOOK', description: '사랑과 상실, 고독을 통과하는 청춘'}, mode: 'deep'})
  }), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.engine, 'metadata-catalog-safety-net-v1');
  assert.equal(data.diagnostics.builtInSafetyNet, true);
  assert.ok(data.items.length >= 3);
  assert.ok(data.items.some(item => item.mediaType !== 'BOOK'));
  assert.ok(data.items.every(item => item.fromWorkId === 'googlebooks:norwegian-wood'));
  assert.ok(data.items.every(item => item.persisted === false));
});

test('recommendations use the built-in catalog when every external provider fails', async () => {
  state.failProviders = true;
  const result = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({work: {id: 'unknown:any-work', title: '어떤 작품', mediaType: 'OTHER', description: '기억과 관계를 다루는 작품'}, mode: 'story'})
  }), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.ok(data.items.length >= 3);
  assert.equal(data.diagnostics.builtInSafetyNet, true);
  assert.ok(new Set(data.items.map(item => item.mediaType)).size >= 2);
});

test('all connection modes satisfy the release quality gate', async () => {
  state.failProviders = true;
  const work = {id: 'quality:persona', title: '퍼소나', creator: '잉마르 베리만', year: 1966, mediaType: 'FILM', description: '침묵과 얼굴, 정체성의 균열을 응시하는 영화'};
  const signatures = new Set();
  for (const mode of ['story', 'mood', 'idea', 'visual', 'deep']) {
    const response = await worker.fetch(new Request('https://site.test/api/recommendations', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({work, mode})
    }), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.items.length, 3);
    assert.equal(new Set(data.items.map(item => item.id)).size, data.items.length);
    assert.ok(new Set(data.items.map(item => item.mediaType)).size >= 2);
    assert.ok(data.items.every(item => Number.isInteger(item.year) && item.year >= 1800));
    assert.ok(data.items.every(item => item.editorialIntro?.endsWith('작품.')));
    assert.ok(data.items.every(item => !item.editorialIntro.includes(`${work.title}에서`)));
    signatures.add(data.items.map(item => item.id).join('|'));
  }
  assert.ok(signatures.size >= 3);
});

test('malformed client analysis cannot break the public recommendation fallback', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({work: {id: 'unknown:malformed', title: '불완전한 작품', mediaType: 'OTHER', analysis: {tags: [null]}}, mode: 'deep'})
  }), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.items.length, 3);
});

test('authenticated recommendations fall back when profile persistence fails', async () => {
  state.failProfiles = true;
  const result = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST',
    headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({work: {id: 'googlebooks:norwegian-wood', title: '노르웨이의 숲', mediaType: 'BOOK', description: '사랑과 상실, 고독을 통과하는 청춘'}, mode: 'deep'})
  }), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.engine, 'metadata-catalog-safety-net-v1');
  assert.ok(data.items.length >= 3);
});

test('catalog indexing ignores client-owned metadata, recomputes analysis, and deduplicates IDs', async () => {
  state.failProfiles = false;
  state.failProviders = false;
  state.works.set('openlibrary:/works/OL1W', {id: 'openlibrary:/works/OL1W', title: '기억의 책', source: 'Open Library'});
  const result = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      work: {
        id: 'openlibrary:/works/OL1W', title: 'HACKED TITLE', mediaType: 'BOOK',
        analysis: {tags: [{tag: '고독', category: 'MOOD', score: 999}], aiComment: 'PRIVATE: do not persist'}
      },
      mode: 'deep'
    })
  }), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.ok(data.diagnostics.catalogIndexed > 0);
  assert.equal(state.works.get('openlibrary:/works/OL1W').title, '기억의 책');
  assert.notEqual(state.works.get('openlibrary:/works/OL1W').taste_analysis?.aiComment, 'PRIVATE: do not persist');
});

test('catalog analysis remains internal and mode weighting changes the pgvector query', async () => {
  state.catalogQueries.length = 0;
  state.works.set('catalog:private-analysis', {
    id: 'catalog:private-analysis', title: '비공개 분석 오염 작품', creator: '작가', media_type: 'FILM',
    description: '기억과 상실', tags: ['기억', '상실'], source: 'Catalog',
    taste_analysis: {tags: [{tag: '기억', category: 'STORY', score: .9}], aiComment: 'PRIVATE: leaked review'},
    taste_vector: catalogVector({기억: .9, 상실: .8})
  });
  const work = {
    id: 'mode:test', title: '모드 테스트', mediaType: 'BOOK',
    analysis: {tags: [
      {tag: '기억', category: 'STORY', score: .9},
      {tag: '상실', category: 'MOOD', score: .8}
    ]}
  };
  const responses = [];
  for (const mode of ['story', 'mood']) {
    const response = await worker.fetch(new Request('https://site.test/api/recommendations', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({work, mode})
    }), env);
    responses.push(await response.json());
  }
  assert.equal(state.catalogQueries.length, 2);
  assert.notEqual(state.catalogQueries[0], state.catalogQueries[1]);
  assert.ok(responses.flatMap(data => data.items).every(item => !('analysis' in item)));
  assert.doesNotMatch(JSON.stringify(responses), /PRIVATE: leaked review/);
});

test('saved and rejected titles stay excluded across provider IDs', async () => {
  state.feedback.clear();
  state.connections = [];
  state.failProfiles = false;
  state.archive.set(`${userId}:tmdb:movie:152601`, {
    user_id: userId,
    work_id: 'tmdb:movie:152601',
    work_json: {id: 'tmdb:movie:152601', title: 'Her', media_type: 'FILM'}
  });
  const source = {id: 'title-exclusion:source', title: '관계의 경계', mediaType: 'BOOK', description: '사랑과 고독, 기술과 미래'};
  let response = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({work: source, mode: 'idea'})
  }), env);
  let data = await response.json();
  assert.ok(data.items.every(item => item.title !== 'Her'));

  state.archive.delete(`${userId}:tmdb:movie:152601`);
  state.works.set('fallback:film:her', {...state.works.get('fallback:film:her'), id: 'fallback:film:her', title: 'Her'});
  response = await worker.fetch(new Request('https://site.test/api/recommendation-feedback', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'},
    body: JSON.stringify({fromWorkId: source.id, toWorkId: 'fallback:film:her', mode: 'idea', value: -1, sharedTags: ['기술과 미래']})
  }), env);
  assert.equal(response.status, 200);
  state.works.set('tmdb:movie:her-alternate', {
    id: 'tmdb:movie:her-alternate', title: 'Her', creator: 'Spike Jonze', media_type: 'FILM',
    description: '기술과 사랑', tags: ['기술과 미래'], source: 'TMDB',
    taste_analysis: {tags: [{tag: '기술과 미래', category: 'IDEA', score: .95}]},
    taste_vector: catalogVector({'기술과 미래': .95})
  });
  response = await worker.fetch(new Request('https://site.test/api/recommendations', {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify({work: source, mode: 'idea'})
  }), env);
  data = await response.json();
  assert.ok(data.items.every(item => item.title !== 'Her'));
});

test('constellation graph combines Taste DNA similarity with saved discovery paths', async () => {
  const first = 'constellation:first';
  const second = 'constellation:second';
  state.works.set(first, {id: first, title: '첫 번째 별', media_type: 'BOOK', creator: '작가', tags: ['기억']});
  state.works.set(second, {id: second, title: '두 번째 별', media_type: 'FILM', creator: '감독', tags: ['기억']});
  state.archive.set(`${userId}:${first}`, {
    user_id: userId, work_id: first, work_json: state.works.get(first), rating: 5,
    analysis_json: {tags: [{tag: '기억', category: 'STORY', score: .9}]},
    taste_vector: catalogVector({기억: .9})
  });
  state.archive.set(`${userId}:${second}`, {
    user_id: userId, work_id: second, work_json: state.works.get(second), rating: 4,
    analysis_json: {tags: [{tag: '기억', category: 'STORY', score: .85}]},
    taste_vector: catalogVector({기억: .85})
  });
  state.connections.push({
    user_id: userId, from_work_id: first, to_work_id: second, connection_type: 'story:v3',
    reason: '기억을 다루는 방식이 연결됩니다.', score: .92, shared_tags: ['기억'], work_json: state.works.get(second)
  });
  const result = await worker.fetch(new Request('https://site.test/api/constellation', {headers}), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.engine, 'constellation-graph-v2');
  assert.ok(data.nodes.some(node => node.id === first));
  assert.ok(data.nodes.some(node => node.id === second));
  const edge = data.edges.find(item => new Set([item.sourceId, item.targetId]).has(first) && new Set([item.sourceId, item.targetId]).has(second));
  assert.ok(edge);
  assert.equal(edge.discovery, true);
  assert.ok(edge.sharedTags.includes('기억'));
  assert.ok(data.stats.connections >= 1);
  assert.ok(data.bridge);
});
