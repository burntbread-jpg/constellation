import {expect, test} from '@playwright/test';

const persona = {
  id: 'tmdb:movie:10404',
  externalId: '10404',
  title: '퍼소나',
  originalTitle: 'Persona',
  creator: '잉마르 베리만',
  mediaType: 'FILM',
  type: 'FILM',
  year: 1966,
  description: '침묵하는 배우와 간호사의 얼굴이 서로에게 스며드는 심리극.',
  editorialIntro: '침묵을 지키려는 얼굴과 타인의 언어가 서로의 경계를 삼켜버리는 작품.',
  tags: ['정체성', '침묵', '얼굴'],
  source: 'TMDB'
};

const recommendations = [
  {
    id: 'tmdb:movie:329865', title: '컨택트', originalTitle: 'Arrival', creator: '드니 빌뇌브',
    mediaType: 'FILM', type: 'FILM', year: 2016, similarity: .91,
    description: '언어와 시간의 구조가 선택의 의미를 바꾸는 영화.',
    editorialIntro: '미래를 기억하게 된 사람이 상실까지 포함한 사랑을 다시 선택하는 작품.',
    sharedTags: ['기억', '선택'], tags: ['기억', '선택'], source: 'TMDB'
  },
  {
    id: 'openlibrary:/works/OL27448W', title: '클라라와 태양', creator: '가즈오 이시구로',
    mediaType: 'BOOK', type: 'BOOK', year: 2021, similarity: .82,
    description: '인공 친구가 인간의 사랑과 희생을 관찰하는 소설.',
    editorialIntro: '사랑을 학습한 비인간의 시선으로 인간이 서로를 대체하는 순간을 바라보는 작품.',
    sharedTags: ['정체성', '사랑'], tags: ['정체성', '사랑'], source: 'Open Library'
  },
  {
    id: 'anilist:339', title: 'Serial Experiments Lain', creator: '나카무라 류타로',
    mediaType: 'ANIME', type: 'ANIME', year: 1998, similarity: .79,
    description: '네트워크와 현실 사이에서 자아가 분해되는 애니메이션.',
    editorialIntro: '접속될수록 선명해지는 대신 여러 개로 갈라지는 자아를 끝까지 추적한 작품.',
    sharedTags: ['정체성', '경계'], tags: ['정체성', '경계'], source: 'AniList'
  }
];

async function installApiMocks(page) {
  const state = {items: []};
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = body => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});

    if (path === '/api/search') return json({items: [persona], sources: {tmdb: 'ok', openLibrary: 'ok', aniList: 'ok'}});
    if (path === '/api/recommendations') return json({items: recommendations, engine: 'e2e-fixture'});
    if (path === '/api/archive' && method === 'GET') return json({items: state.items});
    if (path === '/api/archive' && method === 'POST') {
      const payload = request.postDataJSON();
      const work = {
        ...payload.work,
        rating: payload.rating || 5,
        myComment: payload.myComment || '',
        archiveState: payload.archiveState || 'completed',
        savedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        analysis: {tags: [{tag: '정체성', score: 94}, {tag: '고독', score: 86}]}
      };
      state.items = [work, ...state.items.filter(item => item.id !== work.id)];
      return json({saved: true, work});
    }
    if (path.startsWith('/api/archive/') && method === 'DELETE') {
      const id = decodeURIComponent(path.slice('/api/archive/'.length));
      state.items = state.items.filter(item => item.id !== id);
      return json({deleted: true});
    }
    if (path === '/api/taste-profile') return json({
      tags: state.items.length ? [{tag: '정체성', score: 94}, {tag: '고독', score: 86}] : [],
      statement: state.items.length ? '당신은 정체성과 고독의 경계를 탐색하는 작품을 좋아합니다.' : ''
    });
    if (path === '/api/taste-similarities') return json({edges: []});
    if (path === '/api/connections') return json({items: []});
    if (path === '/api/constellation') return json({
      nodes: state.items.map(item => ({...item, centrality: 0, cluster: 0})),
      edges: [], bridge: state.items[0]?.id || null,
      stats: {works: state.items.length, connections: 0, clusters: state.items.length ? 1 : 0}
    });
    if (path === '/api/artwork') return json({posterUrl: null});
    if (path === '/api/cultural-context') return json({matched: false, awards: [], countries: []});
    if (path === '/api/book-publishers') return json({publishers: []});
    if (path === '/api/metadata-provenance') return json({items: []});
    if (path === '/api/editorial-intro') return json({text: persona.editorialIntro});
    if (path === '/api/metadata-reports') return route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({error: 'forbidden'})});
    return json({items: [], count: 0});
  });
  return state;
}

test.beforeEach(async ({page}) => {
  await installApiMocks(page);
  await page.goto('/');
  await expect(page.locator('#archiveCount')).toHaveText('0');
});
test('search opens a work and Connection Mode navigates to a recommendation', async ({page}) => {
  await page.locator('#searchInput').fill('퍼소나');
  await expect(page.getByRole('option', {name: /퍼소나/})).toBeVisible();
  await page.getByRole('option', {name: /퍼소나/}).click();
  await expect(page.locator('#workTitle')).toHaveText('퍼소나');
  await expect(page.locator('#workYear')).toHaveText('1966');

  await page.getByRole('button', {name: 'STORY'}).click();
  await expect(page.locator('.rec-card')).toHaveCount(3);
  await expect(page.locator('#recommendations')).toContainText('컨택트');
  await page.locator('[data-recommendation="tmdb:movie:329865"]').click();
  await expect(page.locator('#workTitle')).toHaveText('컨택트');
  await expect(page.locator('#workQuote')).toContainText('상실까지 포함한 사랑');
});

test('save, archive, delete, and undo keep the constellation in sync', async ({page}) => {
  await page.getByRole('button', {name: '에반게리온', exact: true}).click();
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveDialog')).toBeVisible();
  await page.locator('#commentInput').fill('타인에게 다가가려는 두려움까지 기억하게 한다.');
  await page.locator('#analyzeSaveBtn').click();
  await expect(page.locator('#archiveCount')).toHaveText('1');
  await expect(page.locator('#saveBtn')).toContainText('내 성좌에서 빼기');

  await page.locator('[data-view="archive"]').click();
  await expect(page.locator('#archiveLibrary')).toContainText('신세기 에반게리온');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-library-delete="evangelion"]').click();
  await expect(page.locator('#archiveCount')).toHaveText('0');
  await expect(page.locator('#undoArchiveDelete')).toBeVisible();

  await page.locator('#undoArchiveDelete').click();
  await expect(page.locator('#archiveCount')).toHaveText('1');
  await expect(page.locator('#archiveLibrary')).toContainText('신세기 에반게리온');
});

test('keyboard search and responsive layout remain usable', async ({page, isMobile}) => {
  await page.keyboard.press('Control+K');
  await expect(page.locator('#searchInput')).toBeFocused();
  await page.locator('#searchInput').fill('퍼소나');
  await expect(page.getByRole('option', {name: /퍼소나/})).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', {name: /퍼소나/})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workTitle')).toHaveText('퍼소나');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${isMobile ? 'mobile' : 'desktop'} viewport has horizontal overflow`).toBeLessThanOrEqual(1);
});
