-- ============================================================
-- 북극성 지표용 이벤트 로그 — 이 파일만 Supabase SQL Editor에서 Run
-- (schema.sql 전체 말고 이 파일만!)
-- ============================================================
-- 지표: 주간 1회 이상 새 기록 완료 + 정원 인터랙션 둘 다 한 유저 수
-- 이벤트: bird_record_completed, garden_interaction

create table if not exists public.user_event_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_name text not null check (event_name in ('bird_record_completed', 'garden_interaction')),
  week_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists user_event_logs_week_event_user_idx
  on public.user_event_logs (week_key, event_name, user_id);

create unique index if not exists user_event_logs_unique_weekly_event
  on public.user_event_logs (user_id, week_key, event_name);

alter table public.user_event_logs enable row level security;

drop policy if exists "Users read own event logs" on public.user_event_logs;
drop policy if exists "Users insert own event logs" on public.user_event_logs;

create policy "Users read own event logs"
  on public.user_event_logs
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users insert own event logs"
  on public.user_event_logs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create or replace function public.get_north_star_active_users(target_week_key text)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from (
    select user_id
    from public.user_event_logs
    where week_key = target_week_key
      and event_name in ('bird_record_completed', 'garden_interaction')
    group by user_id
    having count(distinct event_name) = 2
  ) t;
$$;

revoke all on function public.get_north_star_active_users(text) from public;
grant execute on function public.get_north_star_active_users(text) to authenticated;
