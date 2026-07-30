-- ============================================================
-- LifeQuest Phase 2 schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run
-- ============================================================

-- One row per user holding their entire LifeQuest state as JSON
create table if not exists public.progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.progress enable row level security;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.groups enable row level security;

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_members enable row level security;

-- Helper function (security definer avoids RLS self-recursion issues)
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

-- ---- progress policies ----
create policy "select own progress" on public.progress
  for select using (auth.uid() = user_id);

create policy "select group members progress" on public.progress
  for select using (
    exists (
      select 1 from public.group_members gm
      where gm.user_id = progress.user_id
        and public.is_group_member(gm.group_id)
    )
  );

create policy "insert own progress" on public.progress
  for insert with check (auth.uid() = user_id);

create policy "update own progress" on public.progress
  for update using (auth.uid() = user_id);

-- ---- groups policies (read-only for members; writes go through RPCs below) ----
create policy "select groups you belong to" on public.groups
  for select using (public.is_group_member(id));

-- ---- group_members policies ----
create policy "select memberships of your groups" on public.group_members
  for select using (public.is_group_member(group_id));

-- ---- RPC: create a group, generates a short code, adds you as first member ----
create or replace function public.create_group(p_name text)
returns table(id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_id uuid;
begin
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.groups(code, name, owner_id) values (v_code, p_name, auth.uid())
    returning groups.id into v_id;
  insert into public.group_members(group_id, user_id) values (v_id, auth.uid());
  return query select v_id, v_code;
end;
$$;

-- ---- RPC: join a group using its code ----
create or replace function public.join_group(p_code text)
returns table(id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
begin
  select * into v_group from public.groups where code = upper(p_code);
  if not found then
    raise exception 'Invalid group code';
  end if;
  insert into public.group_members(group_id, user_id)
    values (v_group.id, auth.uid())
    on conflict do nothing;
  return query select v_group.id, v_group.name;
end;
$$;

-- ---- RPC: list your groups with member counts ----
create or replace function public.my_groups()
returns table(id uuid, name text, code text, member_count bigint)
language sql
security definer
set search_path = public
as $$
  select g.id, g.name, g.code, count(gm2.user_id)
  from public.groups g
  join public.group_members gm on gm.group_id = g.id and gm.user_id = auth.uid()
  join public.group_members gm2 on gm2.group_id = g.id
  group by g.id, g.name, g.code;
$$;

-- ---- RPC: group summary (member stats for the group summary page) ----
create or replace function public.group_summary(p_group_id uuid)
returns table(user_id uuid, display_name text, data jsonb)
language sql
security definer
set search_path = public
as $$
  select p.user_id, p.display_name, p.data
  from public.progress p
  join public.group_members gm on gm.user_id = p.user_id
  where gm.group_id = p_group_id
    and public.is_group_member(p_group_id);
$$;
