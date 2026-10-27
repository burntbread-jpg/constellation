set lock_timeout = '5s';

update public.works
set poster_url = case id
  when 'fallback:book:human-disqualification' then 'https://books.google.com/books/content?id=8DW4EAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
  when 'fallback:book:childhoods-end' then 'https://books.google.com/books/content?id=uQKKDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
  when 'fallback:book:klara-and-the-sun' then 'https://books.google.com/books/content?id=SFgmEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
  when 'fallback:book:the-art-of-loving' then 'https://books.google.com/books/content?id=iS2sDwAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
  when 'fallback:book:never-let-me-go' then 'https://books.google.com/books/content?id=CAFDEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
  when 'fallback:book:left-hand-darkness' then 'https://books.google.com/books/content?id=r1_PEAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
  when 'fallback:book:beloved' then 'https://books.google.com/books/content?id=LKUN0AEACAAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'
  else poster_url
end,
updated_at = now()
where id in (
  'fallback:book:human-disqualification',
  'fallback:book:childhoods-end',
  'fallback:book:klara-and-the-sun',
  'fallback:book:the-art-of-loving',
  'fallback:book:never-let-me-go',
  'fallback:book:left-hand-darkness',
  'fallback:book:beloved'
)
and (poster_url is null or btrim(poster_url) = '');
