/* elements.js — Camp's breakdown elements: the industry-standard categories (cast, background, stunts,
   vehicles, props, wardrobe, makeup, SFX, VFX, animals…) found in each scene, plus everything the user
   has tagged, removed, renamed or merged by hand.

   It sits on top of breakdown.js (scenes, eighths, cast, flags) and needs no Apps Script copy: the
   suggestions are made in the browser and only the user's changes are stored.

   Browser: window.CampElements.build(doc, breakdown, store)
   Node:    require("./elements.js").build(doc, breakdown, store)

   store (all optional; this is what gets saved):
     tags:  { sceneKey: [{ c: catId, n: "Name" }] }   elements added to one scene by hand
     off:   { sceneKey: [elementKey] }                 an element taken out of one scene
     drop:  [elementKey]                               an element ignored everywhere
     alias: { elementKey: elementKey }                 rename / merge / move to another category
     names: { elementKey: "Display name" }             the name to show for an element
     notes: { elementKey: "text" }                     notes on an element (shown on every sheet)
     scene: { sceneKey: { syn, day, est, unit, note } } per-scene sheet fields typed by the user
   sceneKey = the scene heading's line id (or "n" + scene number before ids exist).
   elementKey = catId + "|" + normalised name, e.g. "props|shotgun". */
(function (root) {
"use strict";

// ---------- Categories (industry standard, in breakdown-sheet order, with the usual tag colours) ----------
const CATS = [
  { id: "cast",       label: "Cast members",        color: "#e03131", short: "Cast" },
  { id: "background", label: "Background actors",   color: "#2f9e44", short: "BG" },
  { id: "stunts",     label: "Stunts",              color: "#f76707", short: "Stunts" },
  { id: "vehicles",   label: "Vehicles",            color: "#d6336c", short: "Vehicles" },
  { id: "props",      label: "Props",               color: "#7048e8", short: "Props" },
  { id: "weapons",    label: "Weapons",             color: "#5c2d91", short: "Weapons" },
  { id: "wardrobe",   label: "Wardrobe",            color: "#1098ad", short: "Wardrobe" },
  { id: "makeup",     label: "Makeup / hair",       color: "#e64980", short: "Makeup" },
  { id: "sfx",        label: "Special effects",     color: "#1c7ed6", short: "SFX" },
  { id: "mfx",        label: "Mechanical effects",  color: "#4263eb", short: "MFX" },
  { id: "vfx",        label: "Visual effects",      color: "#3b5bdb", short: "VFX" },
  { id: "animals",    label: "Animals",             color: "#5c940d", short: "Animals" },
  { id: "wrangler",   label: "Animal wrangler",     color: "#74b816", short: "Wrangler" },
  { id: "music",      label: "Music",               color: "#a0522d", short: "Music" },
  { id: "sound",      label: "Sound",               color: "#8d6e63", short: "Sound" },
  { id: "art",        label: "Art department",      color: "#c2255c", short: "Art" },
  { id: "setdress",   label: "Set dressing",        color: "#9c6644", short: "Set dressing" },
  { id: "greenery",   label: "Greenery",            color: "#37b24d", short: "Greenery" },
  { id: "camera",     label: "Camera",              color: "#495057", short: "Camera" },
  { id: "equipment",  label: "Special equipment",   color: "#868e96", short: "Equipment" },
  { id: "security",   label: "Security",            color: "#343a40", short: "Security" },
  { id: "labor",      label: "Additional labour",   color: "#f59f00", short: "Labour" },
  { id: "misc",       label: "Miscellaneous",       color: "#adb5bd", short: "Misc" }
];
const CAT = {}; CATS.forEach(function (c) { CAT[c.id] = c; });

// ---------- Text helpers ----------
function runsText(runs) { return Array.isArray(runs) ? runs.map(function (r) { return String((r && r.t) || ""); }).join("") : ""; }
function clean(s) { return String(s == null ? "" : s).replace(/[ ​﻿]/g, " ").replace(/\s+/g, " ").trim(); }
const DET = "(?:a|an|the|his|her|their|its|my|your|our|this|that|these|those|some|two|three|four|five|several|another|each|every|one)";
// The same determiners, matched case-sensitively so a lowercase word list never matches CAPS ("Two COPS watch")
const DETC = "(?:" + DET.slice(3, -1).split("|").map(function (w) { return "[" + w.charAt(0) + w.charAt(0).toUpperCase() + "]" + w.slice(1); }).join("|") + ")";
const NUM_DET_ = /^(two|three|four|five|several|one)$/i;
// Words that are also verbs: only a prop with "a/the/her…" right in front ("the watch", not "the kids watch")
const AMBIG_ = /^(watch|watches|ring|rings|file|files|sign|signs|record|records|tape|tapes|bill|drink|drinks|matches|box|boxes|book|books|whistle|needle|cards|mic|toy|bowl|bowls|ball)$/i;
const DET_LEAD_ = /^(?:a|an|the|his|her|their|its|my|your|our|this|that|these|those|some|another)\s+/i;
function singular(w) {
  w = String(w || "");
  const lw = w.toLowerCase();
  if (/(ss|us|is|ics|news|series|species|glasses|scissors|jeans|pants|trousers|shorts|pyjamas|pajamas|overalls|scrubs|clothes|sunglasses|headphones|binoculars|goggles|cattle|sheep|fish|deer|police)$/.test(lw)) return w;
  if (/knives$/.test(lw)) return w.slice(0, -3) + (w === w.toUpperCase() ? "FE" : "fe");
  if (/(ies)$/.test(lw) && lw.length > 4) return w.slice(0, -3) + (w === w.toUpperCase() ? "Y" : "y");
  if (/(sses|shes|ches|xes|zes)$/.test(lw)) return w.slice(0, -2);
  if (/oes$/.test(lw) && !/(shoes|toes|hoes|canoes)$/.test(lw)) return w.slice(0, -2);
  if (/[^s]s$/.test(lw) && lw.length > 3) return w.slice(0, -1);
  return w;
}
function norm(name) {
  let s = clean(name).toLowerCase().replace(/[“”"]/g, "").replace(/[’]/g, "'").replace(DET_LEAD_, "").replace(/[.,;:!?]+$/, "");
  const parts = s.split(" ");
  parts[parts.length - 1] = singular(parts[parts.length - 1]);
  return parts.join(" ").slice(0, 60);
}
function display(name, cat) {
  let s = clean(name).replace(DET_LEAD_, "").replace(/[.,;:!?]+$/, "").slice(0, 60);
  if (cat === "cast") return s.toUpperCase();
  if (cat !== "background") { const parts = s.split(" "); parts[parts.length - 1] = singular(parts[parts.length - 1]); s = parts.join(" "); }
  if (s === s.toUpperCase() && /[A-Z]{2}/.test(s) && !/^(TV|CCTV|SUV|4WD|VFX|SFX|DJ)$/.test(s)) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function key(cat, name) { return cat + "|" + norm(name); }

// ---------- Word lists ----------
const SOUND_CAPS_ = /^(BANG|BANGS|BOOM|BOOMS|CRASH|CRASHES|THUD|THUDS|SLAM|SLAMS|CLICK|CLICKS|BEEP|BEEPS|BEEPING|RING|RINGS|RINGING|RING RING|POP|WHAM|CRACK|SNAP|BUZZ|BUZZES|BUZZING|KNOCK|KNOCKS|KNOCKING|KNOCK KNOCK|SCREAM|SCREAMS|GUNSHOT|GUNSHOTS|BLAM|THWACK|SPLASH|HONK|HONKS|HONKING|DING|DINGS|TICK|TOCK|TICK TOCK|CREAK|CREAKS|CREAKING|SMASH|SHATTER|SHATTERS|WHOOSH|ROAR|ROARS|RUMBLE|RUMBLES|HISS|HISSES|SIREN|SIRENS|THUMP|THUMPS|CLANG|CLANK|CLATTER|BARK|BARKS|BARKING|VIBRATE|VIBRATES|VIBRATING|BLARES|WAIL|WAILS|SCREECH|SCREECHES|SQUEAL|CHIME|CHIMES|STATIC|FEEDBACK|BOOMING|THUNDER|ALARM|WHISTLE|SHRIEK)$/;
const CAPS_SKIP_ = /^(INT|EXT|I\/E|CUT|CUT TO|FADE|FADE IN|FADE OUT|DISSOLVE|DISSOLVE TO|SMASH CUT|MATCH CUT|V\.?O|O\.?S|O\.?C|CONT|CONT'D|CONTINUED|MORE|SUPER|SUPER:|TITLE|TITLE CARD|CARD|INSERT|CLOSE|CLOSE ON|CLOSE UP|CLOSE-UP|ECU|CU|MCU|MS|WS|ANGLE|ANGLE ON|POV|BACK TO|BACK TO SCENE|LATER|MOMENTS LATER|MONTAGE|END MONTAGE|SERIES OF SHOTS|FLASHBACK|END FLASHBACK|THE END|BLACK|INTERCUT|SFX|VFX|FX|OVER BLACK|ESTABLISHING|WIDE|WIDE SHOT|TIGHT|REVERSE|TRACKING|AERIAL|SLOW MOTION|FREEZE FRAME|OK|OKAY|NO|YES|NOT|NEVER|ALWAYS|NOW|STOP|HELP|ALL|EVERYTHING|NOTHING|SOMETHING|ANYTHING|VERY|REALLY|SO|TOO|HUGE|BIG|LOUD|FAST|HARD|EVERY|ONE|TWO|THREE|PRESENT DAY|DAY|NIGHT|MORNING|EVENING|SAME|SAME TIME|CONTINUOUS|BEAT|PAUSE|SILENCE|DREAM|DREAM SEQUENCE|PRE-LAP|PRELAP|ON SCREEN|ONSCREEN|TEXT|TEXT MESSAGE|CHYRON|LEGEND|SUBTITLE|SUBTITLES|NOTE|TBC|TV|CCTV|PHONE|SCREEN|LAPTOP)$/;
// People written in CAPS who aren't in the cast: background, not props
const PEOPLE_ = /^(MAN|MEN|WOMAN|WOMEN|GUY|GUYS|GIRL|GIRLS|BOY|BOYS|KID|KIDS|CHILD|CHILDREN|PERSON|PEOPLE|OFFICER|OFFICERS|COP|COPS|POLICE|POLICEMAN|POLICEWOMAN|POLICE OFFICER|POLICE OFFICERS|GUARD|GUARDS|SECURITY GUARD|NURSE|NURSES|DOCTOR|DOCTORS|WAITER|WAITERS|WAITRESS|WAITRESSES|BARTENDER|BARMAN|BARMAID|CUSTOMER|CUSTOMERS|STRANGER|STRANGERS|DRIVER|TAXI DRIVER|BUS DRIVER|PASSENGER|PASSENGERS|STUDENT|STUDENTS|TEACHER|TEACHERS|SOLDIER|SOLDIERS|WORKER|WORKERS|PATRON|PATRONS|DINER|DINERS|TOURIST|TOURISTS|NEIGHBOUR|NEIGHBOR|NEIGHBOURS|NEIGHBORS|THUG|THUGS|GOON|GOONS|PARAMEDIC|PARAMEDICS|RECEPTIONIST|CLERK|CASHIER|PRIEST|JUDGE|LAWYER|REPORTER|REPORTERS|PHOTOGRAPHER|PHOTOGRAPHERS|DANCER|DANCERS|SINGER|BAND|CROWD|MOB|PROTESTERS|PROTESTORS|MOURNERS|GUESTS|GUEST|HOSTESS|HOST|USHER|BOUNCER|BOUNCERS|JOGGER|JOGGERS|COMMUTERS|PEDESTRIANS|SHOPPERS|OLD MAN|OLD WOMAN|YOUNG MAN|YOUNG WOMAN|TEENAGER|TEENAGERS|BABY|TODDLER)$/;
const PEOPLE_WORD_ = /\b(man|men|woman|women|guy|guys|girl|girls|boy|boys|kid|kids|child|children|person|people|officer|officers|cop|cops|police|policeman|policewoman|guard|guards|nurse|nurses|doctor|doctors|waiter|waiters|waitress|waitresses|bartender|barman|barmaid|customer|customers|stranger|strangers|driver|passenger|passengers|student|students|teacher|teachers|soldier|soldiers|worker|workers|patron|patrons|diner|diners|tourist|tourists|neighbou?rs?|thugs?|goons?|paramedics?|receptionist|clerk|cashier|priest|judge|lawyer|reporters?|photographers?|dancers?|singer|band|crowd|mob|protest[eo]rs|mourners|guests?|hostess|host|usher|bouncers?|joggers?|commuters|pedestrians|shoppers|teenagers?|baby|toddler)$/i;
const SMALL_GROUP_ = /\b(patrons|diners|customers|shoppers|passers-by|passersby|pedestrians|commuters|students|guests|partygoers|party-goers|onlookers|bystanders|tourists|workers|nurses|doctors|police officers|officers|cops|soldiers|dancers|drinkers|punters|regulars|clients|travell?ers|passengers|classmates|colleagues|co-?workers|office workers|families|couples|locals|villagers|inmates|prisoners|waiters|waitresses|bar staff|mourners|protest[eo]rs|spectators|audience|congregation|revell?ers|joggers|surfers|swimmers|beachgoers|fans)\b/gi;
const PROPS_ = "phone|phones|mobile|mobile phone|cell phone|smartphone|letter|letters|envelope|envelopes|photo|photos|photograph|photographs|polaroid|polaroids|bag|bags|backpack|handbag|suitcase|suitcases|briefcase|duffel bag|keys|key|car keys|wallet|purse|cigarette|cigarettes|cigar|lighter|matches|joint|vape|bottle|bottles|wine bottle|glass|glasses of|wine glass|cup|cups|mug|mugs|laptop|notebook|notepad|diary|journal|book|books|newspaper|magazine|map|maps|camera|torch|flashlight|umbrella|box|boxes|package|parcel|gift|ring|engagement ring|wedding ring|necklace|locket|bracelet|watch|wristwatch|money|cash|wad of cash|coins|pen|pencil|ticket|tickets|passport|badge|id card|file|files|folder|folders|documents|contract|clipboard|coffee|tea|beer|beers|wine|whisky|whiskey|vodka|champagne|drink|drinks|plate|plates|bowl|cake|birthday cake|sandwich|pizza|ball|football|basketball|cricket bat|toy|toys|teddy|teddy bear|doll|candle|candles|bouquet|mirror|remote|headphones|earphones|radio|walkie-talkie|walkie|rope|shovel|spade|hammer|toolbox|ladder|bucket|syringe|needle|pills|pill bottle|medication|cigarette packet|lunchbox|tray|menu|receipt|bill|cheque|credit card|ice pack|first aid kit|blanket|pillow|towel|tissue|tissues|sign|placard|banner|trophy|medal|helmet|skateboard|bike|bicycle|scooter|guitar|violin|microphone|mic|tablet|ipad|usb|hard drive|cassette|tape|vhs|dvd|record|vinyl|binoculars|telescope|compass|lantern|matchbox|paintbrush|canvas|easel|sketchbook|crayons|chalk|whistle|stopwatch|handcuffs|cuffs|baton|briefcase|crate|crates|esky|cooler|thermos|flask|hip flask|kettle|knife and fork|chopsticks|cards|deck of cards|dice|chess board|jigsaw|puzzle";
const SETDRESS_ = "balloons|streamers|bunting|christmas tree|christmas lights|fairy lights|decorations|party decorations|posters|poster|banner|candles|wreath|curtains|bunk beds|hospital bed|coffin|casket|shrine|altar|graffiti";
const GREENERY_ = "flowers|bouquet of flowers|potted plants?|pot plants?|plants|houseplants?|hedge|hedges|cactus|cacti|palm trees?|fern|ferns|vines|ivy|wreath of flowers|garden bed|veggie patch|vegetable patch";
const GARMENT_ = "wedding dress|evening gown|ball gown|school uniform|police uniform|nurse'?s uniform|army uniform|military uniform|lab coat|dressing gown|bathrobe|hi-vis vest|hi-vis|high-vis|t-shirt|tee|tshirt|dress|dresses|gown|suit|suits|tuxedo|tux|uniform|uniforms|jacket|jackets|coat|coats|overcoat|trench coat|hoodie|jumper|sweater|cardigan|shirt|shirts|singlet|tank top|blouse|skirt|jeans|pants|trousers|shorts|overalls|pyjamas|pajamas|pjs|robe|apron|scrubs|vest|helmet|hat|cap|beanie|balaclava|mask|gloves|boots|heels|high heels|sneakers|trainers|thongs|sandals|scarf|tie|bow tie|bikini|swimsuit|bathers|togs|wetsuit|costume|costumes|armour|armor|cape|veil|sunglasses|glasses|lingerie|underwear|nightgown|nightie|onesie|leotard|tracksuit|kilt|sari|hijab|turban|crown|tiara";
const MAKEUP_ = "tattoo|tattoos|wig|fake beard|false beard|bald cap|mascara (?:running|streaked|smeared)|smeared (?:make-?up|lipstick|mascara)|covered in (?:mud|dirt|soot|ash|paint|grease|oil|sweat|vomit)|(?:mud|dirt|soot|grime)-(?:covered|streaked|caked)|dreadlocks|grey hair|gray hair|old-age make-?up|aged up|sunburn|sunburnt|vomit|vomits|sweat-soaked|drenched in sweat";
const CAMERA_ = "steadicam|crane shot|jib shot|dolly shot|dolly zoom|handheld|hand-held|slow motion|slow-motion|high-speed|time-lapse|timelapse|split screen|split diopter|snorricam|gopro|go-pro|car mount|process shot|underwater shot|whip pan|one take|oner|single take";
const MUSIC_MAP_ = [[/^(sings|singing|sang|karaoke)$/, "Song performed on camera"], [/^(song|songs)$/, "Song"], [/plays (the )?piano/, "Piano performance"], [/plays (the )?guitar/, "Guitar performance"], [/^band plays$/, "Live band"], [/^(dj)$/, "DJ set"], [/^concert$/, "Concert performance"], [/./, "Source music"]];
const SFX_MAP_ = [[/^(rain|raining|rains|downpour)$/, "Rain"], [/^storm$/, "Storm (rain & wind)"], [/^(thunder|lightning)$/, "Lightning"], [/^(snow|snowing)$/, "Snow"], [/^(fog|foggy|mist)$/, "Fog / haze"], [/^smoke$/, "Smoke"], [/^(fire|fires|flames|burning|burns|blaze)$/, "Fire"], [/^(explosion|explodes)$/, "Explosion"], [/^sparks$/, "Sparks"], [/^(flood|flooding)$/, "Flooding"], [/^(shatters|smashes)$/, "Breakaway glass"], [/^(wind whips|gale)$/, "Wind"], [/^steam$/, "Steam"]];
const VFX_MAP_ = [[/^(green ?screen)$/, "Green screen"], [/^(hologram|holographic)$/, "Hologram"], [/(disappears|vanishes) into thin air/, "Vanishing effect"], [/^(ghost|ghostly)$/, "Ghost"], [/^(alien|aliens)$/, "Alien"], [/^(vfx|cgi)$/, "VFX shot"]];
const STUNT_MAP_ = [[/^(gunfight|shootout|shoot-out)$/, "Gunfight"], [/^(fight|fights|fighting|punch|punches|punched|kick|kicks|kicked|brawl|brawls|wrestles|grapples|headbutts|slams (him|her|them|into))$/, "Fight"], [/^(tackle|tackles|tackled)$/, "Tackle"], [/^(falls|fell|tumbles)/, "Fall"], [/^(thrown|throws)/, "Throw"], [/^(crash|crashes|crashed|collides|collision)$/, "Crash"], [/^(chase|chases|chased|chasing)$/, "Chase"], [/^jumps/, "Jump"], [/^(stabs|stabbed)$/, "Stabbing"], [/^strangles$/, "Strangling"], [/^hit by$/, "Hit by vehicle"], [/^explosion$/, "Explosion (stunt)"], [/^dragged$/, "Drag"], [/^smashes through$/, "Crash through breakaway"]];
const VEH_MAP_ = [[/^(police car|patrol car)$/, "Police car"], [/^(fire truck|fire engine)$/, "Fire truck"], [/^(taxi|cab)$/, "Taxi"], [/^(motorbike|motorcycle)$/, "Motorbike"], [/^(limo|limousine)$/, "Limousine"], [/^(suv)$/, "SUV"], [/^(4wd)$/, "4WD"], [/train/, "Train"], [/^(cars|car)$/, "Car"]];
const WEAPON_MAP_ = [[/^(gun|guns|handgun|firearm|firearms|holster|ammo|ammunition|bullet|bullets|gunshot|gunshots|gunfire)$/, "Gun"], [/^(knife|knives|blade)$/, "Knife"], [/^(sword|swords)$/, "Sword"], [/^(rifle|rifles)$/, "Rifle"]];
const MAKEUP_FLAG_MAP_ = [[/^(blood|bloody|bleeding|bleeds)$/, "Blood"], [/^(wound|wounds|wounded|gash|cut lip|injury|injured)$/, "Wounds"], [/^(bruise|bruised|bruises)$/, "Bruises"], [/^black eye$/, "Black eye"], [/^scar$/, "Scar"], [/^stitches$/, "Stitches"], [/^(corpse|dead body)$/, "Corpse makeup"], [/^body bag$/, null], [/^prosthetic$/, "Prosthetics"]];
const SCREEN_MAP_ = [[/^(tv|television)$/, "TV playback"], [/^(laptop|computer screen|monitor|monitors)$/, "Computer screen graphics"], [/^(phone screen|text message|texts|facetime|video call|zoom call)$/, "Phone screen graphics"], [/^(news report|broadcast)$/, "News broadcast playback"], [/^(cctv|security footage)$/, "CCTV footage"], [/^screen shows$/, "Screen graphics"]];
function mapWord(map, w) { for (let i = 0; i < map.length; i++) if (map[i][0].test(w)) return map[i][1]; return undefined; }
const FIREARM_ = /^(gun|guns|pistol|revolver|rifle|rifles|shotgun|handgun|firearm|firearms|holster|ammo|ammunition|bullet|bullets|gunshot|gunshots|gunfire|grenade)$/;
const VEHICLE_WORD_ = /\b(car|cars|truck|trucks|van|vans|bus|taxi|cab|ute|utes|motorbike|motorcycle|scooter|limo|limousine|sedan|suv|4wd|tractor|caravan|campervan|ambulance|boat|yacht|ferry|tram|helicopter|hearse|train|jeep|convertible|mustang|holden|falcon|commodore|landcruiser|pickup|pick-up)\b/i;
const ANIMAL_WORD_ = /\b(dog|dogs|puppy|puppies|cat|cats|kitten|kittens|horse|horses|pony|bird|birds|parrot|chicken|chickens|cow|cows|sheep|goat|goats|pig|pigs|kangaroo|kangaroos|wallaby|koala|snake|snakes|spider|rabbit|rabbits|possum|lizard|cattle|duck|ducks|budgie|cockatoo|ferret|hamster|fish|goldfish)\b/i;
const WEAPON_WORD_ = /\b(gun|guns|pistol|revolver|rifle|rifles|shotgun|handgun|firearm|knife|knives|blade|machete|sword|swords|axe|crossbow|taser|grenade|baseball bat|crowbar)\b/i;

// ---------- Scenes: the same split as breakdown.js (a heading starts a scene; text before the first heading is scene 1) ----------
function sceneTexts(doc) {
  const lines = (doc && Array.isArray(doc.lines)) ? doc.lines : [];
  const out = []; let cur = null;
  lines.forEach(function (l) {
    l = l || {};
    const t = String(l.type || "action");
    if (t === "scene") { cur = { id: String(l.id || ""), action: [], talk: [] }; out.push(cur); return; }
    const text = t === "dual" ? "" : clean(runsText(l.runs));
    if (!cur) { if (!text && t !== "dual") return; cur = { id: "", action: [], talk: [] }; out.push(cur); }
    if (t === "dialogue" || t === "parenthetical") { if (text) cur.talk.push(text); }
    else if (t === "dual") {
      const d = l.dual || {};
      ["left", "right"].forEach(function (k) { const s = d[k] || {}; const x = clean(runsText(s.dialogueRuns)); if (x) cur.talk.push(x); });
    } else if (t !== "character" && text) cur.action.push(text);
  });
  return out;
}

// ---------- Auto suggestions for one scene ----------
function suggestScene(s, tx, ctx) {
  const items = []; const seen = {};
  const add = function (cat, name, why) {
    if (!name) return;
    const k = key(cat, name);
    if (!norm(name) || seen[k]) return;
    seen[k] = 1; items.push({ c: cat, n: display(name, cat), k: k, why: why || "" });
  };
  const act = (tx && tx.action) ? tx.action.join("\n") : "";
  const actLow = act.toLowerCase();
  const fw = s.fw || {};
  const words = function (id) { return fw[id] || []; };

  // Cast (from breakdown.js, which already knows who is in the scene)
  (s.cast || []).forEach(function (n) { add("cast", n, "in the scene"); });

  // Background
  const groups = {}; let gm; SMALL_GROUP_.lastIndex = 0;
  while ((gm = SMALL_GROUP_.exec(act)) !== null) groups[gm[1].toLowerCase()] = 1;
  if (s.bg === "Crowd") add("background", "Crowd", "crowd in the action");
  Object.keys(groups).forEach(function (g) { add("background", g.charAt(0).toUpperCase() + g.slice(1), "named in the action"); });
  if (s.bg === "Small group" && !Object.keys(groups).length && !items.some(function (i) { return i.c === "background"; })) add("background", "Background (small group)", "public place or group cue");

  // Flags breakdown.js already found (its word lists know what doesn't count)
  words("vehicles").forEach(function (w) { add("vehicles", mapWord(VEH_MAP_, w) || w, "“" + w + "”"); });
  if (words("driving").length) add("equipment", "Tow rig / process trailer", "driving scene");
  words("animals").forEach(function (w) { add("animals", w, "“" + w + "”"); add("wrangler", singular(w) + " wrangler", "animal in scene"); });
  let firearm = false;
  words("weapons").forEach(function (w) {
    add("weapons", mapWord(WEAPON_MAP_, w) || w, "“" + w + "”");
    if (FIREARM_.test(w)) firearm = true;
    if (/^(gunshot|gunshots|gunfire)$/.test(w)) { add("sfx", "Gunfire (blanks / squibs)", "“" + w + "”"); add("sound", "Gunshots", "“" + w + "”"); }
  });
  if (firearm) { add("labor", "Armourer", "firearm in scene"); add("security", "Weapons safety", "firearm in scene"); }
  words("sfx").forEach(function (w) { add("sfx", mapWord(SFX_MAP_, w) || w, "“" + w + "”"); });
  words("vfx").forEach(function (w) { add("vfx", mapWord(VFX_MAP_, w) || w, "“" + w + "”"); });
  const hasVeh = words("vehicles").length > 0 || words("driving").length > 0;
  words("stunts").forEach(function (w) {
    let n = mapWord(STUNT_MAP_, w) || w;
    if (hasVeh && (n === "Crash" || n === "Chase")) n = "Vehicle " + n.toLowerCase();
    add("stunts", n, "“" + w + "”");
  });
  if (words("stunts").length) add("labor", "Stunt coordinator", "stunts in scene");
  words("blood").forEach(function (w) {
    const n = mapWord(MAKEUP_FLAG_MAP_, w);
    if (n === null) add("props", "Body bag", "“" + w + "”"); else add("makeup", n || w, "“" + w + "”");
  });
  words("music").forEach(function (w) { add("music", mapWord(MUSIC_MAP_, w) || "Source music", "“" + w + "”"); });
  if (!words("music").length && /\b(music|radio|stereo|jukebox|playlist|speakers? (blare|pump|thump))\b/i.test(act) && !/\b(no music|music stops|turns off the (music|radio|stereo))\b/i.test(act)) add("music", "Source music", "music in the action");
  words("screens").forEach(function (w) { add("art", mapWord(SCREEN_MAP_, w) || "Screen graphics", "“" + w + "”"); });
  if (words("minors").length) add("labor", "Child chaperone", "child in scene");
  if (words("intimacy").length) { add("labor", "Intimacy coordinator", "intimate scene"); add("wardrobe", "Modesty garments", "intimate scene"); add("security", "Closed set", "intimate scene"); }
  if (words("water").length) { add("labor", "Water safety officer", "water work"); if (/\bunderwater\b/.test(actLow)) add("camera", "Underwater housing", "underwater"); }
  if (words("drone").length) add("camera", "Drone", "aerial shot");
  if (s.dn === "N" && /EXT/.test(String(s.ie || ""))) add("equipment", "Night exterior lighting", "exterior at night");

  // Dictionary words, only with a determiner in front ("the phone", "her old bag") so verbs don't count
  const castWord = ctx.castWord;
  const dict = function (cat, list, why) {
    const re = new RegExp("\\b(" + DETC + ")\\s+((?:[a-z'\\-]+\\s+){0,2}?)(" + list + ")\\b", "g");
    let m;
    while ((m = re.exec(act)) !== null) {
      const w = m[3];
      if (AMBIG_.test(w) && (m[2] || NUM_DET_.test(m[1]))) continue;
      if (/^(-|'s\b)/.test(act.slice(m.index + m[0].length))) continue;   // "phone-call", "the book's" -> skip compounds
      if (castWord[w.toUpperCase()] && /[A-Z]/.test(w.charAt(0))) continue;
      add(cat, w, why || ("“" + clean(m[0]).toLowerCase() + "”"));
    }
  };
  dict("props", PROPS_);
  dict("setdress", SETDRESS_);
  dict("greenery", GREENERY_);

  // Wardrobe: "wearing a red dress", "in her school uniform" — with whose it is when the sentence names them
  const sentences = act.split(/(?<=[.!?])\s+|\n/);
  const gRe = new RegExp("\\b(?:wearing|wears|wore|dressed in|clad in|changes into|puts on|pulls on|in)\\s+(?:" + DET + "\\s+)?((?:[a-z'\\-]+\\s+){0,2}?)(" + GARMENT_ + ")\\b", "gi");
  sentences.forEach(function (sen) {
    let m; gRe.lastIndex = 0;
    while ((m = gRe.exec(sen)) !== null) {
      const adj = clean(m[1]).toLowerCase().replace(/\b(a|an|the|his|her|their|its|my|your|our|new|old|same|only|very)\b/g, "").trim();
      const garment = (adj ? adj + " " : "") + m[2].toLowerCase();
      if (/^(the |a )?(car|house|room|kitchen|bed|dark|rain|silence)$/.test(garment)) continue;
      const before = sen.slice(0, m.index);
      let owner = "";
      const capsNames = before.match(/\b[A-Z][A-Z'’\-]+(?:\s+[A-Z][A-Z'’\-]+){0,2}\b/g) || [];
      for (let i = capsNames.length - 1; i >= 0; i--) if (ctx.cast[capsNames[i]]) { owner = capsNames[i]; break; }
      if (!owner) { for (const c in ctx.cast) { if (new RegExp("\\b" + c.charAt(0) + c.slice(1).toLowerCase() + "\\b").test(before)) owner = c; } }
      add("wardrobe", owner ? owner.charAt(0) + owner.slice(1).toLowerCase() + ": " + garment : garment, "“" + clean(m[0]).toLowerCase() + "”");
    }
  });
  const mkRe = new RegExp("\\b(" + MAKEUP_ + ")\\b", "gi");
  let mk; while ((mk = mkRe.exec(act)) !== null) {
    const w = mk[1].toLowerCase();
    add("makeup", /tattoo/.test(w) ? "Tattoo" : /wig/.test(w) ? "Wig" : /beard/.test(w) ? "Fake beard" : /mascara|smeared/.test(w) ? "Smeared makeup" : /covered|caked|streaked|covered/.test(w) ? "Dirt / grime" : /vomit/.test(w) ? "Vomit (SFX makeup)" : /sweat/.test(w) ? "Sweat" : /sunburn/.test(w) ? "Sunburn" : /aged|old-age|grey|gray/.test(w) ? "Ageing makeup" : w, "“" + w + "”");
  }
  const camRe = new RegExp("\\b(" + CAMERA_ + ")\\b", "gi");
  let cm; while ((cm = camRe.exec(act)) !== null) {
    const w = cm[1].toLowerCase();
    const n = /steadicam|snorricam/.test(w) ? (w === "snorricam" ? "Snorricam" : "Steadicam") : /crane|jib/.test(w) ? "Crane / jib" : /dolly/.test(w) ? "Dolly & track" : /hand-?held/.test(w) ? "Handheld rig" : /slow|high-speed/.test(w) ? "High-speed camera" : /time-?lapse/.test(w) ? "Time-lapse rig" : /split/.test(w) ? (w === "split screen" ? null : "Split diopter") : /go-?pro/.test(w) ? "Action camera" : /car mount|process/.test(w) ? "Car mount" : /underwater/.test(w) ? "Underwater housing" : /whip/.test(w) ? null : "One-take rig";
    if (w === "split screen") add("vfx", "Split screen", "“split screen”"); else if (n) add("camera", n, "“" + w + "”");
  }

  // Sounds: "we hear a dog bark", "the sound of sirens"
  const hRe = /\b(?:we hear|hear|hears|the sound of|sound of|noise of)\s+((?:(?:a|an|the|some|distant|faint|muffled|loud|low|sudden|soft|far-off)\s+)*)([a-z'\-]+(?:\s+[a-z'\-]+)?)/gi;
  let hm; while ((hm = hRe.exec(act)) !== null) {
    const w = hm[2].toLowerCase().replace(/\s+(in|on|at|from|of|and|as|outside|inside|behind|nearby|somewhere)$/, "");
    if (/^(him|her|them|it|something|nothing|someone|footsteps? approaching|you|me|us|his|her|their)\b/.test(w)) { if (/footstep/.test(w)) add("sound", "Footsteps", "“" + w + "”"); continue; }
    add("sound", w, "“" + clean(hm[0]).toLowerCase() + "”");
  }

  // Words in CAPITALS that aren't the cast: screenwriters capitalise sounds and important props
  const capRe = /\b([A-Z][A-Z0-9'’\-]*[A-Z0-9](?:\s+[A-Z][A-Z0-9'’\-]*[A-Z0-9]){0,3})\b/g;
  let c; while ((c = capRe.exec(act)) !== null) {
    let ph = c[1].replace(/[’]/g, "'").replace(/'S$/, "");
    if (ph.length < 3 && !/^(TV|DJ)$/.test(ph)) continue;
    if (ctx.cast[ph] || ctx.locs[ph] || CAPS_SKIP_.test(ph)) continue;
    const toks = ph.split(/\s+/);
    if (toks.every(function (t) { return castWord[t] || CAPS_SKIP_.test(t); })) continue;
    // drop cast names glued to the front ("JIMMY'S BIKE" -> "BIKE")
    while (toks.length > 1 && (castWord[toks[0].replace(/'S$/, "")] || CAPS_SKIP_.test(toks[0]))) toks.shift();
    ph = toks.join(" ");
    const before = act.slice(Math.max(0, c.index - 40), c.index);
    if (SOUND_CAPS_.test(ph) || /\b(hear|hears|sound of|noise of)\s+(?:a|an|the|some)?\s*$/i.test(before)) { add("sound", ph, "“" + ph + "” (caps)"); continue; }
    if (PEOPLE_.test(ph) || PEOPLE_WORD_.test(toks[toks.length - 1])) { add("background", ph, "“" + ph + "” (caps, not in cast)"); continue; }
    // Props need a determiner in front, like any object: "picks up a SHOTGUN", "the old CHEST"
    if (!new RegExp("\\b" + DET + "\\s+(?:[a-z'\\-]+\\s+){0,2}$", "i").test(before)) continue;
    if (WEAPON_WORD_.test(ph)) add("weapons", ph, "“" + ph + "” (caps)");
    else if (VEHICLE_WORD_.test(ph)) add("vehicles", ph, "“" + ph + "” (caps)");
    else if (ANIMAL_WORD_.test(ph)) add("animals", ph, "“" + ph + "” (caps)");
    else add("props", ph, "“" + ph + "” (caps)");
  }
  // If a weapon was found by its CAPS name, the generic one from the flag words is the same thing
  const capWeap = items.filter(function (i) { return i.c === "weapons" && /\(caps\)/.test(i.why); });
  if (capWeap.length) for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.c === "weapons" && !/\(caps\)/.test(it.why) && capWeap.some(function (w) { return w.k.indexOf(it.k.split("|")[1]) >= 0; })) items.splice(i, 1);
  }
  const capVeh = items.filter(function (i) { return i.c === "vehicles" && /\(caps\)/.test(i.why); });
  if (capVeh.length) for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.c === "vehicles" && !/\(caps\)/.test(it.why) && capVeh.some(function (w) { return w.k.indexOf(it.k.split("|")[1]) >= 0; })) items.splice(i, 1);
  }
  // A thing that's a weapon/vehicle/animal isn't also a prop
  const taken = {};
  items.forEach(function (i) { if (i.c === "weapons" || i.c === "vehicles" || i.c === "animals") taken[i.k.split("|")[1]] = 1; });
  for (let i = items.length - 1; i >= 0; i--) if (items[i].c === "props" && taken[items[i].k.split("|")[1]]) items.splice(i, 1);
  return items;
}

// ---------- Story days: Day 1, Night 1, Day 2… (the script's own timeline, not the shoot days) ----------
const NEXT_DAY_ = /\b(NEXT (DAY|MORNING|NIGHT|EVENING|AFTERNOON)|THE FOLLOWING (DAY|MORNING|NIGHT|EVENING|WEEK)|(A|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|SEVERAL|FEW|\d+) (DAYS?|WEEKS?|MONTHS?|YEARS?) LATER|DAYS LATER|WEEKS LATER|MONTHS LATER|YEARS LATER|TOMORROW)\b/;
const MORNINGISH_ = /\b(DAY|MORNING|EARLY MORNING|LATE MORNING|DAWN|SUNRISE|FIRST LIGHT|DAYTIME|NOON|MIDDAY|AFTERNOON)\b/;
const SAME_ = /\b(CONTINUOUS|CONT'?D?|SAME|SAME TIME|MOMENTS LATER|SECONDS LATER|MINUTES LATER|A MOMENT LATER|SIMULTANEOUS|INTERCUT)\b/;
const FLASH_ = /\b(FLASHBACK|FLASH BACK|DREAM|DREAM SEQUENCE|MEMORY|FLASH FORWARD|FLASHFORWARD|FANTASY|NIGHTMARE)\b/;
function storyDays(bdScenes, texts) {
  let day = 1, prev = null;
  return bdScenes.map(function (s, i) {
    const h = String(s.heading || "").toUpperCase();
    const first = texts[i] && texts[i].action.length ? texts[i].action[0].toUpperCase() : "";
    const flash = FLASH_.test(h) || /^(FLASHBACK|SUPER: ?FLASHBACK)/.test(first);
    if (flash) return { day: day, dn: s.dn, flash: true, label: "Flashback" };
    if (prev) {
      if (NEXT_DAY_.test(h) || (/^(SUPER|TITLE|CARD)/.test(first) && NEXT_DAY_.test(first))) day++;
      else if (!SAME_.test(h) && prev.dn === "N" && s.dn !== "N" && MORNINGISH_.test(h.split(/\s[-–—]\s/).slice(1).join(" "))) day++;
    }
    prev = s;
    return { day: day, dn: s.dn, flash: false, label: (s.dn === "N" ? "N" : "D") + day };
  });
}

// ---------- Estimated shoot time per scene (minutes): about an hour a page, more for heavy work ----------
const EST_WEIGHT_ = { stunts: 1.5, vfx: 1.25, water: 1.5, animals: 1.3, minors: 1.2, intimacy: 1.25, weapons: 1.2, driving: 1.4, sfx: 1.2, drone: 1.1 };
function estimate(s) {
  let m = (Number(s.eighths) || 0) / 8 * 60;
  // the heaviest thing sets the pace; each further heavy thing adds a little
  const w = (s.flags || []).map(function (id) { return EST_WEIGHT_[id] || 0; }).filter(Boolean).sort(function (a, b) { return b - a; });
  let f = w.length ? w[0] + 0.1 * (w.length - 1) : 1;
  if (s.bg === "Crowd") f += 0.3; else if (s.bg === "Small group") f += 0.1;
  if (s.dn === "N") f += 0.15;
  m = Math.max(15, Math.round(m * f / 5) * 5);
  return m;
}

// ---------- Build the full breakdown: suggestions + the user's changes ----------
function sceneKey(s) { return s.id ? String(s.id) : "n" + s.n; }
function resolve(alias, k) { const seen = {}; while (alias[k] && alias[k] !== k && !seen[k]) { seen[k] = 1; k = alias[k]; } return k; }
function build(doc, bd, store) {
  bd = bd || { scenes: [], cast: [] };
  store = store && typeof store === "object" ? store : {};
  const tags = store.tags || {}, off = store.off || {}, alias = store.alias || {}, names = store.names || {}, notes = store.notes || {}, smeta = store.scene || {};
  const drop = {}; (store.drop || []).forEach(function (k) { drop[k] = 1; });
  const bds = bd.scenes || [];
  const texts = sceneTexts(doc);
  // Line the texts up with breakdown.js's scenes (by heading id, else by order)
  const byId = {}; texts.forEach(function (t) { if (t.id) byId[t.id] = t; });
  const txOf = function (s, i) { return (s.id && byId[s.id]) || texts[i] || { action: [], talk: [] }; };
  const ctx = { cast: {}, castWord: {}, locs: {} };
  (bd.cast || []).forEach(function (c) { ctx.cast[c.name] = c; c.name.split(/\s+/).forEach(function (w) { if (w.length > 1) ctx.castWord[w] = 1; }); });
  (bd.locs || []).forEach(function (l) { ctx.locs[l.name] = 1; });
  bds.forEach(function (s) { ctx.locs[s.loc] = 1; ctx.locs[s.set] = 1; String(s.set || "").split(/\s+-\s+/).forEach(function (p) { ctx.locs[p] = 1; }); });
  const castNo = {}; (bd.cast || []).forEach(function (c, i) { castNo[key("cast", c.name)] = i + 1; });
  const days = storyDays(bds, bds.map(txOf));

  const els = {};
  const touch = function (k0, cat, name, n, eighths, auto, why) {
    const k = resolve(alias, k0);
    if (drop[k] || drop[k0]) return null;
    const cat2 = k.split("|")[0];
    if (!CAT[cat2]) return null;
    let e = els[k];
    if (!e) e = els[k] = { key: k, cat: cat2, name: names[k] || (k === k0 ? name : display(k.split("|").slice(1).join("|"), cat2)), scenes: [], eighths: 0, auto: false, manual: false, why: [], note: notes[k] || "", no: castNo[k] || 0 };
    if (e.scenes.indexOf(n) < 0) { e.scenes.push(n); e.eighths += eighths || 0; }
    if (auto) e.auto = true; else e.manual = true;
    if (why && e.why.length < 6 && e.why.indexOf(why) < 0) e.why.push(why);
    return e;
  };

  const scenes = bds.map(function (s, i) {
    const sk = sceneKey(s), meta = smeta[sk] || {}, offs = {};
    (off[sk] || []).forEach(function (k) { offs[resolve(alias, k)] = 1; offs[k] = 1; });
    const per = {};
    const put = function (e) { if (!e || offs[e.key]) return; (per[e.cat] = per[e.cat] || []); if (per[e.cat].indexOf(e.key) < 0) per[e.cat].push(e.key); };
    suggestScene(s, txOf(s, i), ctx).forEach(function (it) { if (offs[it.k] || offs[resolve(alias, it.k)]) return; put(touch(it.k, it.c, it.n, s.n, s.eighths, true, it.why)); });
    (tags[sk] || []).forEach(function (t) { if (!t || !CAT[t.c] || !clean(t.n)) return; put(touch(key(t.c, t.n), t.c, t.c === "cast" ? clean(t.n).toUpperCase() : clean(t.n).charAt(0).toUpperCase() + clean(t.n).slice(1), s.n, s.eighths, false, "tagged")); });
    Object.keys(per).forEach(function (c) { per[c].sort(function (a, b) { return c === "cast" ? ((els[a].no || 999) - (els[b].no || 999)) : els[a].name.localeCompare(els[b].name); }); });
    const d = days[i] || {};
    const estAuto = estimate(s);
    return {
      n: s.n, id: s.id, key: sk, heading: s.heading, ie: s.ie, set: s.set, loc: s.loc, dn: s.dn, eighths: s.eighths, bg: s.bg, flags: s.flags || [],
      syn: clean(meta.syn) || s.syn || "", synAuto: !clean(meta.syn),
      day: clean(meta.day) || d.label || "", dayAuto: !clean(meta.day), storyDay: d.day || 1, flash: !!d.flash,
      est: Number(meta.est) > 0 ? Math.round(Number(meta.est)) : estAuto, estAuto: !(Number(meta.est) > 0),
      unit: clean(meta.unit) || "Main", note: clean(meta.note), els: per,
      count: Object.keys(per).reduce(function (a, c) { return a + per[c].length; }, 0)
    };
  });

  // Elements in a category, most-used first (cast by cast number)
  const byCat = {};
  CATS.forEach(function (c) { byCat[c.id] = []; });
  Object.keys(els).forEach(function (k) { const e = els[k]; e.scenes.sort(function (a, b) { return a - b; }); byCat[e.cat].push(k); });
  Object.keys(byCat).forEach(function (c) {
    byCat[c].sort(function (a, b) {
      const A = els[a], B = els[b];
      if (c === "cast") return (A.no || 999) - (B.no || 999) || A.name.localeCompare(B.name);
      return (B.scenes.length - A.scenes.length) || (A.scenes[0] - B.scenes[0]) || A.name.localeCompare(B.name);
    });
  });
  return { cats: CATS, scenes: scenes, elements: els, byCat: byCat,
    totals: { scenes: scenes.length, elements: Object.keys(els).length, eighths: scenes.reduce(function (a, s) { return a + (s.eighths || 0); }, 0), est: scenes.reduce(function (a, s) { return a + s.est; }, 0) } };
}

// ---------- Store edits (pure: each returns a new store) ----------
function copy(st) { return JSON.parse(JSON.stringify(st && typeof st === "object" ? st : {})); }
function tag(st, sk, cat, name) {
  st = copy(st); name = clean(name).slice(0, 60);
  if (!CAT[cat] || !name) return st;
  const k = key(cat, name);
  st.tags = st.tags || {}; const list = st.tags[sk] = st.tags[sk] || [];
  if (!list.some(function (t) { return key(t.c, t.n) === k; })) list.push({ c: cat, n: name });
  if (st.off && st.off[sk]) { st.off[sk] = st.off[sk].filter(function (x) { return x !== k; }); if (!st.off[sk].length) delete st.off[sk]; }
  if (st.drop) st.drop = st.drop.filter(function (x) { return x !== k; });
  return st;
}
function untag(st, sk, k) {
  st = copy(st);
  if (st.tags && st.tags[sk]) {
    const res = function (x) { return resolve(st.alias || {}, x); };
    st.tags[sk] = st.tags[sk].filter(function (t) { const tk = key(t.c, t.n); return tk !== k && res(tk) !== k; });
    if (!st.tags[sk].length) delete st.tags[sk];
  }
  st.off = st.off || {}; const o = st.off[sk] = st.off[sk] || [];
  if (o.indexOf(k) < 0) o.push(k);
  return st;
}
function dropEl(st, k) { st = copy(st); st.drop = st.drop || []; if (st.drop.indexOf(k) < 0) st.drop.push(k); return st; }
function undrop(st, k) { st = copy(st); st.drop = (st.drop || []).filter(function (x) { return x !== k; }); return st; }
// Rename and/or move to another category. Renaming onto an existing element merges them.
function rename(st, k, cat, name) {
  st = copy(st); name = clean(name).slice(0, 60);
  if (!CAT[cat] || !name) return st;
  const to = key(cat, name);
  st.alias = st.alias || {}; st.names = st.names || {};
  if (to !== k) {
    st.alias[k] = to;
    Object.keys(st.alias).forEach(function (a) { if (st.alias[a] === k) st.alias[a] = to; });   // anything merged into k follows it
    if (st.alias[to] === k) delete st.alias[to];                                                // no loops
    if (st.notes && st.notes[k] && !st.notes[to]) { st.notes[to] = st.notes[k]; delete st.notes[k]; }
  }
  st.names[to] = name;
  return st;
}
function merge(st, keys, intoKey, name) {
  st = copy(st); st.alias = st.alias || {};
  keys.forEach(function (k) {
    if (k === intoKey) return;
    st.alias[k] = intoKey;
    Object.keys(st.alias).forEach(function (a) { if (st.alias[a] === k) st.alias[a] = intoKey; });
    if (st.alias[intoKey] === k) delete st.alias[intoKey];
    if (st.notes && st.notes[k]) { if (!st.notes[intoKey]) st.notes[intoKey] = st.notes[k]; delete st.notes[k]; }
  });
  if (name) st = rename(st, intoKey, intoKey.split("|")[0], name);
  return st;
}
function unmerge(st, k) { st = copy(st); if (st.alias) delete st.alias[k]; return st; }
function setNote(st, k, text) { st = copy(st); st.notes = st.notes || {}; text = String(text || "").slice(0, 2000); if (text.trim()) st.notes[k] = text; else delete st.notes[k]; return st; }
function setScene(st, sk, field, val) {
  st = copy(st);
  if (["syn", "day", "est", "unit", "note"].indexOf(field) < 0) return st;
  st.scene = st.scene || {}; const m = st.scene[sk] = st.scene[sk] || {};
  const v = field === "est" ? (Number(val) > 0 ? Math.min(1440, Math.round(Number(val))) : "") : String(val == null ? "" : val).slice(0, field === "note" || field === "syn" ? 2000 : 40);
  if (v === "" || v == null) delete m[field]; else m[field] = v;
  if (!Object.keys(m).length) delete st.scene[sk];
  return st;
}

// ---------- Reports ----------
function fmtEighths(n) { n = Math.round(Number(n) || 0); const p = Math.floor(n / 8), r = n % 8; return p ? (r ? p + " " + r + "/8" : String(p)) : r + "/8"; }
// One row per element: what it is, which scenes, how many pages — the list each department works from
function report(b, cat) {
  return (b.byCat[cat] || []).map(function (k) { const e = b.elements[k]; return { key: k, name: e.name, no: e.no, scenes: e.scenes.slice(), count: e.scenes.length, pages: fmtEighths(e.eighths), note: e.note }; });
}
function csv(b) {
  const q = function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ["Scene", "Heading", "I/E", "D/N", "Story day", "Pages", "Est. min", "Synopsis"].concat(CATS.map(function (c) { return c.label; }));
  const rows = b.scenes.map(function (s) {
    return [s.n, s.heading, s.ie, s.dn, s.day, fmtEighths(s.eighths), s.est, s.syn].concat(CATS.map(function (c) {
      return (s.els[c.id] || []).map(function (k) { const e = b.elements[k]; return (e.no ? e.no + ". " : "") + e.name; }).join("; ");
    }));
  });
  return [head].concat(rows).map(function (r) { return r.map(q).join(","); }).join("\n");
}

const api = { CATS: CATS, CAT: CAT, build: build, suggestScene: suggestScene, sceneTexts: sceneTexts, storyDays: storyDays, estimate: estimate,
  key: key, norm: norm, display: display, sceneKey: sceneKey, resolve: resolve,
  tag: tag, untag: untag, drop: dropEl, undrop: undrop, rename: rename, merge: merge, unmerge: unmerge, setNote: setNote, setScene: setScene,
  report: report, csv: csv, fmtEighths: fmtEighths };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.CampElements = api;
})(typeof window !== "undefined" ? window : this);
