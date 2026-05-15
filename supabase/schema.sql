-- Supabase SQL Editor에서 한 번 실행하세요.

create table if not exists public.user_gardens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{"birds":[],"records":[]}'::jsonb,
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
