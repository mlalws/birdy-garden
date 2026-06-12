-- ============================================================
-- 정원 데이터 상태 확인 + 복구 안내
-- ============================================================

-- 1) 사용자별 남아 있는 기록 수 확인
select
  user_id,
  jsonb_array_length(coalesce(payload -> 'birds', '[]'::jsonb)) as live_birds,
  jsonb_array_length(coalesce(payload -> 'records', '[]'::jsonb)) as live_records,
  (
    select count(*)
    from jsonb_each(coalesce(payload -> 'dailyArchives', '{}'::jsonb))
  ) as archive_days,
  updated_at
from public.user_gardens
order by updated_at desc;

-- 2) 아카이브에 기록이 남아 있는 사용자만 보기
select
  user_id,
  archive_day.key as date_key,
  jsonb_array_length(coalesce(archive_day.value -> 'records', '[]'::jsonb)) as records,
  jsonb_array_length(coalesce(archive_day.value -> 'birds', '[]'::jsonb)) as birds
from public.user_gardens,
  lateral jsonb_each(coalesce(payload -> 'dailyArchives', '{}'::jsonb)) as archive_day(key, value)
order by user_id, date_key desc;

-- ============================================================
-- 데이터가 비어 있다면 (복구)
-- ============================================================
-- 앱 코드만으로는 이미 지워진 Supabase 데이터를 되살릴 수 없습니다.
-- Supabase Pro 이상이면:
--   Dashboard → Database → Backups → Point in Time Recovery
--   → 사고 발생 직전 시각으로 user_gardens 테이블 복구
--
-- Free 플랜이면 자동 백업 복구가 없을 수 있습니다.
--   Supabase 지원팀에 문의하거나, 남아 있는 dailyArchives 행이 있는지
--   위 2번 쿼리로 먼저 확인하세요.
