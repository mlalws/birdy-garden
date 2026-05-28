-- 북극성 지표 조회 (SQL Editor에서 실행)

-- 1) 특정 주차 북극성 유저 수
select public.get_north_star_active_users('2026-W22');

-- 2) 주차별 북극성 유저 수
select
  week_key,
  count(*) as north_star_users
from (
  select week_key, user_id
  from public.user_event_logs
  where event_name in ('bird_record_completed', 'garden_interaction')
  group by week_key, user_id
  having count(distinct event_name) = 2
) qualified
group by week_key
order by week_key desc;

-- 3) 최근 raw 로그
select *
from public.user_event_logs
order by created_at desc
limit 50;
