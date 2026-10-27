# 취향 성좌 백업·재해 복구 런북

## 목표와 책임

- 목표 RPO: PITR이 활성화된 운영 DB는 2분, 그렇지 않으면 일일 플랫폼 백업 기준 24시간.
- 목표 RTO: 장애 선언 후 읽기 전용 복구 60분, 전체 쓰기 기능 복구 120분.
- 복구 책임자는 먼저 쓰기 트래픽을 중지하고 원본을 보존한다. 운영 DB에 즉시 덮어쓰지 않는다.
- Supabase 공식 백업은 DB만 포함한다. 향후 Storage 객체를 쓰게 되면 객체 파일은 별도 백업해야 한다.

## 평시 백업

1. Supabase Dashboard의 Database → Backups에서 사용 가능한 일일 백업 또는 PITR의 최신 복구 시각을 매주 확인한다.
2. 배포 직전과 주 1회, 별도 보안 저장소에서 다음 논리 백업을 실행한다.

   `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-supabase-backup.mjs --output <암호화된-백업-디렉터리>`

3. 생성된 `.json.gz`와 `.sha256`을 서로 다른 장애 도메인의 암호화 저장소로 복제한다. 이 파일에는 개인정보가 있으므로 Git, 메신저, 일반 클라우드 공유 폴더에 올리지 않는다.
4. Sites의 현재 라이브 버전 번호, Git 커밋 SHA, Supabase 마이그레이션 목록을 함께 기록한다.

## 장애 판단과 복구 순서

1. 장애 시각, 마지막 정상 쓰기 시각, 영향 범위를 기록하고 쓰기 기능을 중지한다.
2. Supabase 플랫폼 장애인지 애플리케이션 오류인지 `/api/health/deep`, 로그, Advisor로 구분한다.
3. 가장 가까운 정상 복구 지점을 선택한다. PITR/플랫폼 복원 중에는 프로젝트가 중단될 수 있음을 공지한다.
4. 가능하면 새 Supabase 프로젝트나 승인된 격리 환경에 먼저 복원한다. 복구 대상이 기존 프로젝트라면 대시보드의 확인 절차를 거친다.
5. `supabase/migrations`를 순서대로 적용하고 `npm run dr:verify`로 스키마·마이그레이션 체크섬을 확인한다.
6. Sites의 환경 변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 복구 대상과 일치하는지 확인한 뒤 저장된 정상 Sites 버전을 배포한다. 키를 소스나 런북에 기록하지 않는다.
7. 사용자 아카이브는 내 성좌의 JSON 내보내기 파일을 JSON 가져오기로 복원할 수 있다. 동일 작품은 안전하게 갱신되고 Taste DNA와 연결은 다시 계산된다.

## 복구 검증

- `npm run check`, `npm run eval:recommendations`, `npm run perf:baseline`, `npm run dr:verify`가 모두 통과해야 한다.
- Supabase Security Advisor가 0건인지 확인한다.
- 작품 수, 사용자별 아카이브 수, 연결 수를 백업 매니페스트와 비교한다.
- 로그인 → 검색 → 저장 → 내 성좌 → Connection Mode → 삭제 취소의 브라우저 여정을 실행한다.
- pgvector `match_work_catalog` 실행계획과 `/api/health/deep`의 database/pgvector 상태를 확인한다.
- 30분 동안 오류율과 지연시간을 관찰한 후 쓰기 트래픽을 재개한다.

## 실패 시 되돌리기

- 복구 검증이 실패하면 쓰기를 재개하지 않고 직전 정상 Sites 버전과 더 이른 DB 복구 지점으로 되돌린다.
- 논리 백업은 원본 보존용이며 운영 DB에 직접 수동 편집하지 않는다. 불일치가 있으면 격리 환경에서 원인을 확인한다.
- 사고가 끝나면 실제 RPO/RTO, 손실 범위, 수행한 명령, 후속 조치를 기록한다.
