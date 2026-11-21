-- PahariPath: anonymous trip-planning log (no names, phones, emails or exact location).
-- Paste into Supabase → SQL Editor → Run once.
create table if not exists public.trip_intents (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  source text not null check (source in ('suggest','plan','itinerary','transport','second-stop')),
  place_id int,
  place_name text check (char_length(place_name) <= 80),
  zone text check (char_length(zone) <= 40),
  origin text check (char_length(origin) <= 60),
  transport text check (transport in ('car','bike','bus','taxi')),
  start_date date,
  nights int check (nights between 1 and 30),
  who text check (who in ('couple','family','friends','solo'))
);
alter table public.trip_intents enable row level security;

drop policy if exists "anyone can log a trip choice" on public.trip_intents;
create policy "anyone can log a trip choice" on public.trip_intents
  for insert to anon, authenticated with check (true);

drop policy if exists "admin reads trip choices" on public.trip_intents;
create policy "admin reads trip choices" on public.trip_intents
  for select to authenticated using (public.is_admin());

-- ── Useful reports (run any time) ──────────────────────────────────────
-- Where people plan to go, and how they travel (last 90 days):
-- select zone, place_name, transport, count(*) from trip_intents
--  where created_at > now() - interval '90 days' and source in ('plan','itinerary')
--  group by 1,2,3 order by 4 desc;
--
-- Rental shop: valleys with the most bus/taxi travellers (they have no vehicle of their own):
-- select zone, count(*) filter (where transport in ('bus','taxi')) as no_own_vehicle,
--        count(*) filter (where transport = 'bike') as bikers, count(*) as all_trips
--   from trip_intents where created_at > now() - interval '90 days'
--  group by zone order by no_own_vehicle desc;
--
-- Which cities they come from:
-- select origin, transport, count(*) from trip_intents group by 1,2 order by 3 desc;
