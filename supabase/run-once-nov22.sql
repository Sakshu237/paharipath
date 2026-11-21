-- PahariPath — run this ONCE in Supabase → SQL Editor. Safe to re-run.
-- 1) Stay 4 (Bir) sample fix  2) Stay 11 (Kasauli) becomes a sample  3) Anonymous trip log table

-- Stay 4 (Bir Tea Garden Bungalow) was skipped because its host_email is blank text, not empty.
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Bir Tea Garden Bungalow', loc='Bir, Kangra', type='Homestay', pn=2800, price='₹2,800/night',
  rooms=3, max_guests=7, checkin_time='12:00', checkout_time='10:00', eco=false,
  description='An old family bungalow next to the tea gardens of Chougan, a short walk from the Bir landing site and the Tibetan colony. Fast WiFi and a garden desk make it good for remote work. Tea tasting with the family, monastery walks, paragliding season September to November.',
  house_rules='No smoking inside. Guests booking paragliding should do so only with registered operators. Check-in after 9 PM by prior message only.'
where id=4 and coalesce(trim(host_email),'')='';
do $$
declare t text;
begin
  select udt_name into t from information_schema.columns where table_schema='public' and table_name='stays' and column_name='amenities';
  if t in ('jsonb','json') then
    execute format('update stays set amenities = %L::%s where id = 4', '["WiFi","Hot Water","Mountain View","Attached Bathroom","Parking","Power Backup"]', t);
  else
    update stays set amenities = '{"WiFi","Hot Water","Mountain View","Attached Bathroom","Parking","Power Backup"}'::text[] where id = 4;
  end if;
end $$;

-- Stay 11 (Kasauli): was an unlabelled placeholder with a made-up 4.7 rating. Now a labelled sample like the others.
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Kasauli Heritage Bungalow', loc='Kasauli, Solan', type='Heritage Stay', pn=3000, price='₹3,000/night',
  rooms=3, max_guests=8, checkin_time='13:00', checkout_time='11:00', eco=false,
  description='A stone-and-timber bungalow from the cantonment days on a pine-covered lane below Kasauli''s Upper Mall, away from the weekend crowd. Verandah with views over the plains on clear nights. Walks to Monkey Point, Christ Church and the Gilbert Trail.',
  house_rules='No smoking indoors. Quiet hours after 10 PM. Cantonment rules apply on the roads above the house.'
where id=11 and coalesce(trim(host_email),'')='';
do $$
declare t text;
begin
  select udt_name into t from information_schema.columns where table_schema='public' and table_name='stays' and column_name='amenities';
  if t in ('jsonb','json') then
    execute format('update stays set amenities = %L::%s where id = 11', '["WiFi","Hot Water","Mountain View","Attached Bathroom","Parking"]', t);
  else
    update stays set amenities = '{"WiFi","Hot Water","Mountain View","Attached Bathroom","Parking"}'::text[] where id = 11;
  end if;
end $$;

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

-- Check: should show 11 sample stays, and the trip log table ready (0 rows is fine).
select count(*) as sample_stays from public_stays where status='demo';
select count(*) as trip_log_rows from trip_intents;
