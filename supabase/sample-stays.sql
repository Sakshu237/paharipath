-- PahariPath: turn placeholder stays 1–10 into labelled SAMPLE listings.
-- Paste into Supabase → SQL Editor → Run. Safe to re-run. Only touches stays with no host attached.
begin;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Tirthan River Cottage', loc='Gushaini, Tirthan Valley', type='Eco Cottage', pn=2400, price='₹2,400/night',
  rooms=3, max_guests=8, checkin_time='12:00', checkout_time='10:00',
  eco=true,
  description='A wood-and-stone cottage a two-minute walk from the Tirthan river, inside the buffer zone of the Great Himalayan National Park. Rooms open onto a shared verandah facing the water. Home-cooked Himachali meals (siddu, rajmah-chawal, trout on request) are served in the family kitchen. Nearby: Chhoie waterfall, Serolsar lake trek, GHNP day walks.',
  house_rules='Quiet hours after 10 PM. No loud music by the river. Carry your plastic back. Fishing only with a permit.'
where id=1 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Spiti Homestay by Lobzang', loc='Kaza, Spiti Valley', type='Homestay', pn=1500, price='₹1,500/night',
  rooms=4, max_guests=10, checkin_time='12:00', checkout_time='10:00',
  eco=true,
  description='A traditional mud-brick Spitian home on the edge of Kaza, run by a local family. Thick walls keep rooms warm on cold nights. Breakfast and dinner are included: thukpa, momos, butter tea. Good base for Key monastery, Kibber, Langza and Hikkim.',
  house_rules='Rest a day on arrival to adjust to altitude. Water is scarce, so please keep showers short. Remove shoes inside. No alcohol in common areas.'
where id=2 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Parvati Pine Camp', loc='Tosh, Parvati Valley', type='Camp', pn=1200, price='₹1,200/night',
  rooms=5, max_guests=12, checkin_time='13:00', checkout_time='11:00',
  eco=true,
  description='Insulated Swiss tents on terraced fields under deodar trees above Tosh village, with shared clean bathrooms and a dining hut. Open April to October. Short walk to Tosh glacier viewpoint; a good stop before Kheerganga.',
  house_rules='Bonfire only in the fire pit and only with the caretaker. No drugs. Quiet hours after 10:30 PM. Respect village temples and customs.'
where id=3 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Bir Tea Garden Bungalow', loc='Bir, Kangra', type='Homestay', pn=2800, price='₹2,800/night',
  rooms=3, max_guests=7, checkin_time='12:00', checkout_time='10:00',
  eco=false,
  description='An old family bungalow next to the tea gardens of Chougan, a short walk from the Bir landing site and the Tibetan colony. Fast WiFi and a garden desk make it good for remote work. Tea tasting with the family, monastery walks, paragliding season September to November.',
  house_rules='No smoking inside. Guests booking paragliding should do so only with registered operators. Check-in after 9 PM by prior message only.'
where id=4 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Jibhi Forest House', loc='Jibhi, Banjar Valley', type='Wooden House', pn=2200, price='₹2,200/night',
  rooms=2, max_guests=6, checkin_time='12:00', checkout_time='10:00',
  eco=true,
  description='A kath-kuni wooden house on the slope above Jibhi stream, with a sit-out over the forest. Upstairs rooms have pine ceilings and wood stoves in winter. Walk to Jibhi waterfall; drive to Jalori Pass and the Serolsar lake trail.',
  house_rules='Wood stoves are lit by the host only. Quiet after 10 PM. Pets allowed with prior request.'
where id=5 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Chitkul Apple Homestay', loc='Chitkul, Kinnaur', type='Homestay', pn=1800, price='₹1,800/night',
  rooms=3, max_guests=8, checkin_time='12:00', checkout_time='10:00',
  eco=true,
  description='A Kinnauri family home among apple orchards in the last village on the old Hindustan–Tibet road. Wake up to the Baspa river and snow peaks. Fresh apples in season (August to October) and Kinnauri rajma for dinner.',
  house_rules='Chitkul is very cold at night, so carry warm layers. Do not pick apples from the orchard without asking. Inner Line rules apply beyond Chitkul.'
where id=6 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Dalhousie Colonial Inn', loc='Dalhousie, Chamba', type='Heritage Stay', pn=2600, price='₹2,600/night',
  rooms=4, max_guests=10, checkin_time='13:00', checkout_time='11:00',
  eco=false,
  description='A restored British-era cottage on a quiet lane away from the Mall Road crowds, with fireplaces, wooden floors and a lawn facing the Pir Panjal. Walks to Dainkund peak and Ganji Pahadi.',
  house_rules='No smoking in rooms. Fireplace lit on request. Quiet hours after 10 PM.'
where id=7 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Shangarh Meadow Camp', loc='Shangarh, Sainj Valley', type='Homestay', pn=1600, price='₹1,600/night',
  rooms=3, max_guests=8, checkin_time='12:00', checkout_time='10:00',
  eco=true,
  description='A village homestay at the edge of the Shangarh meadow, one of the most open grasslands in Kullu. Simple clean rooms, local dham-style meals and evening walks to the Shangchul Mahadev temple.',
  house_rules='Shoes and leather are not allowed in the meadow temple area. No camping on the meadow. Carry your waste back.'
where id=8 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Khajjiar Deodar Lodge', loc='Khajjiar, Chamba', type='Homestay', pn=2000, price='₹2,000/night',
  rooms=3, max_guests=8, checkin_time='12:00', checkout_time='10:00',
  eco=false,
  description='A family-run lodge in the deodar forest a short walk from Khajjiar lake and meadow. Early mornings here are quiet before day-trippers arrive. Kalatop wildlife sanctuary walks nearby.',
  house_rules='Quiet hours after 10 PM. No feeding wildlife. Late check-in by prior message only.'
where id=9 and host_email is null;
update stays set status='demo', verified=false, rating=null, contact='9317110366',
  name='Barot Trout Farm Stay', loc='Barot, Mandi', type='Farm Stay', pn=1400, price='₹1,400/night',
  rooms=2, max_guests=6, checkin_time='12:00', checkout_time='10:00',
  eco=true,
  description='A farmhouse beside the Uhl river, next to a small trout farm run by the family. Fresh trout dinners, river walks and the old Shanan haulage trolley line nearby. Gateway to Nargu wildlife sanctuary and the Rajgundha trek.',
  house_rules='Fishing only with a permit. Children near the river must be with an adult. Quiet after 10 PM.'
where id=10 and host_email is null;
do $$
declare t text;
begin
  select udt_name into t from information_schema.columns where table_schema='public' and table_name='stays' and column_name='amenities';
  execute format('update stays set amenities = %L::%s where id = 1 and host_email is null', case when t in ('jsonb','json') then '["Hot Water", "Bonfire", "Mountain View", "Attached Bathroom", "Parking", "Power Backup"]' else '{"Hot Water","Bonfire","Mountain View","Attached Bathroom","Parking","Power Backup"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 2 and host_email is null', case when t in ('jsonb','json') then '["Hot Water", "Mountain View", "Kitchen Access", "Power Backup"]' else '{"Hot Water","Mountain View","Kitchen Access","Power Backup"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 3 and host_email is null', case when t in ('jsonb','json') then '["Bonfire", "Mountain View", "Hot Water", "Parking"]' else '{"Bonfire","Mountain View","Hot Water","Parking"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 4 and host_email is null', case when t in ('jsonb','json') then '["WiFi", "Hot Water", "Mountain View", "Attached Bathroom", "Parking", "Power Backup"]' else '{"WiFi","Hot Water","Mountain View","Attached Bathroom","Parking","Power Backup"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 5 and host_email is null', case when t in ('jsonb','json') then '["Hot Water", "Bonfire", "Mountain View", "Attached Bathroom", "Kitchen Access"]' else '{"Hot Water","Bonfire","Mountain View","Attached Bathroom","Kitchen Access"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 6 and host_email is null', case when t in ('jsonb','json') then '["Hot Water", "Mountain View", "Power Backup", "Parking"]' else '{"Hot Water","Mountain View","Power Backup","Parking"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 7 and host_email is null', case when t in ('jsonb','json') then '["WiFi", "Hot Water", "Mountain View", "Attached Bathroom", "Parking", "Power Backup"]' else '{"WiFi","Hot Water","Mountain View","Attached Bathroom","Parking","Power Backup"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 8 and host_email is null', case when t in ('jsonb','json') then '["Hot Water", "Bonfire", "Mountain View", "Parking"]' else '{"Hot Water","Bonfire","Mountain View","Parking"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 9 and host_email is null', case when t in ('jsonb','json') then '["Hot Water", "Mountain View", "Attached Bathroom", "Parking", "Power Backup"]' else '{"Hot Water","Mountain View","Attached Bathroom","Parking","Power Backup"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
  execute format('update stays set amenities = %L::%s where id = 10 and host_email is null', case when t in ('jsonb','json') then '["Hot Water", "Bonfire", "Mountain View", "Kitchen Access", "Parking"]' else '{"Hot Water","Bonfire","Mountain View","Kitchen Access","Parking"}' end, case when t in ('jsonb','json') then t else 'text[]' end);
end $$;
commit;

-- Check: should list 10 rows with status 'demo'.
select id, name, status, amenities from stays where status='demo' order by id;
select count(*) as visible_on_public_view from public_stays where status='demo';
