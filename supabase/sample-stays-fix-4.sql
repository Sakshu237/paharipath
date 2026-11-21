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
select id, name, status from stays where id = 4;
