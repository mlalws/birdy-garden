-- records / dailyArchives.records 는 있는데 birds 가 비어 있을 때 확인용
-- (앱 로그인 시에도 자동 복구되지만, DB 상태 점검에 사용)

select
  user_id,
  jsonb_array_length(coalesce(payload -> 'records', '[]'::jsonb)) as live_records,
  jsonb_array_length(coalesce(payload -> 'birds', '[]'::jsonb)) as live_birds,
  (
    select count(*)
    from jsonb_each(coalesce(payload -> 'dailyArchives', '{}'::jsonb)) as arch(day_key, day_val)
    where jsonb_array_length(coalesce(day_val -> 'records', '[]'::jsonb)) > 0
      and jsonb_array_length(coalesce(day_val -> 'birds', '[]'::jsonb)) = 0
  ) as archive_days_missing_birds
from public.user_gardens
order by updated_at desc;
