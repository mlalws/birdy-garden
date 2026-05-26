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

-- 전체 사용자 공용 조류 목록 (리스트에 없는 조류 추가)
create table if not exists public.shared_list_birds (
  id text primary key,
  created_by uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  image_src text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shared_list_birds_created_at_idx
  on public.shared_list_birds (created_at asc);

alter table public.shared_list_birds enable row level security;

drop policy if exists "Authenticated read shared list birds" on public.shared_list_birds;
drop policy if exists "Users insert own shared list birds" on public.shared_list_birds;
drop policy if exists "Users update own shared list birds" on public.shared_list_birds;
drop policy if exists "Users delete own shared list birds" on public.shared_list_birds;

create policy "Authenticated read shared list birds"
  on public.shared_list_birds
  for select
  to authenticated
  using (true);

create policy "Users insert own shared list birds"
  on public.shared_list_birds
  for insert
  to authenticated
  with check (auth.uid() = created_by);

create policy "Users update own shared list birds"
  on public.shared_list_birds
  for update
  to authenticated
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

create policy "Users delete own shared list birds"
  on public.shared_list_birds
  for delete
  to authenticated
  using (auth.uid() = created_by);

-- 모든 사용자 user_gardens.payload.customListBirds → shared_list_birds 일괄 연동 (한 번 실행해도 됨, 앱 로그인 시 자동 호출)
create or replace function public.sync_shared_list_birds_from_all_gardens()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  garden_row record;
  bird jsonb;
  rec_row record;
  bird_id text;
  bird_name text;
  bird_desc text;
  bird_img text;
  bird_created timestamptz;
  row_added integer;
  added integer := 0;
begin
  for garden_row in
    select user_id, payload from public.user_gardens
  loop
    for bird in
      select * from jsonb_array_elements(coalesce(garden_row.payload -> 'customListBirds', '[]'::jsonb))
    loop
      bird_id := bird ->> 'id';
      if bird_id is null or bird_id = '' or bird_id not like 'custom-%' then
        continue;
      end if;

      bird_name := nullif(trim(both from coalesce(bird ->> 'name', '')), '');
      bird_desc := coalesce(bird ->> 'description', '');
      bird_img := nullif(trim(both from coalesce(bird ->> 'imageSrc', '')), '');
      bird_created := coalesce(
        nullif(bird ->> 'createdAt', '')::timestamptz,
        now()
      );

      if bird_name is null then
        bird_name := '이름 없는 조류';
      end if;
      if bird_img is null then
        bird_img := '/duck.png';
      end if;

      insert into public.shared_list_birds (
        id, created_by, name, description, image_src, created_at, updated_at
      )
      values (
        bird_id,
        garden_row.user_id,
        bird_name,
        bird_desc,
        bird_img,
        bird_created,
        now()
      )
      on conflict (id) do nothing;

      get diagnostics row_added = row_count;
      added := added + row_added;
    end loop;

    -- payload.records / dailyArchives 에만 남은 custom-* 종도 연동
    for rec_row in
      select distinct on (r.list_bird_id)
        r.list_bird_id,
        r.species_name,
        r.feature,
        r.photo_url,
        r.created_at
      from (
        select
          rec ->> 'listBirdId' as list_bird_id,
          coalesce(nullif(trim(rec ->> 'speciesName'), ''), nullif(trim(rec ->> 'name'), '')) as species_name,
          coalesce(rec ->> 'feature', '') as feature,
          coalesce(rec ->> 'photoUrl', '') as photo_url,
          coalesce(nullif(rec ->> 'createdAt', '')::timestamptz, now()) as created_at
        from jsonb_array_elements(coalesce(garden_row.payload -> 'records', '[]'::jsonb)) as rec
        where (rec ->> 'listBirdId') like 'custom-%'
        union all
        select
          rec ->> 'listBirdId',
          coalesce(nullif(trim(rec ->> 'speciesName'), ''), nullif(trim(rec ->> 'name'), '')),
          coalesce(rec ->> 'feature', ''),
          coalesce(rec ->> 'photoUrl', ''),
          coalesce(nullif(rec ->> 'createdAt', '')::timestamptz, now())
        from jsonb_each(coalesce(garden_row.payload -> 'dailyArchives', '{}'::jsonb)) as arch(day_key, day_val),
        jsonb_array_elements(coalesce(day_val -> 'records', '[]'::jsonb)) as rec
        where (rec ->> 'listBirdId') like 'custom-%'
      ) as r
      where r.list_bird_id is not null and r.list_bird_id <> ''
      order by r.list_bird_id, r.created_at asc
    loop
      bird_id := rec_row.list_bird_id;
      bird_name := nullif(trim(both from coalesce(rec_row.species_name, '')), '');
      if bird_name is null then
        continue;
      end if;
      bird_desc := coalesce(rec_row.feature, '');
      bird_img := nullif(trim(both from coalesce(rec_row.photo_url, '')), '');
      if bird_img is null then
        bird_img := '/duck.png';
      end if;

      insert into public.shared_list_birds (
        id, created_by, name, description, image_src, created_at, updated_at
      )
      values (
        bird_id,
        garden_row.user_id,
        bird_name,
        bird_desc,
        bird_img,
        rec_row.created_at,
        now()
      )
      on conflict (id) do nothing;

      get diagnostics row_added = row_count;
      added := added + row_added;
    end loop;
  end loop;

  return added;
end;
$$;

revoke all on function public.sync_shared_list_birds_from_all_gardens() from public;
grant execute on function public.sync_shared_list_birds_from_all_gardens() to authenticated;
