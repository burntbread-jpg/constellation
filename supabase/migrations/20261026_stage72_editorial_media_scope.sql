set lock_timeout = '5s';

-- Remove title-only editorial matches accidentally applied to a different medium.
update public.works
set editorial_intro = null,
    updated_at = now()
where (media_type || ':' || regexp_replace(lower(coalesce(title, '')), '[^a-z0-9가-힣]', '', 'g')) in (
  'BOOK:serialexperimentslain',
  'BOOK:퍼펙트블루'
)
and editorial_intro in (
  '인터넷에 접속할수록 내가 누구인지 로그아웃되는 작품.',
  '스타의 얼굴을 여러 거울에 깨뜨려 진짜 내가 어느 조각인지 묻는 작품.'
);
