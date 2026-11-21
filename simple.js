/*!
 * PahariPath — simplified app shell
 * ------------------------------------------------------------------
 * One short screen per job instead of one very long page:
 *   Home · Explore · Crowd · Plan · Saved   (bottom tabs on phones, top links on desktop)
 * A "Going:" date bar drives every crowd level, the snow line and the plan.
 * A "From:" city drives travel times (trip-finder.js engine).
 *
 * Reuses everything that already works in app.js and friends:
 *   ALL, MEDIA, openPD, closePD, getSaved, saveSaved, toast, selectPlanPlace, runFC,
 *   initMap, PP_CROWD (crowd-predict.js), PPTrip (trip-finder.js), PPSnow (snow-finder.js).
 * Old home sections stay in the page (their code still runs) and are shown
 * only on their own tab: Plan → #plansec, Map → #mapwrap, Stays → #stays-bg.
 *
 * Load AFTER app.js, trip-finder.js and snow-finder.js.
 */
/* global ALL, MEDIA, openPD, closePD, getSaved, saveSaved, toast, selectPlanPlace, runFC, initMap, _lmap, renderAll, goTo */
(function () {
  'use strict';

  // FREEZE (Nov 2026): no real host partners or bookings yet, so booking, stays listings,
  // traveller login / PAHADI profile and "manage booking" are hidden. Code stays; flip to false to bring them back.
  var FREEZE = true;

  var WA_NUMBER = '919317110366'; // PahariPath support WhatsApp (same as Help & Support)

  /* ---------------- text (English / Hindi) ---------------- */
  var T = {
    en: {
      going: 'Going:', from: 'From', today: 'Today', weekend: 'This weekend', nextWeekend: 'Next weekend', pick: 'Pick date',
      h1a: 'Same Himachal.', h1b: 'Without the crowd.',
      kicker: 'Responsible travel · Himachal',
      newHere: 'New here? Here’s how it works', how1: 'Pick when you’re going', how2: 'See how busy each place will be', how3: 'Go where it’s quiet, stay with locals', gotIt: 'Got it',
      regionsT: 'Explore Himachal by region', regionsS: 'First time? Start with a region that fits your days.', goodFor: 'Good for', seeRegion: 'See places',
      monthT: function (m) { return 'Himachal in ' + m; }, tipsT: 'First trip to Himachal?', tipsS: 'Six things worth knowing before you go.',
      regionOn: 'Region:', clearRegion: 'Show all regions',
      motto: 'We don’t send you where everyone goes. We show you quiet, lesser-known places — and help you visit them gently.',
      findBtn: 'Find my quiet place', findSub: '2 quick questions · we suggest, you choose', whenGoing: 'When are you going?', browseAll: 'Or browse all 146 places',
      swapT: 'Skip the rush', swapS: 'Heading somewhere famous? Its quiet neighbour is right there.', insteadOf: 'Instead of', busy: 'busy',
      pledgeT: 'Travel light on the hills', pl1: 'Stay with local families, eat at local dhabas', pl2: 'Carry your plastic back down', pl3: 'Respect village and temple customs', pl4: 'Go on weekdays when you can',
      heroT: 'Find a quiet place in the hills', heroS: 'Offbeat Himachal, away from the crowds — 146 places with crowd forecasts.',
      where: 'Where', when: 'When', fromLbl: 'Travelling from', searchBtn: 'Search', notSure: 'Not sure where to go? We’ll suggest a place', knowWhere: 'I know where to go', suggestMe: 'Suggest a place for me',
      sub: 'Crowd forecasts for 146 offbeat places — pick a quiet one for your dates.',
      searchPh: 'Search a place, e.g. Tirthan', go: 'Go',
      helpTitle: 'Not sure where to go?', helpSub: 'Find your place in 3 taps',
      step: function (n) { return 'Question ' + n + ' of 2'; }, close: 'Close',
      q1: 'Where are you coming from?', q2: 'How many days do you have?', q3: 'What would make the trip?',
      d2: '2–3 days', d4: '4–5 days', d6: '6 days or more',
      likeVillage: 'Quiet village life', likeNature: 'Forest, rivers, nature', likeSnow: 'Snow', likeTrek: 'Treks & adventure', likeTemple: 'Temples & culture',
      otherCity: 'Another city…', inHP: 'I’m already in Himachal',
      forYou: 'Picked for you', change: 'Change answers', withKids: 'Travelling with kids or elders',
      seePlace: 'See place', planTrip: 'Plan trip', noPicks: 'Nothing fits all of that. Try more days or another interest.', noSnowPicks: 'No snow expected at places you can reach on these dates. Try a date between December and February, or open the snow finder.',
      quietOn: 'Quiet on', leastBusy: 'Least busy on', quietToday: 'Quiet today', seeAll: 'See all',
      snowOn: 'Snow likely on', snowToday: 'Snow likely today', snowNone: 'No snow expected at places you can drive to on these dates.', snowMore: 'Open snow finder',
      stayTitle: 'Need a homestay?', staySub: 'Tell us where and when. We’ll WhatsApp you 2–3 local homestays within 24 hours.',
      stayBtn: 'Find me a stay', stayBrowse: 'Browse homestay previews',
      trust: 'Built by a small Himachali team from Hamirpur, for travellers who want the real hills — not the traffic jams.',
      trust1: 'Udyam registered', trust2: 'Prices kept low', trust3: 'Live crowd forecasts',
      exploreTitle: 'Explore', all: 'All', quiet: 'Quiet', near: 'Close to me', snow: 'Snow', temples: 'Temples',
      mapView: 'Map view', showMore: 'Show more', places: function (n) { return n === 1 ? '1 place' : n + ' places'; },
      noResults: 'No places match. Try another word or filter.',
      cNature: 'Nature', cTrek: 'Treks & adventure', cCulture: 'Village & culture', sortLbl: 'Sort', sQuiet: 'Quietest first', sClose: 'Closest to you', busyOn: 'Busy on', busyNow: 'Busy today', noneHere: 'No places match. Try another filter.',
      crowdTitle: 'How busy is it?', quietest: 'Quietest', avoid: 'Busiest — avoid if you can',
      planIntro: 'Plan your trip',
      savedTitle: 'Saved', savedEmpty: 'Tap ♡ on any place to save it here. Then send your shortlist to family on WhatsApp.',
      sendFamily: 'Send shortlist to family', plansTitle: 'My plans (work offline)', remove: 'Remove',
      savePlan: 'Save this plan', planSaved: 'Plan saved — open it from Saved, even offline', sharePlan: 'Send plan to family',
      planHere: 'Plan my trip here', stayHere: 'Find me a stay here',
      vq: 'Very quiet', q: 'Quiet', m: 'Moderate', c: 'Crowded', p: 'Packed', closed: 'Closed (snow)',
      hrsFrom: function (h, c) { return h + ' from ' + c; }, fly: function (hub, h) { return 'Fly to ' + hub + ' + ' + h; },
      formTitle: 'Find me a stay', fName: 'Your name', fPhone: 'WhatsApp number', fWhere: 'Where', wherePh: 'e.g. Tirthan Valley — or “anywhere quiet”', fWhen: 'When', fGuests: 'Guests',
      fBudget: 'Budget per night', b1: 'Under ₹2,000', b2: '₹2,000–3,500', b3: '₹3,500+', fNote: 'Anything else? (optional)',
      send: 'Send request', free: 'Free. No payment now.', sending: 'Sending…',
      sentTitle: 'Request sent', sentSub: 'We’ll WhatsApp you 2–3 local homestays within 24 hours. You choose, then book.',
      done: 'Done', needName: 'Please add your name', needPhone: 'Please add a 10-digit WhatsApp number', failed: 'Couldn’t send. Please try again or WhatsApp us.',
      tabs: ['Home', 'Explore', 'Crowd', 'Plan', 'Saved'], stays: 'Stays', blog: 'Blog',
      waList: function (d) { return 'Where should we go? (' + d + ')'; }, waVote: 'Reply with the number you like 👆'
    },
    hi: {
      heroT: 'पहाड़ों में शांत जगह ढूँढिए', heroS: 'भीड़ से दूर, असली हिमाचल — 146 जगहों की भीड़ का अनुमान।',
      where: 'कहाँ', when: 'कब', fromLbl: 'कहाँ से आ रहे हैं', searchBtn: 'खोजें', notSure: 'पता नहीं कहाँ जाएँ? हम जगह सुझाएँगे', knowWhere: 'मुझे पता है कहाँ जाना है', suggestMe: 'मेरे लिए जगह सुझाएँ',
      going: 'कब:', from: 'कहाँ से', today: 'आज', weekend: 'इस वीकेंड', nextWeekend: 'अगला वीकेंड', pick: 'तारीख चुनें',
      h1a: 'वही हिमाचल,', h1b: 'बिना भीड़ के।',
      kicker: 'ज़िम्मेदार यात्रा · हिमाचल',
      newHere: 'पहली बार? ऐसे काम करता है', how1: 'चुनें कब जा रहे हैं', how2: 'देखें हर जगह कितनी भीड़ होगी', how3: 'शांत जगह जाएँ, स्थानीय लोगों के साथ रुकें', gotIt: 'समझ गया',
      regionsT: 'इलाक़े के हिसाब से हिमाचल घूमें', regionsS: 'पहली बार? अपने दिनों के हिसाब से इलाक़ा चुनें।', goodFor: 'किसके लिए', seeRegion: 'जगहें देखें',
      monthT: function (m) { return m + ' में हिमाचल'; }, tipsT: 'हिमाचल की पहली यात्रा?', tipsS: 'जाने से पहले छह ज़रूरी बातें।',
      regionOn: 'इलाक़ा:', clearRegion: 'सभी इलाक़े दिखाएँ',
      motto: 'हम आपको वहाँ नहीं भेजते जहाँ सब जाते हैं। हम शांत, कम जानी-पहचानी जगहें दिखाते हैं — और उन्हें सम्मान से घूमने में मदद करते हैं।',
      findBtn: 'मेरी शांत जगह ढूँढें', findSub: '2 छोटे सवाल · हम सुझाएँ, आप चुनें', whenGoing: 'कब जा रहे हैं?', browseAll: 'या सभी 146 जगहें देखें',
      swapT: 'भीड़ से बचें', swapS: 'मशहूर जगह जा रहे हैं? पास में ही शांत जगह है।', insteadOf: 'की जगह', busy: 'भीड़',
      pledgeT: 'पहाड़ों पर हल्के कदम', pl1: 'स्थानीय परिवारों के साथ रुकें, स्थानीय ढाबों में खाएँ', pl2: 'अपना प्लास्टिक वापस ले जाएँ', pl3: 'गाँव और मंदिर के रीति-रिवाज़ों का सम्मान करें', pl4: 'हो सके तो हफ़्ते के बीच जाएँ',
      sub: '146 अनछुई जगहों पर भीड़ का अनुमान — अपनी तारीखों के लिए शांत जगह चुनें।',
      searchPh: 'जगह खोजें, जैसे Tirthan', go: 'खोजें',
      helpTitle: 'कहाँ जाएँ, तय नहीं?', helpSub: '3 टैप में अपनी जगह पाएँ',
      step: function (n) { return 'सवाल ' + n + ' / 2'; }, close: 'बंद करें',
      q1: 'आप कहाँ से आ रहे हैं?', q2: 'आपके पास कितने दिन हैं?', q3: 'यात्रा में क्या चाहिए?',
      d2: '2–3 दिन', d4: '4–5 दिन', d6: '6 दिन या ज़्यादा',
      likeVillage: 'शांत गाँव', likeNature: 'जंगल, नदी, प्रकृति', likeSnow: 'बर्फ़', likeTrek: 'ट्रेक और एडवेंचर', likeTemple: 'मंदिर और संस्कृति',
      otherCity: 'कोई और शहर…', inHP: 'मैं हिमाचल में ही हूँ',
      forYou: 'आपके लिए चुनी गई', change: 'जवाब बदलें', withKids: 'बच्चों या बुज़ुर्गों के साथ',
      seePlace: 'जगह देखें', planTrip: 'प्लान बनाएँ', noPicks: 'इन सब से मेल खाती जगह नहीं मिली। ज़्यादा दिन या दूसरी पसंद चुनें।', noSnowPicks: 'इन तारीखों पर पहुँचने लायक जगहों पर बर्फ़ की उम्मीद नहीं। दिसंबर से फ़रवरी की कोई तारीख चुनें या स्नो फ़ाइंडर खोलें।',
      quietOn: 'शांत जगहें:', leastBusy: 'सबसे कम भीड़:', quietToday: 'आज शांत जगहें', seeAll: 'सभी देखें',
      snowOn: 'बर्फ़ की संभावना:', snowToday: 'आज बर्फ़ की संभावना', snowNone: 'इन तारीखों पर सड़क से पहुँचने वाली जगहों पर बर्फ़ की उम्मीद नहीं।', snowMore: 'स्नो फ़ाइंडर खोलें',
      stayTitle: 'होमस्टे चाहिए?', staySub: 'बताइए कहाँ और कब। हम 24 घंटे में WhatsApp पर 2–3 स्थानीय होमस्टे भेजेंगे।',
      stayBtn: 'मेरे लिए होमस्टे ढूँढें', stayBrowse: 'होमस्टे की झलक देखें',
      trust: 'हमीरपुर की एक छोटी हिमाचली टीम ने बनाया — उन यात्रियों के लिए जो असली पहाड़ चाहते हैं, ट्रैफ़िक जाम नहीं।',
      trust1: 'Udyam रजिस्टर्ड', trust2: 'कम दाम', trust3: 'भीड़ का लाइव अनुमान',
      exploreTitle: 'जगहें खोजें', all: 'सभी', quiet: 'शांत', near: 'मेरे पास', snow: 'बर्फ़', temples: 'मंदिर',
      mapView: 'मैप देखें', showMore: 'और देखें', places: function (n) { return n + ' जगहें'; },
      noResults: 'कोई जगह नहीं मिली। दूसरा शब्द या फ़िल्टर आज़माएँ।',
      cNature: 'प्रकृति', cTrek: 'ट्रेक और एडवेंचर', cCulture: 'गाँव और संस्कृति', sortLbl: 'क्रम', sQuiet: 'सबसे शांत पहले', sClose: 'आपके सबसे पास', busyOn: 'भीड़ रहेगी —', busyNow: 'आज भीड़ —', noneHere: 'कोई जगह नहीं मिली। दूसरा फ़िल्टर आज़माएँ।',
      crowdTitle: 'कितनी भीड़ है?', quietest: 'सबसे शांत', avoid: 'सबसे ज़्यादा भीड़ — हो सके तो बचें',
      planIntro: 'अपनी यात्रा प्लान करें',
      savedTitle: 'सेव की गई', savedEmpty: 'किसी भी जगह पर ♡ दबाएँ, वो यहाँ सेव होगी। फिर लिस्ट परिवार को WhatsApp पर भेजें।',
      sendFamily: 'लिस्ट परिवार को भेजें', plansTitle: 'मेरे प्लान (ऑफ़लाइन भी)', remove: 'हटाएँ',
      savePlan: 'प्लान सेव करें', planSaved: 'प्लान सेव हो गया — Saved में खोलें, ऑफ़लाइन भी', sharePlan: 'प्लान परिवार को भेजें',
      planHere: 'यहाँ का प्लान बनाएँ', stayHere: 'यहाँ होमस्टे ढूँढें',
      vq: 'बहुत शांत', q: 'शांत', m: 'ठीक-ठाक', c: 'भीड़', p: 'बहुत भीड़', closed: 'बंद (बर्फ़)',
      hrsFrom: function (h, c) { return c + ' से ' + h; }, fly: function (hub, h) { return hub + ' तक फ़्लाइट + ' + h; },
      formTitle: 'मेरे लिए होमस्टे ढूँढें', fName: 'आपका नाम', fPhone: 'WhatsApp नंबर', fWhere: 'कहाँ', wherePh: 'जैसे Tirthan Valley — या “कोई भी शांत जगह”', fWhen: 'कब', fGuests: 'मेहमान',
      fBudget: 'प्रति रात बजट', b1: '₹2,000 से कम', b2: '₹2,000–3,500', b3: '₹3,500+', fNote: 'कुछ और? (ज़रूरी नहीं)',
      send: 'रिक्वेस्ट भेजें', free: 'मुफ़्त। अभी कोई पेमेंट नहीं।', sending: 'भेज रहे हैं…',
      sentTitle: 'रिक्वेस्ट भेज दी', sentSub: 'हम 24 घंटे में WhatsApp पर 2–3 स्थानीय होमस्टे भेजेंगे। आप चुनें, फिर बुक करें।',
      done: 'ठीक है', needName: 'कृपया अपना नाम लिखें', needPhone: 'कृपया 10 अंकों का WhatsApp नंबर लिखें', failed: 'भेज नहीं पाए। फिर कोशिश करें या WhatsApp करें।',
      tabs: ['होम', 'खोजें', 'भीड़', 'प्लान', 'सेव'], stays: 'होमस्टे', blog: 'ब्लॉग',
      waList: function (d) { return 'कहाँ चलें? (' + d + ')'; }, waVote: 'जो पसंद हो उसका नंबर भेजें 👆'
    }
  };

  var TABS = ['home', 'explore', 'crowd', 'plan', 'saved'];
  var CITY_QUICK = [['Delhi', 'Delhi NCR'], ['Chandigarh', 'Chandigarh / Punjab'], ['Mumbai', 'Mumbai / Pune'], ['Bengaluru', 'Bengaluru / South']];
  /* ---------------- first-time explorer help (Nov 2026) ---------------- */
  // Himachal in 7 easy regions, grouped by the zone field in places data.
  var REGIONS = [
    { k: 'kangra', z: ['kangra'], e: '🍵',
      en: ['Kangra & Dhauladhar', 'Tea gardens, monasteries and snow peaks right behind town.', 'Easy first trip', '3–4 days', 'Good all year'],
      hi: ['कांगड़ा और धौलाधार', 'चाय बागान, मठ और ठीक पीछे बर्फ़ीले पहाड़।', 'पहली यात्रा के लिए आसान', '3–4 दिन', 'पूरे साल अच्छा'] },
    { k: 'kullu', z: ['kullu', 'tirthan', 'parvati'], e: '🌲',
      en: ['Kullu, Tirthan & Seraj', 'Rivers, deodar forests and wooden villages — go beyond Manali.', 'Nature lovers', '4–5 days', 'Mar–Jun, Sep–Dec'],
      hi: ['कुल्लू, तीर्थन और सराज', 'नदियाँ, देवदार के जंगल और लकड़ी के गाँव — मनाली से आगे।', 'प्रकृति प्रेमी', '4–5 दिन', 'मार्च–जून, सितंबर–दिसंबर'] },
    { k: 'shimla', z: ['shimla', 'sirmaur', 'solan'], e: '🍎',
      en: ['Shimla hills & Sirmaur', 'Apple orchards and old hill towns, closest to Delhi and Chandigarh.', 'Short trips', '2–3 days', 'All year · snow Jan–Feb'],
      hi: ['शिमला की पहाड़ियाँ और सिरमौर', 'सेब के बाग़ और पुराने पहाड़ी कस्बे, दिल्ली-चंडीगढ़ के सबसे पास।', 'छोटी यात्रा', '2–3 दिन', 'पूरे साल · बर्फ़ जनवरी–फ़रवरी'] },
    { k: 'mandi', z: ['mandi'], e: '🏞️',
      en: ['Mandi & Barot', 'Lakes, trout streams and old temples — hardly touristy.', 'Quiet escapes', '3–4 days', 'Mar–Nov'],
      hi: ['मंडी और बरोट', 'झीलें, ट्राउट वाली नदियाँ और पुराने मंदिर — बहुत कम पर्यटक।', 'शांत छुट्टी', '3–4 दिन', 'मार्च–नवंबर'] },
    { k: 'chamba', z: ['chamba'], e: '🛕',
      en: ['Chamba & Pangi', 'Stone temples, shepherd trails and remote valleys.', 'Slow travellers', '4–6 days', 'Apr–Nov'],
      hi: ['चंबा और पांगी', 'पत्थर के मंदिर, गद्दी चरवाहों के रास्ते और दूर की घाटियाँ।', 'आराम से घूमने वाले', '4–6 दिन', 'अप्रैल–नवंबर'] },
    { k: 'high', z: ['kinnaur', 'spiti', 'lahaul'], e: '🏔️',
      en: ['Kinnaur, Spiti & Lahaul', 'High mountain desert, monasteries and long, dramatic drives.', 'Big adventure', '7+ days', 'Late May–Oct'],
      hi: ['किन्नौर, स्पीति और लाहौल', 'ऊँचा पहाड़ी रेगिस्तान, मठ और लंबे शानदार रास्ते।', 'बड़ा एडवेंचर', '7+ दिन', 'मई के अंत से अक्टूबर'] },
    { k: 'lower', z: ['hamirpur', 'bilaspur', 'una'], e: '🌅',
      en: ['Lower hills', 'Temples, lakes and warm, easy hills — good for winter weekends.', 'Families & elders', '1–2 days', 'Oct–Mar'],
      hi: ['निचली पहाड़ियाँ', 'मंदिर, झीलें और गर्म, आसान पहाड़ — सर्दी के वीकेंड के लिए अच्छा।', 'परिवार और बुज़ुर्ग', '1–2 दिन', 'अक्टूबर–मार्च'] }
  ];
  var MONTHS = {
    en: ['Coldest month. Snow in the upper hills of Shimla, Kullu and Chamba; high passes closed. Lower hills are sunny.',
      'Still cold, snow likely higher up. One of the quietest months almost everywhere.',
      'Rhododendrons and early blossom. Warm days, cold nights — lovely in Kangra and Kullu valleys.',
      'Apple and cherry blossom, clear views. A great month before the summer rush.',
      'Warm in the valleys. Famous hill towns fill up with holiday crowds — go offbeat or higher.',
      'Peak holiday crowds in famous towns. Roads to Spiti and Lahaul open — best start for the high regions.',
      'Monsoon. Landslides and road closures are common; Spiti and Lahaul get little rain.',
      'Monsoon continues — green but risky roads. Keep spare days and check the weather.',
      'Rain eases, everything is green and few tourists come. One of the best months.',
      'Clear skies, crisp air, apple harvest — the best views of the year. Kullu is busy around Dussehra.',
      'Clear sunny days, cold nights and very few crowds. High passes start to close.',
      'Winter begins; snow possible up high late in the month. Shimla and Manali get crowded around Christmas–New Year.'],
    hi: ['सबसे ठंडा महीना। शिमला, कुल्लू और चंबा की ऊँची पहाड़ियों में बर्फ़; ऊँचे दर्रे बंद। निचली पहाड़ियों में धूप।',
      'अब भी ठंड, ऊपर बर्फ़ की संभावना। लगभग हर जगह सबसे शांत महीनों में से एक।',
      'बुरांश के फूल और शुरुआती बहार। दिन गर्म, रातें ठंडी — कांगड़ा और कुल्लू घाटी में बढ़िया।',
      'सेब और चेरी के फूल, साफ़ नज़ारे। गर्मी की भीड़ से पहले शानदार महीना।',
      'घाटियों में गर्मी। मशहूर कस्बों में छुट्टियों की भीड़ — कम जानी जगहों या ऊपर जाएँ।',
      'मशहूर कस्बों में सबसे ज़्यादा भीड़। स्पीति और लाहौल के रास्ते खुलते हैं।',
      'मानसून। भूस्खलन और रास्ते बंद होना आम है; स्पीति और लाहौल में कम बारिश।',
      'मानसून जारी — हरियाली पर रास्ते जोखिम भरे। अतिरिक्त दिन रखें, मौसम देखें।',
      'बारिश कम, सब हरा-भरा और कम पर्यटक। सबसे अच्छे महीनों में से एक।',
      'साफ़ आसमान, ठंडी हवा, सेब की फ़सल — साल के सबसे अच्छे नज़ारे। दशहरे पर कुल्लू में भीड़।',
      'धूप वाले साफ़ दिन, ठंडी रातें और बहुत कम भीड़। ऊँचे दर्रे बंद होने लगते हैं।',
      'सर्दी शुरू; महीने के अंत में ऊपर बर्फ़ संभव। क्रिसमस–नए साल पर शिमला और मनाली में भीड़।']
  };
  var TIPS = {
    en: [['🚌', 'Getting there', 'Overnight Volvo buses from Delhi and Chandigarh reach most valleys. Airports: Kangra (Gaggal), Kullu (Bhuntar) and Shimla. Trains go to Kalka, Pathankot and Una.'],
      ['🛣️', 'Hill roads are slow', 'Plan on about 25–30 km an hour. Avoid driving after dark, and keep a spare day in monsoon and winter.'],
      ['📶', 'Phone & cash', 'Network fades in remote valleys — download offline maps. Carry cash; ATMs are few beyond the towns.'],
      ['⛰️', 'Going high', 'For Spiti, Lahaul and Kinnaur, go up slowly, drink plenty of water and rest on the first day.'],
      ['📝', 'Permits', 'A few places, like Rohtang Pass, need a permit — check before you go.'],
      ['🆘', 'Stay safe', 'Tell your homestay your plans when you trek. The SOS button on this site works even with weak network.']],
    hi: [['🚌', 'कैसे पहुँचें', 'दिल्ली और चंडीगढ़ से रात की वोल्वो बसें ज़्यादातर घाटियों तक जाती हैं। हवाई अड्डे: कांगड़ा (गग्गल), कुल्लू (भुंतर) और शिमला। ट्रेनें कालका, पठानकोट और ऊना तक।'],
      ['🛣️', 'पहाड़ी रास्ते धीमे हैं', 'लगभग 25–30 किमी प्रति घंटा मानकर चलें। अँधेरे में गाड़ी न चलाएँ, मानसून और सर्दी में एक दिन अतिरिक्त रखें।'],
      ['📶', 'फ़ोन और नकद', 'दूर की घाटियों में नेटवर्क कमज़ोर — ऑफ़लाइन मैप डाउनलोड करें। नकद रखें; कस्बों के बाहर एटीएम कम हैं।'],
      ['⛰️', 'ऊँचाई पर', 'स्पीति, लाहौल और किन्नौर में धीरे-धीरे ऊपर जाएँ, खूब पानी पिएँ और पहले दिन आराम करें।'],
      ['📝', 'परमिट', 'कुछ जगहों जैसे रोहतांग दर्रे के लिए परमिट चाहिए — जाने से पहले जाँच लें।'],
      ['🆘', 'सुरक्षित रहें', 'ट्रेक पर जाने से पहले होमस्टे को बताएँ। इस साइट का SOS बटन कमज़ोर नेटवर्क में भी काम करता है।']]
  };

  var LIKES = { village: ['offbeat', 'culture'], nature: ['nature'], snow: ['snow'], trek: ['trek', 'adventure'], temple: ['spiritual'] };

  /* ---------------- state ---------------- */
  var S = {
    tab: 'home', lang: load('pp_lang', 'en'), dateKey: 'now', customDate: null,
    origin: load('pp_origin', 'Delhi'),
    help: { step: 0, city: null, days: null, like: null, kids: false },
    q: '', chip: 'all', exploreN: 20, stayDone: false, budget: 'b2',
    cType: 'all', cSort: 'quiet', crowdN: 20, region: null, seenHow: load('pp_seen_how', '') === '1'
  };
  function load(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function t() { return T[S.lang] || T.en; }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function places() { try { return ALL || []; } catch (e) { return []; } }
  function media() { try { return MEDIA || {}; } catch (e) { return {}; } }
  function saved() { try { return getSaved(); } catch (e) { return []; } }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtDay(d) {
    try { return d.toLocaleDateString(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch (e) { return d.toDateString().slice(0, 10); }
  }
  function fmtRange(a, b) {
    if (a.getMonth() === b.getMonth()) { return a.getDate() + '–' + fmtShort(b); }
    return fmtShort(a) + '–' + fmtShort(b);
  }
  function fmtShort(d) {
    try { return d.toLocaleDateString(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' }); }
    catch (e) { return d.toDateString().slice(4, 10); }
  }

  /* ---------------- dates ---------------- */
  // Memoised: building the long-weekend list walks 75 days of calendar, so it must not run
  // inside per-place crowd lookups or sort comparators (that froze the page for seconds).
  var _dopts = null, _doptsKey = '';
  function dateOptions() {
    var key = S.lang + '|' + ymd(new Date()) + '|' + (S.customDate ? ymd(S.customDate) : '');
    if (_dopts && _doptsKey === key) return _dopts;
    _doptsKey = key;
    return (_dopts = buildDateOptions());
  }
  function buildDateOptions() {
    var now = new Date(), opts = [{ key: 'now', label: t().today, d: null }];
    var dow = now.getDay();
    // Next Saturday (on Sunday the weekend is over, so look at the coming one).
    var sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (dow === 0 ? 6 : (6 - dow)));
    var lws = [];
    try { lws = window.PP_CROWD ? PP_CROWD.upcomingLongWeekends(now, 75) : []; } catch (e) { /* calendar not ready */ }
    var inLW = lws.some(function (lw) { return sat >= new Date(lw.start.getFullYear(), lw.start.getMonth(), lw.start.getDate()) && sat <= lw.end; });
    if (!inLW && dow !== 6) opts.push({ key: 'wk', label: (dow === 0 ? t().nextWeekend : t().weekend) + ' · ' + fmtShort(sat), short: fmtShort(sat), d: sat });
    try {
      lws.slice(0, 2).forEach(function (lw, i) {
        var nm = lw.names && lw.names[0] ? ' · ' + lw.names[0] : '';
        opts.push({ key: 'lw' + i, label: fmtRange(lw.start, lw.end) + nm, short: fmtRange(lw.start, lw.end), names: (lw.names || []).join(', '), d: lw.peakDay || lw.start });
      });
    } catch (e) { /* calendar not ready */ }
    if (S.customDate) opts.push({ key: 'custom', label: fmtDay(S.customDate), short: fmtShort(S.customDate), d: S.customDate });
    return opts;
  }
  function curDate() {
    var o = dateOptions().find(function (x) { return x.key === S.dateKey; }) || dateOptions()[0];
    return o;
  }
  function dateLabelShort() { var o = curDate(); return o.key === 'now' ? t().today : (o.short || o.label); }
  function planDate() { var o = curDate(); if (o.d) return new Date(o.d); var d = new Date(); return d; }

  /* ---------------- crowd ---------------- */
  var _cc = {};
  function crowd(p) {
    var k = p.id + '|' + S.dateKey;
    if (_cc[k]) return _cc[k];
    var o = curDate();
    var r = { value: p.crowd || 30, closed: false, inSeason: true };
    try {
      if (window.PP_CROWD) r = o.key === 'now' ? PP_CROWD.now(p) : PP_CROWD.predict(p, o.d);
    } catch (e) { /* fall back to base crowd */ }
    return (_cc[k] = r);
  }
  function word(p) {
    var r = crowd(p), v = r.value, tt = t();
    if (r.closed) return { w: tt.closed, fg: '#3b4a7a', bg: '#eef0f6', v: v };
    if (v < 20) return { w: tt.vq, fg: '#245c3a', bg: '#dcefe2', v: v };
    if (v < 40) return { w: tt.q, fg: '#2d5a40', bg: '#e7f1ea', v: v };
    if (v < 60) return { w: tt.m, fg: '#7a5410', bg: '#f6ecd6', v: v };
    if (v < 80) return { w: tt.c, fg: '#9b3a1e', bg: '#f6e1d8', v: v };
    return { w: tt.p, fg: '#8a2412', bg: '#f3d5ca', v: v };
  }
  // Can't really go: road closed, or a trek/high pass outside its season (snowbound). Those show a
  // tiny crowd % only because nobody can get there, so they must not appear as "quiet".
  function shut(p) {
    var r = crowd(p); if (r.closed) return true;
    if (r.inSeason !== false) return false;
    var alt = parseInt(String(p.altitude || '').replace(/[^0-9]/g, ''), 10) || 0;
    return (p.vibes || []).indexOf('trek') >= 0 || /\b(Pass|Peak|Trek|Kund|Lake)\b/.test(p.name) && alt >= 2800;
  }
  function sortVal(p) { var r = crowd(p); return r.value + (r.closed ? 200 : r.inSeason === false ? 60 : 0); }
  // Sort by a key computed once per item (not inside the comparator).
  function sortBy(list, fn) {
    return list.map(function (p) { return [fn(p), p]; }).sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; });
  }

  /* ---------------- travel ---------------- */
  function syncOrigin() { try { window.PP_ORIGIN = originObj(S.origin); } catch (e) { /* ignore */ } }
  function originObj(name) {
    var list = (window.PPTrip && PPTrip.origins) || [];
    var o = list.find(function (x) { return x[0] === name; }) || list[0];
    return o ? { name: o[0], lat: o[1], lng: o[2], kind: o[3] } : null;
  }
  function fmtH(h) { if (window.PPTrip && PPTrip.fmtH) return PPTrip.fmtH(h); return '~' + Math.round(h) + 'h'; }
  var _tc = {};
  function travel(p) {
    var k = p.id + '|' + S.origin;
    if (_tc[k] !== undefined) return _tc[k];
    var out = null;
    try {
      var o = originObj(S.origin);
      var r = o && PPTrip.travelFrom(o, p);
      if (r) out = { hours: r.hours, far: !!r.far, hub: r.hub ? String(r.hub).split(' (')[0] : '' };
    } catch (e) { /* engine not loaded */ }
    return (_tc[k] = out);
  }
  function reach(p) {
    var r = travel(p); if (!r) return p.district || '';
    var h = fmtH(r.hours);
    if (S.lang === 'hi') h = h.replace('h', ' घंटे');
    return r.far ? t().fly(r.hub.replace(' airport', ''), h) : t().hrsFrom(h, S.origin);
  }
  function tier(p) { try { return PPTrip.tierOf(p.id); } catch (e) { return 'A'; } }

  /* ---------------- pieces ---------------- */
  function img(p) {
    var m = media()[p.id], src = m && m.images && m.images[0];
    return src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.remove()">' : '<span aria-hidden="true">' + esc(p.emoji || '⛰️') + '</span>';
  }
  function pill(p) { var w = word(p); return '<span class="sp-pill" style="background:' + w.bg + ';color:' + w.fg + '">' + esc(w.w) + '</span>'; }
  function heart(p) {
    var on = saved().indexOf(p.id) >= 0;
    return '<button class="sp-heart" data-act="save" data-id="' + p.id + '" aria-label="' + (on ? 'Remove from saved' : 'Save') + '" aria-pressed="' + on + '">' + (on ? '❤️' : '🤍') + '</button>';
  }
  function tile(p) {
    return '<button class="sp-tile" data-act="open" data-id="' + p.id + '"><div class="sp-img">' + img(p) + '</div><div class="sp-tb">' +
      pill(p) + '<span class="sp-name">' + esc(p.name) + '</span><span class="sp-small">' + esc(reach(p)) + '</span></div></button>';
  }
  function item(p) {
    return '<div class="sp-item"><button class="sp-open" data-act="open" data-id="' + p.id + '"><span class="sp-img">' + img(p) + '</span><span class="sp-tx">' +
      '<span class="sp-name">' + esc(p.name) + '</span><span class="sp-small">' + esc(reach(p)) + '</span>' + pill(p) + '</span></button>' + heart(p) + '</div>';
  }

  /* ---------------- screens ---------------- */
  function renderBar() {
    var el = $('spBar'); if (!el) return;
    if (S.tab === 'home') { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    var opts = dateOptions(), tt = t();
    var origins = (window.PPTrip && PPTrip.origins) || [['Delhi'], ['Chandigarh'], ['Mumbai'], ['Bengaluru']];
    el.innerHTML = '<div class="sp-bar-in"><span class="sp-bar-lbl">' + esc(tt.going) + '</span><div class="sp-scroll">' +
      opts.map(function (o) { return '<button class="sp-chip' + (o.key === S.dateKey ? ' on' : '') + '" data-act="date" data-key="' + o.key + '">' + esc(o.label) + '</button>'; }).join('') +
      '<button class="sp-chip" data-act="pickdate">📅 ' + esc(tt.pick) + '</button><input type="date" id="spDateIn" class="sp-datein" min="' + ymd(new Date()) + '" aria-label="' + esc(tt.pick) + '">' +
      '<label class="sp-bar-lbl" for="spFrom" style="margin-left:6px">' + esc(tt.from) + '</label><select id="spFrom" class="sp-from">' +
      origins.map(function (o) { return '<option' + (o[0] === S.origin ? ' selected' : '') + '>' + esc(o[0]) + '</option>'; }).join('') +
      '</select></div></div>';
  }

  function renderHome() {
    var tt = t(), h = S.help, el = $('spHome'); if (!el) return;
    // Concept A (Nov 2026): green header + one search card (where / when / from), like Booking.com.
    var opts0 = dateOptions();
    var origins = (window.PPTrip && PPTrip.origins) || [['Delhi'], ['Chandigarh'], ['Mumbai'], ['Bengaluru']];
    var ico = function (d) { return '<span class="sp-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg></span>'; };
    // Nov 2026: no search box on home. PahariPath suggests quiet places; people searching for a name
    // they already know are usually after the famous, crowded ones. Search still lives on Explore.
    var html = '<div class="sp-hero"><div class="sp-hero-in"><span class="sp-kick">' + esc(tt.kicker) + '</span><h1>' + esc(tt.h1a) + ' <em>' + esc(tt.h1b) + '</em></h1><p>' + esc(tt.motto) + '</p></div></div>' +
      '<div class="sp-wrap sp-home-wrap"><div class="sp-lead">' +
      (h.step === 0 ? '<button class="sp-btn clay sp-findbtn" data-act="help-open"><span>' + esc(tt.findBtn) + ' →</span><small>' + esc(tt.findSub) + '</small></button>' : '') +
      '<div class="sp-lead-row"><span class="sp-sl">' + esc(tt.whenGoing) + '</span><span class="sp-scroll sp-when">' +
      opts0.map(function (o) { return '<button type="button" class="sp-chip' + (o.key === S.dateKey ? ' on' : '') + '" data-act="date" data-key="' + o.key + '">' + esc(o.label) + '</button>'; }).join('') +
      '<button type="button" class="sp-chip" data-act="pickdate">' + esc(tt.pick) + '</button><input type="date" id="spDateIn" class="sp-datein" min="' + ymd(new Date()) + '" aria-label="' + esc(tt.pick) + '">' +
      '</span></div>' +
      '<label class="sp-lead-from" for="spFrom">' + ico('<path d="M5 17h14M6 17l1.5-6h9L18 17"/><circle cx="8" cy="18.5" r="1.5"/><circle cx="16" cy="18.5" r="1.5"/>') +
      '<span class="sp-sl">' + esc(tt.fromLbl) + '</span><select id="spFrom" class="sp-from2">' +
      origins.map(function (o) { return '<option' + (o[0] === S.origin ? ' selected' : '') + '>' + esc(o[0]) + '</option>'; }).join('') +
      '</select></label></div>' +
      (h.step === 0 ? '<button class="sp-notsure" data-act="tab" data-tab="explore">' + esc(tt.browseAll) + ' <span aria-hidden="true">→</span></button>' : '');

    // first visit only: three steps, dismissible
    if (!S.seenHow && h.step === 0) {
      html += '<div class="sp-how"><div class="sp-row" style="margin-bottom:8px"><b>' + esc(tt.newHere) + '</b><button class="sp-link" data-act="how-ok">' + esc(tt.gotIt) + '</button></div><ol>' +
        [tt.how1, tt.how2, tt.how3].map(function (x, i) { return '<li><span>' + (i + 1) + '</span>' + esc(x) + '</li>'; }).join('') + '</ol></div>';
    }

    // help me choose
    if (h.step === 0) {
      /* the "Find my quiet place" button sits in the lead card above */
    } else if (h.step <= 3) {
      var opts = h.step === 1
        ? CITY_QUICK.map(function (c) { return [c[0], c[1]]; }).concat([['__hp', tt.inHP], ['__other', tt.otherCity]])
        : h.step === 2 ? [['2', tt.d2], ['4', tt.d4], ['6', tt.d6]]
          : [['village', tt.likeVillage], ['nature', tt.likeNature], ['snow', tt.likeSnow], ['trek', tt.likeTrek], ['temple', tt.likeTemple]];
      html += '<div class="sp-card" style="max-width:560px;margin-top:18px"><div style="display:flex;justify-content:space-between;align-items:center"><span class="sp-muted" style="font-weight:600">' + esc(tt.step(h.step - 1)) +
        '</span><button class="sp-link" data-act="help-close">' + esc(tt.close) + '</button></div><div class="sp-steps"><i class="on"></i><i class="' + (h.step >= 3 ? 'on' : '') + '"></i></div>' +
        '<div class="sp-q">' + esc(tt['q' + h.step]) + '</div>' +
        opts.map(function (o) { return '<button class="sp-opt" data-act="help-answer" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') +
        (h.step === 1 && h.city === '__other' ? '' : '') + '</div>';
    } else {
      html += '<div class="sp-sec" style="max-width:720px"><div class="sp-row"><h2 class="sp-h2">' + esc(tt.forYou) + '</h2><button class="sp-link" data-act="help-restart">' + esc(tt.change) + '</button></div>' +
        '<label style="display:flex;align-items:center;gap:10px;min-height:44px;font-size:15px;margin-bottom:8px"><input type="checkbox" id="spKids"' + (h.kids ? ' checked' : '') + ' style="width:20px;height:20px"> ' + esc(tt.withKids) + '</label>';
      var picks = suggestions();
      if (!picks.length) html += h.like === 'snow'
        ? '<div class="sp-empty">' + esc(tt.noSnowPicks) + ' <button class="sp-link" data-act="snow">' + esc(tt.snowMore) + ' →</button></div>'
        : '<div class="sp-empty">' + esc(tt.noPicks) + '</div>';
      picks.forEach(function (r) {
        var p = r.p;
        html += '<div class="sp-pick"><div class="sp-top"><span class="sp-img">' + img(p) + '</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px"><span class="sp-name">' + esc(p.name) + '</span>' +
          '<span class="sp-small">' + esc(reach(p)) + '</span>' + pill(p) + '</span>' + heart(p) + '</div>' +
          (r.why && r.why.length ? '<div class="sp-why">' + r.why.map(function (w) { return '<span>' + esc(whyText(w)) + '</span>'; }).join('') + '</div>' : '') +
          '<div class="sp-2"><button class="sp-btn ghost" data-act="open" data-id="' + p.id + '">' + esc(tt.seePlace) + '</button><button class="sp-btn" data-act="plan" data-id="' + p.id + '">' + esc(tt.planTrip) + '</button></div></div>';
      });
      html += '</div>';
    }

    // quiet on your dates
    // Trip-worthy, open, in season — quietest first. On peak dates (Christmas, New Year) few
    // places stay under 40%, so top up with the least busy of the rest rather than show 2 cards.
    var pool = sortBy(places().filter(function (p) { var r = crowd(p); return tier(p) === 'A' && !r.closed && r.inSeason !== false; }), sortVal);
    var quiet = pool.filter(function (p) { return crowd(p).value < 40; });
    var topped = quiet.length < 6;
    if (topped) quiet = pool.slice(0, 6);
    quiet = quiet.slice(0, 10);
    html += '<div class="sp-sec"><div class="sp-row"><h2 class="sp-h2">' + esc(topped ? tt.leastBusy + ' ' + dateLabelShort() : S.dateKey === 'now' ? tt.quietToday : tt.quietOn + ' ' + dateLabelShort()) + '</h2><button class="sp-link" data-act="tab" data-tab="crowd">' + esc(tt.seeAll) + '</button></div>' +
      '<div class="sp-hlist">' + quiet.map(tile).join('') + '</div></div>';

    // explore by region — the easy way in for first-timers
    html += '<div class="sp-sec"><h2 class="sp-h2">' + esc(tt.regionsT) + '</h2><p class="sp-muted" style="margin:4px 0 12px">' + esc(tt.regionsS) + '</p><div class="sp-hlist">' +
      REGIONS.map(function (r) {
        var x = r[S.lang] || r.en, top = regionPlaces(r)[0];
        return '<button class="sp-region" data-act="region" data-key="' + r.k + '"><span class="sp-img">' + (top ? img(top) : '<span aria-hidden="true">' + r.e + '</span>') + '</span>' +
          '<span class="sp-tb"><span class="sp-name">' + esc(x[0]) + '</span><span class="sp-small">' + esc(x[1]) + '</span>' +
          '<span class="sp-rmeta"><span>⏱ ' + esc(x[3]) + '</span><span>🗓 ' + esc(x[4]) + '</span></span>' +
          '<span class="sp-rgood">' + esc(tt.goodFor) + ': ' + esc(x[2]) + '</span></span></button>';
      }).join('') + '</div></div>';

    // "Skip the rush": famous place -> quiet neighbour (ALTS list in app.js)
    var swaps = swapList();
    if (swaps.length) {
      html += '<div class="sp-sec"><h2 class="sp-h2">' + esc(tt.swapT) + '</h2><p class="sp-muted" style="margin:4px 0 12px">' + esc(tt.swapS) + '</p><div class="sp-hlist">' +
        swaps.map(function (x) {
          var from = S.lang === 'hi' ? esc(x.instead) + ' ' + esc(tt.insteadOf) : esc(tt.insteadOf) + ' ' + esc(x.instead);
          return '<button class="sp-swap" data-act="open" data-id="' + x.p.id + '"><span class="sp-swap-from">' + from + (x.busy != null ? ' · <b>' + x.busy + '% ' + esc(tt.busy) + '</b>' : '') + '</span>' +
            '<span class="sp-swap-to"><span class="sp-img">' + img(x.p) + '</span><span class="sp-tb">' + pill(x.p) + '<span class="sp-name">' + esc(x.p.name) + '</span></span></span>' +
            '<span class="sp-small sp-swap-d">' + esc(x.desc) + '</span></button>';
        }).join('') + '</div></div>';
    }

    // what the chosen month is like + first-trip tips (collapsed so the page stays short)
    var md = planDate(), mi = md.getMonth();
    var mName = md.toLocaleDateString(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long' });
    html += '<div class="sp-sec"><div class="sp-month"><b>🗓 ' + esc(tt.monthT(mName)) + '</b><span>' + esc((MONTHS[S.lang] || MONTHS.en)[mi]) + '</span></div></div>';
    html += '<div class="sp-sec"><h2 class="sp-h2">' + esc(tt.tipsT) + '</h2><p class="sp-muted" style="margin:4px 0 12px">' + esc(tt.tipsS) + '</p><div class="sp-tips">' +
      (TIPS[S.lang] || TIPS.en).map(function (x) { return '<details><summary><span aria-hidden="true">' + x[0] + '</span>' + esc(x[1]) + '</summary><p>' + esc(x[2]) + '</p></details>'; }).join('') + '</div></div>';

    // responsible travel, in four lines
    html += '<div class="sp-sec"><h2 class="sp-h2" style="margin-bottom:12px">' + esc(tt.pledgeT) + '</h2><div class="sp-pledge">' +
      [['🏡', tt.pl1], ['♻️', tt.pl2], ['🛕', tt.pl3], ['📅', tt.pl4]].map(function (x) { return '<div><span aria-hidden="true">' + x[0] + '</span>' + esc(x[1]) + '</div>'; }).join('') + '</div></div>';

    // two quiet one-line shortcuts instead of big cards (keeps the home screen short)
    var snow = snowNames();
    html += '<div class="sp-sec sp-minis">' +
      '<button class="sp-mini snow" data-act="snow"><span aria-hidden="true">❄️</span><span class="sp-mini-tx"><b>' + esc(S.dateKey === 'now' ? tt.snowToday : tt.snowOn + ' ' + dateLabelShort()) + '</b>' +
      '<span>' + esc(snow.length ? snow.slice(0, 3).join(', ') + (snow.length > 3 ? ' +' + (snow.length - 3) : '') : tt.snowNone) + '</span></span><span aria-hidden="true">›</span></button>' +
      '<button class="sp-mini" data-act="stay"><span aria-hidden="true">🏡</span><span class="sp-mini-tx"><b>' + esc(tt.stayTitle) + '</b><span>' + esc(tt.stayBtn) + '</span></span><span aria-hidden="true">›</span></button>' +
      '</div></div>';
    el.innerHTML = html;
  }

  function regionOf(k) { return REGIONS.find(function (r) { return r.k === k; }); }
  function regionPlaces(r) {
    return sortBy(places().filter(function (p) { return r.z.indexOf(String(p.zone || '').toLowerCase()) >= 0 && !crowd(p).closed; }), function (p) {
      return (media()[p.id] && media()[p.id].images && media()[p.id].images.length ? 0 : 1000) + (tier(p) === 'A' ? 0 : 500) + sortVal(p);
    });
  }

  // trip-finder.js writes its "why" tags in English; translate the common ones for Hindi.
  var WHY_HI = { 'Best season': 'सही मौसम', 'Good season': 'अच्छा मौसम', 'Offbeat': 'कम जानी जगह', 'Culture': 'संस्कृति', 'Nature': 'प्रकृति', 'Snow': 'बर्फ़',
    'Trek': 'ट्रेक', 'Treks': 'ट्रेक', 'Adventure': 'एडवेंचर', 'Spiritual': 'आध्यात्मिक', 'Temples': 'मंदिर', 'Family-friendly': 'परिवार के लिए', 'Easy roads': 'आसान रास्ते', 'Quiet': 'शांत',
    'Monsoon — check roads': 'मानसून — रास्ते जाँच लें', 'Snow possible': 'बर्फ़ पड़ सकती है', 'Long journey': 'लंबा सफ़र', 'Snow likely': 'बर्फ़ की संभावना', 'Village': 'गाँव', 'River': 'नदी', 'Lake': 'झील' };
  function whyText(w) {
    if (S.lang !== 'hi') return w;
    var s = String(w);
    if (WHY_HI[s]) return WHY_HI[s];
    var m = s.match(/^(Quiet|Calm|Moderate|Busy)\s*·\s*(\d+)% crowd$/);
    if (m) return ({ Quiet: 'शांत', Calm: 'शांत', Moderate: 'मध्यम', Busy: 'भीड़' }[m[1]]) + ' · ' + m[2] + '% भीड़';
    return s;
  }

  function swapList() {
    // Own copy so the home screen doesn't depend on app.js load order (same pairs as ALTS in app.js).
    var alts = [
      { instead: 'Manali', crowd: 92, name: 'Sethan', desc: 'Hidden 20 min from Manali. Deep snow in winter, worlds apart in feel.', hi: 'मनाली से सिर्फ़ 20 मिनट, फिर भी बिल्कुल अलग दुनिया। सर्दी में गहरी बर्फ़।' },
      { instead: 'Kasol', crowd: 88, name: 'Grahan', desc: '9 km forest trek — silence, no cafes, just stars and mountains.', hi: '9 किमी जंगल का ट्रेक — सन्नाटा, कोई कैफ़े नहीं, बस तारे और पहाड़।' },
      { instead: 'Shimla', crowd: 85, name: 'Narkanda', desc: 'Apple orchards, Hatu Peak, skiing — 65 km from Shimla, no Mall Road chaos.', hi: 'सेब के बाग़, हाटू पीक, स्कीइंग — शिमला से 65 किमी, मॉल रोड की भीड़ नहीं।' },
      { instead: 'Triund', crowd: 68, name: 'Kareri Lake', desc: 'Alpine lake above Dharamshala. Same Dhauladhar views, far fewer people.', hi: 'धर्मशाला के ऊपर पहाड़ी झील। वही धौलाधार नज़ारे, बहुत कम लोग।' },
      { instead: 'Dharamshala', crowd: 71, name: 'Bir Billing', desc: 'Paragliding, monasteries, good cafes — without the McLeod crush.', hi: 'पैराग्लाइडिंग, मठ, अच्छे कैफ़े — मैक्लोडगंज की भीड़ के बिना।' },
      { instead: 'Spiti Valley', look: 'Kaza', crowd: 35, name: 'Barot', desc: 'Trout streams, pine forests, Pahari villages. No permit needed.', hi: 'ट्राउट वाली नदियाँ, चीड़ के जंगल, पहाड़ी गाँव। परमिट की ज़रूरत नहीं।' }
    ];
    var all = places();
    return alts.map(function (a) {
      var p = all.find(function (x) { return x.name === a.name; }); if (!p) return null;
      if (shut(p)) return null;   // e.g. Kareri Lake / Grahan treks in snow season
      var f = all.find(function (x) { return x.name === (a.look || a.instead); });
      var busy = f ? crowd(f).value : null;
      return { p: p, instead: a.instead, busy: busy == null ? null : Math.round(busy), desc: S.lang === 'hi' && a.hi ? a.hi : a.desc };
    }).filter(Boolean);
  }

  function suggestions() {
    var h = S.help;
    if (!window.PPTrip || !PPTrip.suggestFor) return [];
    var name = h.city === '__hp' ? 'Hamirpur' : h.city && h.city !== '__other' ? h.city : S.origin;
    var o = originObj(name); if (!o) return [];
    try {
      return PPTrip.suggestFor({ origin: o, date: planDate(), nights: +h.days || 2, interests: LIKES[h.like] || [], who: h.kids ? 'family' : 'couple', limit: 3 });
    } catch (e) { console.warn('[simple] suggest failed', e); return []; }
  }

  function snowNames() {
    try {
      if (!window.PPSnow || !PPSnow.snowFor) return [];
      var set = PPSnow.snowFor(ymd(planDate()));
      return places().filter(function (p) { return set.has(p.id) && !crowd(p).closed; }).map(function (p) { return p.name; });
    } catch (e) { return []; }
  }

  function exploreList() {
    var q = S.q.trim().toLowerCase(), tt = t();
    var snowSet = null;
    if (S.chip === 'snow') { try { snowSet = PPSnow.snowFor(ymd(planDate())); } catch (e) { snowSet = new Set(); } }
    return sortBy(places().filter(function (p) {
      if (q && (p.name + ' ' + (p.district || '') + ' ' + (p.famousFor || '')).toLowerCase().indexOf(q) < 0) return false;
      if (S.region) { var rg = regionOf(S.region); if (rg && rg.z.indexOf(String(p.zone || '').toLowerCase()) < 0) return false; }
      if (S.chip === 'quiet') return crowd(p).value < 30 && !shut(p);
      if (S.chip === 'near') { var r = travel(p); return r && r.hours <= (r.far ? 5 : 8); }
      if (S.chip === 'snow') return snowSet.has(p.id) && !crowd(p).closed;
      if (S.chip === 'temples') return (p.vibes || []).indexOf('spiritual') >= 0;
      return true;
    }), sortVal);
  }

  function renderExplore() {
    var tt = t(), el = $('spExplore'); if (!el) return;
    var chips = [['all', tt.all], ['quiet', tt.quiet], ['near', tt.near], ['snow', tt.snow], ['temples', tt.temples]];
    el.innerHTML = '<div class="sp-wrap"><div class="sp-row"><h1 class="sp-h1" style="font-size:34px">' + esc(tt.exploreTitle) + '</h1><button class="sp-btn ghost" data-act="tab" data-tab="map" style="min-height:42px">🗺️ ' + esc(tt.mapView) + '</button></div>' +
      '<form class="sp-search" data-form="search" role="search" style="margin-top:4px"><span aria-hidden="true">🔍</span><label for="spQ2" class="sp-datein">' + esc(tt.searchPh) + '</label>' +
      '<input id="spQ2" type="search" placeholder="' + esc(tt.searchPh) + '" value="' + esc(S.q) + '" autocomplete="off"></form>' +
      '<div class="sp-scroll" style="margin:14px -16px 0;padding:0 16px">' + chips.map(function (c) { return '<button class="sp-chip big' + (S.chip === c[0] ? ' on' : '') + '" data-act="chip" data-chip="' + c[0] + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' +
      (S.region && regionOf(S.region) ? '<div class="sp-rbar"><span>' + esc(tt.regionOn) + ' <b>' + esc((regionOf(S.region)[S.lang] || regionOf(S.region).en)[0]) + '</b></span><button class="sp-link" data-act="region-clear">' + esc(tt.clearRegion) + ' ✕</button></div>' : '') +
      '<div id="spExList"></div></div>';
    renderExploreList();
  }
  function renderExploreList() {
    var el = $('spExList'); if (!el) return;
    var tt = t(), list = exploreList();
    el.innerHTML = '<p class="sp-muted" style="margin:14px 0 10px">' + esc(tt.places(list.length)) + ' · ' + esc(dateLabelShort()) + '</p>' +
      (list.length ? '<div class="sp-grid">' + list.slice(0, S.exploreN).map(item).join('') + '</div>' : '<div class="sp-empty">' + esc(tt.noResults) + '</div>') +
      (list.length > S.exploreN ? '<button class="sp-btn ghost full" data-act="more" style="margin-top:6px">' + esc(tt.showMore) + '</button>' : '');
  }

  // Crowd tab (Nov 2026): quietest first, with type filter + sort; busy places shrink to one line at the bottom.
  var CTYPES = { nature: ['nature'], temples: ['spiritual'], trek: ['trek', 'adventure'], culture: ['culture', 'offbeat'] };
  function crowdList() {
    var snowSet = null;
    if (S.cType === 'snow') { try { snowSet = PPSnow.snowFor(ymd(planDate())); } catch (e) { snowSet = new Set(); } }
    var match = function (p) {
      if (crowd(p).closed) return false;
      if (S.cType === 'snow') return snowSet.has(p.id);
      var want = CTYPES[S.cType]; if (!want) return true;
      return (p.vibes || []).some(function (v) { return want.indexOf(v) >= 0; });
    };
    var all = places().filter(match);
    // Trip-worthy places only, unless that leaves too few for this filter.
    var list = all.filter(function (p) { return tier(p) === 'A'; });
    if (list.length < 8) list = all;
    if (S.cSort === 'close') return sortBy(list, function (p) { var r = travel(p); return (r ? r.hours : 99) * 100 + crowd(p).value / 2; });
    return sortBy(list, sortVal);
  }
  function renderCrowd() {
    var tt = t(), el = $('spCrowd'); if (!el) return;
    var o = curDate(), note = o.names || '';
    if (!note) {
      try {
        var di = PP_CROWD.dayInfo(o.d || new Date());
        if (di && di.run && di.run.isLong) note = (di.run.names || []).join(', ') + ' · ' + fmtRange(di.run.start, di.run.end);
      } catch (e) { /* no calendar */ }
    }
    var types = [['all', tt.all], ['nature', tt.cNature], ['temples', tt.temples], ['trek', tt.cTrek], ['culture', tt.cCulture], ['snow', tt.snow]];
    var chip = function (act, key, on, label) { return '<button class="sp-chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-key="' + key + '" aria-pressed="' + on + '">' + esc(label) + '</button>'; };
    el.innerHTML = '<div class="sp-wrap"><h1 class="sp-h1" style="font-size:34px">' + esc(tt.crowdTitle) + '</h1><p class="sp-sub">' + esc(dateLabelShort()) + (note ? ' · ' + esc(note) : '') + '</p>' +
      '<div class="sp-scroll" style="margin:14px -16px 0;padding:0 16px">' + types.map(function (x) { return chip('ctype', x[0], S.cType === x[0], x[1]); }).join('') + '</div>' +
      '<div class="sp-sortrow"><span class="sp-sl">' + esc(tt.sortLbl) + '</span>' + chip('csort', 'quiet', S.cSort === 'quiet', tt.sQuiet) + chip('csort', 'close', S.cSort === 'close', tt.sClose + ' (' + S.origin + ')') + '</div>' +
      '<div id="spCrList"></div></div>';
    renderCrowdList();
  }
  function renderCrowdList() {
    var tt = t(), el = $('spCrList'); if (!el) return;
    var list = crowdList();
    var open = places().filter(function (p) { return !crowd(p).closed; });
    var busy = sortBy(open, function (p) { return -crowd(p).value; }).slice(0, 5);
    el.innerHTML = '<p class="sp-muted" style="margin:12px 0 10px">' + esc(tt.places(list.length)) + '</p>' +
      (list.length ? '<div class="sp-grid">' + list.slice(0, S.crowdN).map(item).join('') + '</div>' : '<div class="sp-empty">' + esc(tt.noneHere) + '</div>') +
      (list.length > S.crowdN ? '<button class="sp-btn ghost full" data-act="cmore" style="margin-top:6px">' + esc(tt.showMore) + '</button>' : '') +
      (busy.length ? '<p class="sp-busyline"><b>' + esc(S.dateKey === 'now' ? tt.busyNow : tt.busyOn + ' ' + dateLabelShort()) + ':</b> ' +
        busy.map(function (p) { return '<button class="sp-link" data-act="open" data-id="' + p.id + '">' + esc(p.name) + '</button>'; }).join(', ') + '</p>' : '');
  }

  function plans() { try { return JSON.parse(localStorage.getItem('pp_plans') || '[]'); } catch (e) { return []; } }
  function renderSaved() {
    var tt = t(), el = $('spSaved'); if (!el) return;
    var ids = saved(), list = places().filter(function (p) { return ids.indexOf(p.id) >= 0; });
    var html = '<div class="sp-wrap"><h1 class="sp-h1" style="font-size:34px">' + esc(tt.savedTitle) + '</h1><div class="sp-sec">';
    if (!list.length) html += '<div class="sp-empty">' + esc(tt.savedEmpty) + '</div>';
    else html += '<div class="sp-grid">' + list.map(item).join('') + '</div><button class="sp-btn full" data-act="share-list" style="margin-top:6px;background:#1f8f4e">💬 ' + esc(tt.sendFamily) + '</button>';
    html += '</div>';
    var pl = plans();
    if (pl.length) {
      html += '<div class="sp-sec"><h2 class="sp-h2" style="font-size:22px;margin-bottom:12px">' + esc(tt.plansTitle) + '</h2>' + pl.map(function (x, i) {
        return '<details class="sp-plan"><summary style="cursor:pointer;font-weight:600;min-height:32px">' + esc(x.name) + ' · ' + esc(x.nights) + 'N · ' + esc(x.date) + '</summary><pre>' + esc(x.text) + '</pre>' +
          '<button class="sp-link" data-act="plan-del" data-i="' + i + '">' + esc(tt.remove) + '</button></details>';
      }).join('') + '</div>';
    }
    el.innerHTML = html + '</div>';
  }

  /* ---------------- tabs / routing ---------------- */
  var OLD = { plan: 'plansec', map: 'mapwrap', stays: 'stays-bg' };
  function show(tab, opts) {
    opts = opts || {};
    if (['home', 'explore', 'crowd', 'plan', 'saved', 'map', 'stays'].indexOf(tab) < 0) tab = 'home';
    if (FREEZE && tab === 'stays') { tab = 'home'; setTimeout(function () { openStay(); }, 0); }
    S.tab = tab;
    try {
      var pd = $('pd');
      if (pd && getComputedStyle(pd).display !== 'none' && typeof closePD === 'function' && !opts.keepPD) closePD();
    } catch (e) { /* ignore */ }
    var home = $('view-home');
    if (home && !home.classList.contains('active')) {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
      home.classList.add('active');
    }
    ['spHome', 'spExplore', 'spCrowd', 'spSaved'].forEach(function (id) { var e = $(id); if (e) e.classList.toggle('on', id === 'sp' + tab.charAt(0).toUpperCase() + tab.slice(1)); });
    Object.keys(OLD).forEach(function (k) { var e = $(OLD[k]); if (e) e.classList.toggle('sp-show', k === tab); });
    var foot = document.querySelector('#view-home > footer'); if (foot) foot.classList.toggle('sp-show', tab === 'home');
    var legal = foot && foot.nextElementSibling; if (legal && legal.classList.contains('sp-old')) legal.classList.toggle('sp-show', tab === 'home');
    if (tab === 'plan') preparePlan();
    if (tab === 'map') setTimeout(function () { try { initMap(); _lmap && _lmap.invalidateSize(); } catch (e) { /* map not ready */ } mapQuietFirst(); }, 60);
    render();
    updateTabs();
    var hash = tab === 'home' ? '' : '#/' + tab;
    if (!opts.fromHash && location.hash !== hash) { try { history.pushState(null, '', location.pathname + location.search + hash); } catch (e) { /* ignore */ } }
    if (!opts.keepScroll) window.scrollTo(0, 0);
  }
  function updateTabs() {
    var active = S.tab === 'map' ? 'explore' : S.tab === 'stays' ? 'home' : S.tab;
    var tabs = $('spTabs');
    if (tabs) tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === active); b.setAttribute('aria-current', b.dataset.tab === active ? 'page' : 'false'); });
    document.querySelectorAll('nav .nl a[data-tab]').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === S.tab); });
  }
  function render() {
    _cc = {};
    // Snow finder and the map's Snow / Quiet buttons follow the "Going" date too (they used this Saturday / right now).
    try { if (window.PPSnow && PPSnow.setDate) PPSnow.setDate(ymd(planDate())); } catch (e) { /* ignore */ }
    try { if (S.tab === 'map' && typeof _mFilter !== 'undefined' && _mFilter === 'quiet') { var qb = document.querySelector('#mapwrap .map-filter-btn.quiet-only'); if (qb) mapFilter('quiet', qb); } } catch (e) { /* map not ready */ }
    renderBar();
    if (S.tab === 'home') renderHome();
    else if (S.tab === 'explore') renderExplore();
    else if (S.tab === 'crowd') renderCrowd();
    else if (S.tab === 'saved') renderSaved();
  }

  var ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    explore: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    crowd: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/>',
    plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    saved: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'
  };
  function renderChrome() {
    var tt = t();
    var tabs = $('spTabs');
    if (tabs) tabs.innerHTML = TABS.map(function (k, i) {
      var n = k === 'saved' && saved().length ? ' (' + saved().length + ')' : '';
      return '<button data-tab="' + k + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>' + esc(tt.tabs[i] + n) + '</button>';
    }).join('');
    var nl = document.querySelector('nav .nl');
    if (nl) nl.innerHTML = ['explore', 'crowd', 'plan', 'saved'].map(function (k) { return '<li><a data-tab="' + k + '" href="#/' + k + '">' + esc(tt.tabs[TABS.indexOf(k)]) + '</a></li>'; }).join('') +
      '<li><a data-tab="stays" href="#/stays">🏡 ' + esc(tt.stays) + '</a></li>' + '<li><a href="/blog">' + esc(tt.blog) + '</a></li>';
    var lang = $('spLang');
    if (lang) lang.innerHTML = '<button data-lang="en" class="' + (S.lang === 'en' ? 'on' : '') + '" aria-pressed="' + (S.lang === 'en') + '">EN</button><button data-lang="hi" lang="hi" class="' + (S.lang === 'hi' ? 'on' : '') + '" aria-pressed="' + (S.lang === 'hi') + '">हिंदी</button>';
    document.documentElement.lang = S.lang === 'hi' ? 'hi' : 'en';
    drawerLabels();
    cookieText();
    updateTabs();
  }

  /* ---------------- plan tab ---------------- */
  var _planTouched = false;
  var _sugInit = false;
  function prepareSuggest() {
    if (!window.PPTrip || !$('tfForm')) return;
    var tt = t(), k = $('tfModeKnow'), g = $('tfModeSuggest');
    if (k) k.textContent = '📍 ' + tt.knowWhere;
    if (g) g.textContent = '✨ ' + tt.suggestMe;
    var o = $('tfOrigin');
    if (o && S.origin && Array.prototype.some.call(o.options, function (x) { return x.value === S.origin; })) { o.value = S.origin; PPTrip.pick(S.origin); }
    var td = $('tfDate'); if (td && !_planTouched) td.value = ymd(planDate());
    if (!_sugInit) {
      _sugInit = true;
      // first visit with no place chosen: start on "Suggest a place for me"
      if (!+(($('ppPlace') || {}).value || 0)) PPTrip.setMode('suggest');
    }
  }
  function preparePlan() {
    prepareSuggest();
    var d = $('ppDate');
    if (d && !_planTouched) d.value = ymd(planDate());
    if (!$('spPlanBar')) {
      var res = $('planRes'), bar = document.createElement('div');
      bar.id = 'spPlanBar';
      if (res && res.parentNode) res.parentNode.insertBefore(bar, res.nextSibling);
    }
    renderPlanBar();
  }
  function renderPlanBar() {
    var bar = $('spPlanBar'); if (!bar) return;
    var id = +(($('ppPlace') || {}).value || 0), tt = t();
    bar.style.display = id ? 'flex' : 'none';
    bar.innerHTML = '<button class="sp-btn light" data-act="plan-save">💾 ' + esc(tt.savePlan) + '</button><button class="sp-btn" style="background:#1f8f4e" data-act="plan-share">💬 ' + esc(tt.sharePlan) + '</button>' +
      '<button class="sp-btn clay" data-act="stay" data-id="' + id + '">' + esc(tt.stayHere) + '</button>';
  }
  function planFor(id) {
    var p = places().find(function (x) { return x.id === +id; }); if (!p) return;
    _sugInit = true;
    if (window.PPTrip && $('tfForm')) PPTrip.setMode('know');
    show('plan');
    var d = $('ppDate'); if (d) d.value = ymd(planDate());
    var n = $('ppNights'); if (n && S.help.days) n.value = S.help.days;
    try { selectPlanPlace(p.id, p.name); } catch (e) { console.warn('[simple] plan failed', e); }
    renderPlanBar();
    setTimeout(function () { var r = $('planRes'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250);
  }
  function savePlan() {
    var id = +(($('ppPlace') || {}).value || 0), p = places().find(function (x) { return x.id === id; }); if (!p) return;
    var res = $('planRes');
    var text = res ? res.innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000) : '';
    var list = plans().filter(function (x) { return !(x.id === id && x.date === ($('ppDate') || {}).value); });
    list.unshift({ id: id, name: p.name, date: ($('ppDate') || {}).value || '', nights: ($('ppNights') || {}).value || '2', text: text, at: Date.now() });
    store('pp_plans', JSON.stringify(list.slice(0, 10)));
    try { toast('✓ ' + t().planSaved); } catch (e) { /* ignore */ }
  }
  function sharePlan() {
    var id = +(($('ppPlace') || {}).value || 0), p = places().find(function (x) { return x.id === id; }); if (!p) return;
    var txt = '🏔️ ' + p.name + ' · ' + (($('ppNights') || {}).value || 2) + ' nights · ' + (($('ppDate') || {}).value || '') + '\n' + word(p).w + ' · ' + reach(p) +
      '\nhttps://paharipath.in/destination/' + (p.slug || '');
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  }
  function shareList() {
    var ids = saved(), list = places().filter(function (p) { return ids.indexOf(p.id) >= 0; }); if (!list.length) return;
    var tt = t();
    var txt = '🏔️ ' + tt.waList(dateLabelShort()) + '\n\n' + list.map(function (p, i) {
      return (i + 1) + ') ' + p.name + ' — ' + word(p).w + ', ' + reach(p) + '\nhttps://paharipath.in/destination/' + (p.slug || '');
    }).join('\n\n') + '\n\n' + tt.waVote;
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  }

  /* ---------------- stay request sheet ---------------- */
  function openStay(id) {
    var tt = t(), sheet = $('spSheet'); if (!sheet) return;
    var p = places().find(function (x) { return x.id === +id; });
    var name = load('pp_name', ''), phone = load('pp_phone', '');
    var budgets = [['b1', tt.b1], ['b2', tt.b2], ['b3', tt.b3]];
    sheet.innerHTML = '<div class="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="spStayT"><div style="display:flex;justify-content:space-between;align-items:center"><h2 id="spStayT" class="sp-h2">' + esc(tt.formTitle) + '</h2>' +
      '<button class="sp-x" data-act="sheet-close" aria-label="' + esc(tt.close) + '">✕</button></div><p class="sp-muted" style="line-height:1.5;margin:6px 0 0">' + esc(tt.staySub) + '</p>' +
      '<form data-form="stay" novalidate>' +
      '<label class="sp-field">' + esc(tt.fWhere) + '<input name="where" list="spPlaceList" placeholder="' + esc(tt.wherePh) + '" value="' + esc(p ? p.name : '') + '" required maxlength="80"></label>' +
      '<datalist id="spPlaceList">' + places().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('') + '</datalist>' +
      '<div class="sp-2"><label class="sp-field">' + esc(tt.fWhen) + '<input name="when" type="date" min="' + ymd(new Date()) + '" value="' + ymd(curDate().d || new Date(Date.now() + 7 * 864e5)) + '"></label>' +
      '<label class="sp-field">' + esc(tt.fGuests) + '<input name="guests" type="number" min="1" max="20" value="2" inputmode="numeric"></label></div>' +
      '<div class="sp-field">' + esc(tt.fBudget) + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + budgets.map(function (b) {
        return '<button type="button" class="sp-chip big' + (S.budget === b[0] ? ' on' : '') + '" data-act="budget" data-b="' + b[0] + '">' + esc(b[1]) + '</button>';
      }).join('') + '</div></div>' +
      '<label class="sp-field">' + esc(tt.fName) + '<input name="name" autocomplete="name" value="' + esc(name) + '" required maxlength="100"></label>' +
      '<label class="sp-field">' + esc(tt.fPhone) + '<input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98xxxxxxxx" value="' + esc(phone) + '" required maxlength="13"></label>' +
      '<label class="sp-field">' + esc(tt.fNote) + '<input name="note" maxlength="300"></label>' +
      '<button class="sp-btn clay full" type="submit" style="margin-top:16px;min-height:52px">' + esc(tt.send) + '</button><p class="sp-muted" style="text-align:center;margin:10px 0 0">' + esc(tt.free) + '</p>' +
      '<p style="text-align:center;margin:12px 0 0"><a href="/sample-stays" style="color:var(--pine);font-weight:600">' + esc(tt.stayBrowse) + ' →</a></p></form></div>';
    sheet.classList.add('on');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { var f = sheet.querySelector('input[name="' + (p ? 'name' : 'where') + '"]'); if (f && !f.value) f.focus(); }, 50);
  }
  function closeSheet() { var s = $('spSheet'); if (s) { s.classList.remove('on'); s.innerHTML = ''; } document.body.style.overflow = ''; }
  function sendStay(form) {
    var tt = t(), f = form.elements, btn = form.querySelector('button[type="submit"]');
    var name = f.name.value.trim(), phone = f.phone.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!name) { toast(tt.needName); f.name.focus(); return; }
    if (!/^\d{10}$/.test(phone)) { toast(tt.needPhone); f.phone.focus(); return; }
    store('pp_name', name); store('pp_phone', phone);
    var budget = { b1: 'Under ₹2,000', b2: '₹2,000–3,500', b3: '₹3,500+' }[S.budget];
    var msg = 'STAY REQUEST\nWhere: ' + f.where.value.trim() + '\nCheck-in: ' + f.when.value + '\nGuests: ' + f.guests.value + '\nBudget/night: ' + budget +
      '\nComing from: ' + S.origin + (f.note.value.trim() ? '\nNote: ' + f.note.value.trim() : '') + '\nLanguage: ' + (S.lang === 'hi' ? 'Hindi' : 'English');
    btn.disabled = true; btn.textContent = tt.sending;
    fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', name: name, contact: phone, category: 'stay-request', message: msg }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || 'failed'); return j; }); })
      .then(function () {
        try { if (window.plausible) plausible('Stay request'); } catch (e) { /* analytics optional */ }
        $('spSheet').querySelector('.sp-sheet').innerHTML = '<div style="padding:8px 0"><div style="width:52px;height:52px;border-radius:26px;background:#dcefe2;display:flex;align-items:center;justify-content:center;font-size:26px">✓</div>' +
          '<h2 class="sp-h2" style="margin-top:12px">' + esc(tt.sentTitle) + '</h2><p style="font-size:15px;line-height:1.5;color:#2b3830">' + esc(tt.sentSub) + '</p><button class="sp-btn full" data-act="sheet-close">' + esc(tt.done) + '</button></div>';
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = tt.send;
        toast((e && e.message && e.message !== 'failed' ? e.message : tt.failed));
      });
  }

  /* ---------------- place page bar (inside existing #pd overlay) ---------------- */
  function addPdBar(id) {
    var pd = $('pd'); if (!pd) return;
    var bar = $('spPdBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'spPdBar'; pd.appendChild(bar); }
    var tt = t();
    bar.innerHTML = '<button class="sp-btn ghost" data-act="stay" data-id="' + id + '">' + esc(tt.stayHere) + '</button><button class="sp-btn clay" data-act="plan" data-id="' + id + '">' + esc(tt.planHere) + '</button>';
  }

  /* ---------------- events ---------------- */
  function onClick(e) {
    var b = e.target.closest('[data-act],[data-tab],[data-lang]'); if (!b) return;
    if (b.dataset.lang) { S.lang = b.dataset.lang; store('pp_lang', S.lang); renderChrome(); render(); return; }
    var act = b.dataset.act;
    if (!act && b.dataset.tab) { e.preventDefault(); show(b.dataset.tab); return; }
    var id = b.dataset.id ? +b.dataset.id : null;
    switch (act) {
      case 'tab': show(b.dataset.tab); break;
      case 'date': S.dateKey = b.dataset.key; _planTouched = false; render(); break;
      case 'pickdate': var di = $('spDateIn'); if (di) { try { di.showPicker(); } catch (x) { di.style.pointerEvents = 'auto'; di.focus(); di.click(); } } break;
      case 'open': try { openPD(id); addPdBar(id); } catch (x) { console.warn(x); } break;
      case 'plan': planFor(id); break;
      case 'save': toggleSaved(id); break;
      case 'help-open': S.help.step = 2; S.help.city = S.origin; renderHome(); break; // city comes from 'Travelling from'
      case 'help-close': S.help.step = 0; renderHome(); break;
      case 'help-restart': S.help = { step: 2, city: S.origin, days: null, like: null, kids: S.help.kids }; renderHome(); break;
      case 'help-answer': helpAnswer(b.dataset.val); break;
      case 'chip': S.chip = b.dataset.chip; S.exploreN = 20; renderExplore(); break;
      case 'more': S.exploreN += 20; renderExploreList(); break;
      case 'ctype': S.cType = b.dataset.key; S.crowdN = 20; renderCrowd(); break;
      case 'csort': S.cSort = b.dataset.key; S.crowdN = 20; renderCrowd(); break;
      case 'cmore': S.crowdN += 20; renderCrowdList(); break;
      case 'how-ok': S.seenHow = true; store('pp_seen_how', '1'); renderHome(); break;
      case 'region': S.region = b.dataset.key; S.q = ''; S.chip = 'all'; S.exploreN = 20; show('explore'); window.scrollTo(0, 0); break;
      case 'region-clear': S.region = null; S.exploreN = 20; renderExplore(); break;
      case 'snow': try { if (PPSnow.setDate) PPSnow.setDate(ymd(planDate())); PPSnow.open(); } catch (x) { /* ignore */ } break;
      case 'stay': openStay(id); break;
      case 'sheet-close': closeSheet(); break;
      case 'budget': S.budget = b.dataset.b; b.parentNode.querySelectorAll('.sp-chip').forEach(function (c) { c.classList.toggle('on', c === b); }); break;
      case 'share-list': shareList(); break;
      case 'plan-save': savePlan(); break;
      case 'plan-share': sharePlan(); break;
      case 'plan-del': var pl = plans(); pl.splice(+b.dataset.i, 1); store('pp_plans', JSON.stringify(pl)); renderSaved(); break;
    }
  }
  function helpAnswer(v) {
    var h = S.help;
    if (h.step === 1) {
      if (v === '__other') { var sel = $('spFrom'); if (sel) { sel.focus(); try { sel.showPicker(); } catch (x) { /* older browsers */ } } h.city = S.origin; }
      else { h.city = v; if (v !== '__hp') { S.origin = v; store('pp_origin', v); _tc = {}; syncOrigin(); renderBar(); } }
    } else if (h.step === 2) h.days = v;
    else h.like = v;
    h.step++;
    try { if (h.step === 4 && window.plausible) plausible('Help me choose', { props: { like: h.like, days: h.days } }); } catch (x) { /* optional */ }
    renderHome();
  }
  function toggleSaved(id) {
    var list = saved().slice(), i = list.indexOf(id), p = places().find(function (x) { return x.id === id; });
    if (i >= 0) list.splice(i, 1); else list.push(id);
    try { saveSaved(list); } catch (e) { /* ignore */ }
    try { toast(i >= 0 ? 'Removed ' + (p ? p.name : '') : '❤️ ' + (p ? p.name : '')); } catch (e) { /* ignore */ }
    renderChrome(); render();
  }
  function onInput(e) {
    if (e.target.id === 'spQ2') { S.q = e.target.value; S.exploreN = 20; renderExploreList(); }
    else if (e.target.id === 'spQ') { S.q = e.target.value; }
  }
  function onChange(e) {
    var tg = e.target;
    if (tg.id === 'spFrom') { S.origin = tg.value; store('pp_origin', S.origin); _tc = {}; syncOrigin(); render(); }
    else if (tg.id === 'spDateIn' && tg.value) { var p = tg.value.split('-'); S.customDate = new Date(+p[0], +p[1] - 1, +p[2]); S.dateKey = 'custom'; _dopts = null; _planTouched = false; render(); }
    else if (tg.id === 'spKids') { S.help.kids = tg.checked; renderHome(); }
    else if (tg.id === 'ppDate' || tg.id === 'ppNights') { _planTouched = true; }
    else if (tg.id === 'ppPlace') renderPlanBar();
  }
  function onSubmit(e) {
    var f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'search') { var i = f.querySelector('input'); S.q = i ? i.value : ''; S.chip = 'all'; S.exploreN = 20; show('explore'); }
    else if (f.dataset.form === 'stay') sendStay(f);
  }

  /* ---------------- freeze (no real hosts / bookings yet) ---------------- */
  function freeze() {
    document.body.classList.add('pp-freeze');
    var tag = function (el) { if (el) el.classList.add('sp-frz'); };
    var byText = function (sel, re) { Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) { if (re.test(el.textContent)) tag(el); }); };
    byText('nav .nr .nb', /My Profile|Find Stays|Book a Stay/);           // traveller login / PAHADI, booking buttons
    byText('#mobDrawer .mob-link', /My Profile|Find Stays/);
    tag(document.querySelector('#mobDrawer .mob-footer'));                  // Find Stays / Book a Stay
    byText('footer a, #view-home a', /Manage \/ Cancel Booking/);
    var st = $('pdstays'); if (st && st.parentNode) tag(st.parentNode);     // "Stays in X · book directly" on place pages
    // Help & Support: no booking / payment / PAHADI topics or booking reference while those are paused.
    var origSup = window.openSupportMo;
    if (typeof origSup === 'function') window.openSupportMo = function () {
      var r = origSup.apply(this, arguments);
      try {
        var sel = $('supCategory');
        if (sel) Array.prototype.slice.call(sel.options).forEach(function (o) { if (/^(booking|payment|account|host)$/.test(o.value)) o.remove(); });
        var ref = $('supBookingRef'); if (ref && ref.parentNode) ref.parentNode.style.display = 'none';
      } catch (e) { /* form changed */ }
      return r;
    };
    byText('#mapwrap .map-filter-btn', /Has Stays/);                         // map filter that only finds placeholder stays
  }

  /* ---------------- shorter cookie text (fits two lines on a phone) ---------------- */
  function cookieText() {
    var cb = $('cookieBanner'), d = cb && cb.firstElementChild; if (!d) return;
    var hi = S.lang === 'hi';
    d.innerHTML = '🍪 ' + (hi ? 'सिर्फ़ बेसिक एनालिटिक्स — कोई विज्ञापन नहीं।' : 'Basic analytics only — no ads.') +
      ' <a href="#" onclick="showPrivacy();return false;" style="color:#7fd4a0;text-decoration:underline">' + (hi ? 'प्राइवेसी' : 'Privacy') + '</a>';
    var on = function () { document.body.classList.toggle('sp-cookie-on', getComputedStyle(cb).display !== 'none'); };
    on(); if (!cb._spObs) { cb._spObs = new MutationObserver(on); cb._spObs.observe(cb, { attributes: true, attributeFilter: ['style'] }); }
    var bs = cb.querySelectorAll('button');
    if (bs[0]) bs[0].textContent = hi ? 'ठीक है' : 'Accept';
    if (bs[1]) bs[1].textContent = hi ? 'नहीं' : 'Decline';
  }

  /* ---------------- side menu: Home + Saved at the top ---------------- */
  function drawerExtras() {
    var links = document.querySelector('#mobDrawer .mob-links'); if (!links || $('spDrHome')) return;
    var mk = function (id, icon, tab) {
      var d = document.createElement('div'); d.className = 'mob-link'; d.id = id; d.dataset.tab = tab;
      d.innerHTML = '<span class="ml-icon">' + icon + '</span><span class="sp-drl"></span>';
      d.addEventListener('click', function () { try { closeMobMenu(); } catch (e) { /* ignore */ } });
      return d;
    };
    links.insertBefore(mk('spDrSaved', '♡', 'saved'), links.firstChild);
    links.insertBefore(mk('spDrHome', '🏠', 'home'), links.firstChild);
    drawerLabels();
  }
  function drawerLabels() {
    var tt = t();
    [['spDrHome', 0], ['spDrSaved', 4]].forEach(function (x) { var e = $(x[0]); if (e) e.querySelector('.sp-drl').textContent = tt.tabs[x[1]]; });
  }

  /* ---------------- map: simpler (Nov 2026) ---------------- */
  // 4 buttons (Quiet · Snow · Near me · All), no name search, no public "Add a Place" pins (nobody moderating yet).
  function simplifyMap() {
    var wrap = $('mapwrap'); if (!wrap) return;
    var btns = wrap.querySelectorAll('.map-filter-btn'), all = null;
    Array.prototype.forEach.call(btns, function (b) {
      var x = b.textContent;
      if (/All 146/.test(x)) all = b;
      else if (!/Quiet|Snow|Near Me/.test(x)) b.classList.add('sp-map-off');
    });
    if (all && all.parentNode) all.parentNode.appendChild(all);   // "All" last; map opens on Quiet
    ['msSearch', 'addPinBtn'].forEach(function (id) { var e = $(id); if (e) e.classList.add('sp-map-off'); });
  }
  var _mapQuiet = false;
  function mapQuietFirst() {
    if (_mapQuiet) return;
    var tries = 0;
    (function go() {
      var ready = false; try { ready = !!_lmap && Object.keys(_markers || {}).length > 0; } catch (e) { /* not yet */ }
      if (ready) {
        var q = document.querySelector('#mapwrap .map-filter-btn.quiet-only');
        if (q) { try { mapFilter('quiet', q); _mapQuiet = true; } catch (e) { /* ignore */ } }
        return;
      }
      if (++tries < 30) setTimeout(go, 150);
    })();
  }

  /* ---------------- boot ---------------- */
  function boot() {
    var home = $('view-home'); if (!home || $('spRoot')) return;
    document.body.classList.add('sp');
    // Hide the old long homepage; keep it in the DOM so its code still works.
    Array.prototype.forEach.call(home.children, function (c) { c.classList.add('sp-old'); });
    var root = document.createElement('div');
    root.id = 'spRoot';
    root.innerHTML = '<div id="spBar"></div><div id="spHome" class="sp-screen on"></div><div id="spExplore" class="sp-screen"></div><div id="spCrowd" class="sp-screen"></div><div id="spSaved" class="sp-screen"></div>';
    home.insertBefore(root, home.firstChild);
    var tabs = document.createElement('div'); tabs.id = 'spTabs'; tabs.setAttribute('role', 'navigation'); tabs.setAttribute('aria-label', 'Main'); document.body.appendChild(tabs);
    var sheet = document.createElement('div'); sheet.id = 'spSheet'; document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    // Header: language switch, hide duplicate stay buttons.
    var nr = document.querySelector('nav .nr');
    if (nr) {
      var lang = document.createElement('div'); lang.id = 'spLang'; lang.className = 'sp-lang'; lang.setAttribute('role', 'group'); lang.setAttribute('aria-label', 'Language');
      nr.insertBefore(lang, nr.firstChild);
      Array.prototype.forEach.call(nr.querySelectorAll('.nb'), function (b) { if (/Find Stays|Book a Stay/.test(b.textContent)) b.classList.add('sp-hide-btn'); });
    }
    if (FREEZE) freeze();
    syncOrigin();
    simplifyMap();
    drawerExtras();
    cookieText();
    var hostLink = document.querySelector('nav .nr .nr-host'); if (hostLink) hostLink.classList.add('sp-nav-off'); // owners: side menu + footer
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('spSheet') && $('spSheet').classList.contains('on')) closeSheet(); });
    window.addEventListener('popstate', fromHash);
    // Track which view is active so the tab bar hides on host/admin screens.
    var syncView = function () { document.body.classList.toggle('sp-home-view', home.classList.contains('active')); };
    new MutationObserver(syncView).observe(home, { attributes: true, attributeFilter: ['class'] });
    syncView();

    // Old navigation calls goTo('crowd') etc. — send them to the new tabs.
    var origGoTo = window.goTo;
    window.goTo = function (id) {
      var map = { crowd: 'crowd', explore: 'explore', plansec: 'plan', mapwrap: 'map', 'stays-bg': 'stays' };
      if (map[id]) return show(map[id]);
      return origGoTo && origGoTo.apply(this, arguments);
    };
    // Re-render when app data (places, photos, crowd news) finishes loading.
    var origRenderAll = window.renderAll;
    if (typeof origRenderAll === 'function') window.renderAll = function () { var r = origRenderAll.apply(this, arguments); _cc = {}; _tc = {}; render(); return r; };
    var origOpenPD = window.openPD;
    if (typeof origOpenPD === 'function') window.openPD = function (id) { var r = origOpenPD.apply(this, arguments); try { addPdBar(id); } catch (e) { /* ignore */ } return r; };
    var origRunFC = window.runFC;
    if (typeof origRunFC === 'function') window.runFC = function () { var r = origRunFC.apply(this, arguments); setTimeout(renderPlanBar, 0); return r; };
    try { if (window.PPSnow && PPSnow.ready) PPSnow.ready().then(function () { render(); }, function () { /* estimates */ }); } catch (e) { /* ignore */ }

    renderChrome();
    fromHash();
  }
  function fromHash() {
    var m = (location.hash || '').match(/^#\/(\w+)/);
    show(m ? m[1] : 'home', { fromHash: true, keepScroll: !m });
  }

  // Map 'Quiet only' (app.js): quiet on the chosen date, open, and in season — not snowbound passes showing 3%.
  window.PP_QUIET = function (p) { return crowd(p).value < 45 && !shut(p); };
  window.PPSimple = { show: show, render: render, planFor: planFor, openStay: openStay, state: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
