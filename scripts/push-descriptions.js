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
