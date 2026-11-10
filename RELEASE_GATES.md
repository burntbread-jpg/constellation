# 정식 출시 8단계 게이트

이 순서는 고정한다. 앞 단계가 아래 완료 조건을 충족하기 전에는 다음 단계를 시작하거나 완료로 표시하지 않는다.

| 단계 | 고정 작업 | 완료 증거 | 상태 |
|---:|---|---|---|
| 1 | Vercel용 Supabase Auth | 운영 로그인 UI·Supabase Bearer 검증·위조 헤더 차단·운영 URL 설정 확인 | 완료 |
| 2 | CI 121/121 및 전체 Actions 녹색 | 로컬 121/121, 기본 브랜치의 필수 Actions 전부 성공 | 완료 |
| 3 | Supabase Cron을 Vercel로 이전 | Vercel Cron 실행·인증·로그, Supabase의 기존 Sites 호출 제거 | 완료 |
| 4 | 운영 로그인 E2E | PC·모바일에서 로그인→검색→저장→성좌→추천→삭제·복원 성공 | 완료 |
| 5 | 카탈로그·포스터 100작품 검수 | 100작품의 제목·매체·연도·창작자·포스터·소개 완성률 98% 이상 | 완료 |
| 6 | 40작품 사람 A/B 검수 | 작품당 2인 독립 평가, AI 통과율 80%+, 스포일러 0, 선호도 +5%p | 대기 |
| 7 | 실트래픽 성능·모바일 실기기 | 운영 p95 기준선과 iPhone Safari·Android Chrome 수동 검수 통과 | 대기 |
| 8 | 실제 백업 복구 훈련 | 격리 환경 복원, 사용자 아카이브 검증, RTO/RPO와 절차 기록 | 대기 |

## 공통 완료 규칙

1. 구현, 자동 테스트, 운영 환경 확인, 증거 기록 네 가지가 모두 있어야 완료다.
2. 부분 성공이나 로컬 성공만으로 완료 처리하지 않는다.
3. 실패한 검증은 숨기지 않고 해당 단계의 차단 사유로 기록한다.
4. 단계의 범위를 바꿀 때는 이 문서의 번호와 완료 조건을 먼저 갱신한다.
5. 운영 비밀키는 저장소·클라이언트·로그에 기록하지 않는다.

## 단계 3 완료 증거 (2026-11-09)

- Production 배포 `39x6SEEmSmbN74CA3RExpVNRniWj`가 `constellation-swart.vercel.app`의 Current로 확인됐다.
- Vercel Cron Jobs에서 health, data retention, recommendation metrics 세 경로가 모두 Active로 등록됐다.
- `/api/cron-health`를 Vercel에서 수동 실행해 `vercel_cron_complete`, `ok: true`, `database: true`, `pgvector: true` 로그를 확인했다.
- Production의 Supabase 서비스 역할 키를 현재 프로젝트 키로 교정한 뒤 재배포했다. 비밀값은 저장소와 문서에 기록하지 않았다.
- 마이그레이션 `migrate_cron_to_vercel`을 운영 DB에 적용했고, 이전 Supabase `pg_cron` 작업 3개가 더 이상 존재하지 않음을 조회로 확인했다.
- 마이그레이션 후 Supabase Security·Health advisor는 경고 0건이다. Performance advisor의 기존 미사용 인덱스 INFO 10건만 남아 있으며 이 이전 작업의 차단 사유는 아니다.

## 단계 4 완료 증거 (2026-11-10)

- 운영 도메인 `constellation-swart.vercel.app`에서 `yungoobae@gmail.com` 계정의 Supabase 로그인과 세션 유지를 확인했다.
- PC 흐름에서 `기생충` 검색·작품 식별·별점과 임시 감상 저장·내 성좌 표시·Connection Mode 추천 이동을 확인했다.
- Vercel의 중첩 아카이브 경로 누락을 `api/archive/[id].js`로 교정했다. 운영 DELETE 경로가 더 이상 HTML 404가 아니라 인증된 JSON API로 동작한다.
- 운영에서 기록 삭제 후 `실행 취소` 복원을 재시험해 `작품을 다시 성좌에 복원했어요.` 상태, `내 성좌 1`, 복원된 작품 카드를 확인했다.
- 390×844 모바일 뷰포트에서 로그인 상태·`기생충` 검색 결과의 정확한 FILM/2019 식별·Connection Mode 이동·내 성좌와 저장 카드 표시를 확인했다.
- 회귀 검증은 단위·통합 122/122와 Playwright 데스크톱·모바일 10/10을 통과했다.
- 운영 배포 `6hFGP8XY9TNtoJ7j85w8RSU7VRz1`이 커밋 `f11e9df`를 Production Current로 제공한다.

## 단계 5 완료 증거 (2026-11-10)

- 고정 검수 목록 100작품을 책 30·영화 30·애니메이션 25·만화 15로 구성하고 제목·매체·초판 연도·창작자·스포일러 없는 소개 문구를 사람 기준으로 확정했다.
- 영화는 명시적 TMDB 작품 ID, 애니메이션은 AniList→TMDB→Wikipedia 동일 작품 대체 경로, 만화는 AniList 시리즈 정체성, 책은 제목·저자와 한국어판 우선 기준으로 표지를 선택했다.
- 100개 포스터 URL을 실제 요청해 이미지 응답을 확인했다. 제목·매체·연도·창작자·포스터·소개 완성률은 모두 100%이며 검수 목록 내부 중복 정체성은 0건이다.
- 운영 Supabase에 `verified` 100작품을 반영했고 전 작품의 `metadata_quality_score=100`, 활성 canonical 중복 0건, 추천 가능 카탈로그 100작품을 SQL로 재확인했다.
- 동일 작품의 자동수집 후보는 삭제하지 않고 `quarantined`로 격리했다. 명시적 격리를 `candidate`로 되돌리던 분류 트리거도 교정했다.
- 재현 가능한 원본은 `quality/catalog-review-100.json`, 자동 검수 결과는 `quality/reports/catalog-review-100.json`과 `quality/reports/catalog-review-100.md`에 기록했다.
- 마이그레이션 후 Supabase Health advisor는 0건이다. 기존 Auth의 유출 비밀번호 보호 비활성 경고 1건과 미사용 인덱스 INFO 10건은 이 단계에서 새로 발생한 항목이 아니다.
