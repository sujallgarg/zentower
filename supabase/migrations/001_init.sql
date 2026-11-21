-- ==============================================================================
-- STACK & BALANCE: ZEN TOWERS — PRODUCTION SUPABASE MIGRATION
-- Idempotent setup for Leaderboard, Sponsor Bids, RLS & Storage Buckets
-- ==============================================================================

-- 1. Enable required extensions
create extension if not exists "pgcrypto";

-- 2. Leaderboard Entries Table
create table if not exists public.leaderboard_entries (
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

-- Unique index per player per daily seed / endless mode
create unique index if not exists idx_leaderboard_unique_player 
  on public.leaderboard_entries (player_id, mode, coalesce(daily_day_number, 0));

-- Fast indexes for leaderboard querying
create index if not exists idx_leaderboard_daily 
  on public.leaderboard_entries (daily_day_number, peak_height desc, balanced_count desc) 
  where mode = 'daily';

create index if not exists idx_leaderboard_endless 
  on public.leaderboard_entries (peak_height desc, balanced_count desc) 
  where mode = 'endless';

-- Enable Row Level Security (RLS)
alter table public.leaderboard_entries enable row level security;

-- Public read access
drop policy if exists "Allow public select on leaderboard_entries" on public.leaderboard_entries;
create policy "Allow public select on leaderboard_entries"
  on public.leaderboard_entries
  for select
  using (true);

-- RPC for secure score submission with bounds validation
create or replace function public.submit_high_score(
  p_player_id text,
  p_tag varchar(3),
  p_x_handle text,
  p_mode text,
  p_daily_day_number integer,
  p_peak_height numeric,
  p_balanced_count integer,
  p_max_tilt_deg numeric
) returns public.leaderboard_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean_tag varchar(3);
  v_clean_x text;
  v_result public.leaderboard_entries;
begin
  -- Sanity checks: reject physically impossible or spoofed inputs
  if p_player_id is null or length(trim(p_player_id)) < 3 then
    raise exception 'Invalid player_id';
  end if;
  if p_mode not in ('daily', 'endless') then
    raise exception 'Invalid game mode';
  end if;
  if p_peak_height < 0 or p_peak_height > 500 then
    raise exception 'peak_height outside allowed bounds (0 - 500m)';
  end if;
  if p_balanced_count < 0 or p_balanced_count > 500 then
    raise exception 'balanced_count outside allowed bounds (0 - 500)';
  end if;

  -- Sanitize 3-letter arcade tag
  v_clean_tag := upper(regexp_replace(coalesce(p_tag, 'ZEN'), '[^a-zA-Z0-9]', '', 'g'));
  if length(v_clean_tag) < 3 then
    v_clean_tag := rpad(v_clean_tag, 3, 'X');
  end if;
  v_clean_tag := substr(v_clean_tag, 1, 3);

  -- Sanitize optional X handle
  v_clean_x := nullif(trim(regexp_replace(coalesce(p_x_handle, ''), '^@+', '')), '');
  if v_clean_x is not null then
    v_clean_x := regexp_replace(v_clean_x, '[^a-zA-Z0-9_]', '', 'g');
    if length(v_clean_x) > 20 then
      v_clean_x := substr(v_clean_x, 1, 20);
    end if;
  end if;

  insert into public.leaderboard_entries (
    player_id, tag, x_handle, mode, daily_day_number, peak_height, balanced_count, max_tilt_deg, updated_at
  ) values (
    p_player_id, v_clean_tag, v_clean_x, p_mode, p_daily_day_number, p_peak_height, p_balanced_count, p_max_tilt_deg, now()
  )
  on conflict (player_id, mode, coalesce(daily_day_number, 0)) do update
  set
    tag = excluded.tag,
    x_handle = excluded.x_handle,
    peak_height = greatest(public.leaderboard_entries.peak_height, excluded.peak_height),
    balanced_count = greatest(public.leaderboard_entries.balanced_count, excluded.balanced_count),
    max_tilt_deg = greatest(public.leaderboard_entries.max_tilt_deg, excluded.max_tilt_deg),
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.submit_high_score to anon, authenticated;

-- 3. Sponsor Bids Table
create table if not exists public.sponsor_bids (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot in ('block', 'sky', 'water')),
  brand_name varchar(24) not null,
  tagline varchar(36) not null,
  accent_color varchar(7) not null,
  logo_url text,
  bid_amount_cents integer not null check (bid_amount_cents >= 200), -- minimum opening floor (sky: $2.00, water: $5.00, block: $9.00)
  contact_email text not null,
  dodo_payment_id text unique,
  stripe_session_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Idempotent column addition in case table already exists
do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'sponsor_bids' and column_name = 'dodo_payment_id'
  ) then
    alter table public.sponsor_bids add column dodo_payment_id text unique;
  end if;
end;
$$;

create index if not exists idx_sponsor_bids_status_slot 
  on public.sponsor_bids (status, slot, bid_amount_cents desc);

create index if not exists idx_sponsor_bids_dodo_id 
  on public.sponsor_bids (dodo_payment_id) where dodo_payment_id is not null;

alter table public.sponsor_bids enable row level security;

-- Only service role can directly write to sponsor_bids table
drop policy if exists "Service role full access on sponsor_bids" on public.sponsor_bids;
create policy "Service role full access on sponsor_bids"
  on public.sponsor_bids
  for all
  using (auth.role() = 'service_role');

-- Strictly Increasing Auction Floor Trigger:
-- Once bid, nobody can ever bid that same price or lower again (strictly >= current highest + $1.00)
create or replace function public.validate_sponsor_bid_floor()
returns trigger
language plpgsql
security definer
as $$
declare
  v_current_max integer;
  v_min_floor integer;
begin
  select coalesce(max(bid_amount_cents), 0)
  into v_current_max
  from public.sponsor_bids
  where slot = NEW.slot
    and status = 'paid'
    and (expires_at is null or expires_at > now());

  if v_current_max > 0 then
    v_min_floor := v_current_max + 100;
  else
    v_min_floor := 200; -- All slots start at $2.00 opening floor
  end if;

  if NEW.bid_amount_cents < v_min_floor then
    raise exception 'Bid of % cents does not meet strictly increasing floor of % cents for slot %',
      NEW.bid_amount_cents, v_min_floor, NEW.slot;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_validate_sponsor_bid_floor on public.sponsor_bids;
create trigger trg_validate_sponsor_bid_floor
before insert on public.sponsor_bids
for each row
execute function public.validate_sponsor_bid_floor();

-- 4. Public Safe View for Active Sponsors (Hides contact_email)
create or replace view public.active_sponsors_public as
select
  id,
  slot,
  brand_name,
  tagline,
  accent_color,
  logo_url,
  bid_amount_cents,
  round((bid_amount_cents / 100.0), 2) as bid_amount_dollars,
  status,
  expires_at,
  created_at
from public.sponsor_bids
where status = 'paid' 
  and (expires_at is null or expires_at > now())
order by bid_amount_cents desc;

grant select on public.active_sponsors_public to anon, authenticated;

-- 5. Supabase Storage: sponsor-logos bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sponsor-logos',
  'sponsor-logos',
  true,
  1048576, -- 1MB
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set 
  public = true,
  file_size_limit = 1048576,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

drop policy if exists "Public read on sponsor-logos" on storage.objects;
create policy "Public read on sponsor-logos"
  on storage.objects for select
  using (bucket_id = 'sponsor-logos');

drop policy if exists "Public upload on sponsor-logos" on storage.objects;
create policy "Public upload on sponsor-logos"
  on storage.objects for insert
  with check (bucket_id = 'sponsor-logos');

-- 6. Enable Realtime Publications
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sponsor_bids'
  ) then
    alter publication supabase_realtime add table public.sponsor_bids;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leaderboard_entries'
  ) then
    alter publication supabase_realtime add table public.leaderboard_entries;
  end if;
end;
$$;
