# 70단계 개인정보·보존 정책 검증

- 실행 시각: 2026-10-27 22:55 KST (13:55 UTC)
- 대상: Supabase `idjusulvcxrrlqqhzopp`
- 정책 버전: 1
- 자동 실행: 매일 03:40 UTC, Cron job `taste-constellation-data-retention`
- 운영 첫 실행: 성공, 삭제 대상 0건, 11ms
- 권한: `anon`·`authenticated` 실행 불가, `service_role`만 실행 가능
- RLS: `data_retention_runs` 활성화 및 직접 클라이언트 접근 거부
- Security Advisor: 0건

## 트랜잭션 복구형 시험

합성 프로필과 작품을 만들고 다음 경계를 한 트랜잭션 안에서 검증한 뒤 전체 롤백했다.

- 181일 된 추천 연결은 삭제되고 최신 연결은 유지됨
- 731일 된 추천 반응은 삭제되고 최신 반응은 유지됨
- 181일 된 미처리 정보 신고는 삭제되고 최신 신고는 유지됨
- 3일 된 Rate Limit 버킷 삭제
- 365일이 지난 해결 장애와 연결된 상태 점검 삭제
- `delete_user_private_data()`가 아카이브·Taste 태그·연결·추천 반응·신고를 원자적으로 삭제
- 롤백 후 합성 프로필·작품 잔여 행 0건

결과: `retention_boundaries_and_atomic_delete_passed`
