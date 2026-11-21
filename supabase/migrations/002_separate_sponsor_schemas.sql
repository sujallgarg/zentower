-- ==============================================================================
-- ZEN TOWERS: SEPARATE SCHEMAS FOR 4 ENTITIES WITH AUTO-EXPIRY CLEANUP
-- 1. High Score Leaderboard (high_score_leaderboard)
-- 2. Sky Billboard Sponsors (sky_billboard_sponsors)
-- 3. Water Sponsors (water_sponsors) with expiry removal
-- 4. Block Sponsors (block_sponsors) with expiry removal
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. HIGH SCORE LEADERBOARD TABLE
-- ------------------------------------------------------------------------------
create table if not exists public.high_score_leaderboard (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  tag varchar(3) not null check (length(tag) = 3),
  x_handle text,
  mode text not null check (mode in ('daily', 'endless')),
  daily_day_number integer,
  peak_height numeric(6,1) not null check (peak_height >= 0),
  balanced_count integer not null check (balanced_count >= 0),
  max_tilt_deg numeric(4,1) not null default 0.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique constraint per player per daily seed / endless mode
create unique index if not exists idx_high_score_unique_player 
  on public.high_score_leaderboard (player_id, mode, coalesce(daily_day_number, 0));

-- Fast indexes for ranking queries
create index if not exists idx_high_score_daily 
  on public.high_score_leaderboard (daily_day_number, peak_height desc, balanced_count desc) 
  where mode = 'daily';

create index if not exists idx_high_score_endless 
  on public.high_score_leaderboard (peak_height desc, balanced_count desc) 
  where mode = 'endless';

alter table public.high_score_leaderboard enable row level security;

drop policy if exists "Allow public select on high_score_leaderboard" on public.high_score_leaderboard;
create policy "Allow public select on high_score_leaderboard"
  on public.high_score_leaderboard for select
  using (true);

drop policy if exists "Allow public insert on high_score_leaderboard" on public.high_score_leaderboard;
create policy "Allow public insert on high_score_leaderboard"
  on public.high_score_leaderboard for insert
  with check (true);

drop policy if exists "Allow public update on high_score_leaderboard" on public.high_score_leaderboard;
create policy "Allow public update on high_score_leaderboard"
  on public.high_score_leaderboard for update
  using (true);

-- ------------------------------------------------------------------------------
-- 2. SKY BILLBOARD SPONSORS TABLE (Permanent King-of-the-Hill Ranking)
-- ------------------------------------------------------------------------------
create table if not exists public.sky_billboard_sponsors (
  id uuid primary key default gen_random_uuid(),
  brand_name varchar(24) not null,
  tagline varchar(36) not null default 'Official Partner',
  website_url text,
  accent_color varchar(7) not null default '#0284c7',
  logo_url text,
  bid_amount_cents integer not null check (bid_amount_cents >= 200),
  contact_email text not null,
  dodo_payment_id text unique,
  status text not null default 'active' check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sky_billboard_active_bid 
  on public.sky_billboard_sponsors (status, bid_amount_cents desc);

alter table public.sky_billboard_sponsors enable row level security;

drop policy if exists "Allow public select on sky_billboard_sponsors" on public.sky_billboard_sponsors;
create policy "Allow public select on sky_billboard_sponsors"
  on public.sky_billboard_sponsors for select
  using (true);

drop policy if exists "Allow insert on sky_billboard_sponsors" on public.sky_billboard_sponsors;
create policy "Allow insert on sky_billboard_sponsors"
  on public.sky_billboard_sponsors for insert
  with check (true);

-- ------------------------------------------------------------------------------
-- 3. WATER SPONSORS TABLE (Timed Expiry: e.g. 7, 14, 30 days)
-- ------------------------------------------------------------------------------
create table if not exists public.water_sponsors (
  id uuid primary key default gen_random_uuid(),
  brand_name varchar(24) not null,
  tagline varchar(36) not null default 'Official Partner',
  website_url text,
  accent_color varchar(7) not null default '#0284c7',
  logo_url text,
  bid_amount_cents integer not null check (bid_amount_cents >= 200),
  contact_email text not null,
  dodo_payment_id text unique,
  duration_days integer not null default 7 check (duration_days >= 1),
  status text not null default 'active' check (status in ('pending', 'active')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_water_sponsors_active_expires 
  on public.water_sponsors (status, expires_at, bid_amount_cents desc);

alter table public.water_sponsors enable row level security;

drop policy if exists "Allow public select on water_sponsors" on public.water_sponsors;
create policy "Allow public select on water_sponsors"
  on public.water_sponsors for select
  using (true);

drop policy if exists "Allow insert on water_sponsors" on public.water_sponsors;
create policy "Allow insert on water_sponsors"
  on public.water_sponsors for insert
  with check (true);

-- ------------------------------------------------------------------------------
-- 4. BLOCK SPONSORS TABLE (Timed Expiry: e.g. 7, 14, 30 days)
-- ------------------------------------------------------------------------------
create table if not exists public.block_sponsors (
  id uuid primary key default gen_random_uuid(),
  brand_name varchar(24) not null,
  tagline varchar(36) not null default 'Official Partner',
  website_url text,
  accent_color varchar(7) not null default '#0284c7',
  logo_url text,
  bid_amount_cents integer not null check (bid_amount_cents >= 200),
  contact_email text not null,
  dodo_payment_id text unique,
  duration_days integer not null default 7 check (duration_days >= 1),
  status text not null default 'active' check (status in ('pending', 'active')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_block_sponsors_active_expires 
  on public.block_sponsors (status, expires_at, bid_amount_cents desc);

alter table public.block_sponsors enable row level security;

drop policy if exists "Allow public select on block_sponsors" on public.block_sponsors;
create policy "Allow public select on block_sponsors"
  on public.block_sponsors for select
  using (true);

drop policy if exists "Allow insert on block_sponsors" on public.block_sponsors;
create policy "Allow insert on block_sponsors"
  on public.block_sponsors for insert
  with check (true);

-- ------------------------------------------------------------------------------
-- 5. AUTOMATIC EXPIRY REMOVAL FUNCTION & TRIGGERS
-- Removes expired water and block sponsors permanently from the database.
-- ------------------------------------------------------------------------------
create or replace function public.remove_expired_sponsors()
returns integer
language plpgsql
security definer
as $$
declare
  v_deleted_count integer := 0;
  v_count integer;
begin
  -- 1. Remove expired water sponsors
  delete from public.water_sponsors
  where expires_at is not null and expires_at <= now();
  get diagnostics v_count = row_count;
  v_deleted_count := v_deleted_count + v_count;

  -- 2. Remove expired block sponsors
  delete from public.block_sponsors
  where expires_at is not null and expires_at <= now();
  get diagnostics v_count = row_count;
  v_deleted_count := v_deleted_count + v_count;

  -- 3. Also clean up legacy sponsor_bids table if present
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sponsor_bids') then
    delete from public.sponsor_bids
    where slot in ('water', 'block') and expires_at is not null and expires_at <= now();
  end if;

  return v_deleted_count;
end;
$$;

grant execute on function public.remove_expired_sponsors to anon, authenticated, service_role;

-- Automatic trigger to remove expired rows on any insert/activity
create or replace function public.trg_auto_cleanup_expired()
returns trigger
language plpgsql
security definer
as $$
begin
  perform public.remove_expired_sponsors();
  return NEW;
end;
$$;

drop trigger if exists trg_cleanup_water_expired on public.water_sponsors;
create trigger trg_cleanup_water_expired
before insert on public.water_sponsors
for each statement
execute function public.trg_auto_cleanup_expired();

drop trigger if exists trg_cleanup_block_expired on public.block_sponsors;
create trigger trg_cleanup_block_expired
before insert on public.block_sponsors
for each statement
execute function public.trg_auto_cleanup_expired();

-- ------------------------------------------------------------------------------
-- 6. UNIFIED COMPATIBILITY VIEW (Hides emails, exposes active sponsors to app)
-- ------------------------------------------------------------------------------
create or replace view public.active_sponsors_public as
select
  id,
  'sky'::text as slot,
  brand_name,
  tagline,
  website_url,
  accent_color,
  logo_url,
  bid_amount_cents,
  round((bid_amount_cents / 100.0), 2) as bid_amount_dollars,
  status,
  null::timestamptz as expires_at,
  created_at
from public.sky_billboard_sponsors
where status = 'active'

union all

select
  id,
  'water'::text as slot,
  brand_name,
  tagline,
  website_url,
  accent_color,
  logo_url,
  bid_amount_cents,
  round((bid_amount_cents / 100.0), 2) as bid_amount_dollars,
  status,
  expires_at,
  created_at
from public.water_sponsors
where status = 'active' and expires_at > now()

union all

select
  id,
  'block'::text as slot,
  brand_name,
  tagline,
  website_url,
  accent_color,
  logo_url,
  bid_amount_cents,
  round((bid_amount_cents / 100.0), 2) as bid_amount_dollars,
  status,
  expires_at,
  created_at
from public.block_sponsors
where status = 'active' and expires_at > now();

grant select on public.active_sponsors_public to anon, authenticated;

-- ------------------------------------------------------------------------------
-- 7. ENABLE SUPABASE REALTIME REPLICATION FOR ALL 4 TABLES
-- ------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'high_score_leaderboard') then
    alter publication supabase_realtime add table public.high_score_leaderboard;
  end if;

  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sky_billboard_sponsors') then
    alter publication supabase_realtime add table public.sky_billboard_sponsors;
  end if;

  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'water_sponsors') then
    alter publication supabase_realtime add table public.water_sponsors;
  end if;

  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'block_sponsors') then
    alter publication supabase_realtime add table public.block_sponsors;
  end if;
end;
$$;
