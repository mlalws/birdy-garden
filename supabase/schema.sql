-- Supabase SQL Editor에서 한 번 실행하세요.
-- payload JSONB 필드 예: birds, records, dexSeenSpecies, profile,
-- currentGardenDate (KST YYYY-MM-DD), dailyArchives (날짜별 정원 스냅샷)

create table if not exists public.user_gardens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{"birds":[],"records":[],"dailyArchives":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_gardens enable row level security;

drop policy if exists "Users read own garden" on public.user_gardens;
drop policy if exists "Users insert own garden" on public.user_gardens;
drop policy if exists "Users update own garden" on public.user_gardens;

create policy "Users read own garden"
  on public.user_gardens
  for select
  using (auth.uid() = user_id);

create policy "Users insert own garden"
  on public.user_gardens
  for insert
  with check (auth.uid() = user_id);

create policy "Users update own garden"
  on public.user_gardens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 주간 조류 발견 랭킹 (KST ISO 주차, discovery_count = 해당 주 누적 발견 마리 수)
create table if not exists public.weekly_rankings (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_key text not null,
  discovery_count integer not null default 0 check (discovery_count >= 0),
  nickname text not null default '',
  avatar_url text,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_key)
);

-- 기존 DB: Supabase SQL Editor에서 실행
-- alter table public.weekly_rankings add column if not exists avatar_url text;

create index if not exists weekly_rankings_week_score_idx
  on public.weekly_rankings (week_key, discovery_count desc, updated_at asc);

alter table public.weekly_rankings enable row level security;

drop policy if exists "Authenticated read weekly rankings" on public.weekly_rankings;
drop policy if exists "Users insert own weekly ranking" on public.weekly_rankings;
drop policy if exists "Users update own weekly ranking" on public.weekly_rankings;

create policy "Authenticated read weekly rankings"
  on public.weekly_rankings
  for select
  to authenticated
  using (true);

create policy "Users insert own weekly ranking"
  on public.weekly_rankings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users update own weekly ranking"
  on public.weekly_rankings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
