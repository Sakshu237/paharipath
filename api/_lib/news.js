// /api/_lib/news.js
// Pulls recent Himachal travel headlines from Google News RSS (English +
// Hindi), and tags each one with:
//   kinds : rush | snowfall | closure | weather | event
//   zones : PahariPath zone ids the headline mentions (kullu, parvati, …)
// The browser (crowd-predict.js) turns these into crowd adjustments.
//
// Free, no API key. Only headline, link, source and time are passed on —
// the article itself is never copied; travellers click through to read it.
// Lives in _lib so it does NOT count toward Vercel's 12-function cap.

const FEEDS = [
  'https://news.google.com/rss/search?q=' + encodeURIComponent(
    'Himachal (tourists OR "tourist rush" OR "traffic jam" OR snowfall OR landslide OR "road closed" OR "roads closed" OR "red alert" OR "orange alert" OR festival OR mela) when:3d'
  ) + '&hl=en-IN&gl=IN&ceid=IN:en',
  'https://news.google.com/rss/search?q=' + encodeURIComponent(
    'हिमाचल (पर्यटक OR सैलानी OR जाम OR बर्फबारी OR भूस्खलन OR "सड़क बंद" OR अलर्ट OR मेला) when:3d'
  ) + '&hl=hi&gl=IN&ceid=IN:hi',
];

// Place/area words → zone id used in places.json.
// cs: true = case-sensitive (words that are also common nouns: "Mandi"
// = market, "Una", "Bir")
const ZONE_WORDS = {
  kullu: ['manali', 'kullu', 'solang', 'rohtang', 'atal tunnel', 'vashisht', 'naggar', 'bhuntar', 'hamta', 'मनाली', 'कुल्लू', 'रोहतांग', 'अटल टनल', 'सोलंग'],
  parvati: ['kasol', 'manikaran', 'tosh', 'kheerganga', 'malana', 'parvati valley', 'कसोल', 'मणिकर्ण'],
  tirthan: ['tirthan', 'jibhi', 'jalori', 'banjar', 'shoja', 'gushaini', 'जिभी', 'जलोड़ी', 'बंजार', 'तीर्थन'],
  lahaul: ['lahaul', 'keylong', 'sissu', 'darcha', 'sarchu', 'लाहौल', 'सिस्सू', 'केलांग'],
  spiti: ['spiti', 'kaza', 'kunzum', 'chandratal', 'स्पीति', 'काजा'],
  kinnaur: ['kinnaur', 'sangla', 'chitkul', 'kalpa', 'reckong peo', 'nako', 'किन्नौर', 'सांगला', 'छितकुल'],
  shimla: ['shimla', 'kufri', 'narkanda', 'mashobra', 'theog', 'rampur', 'शिमला', 'कुफरी', 'नारकंडा'],
  solan: ['solan', 'kasauli', 'chail', 'parwanoo', 'सोलन', 'कसौली', 'चायल'],
  sirmaur: ['sirmaur', 'nahan', 'renuka', 'paonta', 'churdhar', 'सिरमौर', 'नाहन', 'रेणुका'],
  kangra: ['kangra', 'dharamshala', 'dharamsala', 'mcleodganj', 'mcleod ganj', 'palampur', 'triund', 'bhagsu', 'billing', 'कांगड़ा', 'धर्मशाला', 'मैक्लोडगंज', 'पालमपुर'],
  chamba: ['chamba', 'dalhousie', 'khajjiar', 'bharmour', 'manimahesh', 'pangi', 'चंबा', 'डलहौजी', 'खज्जियार', 'मणिमहेश', 'भरमौर'],
  mandi: ['rewalsar', 'prashar', 'barot', 'janjheli', 'karsog', 'पराशर', 'रिवालसर'],
  bilaspur: ['bilaspur', 'naina devi', 'बिलासपुर', 'नैना देवी'],
  hamirpur: ['hamirpur', 'baba balak nath', 'deotsidh', 'sujanpur', 'हमीरपुर', 'बाबा बालक नाथ'],
  una: ['chintpurni', 'चिंतपूर्णी'],
};
const ZONE_WORDS_CS = { mandi: ['Mandi'], una: ['Una'], kangra: ['Bir'] };

// What the headline is about. First list = English (word-ish match),
// Hindi words matched as plain substrings.
const KIND_WORDS = {
  closure: ['road closed', 'roads closed', 'closed for traffic', 'blocked', 'landslide', 'cloudburst', 'flash flood', 'stranded', 'shut', 'suspended',
            'सड़क बंद', 'सड़कें बंद', 'बंद', 'भूस्खलन', 'फंसे', 'बादल फटा', 'अवरुद्ध'],
  weather: ['red alert', 'orange alert', 'yellow alert', 'heavy rain', 'rain alert', 'weather alert', 'imd warns', 'cold wave',
            'रेड अलर्ट', 'ऑरेंज अलर्ट', 'अलर्ट', 'भारी बारिश', 'शीतलहर'],
  snowfall: ['snowfall', 'fresh snow', 'snow', 'बर्फबारी', 'हिमपात', 'बर्फ'],
  rush: ['tourist rush', 'rush', 'traffic jam', 'jam', 'jam-packed', 'packed', 'flock', 'crowd', 'swarm', 'hotels full', 'occupancy', 'footfall', 'influx', 'long weekend',
         'पर्यटकों की भीड़', 'भीड़', 'जाम', 'सैलानियों', 'पर्यटकों', 'ऑक्यूपेंसी'],
  event: ['festival', 'mela', 'fair', 'carnival', 'utsav', 'dussehra', 'shivratri', 'मेला', 'उत्सव', 'दशहरा', 'शिवरात्रि', 'कार्निवल'],
};
// headlines that say a road REOPENED are not closures
const ENDED = /\b(conclud\w*|conclusion|ends|ended|culminat\w*|wraps up|comes to an end)\b|समापन|संपन्न|समाप्त/i;
const REOPEN = /\b(reopen|reopened|restored|resumes?|cleared)\b|बहाल|खुल/i;

const decode = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };

function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const raw = m[1];
    let title = tag(raw, 'title');
    const source = tag(raw, 'source');
    // Google appends " - Source Name" to every title
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    items.push({ title, url: tag(raw, 'link'), source, publishedAt: new Date(tag(raw, 'pubDate')).toISOString() });
  }
  return items;
}

const escRe = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, w) => /[^\x00-\x7F]/.test(w)
  ? text.includes(w)
  : new RegExp(`(^|[^a-z])${escRe(w)}(s|es|ed|ing)?([^a-z]|$)`, 'i').test(text); // jams, crowds, flocking…

function classify(item) {
  const t = item.title;
  const zones = new Set();
  for (const [z, words] of Object.entries(ZONE_WORDS)) if (words.some(w => hasWord(t, w))) zones.add(z);
  for (const [z, words] of Object.entries(ZONE_WORDS_CS)) if (words.some(w => new RegExp(`\\b${w}\\b`).test(t))) zones.add(z);

  const kinds = [];
  for (const [k, words] of Object.entries(KIND_WORDS)) if (words.some(w => hasWord(t, w))) kinds.push(k);
  let k2 = kinds;
  if (REOPEN.test(t)) k2 = k2.filter(k => k !== 'closure');
  // a festival that has ENDED doesn't bring more crowd
  if (ENDED.test(t)) k2 = k2.filter(k => k !== 'event');
  // "jam" from a landslide is a closure story, not a tourist rush
  if (k2.includes('closure') && k2.includes('rush') && !/tourist|पर्यटक|सैलानी|weekend/i.test(t)) k2 = k2.filter(k => k !== 'rush');
  return { ...item, zones: [...zones], kinds: k2 };
}

async function fetchFeed(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PahariPathCrowdBot/1.0; +https://paharipath.in)' } });
    if (!r.ok) return [];
    return parseRss(await r.text());
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function getCrowdNews() {
  const results = await Promise.all(FEEDS.map(fetchFeed));
  const cutoff = Date.now() - 80 * 3600 * 1000;
  const seen = new Set();
  const out = [];
  for (const it of results.flat()) {
    if (!it.title || !it.url) continue;
    const ts = new Date(it.publishedAt).getTime();
    if (!ts || ts < cutoff) continue;
    const key = it.title.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classify(it);
    // only keep headlines that are about a place we cover AND say something useful
    if (!c.zones.length || !c.kinds.length) continue;
    out.push(c);
  }
  out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return out.slice(0, 40);
}

module.exports = { getCrowdNews, parseRss, classify };
