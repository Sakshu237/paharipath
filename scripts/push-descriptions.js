// scripts/push-descriptions.js
//
// Batch-pushes long-form destination descriptions straight into the
// destination_overrides table in Supabase — same table your admin
// dashboard's "Manage Destinations" edit form writes to, just skipping
// the UI so you can update many places in one run.
//
// USAGE:
//   1. Make sure SUPABASE_SERVICE_ROLE_KEY is set in your shell:
//        export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-from-vercel"
//      (same value as the Vercel env var of the same name)
//   2. Run:
//        node scripts/push-descriptions.js
//   3. It will print a per-place ✓/✗ result. Nothing is deployed —
//      changes are live immediately, same as an admin panel edit.
//
// SAFETY:
//   - Only touches the `description` field via upsert (on_conflict place_id),
//     exactly like adminSaveDest() does for built-in destinations (id < 1000).
//   - Does NOT touch name, district, altitude, vibes, etc. — untouched fields
//     are simply omitted from the payload.
//   - Re-running is safe: it's an upsert, so it just overwrites description.

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is not set in your environment.');
  console.error('   export SUPABASE_SERVICE_ROLE_KEY="..." then re-run.');
  process.exit(1);
}

// id -> new description. Add more entries here as you get more copy written.
const DESCRIPTIONS = {
  5: `Pundrik Rishi Lake sits at 3,100m in Himachal Pradesh's Sainj Valley, a glacial pool named for the sage said to have meditated on its banks. Unlike Manali's crowded alpine lakes, this one sees only a trickle of trekkers — the approach runs through Sainj Valley's deodar forest and terraced villages, with no road access and no fixed trail markers, so most visitors go with a local guide. The best window is May–June or September–October, when snowmelt clears the path but the monsoon hasn't turned it to mud. Camping overnight near the lake means genuine silence and unpolluted night skies. It pairs naturally with a Sainj Valley stay, since the valley itself is one of Kullu's least-visited corners despite sitting right next to the busier Tirthan.`,

  135: `Sainj Valley is the quiet cousin of neighboring Tirthan Valley — same Great Himalayan National Park foothills, same pine-and-apple landscape, a fraction of the tourists. Sitting around 1,600m in Kullu district, it's best visited April–June or September–November, when the weather is mild and the trails to Pundrik Rishi Lake are open. The valley's villages still run on Pahari rhythms: terraced farming, wood-and-stone houses, minimal signage for outsiders. There's no built-up tourist strip here — homestays are the main lodging option, run by local families rather than hotel chains. For travelers who found Tirthan too discovered, Sainj is what Tirthan looked like a decade ago.`,

  105: `Kaza is Spiti's administrative headquarters and the practical base for the entire valley — the last reliable ATM, market, and phone signal before the high villages. At 3,800m, altitude sickness is a real consideration, so most itineraries build in a rest day here before pushing higher to Kibber, Komic, or Langza. The town itself is functional rather than picturesque, but it's surrounded by some of the starkest cold-desert scenery in the Himalayas. Spiti is only accessible June to September; roads close with the first heavy snow. Most travelers reach Kaza via Manali over Kunzum Pass or the longer Shimla–Kinnaur route through Nako and Tabo — both routes are worth planning around rather than rushing.`,

  48: `Chandratal — the "Moon Lake" — sits at 4,300m near the Kunzum Pass, its crescent shape giving it the name. The water is glacier-fed and startlingly clear; on a still day you can see the lakebed several meters down. Camping is the standard way to experience it, since day-tripping doesn't do justice to the sunset-to-sunrise light change over the water, and the night sky here is one of the darkest accessible by road in India. It's open only July to September — the approach road is snowbound the rest of the year — and camping permits are required, arranged through the Spiti forest department or your camp operator. Altitude sickness risk is real at this elevation; acclimatizing in Kaza first is standard practice.`,

  106: `Key Monastery is Spiti's most recognizable landmark — a thousand-year-old Buddhist gompa stacked improbably against a cliff face at 4,166m, visible for kilometers before you reach it. It's still an active monastery with roughly 300 resident monks, not a museum, so visitors are welcome but expected to be respectful of prayer times and restricted areas. The best visiting window is June to September, matching Spiti's short accessible season. Inside are centuries-old murals and thangka paintings that have survived earthquakes and Spiti's brutal winters largely intact. It's a short drive from Kaza, making it an easy half-day addition to any Spiti itinerary, though the cliffside architecture rewards lingering rather than a quick photo stop.`,

  21: `Grahan is what Kasol was before it became a backpacker circuit — reached only by a 9km forest trek from the Kasol side of Parvati Valley, with no road access at all. At 2,800m, the walk climbs through dense pine and cannabis-lined forest before opening onto a small village that still runs almost entirely on subsistence farming. There's no cafe strip, no wifi cafes, none of Kasol's Israeli-backpacker infrastructure — just homestays run by the handful of families who live there. Best time is April–June or September–October, avoiding both winter snow and monsoon slides. For travelers who found Kasol's May–September crowds unbearable, Grahan is the same valley, the same mountains, minus the crowd entirely.`,

  29: `Sethan sits barely 20 minutes above Manali by road, but the shift in atmosphere is total — no tourist buses, no market noise, just a snowbound village at 2,700m looking down over the valley Manali occupies. Winter (December–February) brings genuinely deep snow and a handful of small guesthouses running informal ski and snowshoe trips; summer (June–September) trades snow for quiet meadow walks. Because it's so close to Manali, Sethan works well as either a day trip or a base for travelers who want Manali's access without Manali's density — most of the village's few hundred residents still farm apples and potatoes rather than run tourism operations full-time.`,

  35: `Barot is a genuine outlier on Himachal's offbeat map: no permit required, no high-altitude acclimatization needed, just a quiet river valley at 1,800m along the Uhl river in Mandi district. It's built around trout — both wild and farmed — with several trout hatcheries open to visitors and small operators offering rod-and-line fishing trips. The forest here is pine rather than Spiti's barren cold desert, so it reads as a completely different kind of offbeat: green, riverside, low-altitude, and open essentially year-round rather than restricted to a four-month window. Best time is May–June or September–October for clear water and comfortable trekking weather. For travelers priced out of Spiti's long drive and short season, Barot delivers the "no crowds, no infrastructure" feeling with a fraction of the logistics.`,

  // ---- Batch 2 ----

  1: `Pangi Valley is as remote as Himachal gets — a tribal valley on the Chenab river, cut off from the rest of the state for roughly eight months of the year once winter snow seals the Sach Pass access route. At 2,700m, the valley runs on its own rhythm: the Pangwal community here has a distinct language, dress, and way of life shaped by isolation, not tourism. Mobile signal is patchy to nonexistent through most of the valley, and there's no built tourist infrastructure — homestays with local families are the only realistic option. The short window to visit is June–September, when the Sach Pass road is open and the valley is accessible at all. This isn't an add-on to a Chamba trip; it's a destination for travelers who specifically want to go somewhere few outsiders ever see.`,

  2: `Pooh sits close enough to the Indo-China border that its remoteness isn't a marketing line — it's geography. At 2,840m in Kinnaur, the village has almost none of the tourist infrastructure found further down the valley in Sangla or Kalpa, but it does have centuries-old temples and a Kinnauri tribal culture that's stayed largely undisturbed by outside visitors. Best visited May–October, when the high-Kinnaur roads are clear. There's little in the way of formal sightseeing here — the draw is walking through a working village that tourism hasn't reshaped, with dramatic dry-mountain views typical of upper Kinnaur's rain-shadow landscape. Basic homestays are the only lodging; come with low expectations of comfort and high expectations of quiet.`,

  3: `Rasol is one of the harder villages to reach in Parvati Valley, which is exactly why it's stayed one of the quietest. There's no road — getting here means a trek from the Kasol side through pine forest, climbing to 2,900m before the village comes into view. Unlike Kasol or Tosh, Rasol has no cafe culture and minimal tourist footfall; it's a genuine mountain village where the silence is the main feature. Best time to go is May–June or September–October, avoiding both winter snow and monsoon-slick trails. It works well as a one- or two-night trek out of Kasol for travelers who want to see what the valley looked like before it became a backpacker circuit.`,

  4: `Karsog Valley is Mandi district's quietest secret — a low-altitude valley at 1,400m built around apple orchards and centered on the Mamleshwar Mahadev temple, one of the region's older Shiva shrines. Unlike Himachal's high-altitude offbeat spots, Karsog needs no acclimatization and no narrow seasonal window: March–June and September–November both work well, and even outside those months the valley is pleasant. The pace here is agricultural rather than touristic — orchard villages, temple visits, and roads with almost no other travelers on them. It's a realistic weekend option for anyone wanting genuine offbeat Himachal without the logistics of Spiti or Kinnaur.`,

  6: `Haripurdhar is a forested ridge in Sirmaur district that most Himachal itineraries skip entirely, which means you can walk it without meeting another traveler. At 2,100m, the ridge is thick with deodar forest and opens onto views over Renuka Lake below — a very different, greener kind of offbeat than the cold-desert valleys further north. Best time is April–June or September–November. There's minimal built infrastructure, so this is a trip for travelers comfortable with basic homestays and self-directed walking rather than marked trails and signage. It pairs naturally with a Renuka Lake visit, extending a fairly standard Sirmaur trip into genuinely offbeat territory.`,

  7: `Thachi Valley sits deep in Mandi district, an apple-orchard valley where the road turns to dirt track for long stretches and traditional Pahari villages haven't been reshaped by tourism. At 1,800m, it's accessible without acclimatization concerns, with a best-time window of April–June or September–October. There's no tourist strip here — homestays run by orchard-owning families are the standard lodging, and the appeal is straightforwardly the absence of anything touristic: no cafes, no souvenir stalls, just apple trees and mountain villages going about their normal year. It suits travelers looking for a low-key rural Himachal experience rather than a checklist of sights.`,

  8: `Sach Pass, at 4,390m, is one of the more demanding high-altitude crossings in Himachal — narrow switchback roads with drop-offs and patches of snow that can persist into July, connecting Chamba to the isolated Pangi Valley beyond. This is a route for experienced riders or travelers in a capable vehicle, not a casual scenic drive; conditions change fast and margin for error is genuinely thin. The pass is open only July–September. Its real function is as the gateway to Pangi — most travelers who cross Sach Pass are doing so specifically to reach Pangi's tribal villages on the far side, making the pass itself both a destination and a filter for how committed a traveler needs to be to get there.`,

  9: `Churdhar Peak, at 3,647m, is the highest point in the outer Himalayas and carries genuine spiritual weight — the Shirgul Maharaj temple sits right at the summit, and the trek up is as much pilgrimage as trek for many who make it. The climb typically starts from Nohradhar or Sarain in Sirmaur district, gaining significant altitude over a single push, so reasonable fitness matters. Best time is May–June or September–October, avoiding monsoon slides and winter snow. Unlike more commercialized trek routes elsewhere in Himachal, Churdhar sees a modest, mostly domestic pilgrim and trekker crowd rather than backpacker tourism, and the summit views across the Sirmaur and Shimla hills are the payoff for a demanding day.`,

  10: `Ribba is a Kinnauri village known locally for something few visitors expect from Himachal: grape wine, made from vineyards that thrive in Kinnaur's dry mountain climate at 2,700m. It's a village that runs on its own traditional Kinnauri culture — distinct architecture, dress, and customs — with essentially no tourist infrastructure built around it. Best time to visit is August–October, which lines up with the grape harvest season and gives the best chance to see the vineyards in their most active state. There's no formal wine-tasting setup; this is a village to walk through and talk to people in, not a vineyard-tour destination in the commercial sense.`,

  11: `Kalga sits above Pulga in Parvati Valley and is, by most accounts, the quietest inhabited point in that whole stretch — forest, mountain views, and birdsong replacing the cafe noise of Kasol further down the valley. At 2,500m, it's reached by a short trek from the road-end near Barshaini, with a best-time window of April–June or September–October. Homestays here are genuinely small-scale, run by the handful of families living in the village, and there's little to "do" in the conventional sense — the point is slow mornings and forest walks rather than an activity checklist. For travelers who found even Tosh too built-up, Kalga is the next step further in.`,

  12: `Bhaba Valley is widely considered Kinnaur's greenest corner, a striking contrast to the dry, rocky landscape most of Kinnaur is known for. At 2,700m, it's best known as the starting point for the Bhaba Pass trek, a multi-day route that eventually crosses over into Pin Valley in Spiti — connecting two very different landscapes on foot. Best time is June–September, matching the trekking season. Even for travelers not attempting the full pass crossing, the lower valley itself is worth a visit for its unusually lush meadows and forest, a side of Kinnaur that photos of Kalpa and Sangla don't usually show.`,

  13: `Khab marks the point where the Spiti River meets the Sutlej, and the landscape shift is immediate and dramatic — green Kinnaur giving way abruptly to the barren, cold-desert terrain that defines Spiti further upstream. At 2,000m, it's more a striking waypoint than a destination with its own infrastructure; most travelers see it while driving the Kinnaur–Spiti road rather than stopping to stay. Best time is May–October, matching the road's open season. It's worth building a deliberate stop into an itinerary here rather than passing through — the confluence and the sudden change in terrain are among the more visually dramatic single moments on the whole Kinnaur-to-Spiti route.`,
};

async function main() {
  const svcHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  const entries = Object.entries(DESCRIPTIONS);
  console.log(`Pushing ${entries.length} descriptions to destination_overrides...\n`);

  let ok = 0, fail = 0;
  for (const [id, description] of entries) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/destination_overrides?on_conflict=place_id`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        place_id: parseInt(id),
        description,
        updated_at: new Date().toISOString(),
      }),
    });

    if (res.ok) {
      console.log(`✓ id ${id}`);
      ok++;
    } else {
      const err = await res.text();
      console.error(`✗ id ${id} — ${err}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} updated, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main();
