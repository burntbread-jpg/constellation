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
  tags: []
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

function mockSupabase(url, init = {}) {
  const parsed = new URL(url);
  const table = parsed.pathname.split('/').at(-1);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;

  if (method === 'POST' && table === 'profiles') return response(null, 204);
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
  if (method === 'POST' && table === 'works') {
    state.works.set(body.id, body);
    return response(null, 204);
  }
  if (method === 'POST' && table === 'archive_items') {
    state.archive.set(`${body.user_id}:${body.work_id}`, body);
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
  if (method === 'GET' && table === 'archive_items') {
    const filteredUserId = parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
    return response([...state.archive.values()].filter(item => item.user_id === filteredUserId).map(item => ({
      ...item,
      created_at: '2026-09-30T00:00:00.000Z',
      works: state.works.get(item.work_id)
    })));
  }
  if (method === 'GET' && table === 'taste_tags') {
    const filteredUserId = parsed.searchParams.get('user_id')?.replace(/^eq\./, '');
    return response(state.tags.filter(tag => tag.user_id === filteredUserId));
  }
  return response({message: `Unhandled mock request: ${method} ${table}`}, 500);
}

test.before(() => {
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(env.SUPABASE_URL)) return mockSupabase(url, init);
    if (url.startsWith('https://openlibrary.org/')) {
      return response({docs: [{key: '/works/OL1W', title: '기억의 책', author_name: ['작가'], first_publish_year: 2020, subject: ['Memory']}]});
    }
    if (url === 'https://graphql.anilist.co') {
      return response({data: {Page: {media: [{id: 1, title: {userPreferred: '별의 아이', native: '星の子'}, description: '우주와 가족', startDate: {year: 2021}, coverImage: {}, genres: ['Drama'], tags: [], staff: {nodes: []}}]}}});
    }
    throw new Error(`Unexpected external request: ${url}`);
  };
});

test.beforeEach(() => {
  state.works.clear();
  state.archive.clear();
  state.tags = [];
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test('health reports free providers and configured persistence', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/health'), env);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(data.ok, true);
  assert.equal(data.sources.openLibrary, true);
  assert.equal(data.sources.aniList, true);
  assert.equal(data.sources.supabase, true);
  assert.equal(data.sources.tasteEngine, 'metadata-lexicon-v1');
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

  const remove = await worker.fetch(new Request(`https://site.test/api/archive/${encodeURIComponent(work.id)}`, {
    method: 'DELETE',
    headers
  }), env);
  assert.equal(remove.status, 200);
  assert.equal(state.archive.size, 0);
  assert.equal(state.tags.length, 0);
});

test('archive endpoints reject unauthenticated requests', async () => {
  const result = await worker.fetch(new Request('https://site.test/api/archive'), env);
  assert.equal(result.status, 401);
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
