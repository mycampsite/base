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
const Q_LEAD_ = /^(?:wearing|wears|wore|dressed in|clad in|changes into|puts on|pulls on|in|we hear|hears?|the sound of|sound of|noise of)\s+/i;
const DET_LEAD_ = /^(?:a|an|the|his|her|their|its|my|your|our|this|that|these|those|some|another)\s+/i;
function singular(w) {
  w = String(w || "");
  const lw = w.toLowerCase();
  if (NO_SINGULAR_.test(lw)) return w;
  if (/(ss|us|is|ics|news|series|species|glasses|scissors|pliers|tongs|tweezers|secateurs|shears|handcuffs|jeans|pants|trousers|shorts|pyjamas|pajamas|overalls|scrubs|clothes|sunglasses|headphones|binoculars|goggles|cattle|sheep|fish|deer|police)$/.test(lw)) return w;
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
  if (cat !== "background" && !/[&(:]/.test(s)) { const parts = s.split(" "); parts[parts.length - 1] = singular(parts[parts.length - 1]); s = parts.join(" "); }
  if (s === s.toUpperCase() && /[A-Z]{2}/.test(s) && !/^(TV|CCTV|SUV|4WD|VFX|SFX|DJ)$/.test(s)) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function key(cat, name) { return cat + "|" + norm(name); }
function escapeRe(x) { return String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// First names that are also ordinary words: only counted in CAPS
const COMMON_NAME_ = /^(WILL|MAY|JUNE|APRIL|AUGUST|HOPE|GRACE|FAITH|JOY|ROSE|IVY|LILY|DAISY|DAWN|SKY|STORM|RAIN|SUMMER|WINTER|AUTUMN|BILL|MARK|JACK|ART|BOB|PAT|ROB|SUE|RAY|MATT|NICK|WOODY|GUY|DREW|CHASE|HUNTER|PRINCE|KING|QUEEN|BISHOP|DEAN|JUSTICE|MAJOR|SARGE|DOC|BOSS|CHIEF|SON|BABY|KID|MAN|WOMAN|GIRL|BOY|FRANK|HARPER|MASON|CARTER|PARKER|CAMP|RIVER|STONE|WOLF|FOX|BEAR|DUCK|BIRD|PIP|TINY|SMALL|BIG|RED|BLUE|GREEN|BLACK|WHITE|GREY|GRAY|BROWN|MUM|DAD|MOM|NAN|POP|GRAN|SIS|BRO)$/;
const MAKEUP_MORE_ = "fresh cut|cut above (?:her|his|their) eye|cuts|gash|graze|grazes|grazed|scratches|scratched|bandage|bandages|bandaged|stitches|band-aid|plaster cast|(?:arm|leg|wrist) in a cast|in a sling|sling|neck brace|pale|gaunt|sickly|clammy|pregnant|heavily pregnant|moustache|mustache|stubble|tears streaming|tear-streaked|weeps|crying";
const BG_VEHICLE_SET_ = /\b(CAR|UTE|VAN|TRUCK|TAXI|CAB|BUS|4WD|SEDAN|BOAT|PLANE|HELICOPTER|TRAIN)\b/;

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
const GARMENT_ = "yesterday's clothes|same clothes|wet clothes|akubra hat|akubra|gumboots|riding helmet|show jacket|riding boots|jodhpurs|drizabone|oilskin coat|flannel shirt|flannelette shirt|footy jumper|footy shorts|work boots|steel-capped boots|blundstones|hard hat|wedding dress|evening gown|ball gown|school uniform|police uniform|nurse'?s uniform|army uniform|military uniform|lab coat|dressing gown|bathrobe|hi-vis vest|hi-vis|high-vis|t-shirt|tee|tshirt|dress|dresses|gown|suit|suits|tuxedo|tux|uniform|uniforms|jacket|jackets|coat|coats|overcoat|trench coat|hoodie|jumper|sweater|cardigan|shirt|shirts|singlet|tank top|blouse|skirt|jeans|pants|trousers|shorts|overalls|pyjamas|pajamas|pjs|robe|apron|scrubs|vest|helmet|hat|cap|beanie|balaclava|mask|gloves|boots|heels|high heels|sneakers|trainers|thongs|sandals|scarf|tie|bow tie|bikini|swimsuit|bathers|togs|wetsuit|costume|costumes|armour|armor|cape|veil|sunglasses|glasses|lingerie|underwear|nightgown|nightie|onesie|leotard|tracksuit|kilt|sari|hijab|turban|crown|tiara";
const MAKEUP_ = "tattoo|tattoos|wig|fake beard|false beard|bald cap|mascara (?:running|streaked|smeared)|smeared (?:make-?up|lipstick|mascara)|covered in (?:mud|dirt|soot|ash|paint|grease|oil|sweat|vomit)|(?:mud|dirt|soot|grime)-(?:covered|streaked|caked)|dreadlocks|grey hair|gray hair|old-age make-?up|aged up|sunburn|sunburnt|vomit|vomits|sweat-soaked|drenched in sweat";
const CAMERA_ = "steadicam|crane shot|jib shot|dolly shot|dolly zoom|handheld|hand-held|slow motion|slow-motion|high-speed|time-lapse|timelapse|split screen|split diopter|snorricam|gopro|go-pro|car mount|process shot|underwater shot|whip pan|one take|oner|single take";
const MUSIC_MAP_ = [[/^(sings|singing|sang|karaoke)$/, "Song performed on camera"], [/^(song|songs)$/, "Song"], [/plays (the )?piano/, "Piano performance"], [/plays (the )?guitar/, "Guitar performance"], [/^band plays$/, "Live band"], [/^(dj)$/, "DJ set"], [/^concert$/, "Concert performance"], [/./, "Source music"]];
const SFX_MAP_ = [[/^(rain|raining|rains|downpour)$/, "Rain"], [/^storm$/, "Storm (rain & wind)"], [/^(thunder|lightning)$/, "Lightning"], [/^(snow|snowing)$/, "Snow"], [/^(fog|foggy|mist)$/, "Fog / haze"], [/^smoke$/, "Smoke"], [/^(fire|fires|flames|burning|burns|blaze)$/, "Fire"], [/^(explosion|explodes)$/, "Explosion"], [/^sparks$/, "Sparks"], [/^(flood|flooding)$/, "Flooding"], [/^(shatters|smashes)$/, "Breakaway glass"], [/^(wind whips|gale)$/, "Wind"], [/^steam$/, "Steam"]];
const VFX_MAP_ = [[/^(green ?screen)$/, "Green screen"], [/^(hologram|holographic)$/, "Hologram"], [/(disappears|vanishes) into thin air/, "Vanishing effect"], [/^(ghost|ghostly)$/, "Ghost"], [/^(alien|aliens)$/, "Alien"], [/^(vfx|cgi)$/, "VFX shot"]];
const STUNT_MAP_ = [[/^(gunfight|shootout|shoot-out)$/, "Gunfight"], [/^(fight|fights|fighting|punch|punches|punched|kick|kicks|kicked|brawl|brawls|wrestles|grapples|headbutts|slams (him|her|them|into))$/, "Fight"], [/^(tackle|tackles|tackled)$/, "Tackle"], [/^(falls|fell|tumbles)/, "Fall"], [/^(thrown|throws)/, "Throw"], [/^(crash|crashes|crashed|collides|collision)$/, "Crash"], [/^(chase|chases|chased|chasing)$/, "Chase"], [/^jumps/, "Jump"], [/^(stabs|stabbed)$/, "Stabbing"], [/^strangles$/, "Strangling"], [/^hit by$/, "Hit by vehicle"], [/^explosion$/, "Explosion (stunt)"], [/^dragged$/, "Drag"], [/^smashes through$/, "Crash through breakaway"]];
const VEH_MAP_ = [[/^road train$/, "Road train"], [/^(semi|semi-trailer|semitrailer)$/, "Semi-trailer"], [/^(paddy wagon|divvy van)$/, "Police van"], [/^(police car|patrol car)$/, "Police car"], [/^(fire truck|fire engine)$/, "Fire truck"], [/^(taxi|cab)$/, "Taxi"], [/^(motorbike|motorcycle)$/, "Motorbike"], [/^(limo|limousine)$/, "Limousine"], [/^(suv)$/, "SUV"], [/^(4wd)$/, "4WD"], [/train/, "Train"], [/^(cars|car)$/, "Car"]];
const WEAPON_MAP_ = [[/^(gun|guns|handgun|firearm|firearms|holster|ammo|ammunition|bullet|bullets|gunshot|gunshots|gunfire)$/, "Gun"], [/^(knife|knives|blade)$/, "Knife"], [/^(sword|swords)$/, "Sword"], [/^(rifle|rifles)$/, "Rifle"]];
const MAKEUP_FLAG_MAP_ = [[/^(blood|bloody|bleeding|bleeds)$/, "Blood"], [/^(wound|wounds|wounded|gash|cut lip|injury|injured)$/, "Wounds"], [/^(bruise|bruised|bruises)$/, "Bruises"], [/^black eye$/, "Black eye"], [/^scar$/, "Scar"], [/^stitches$/, "Stitches"], [/^(corpse|dead body)$/, "Corpse makeup"], [/^body bag$/, null], [/^prosthetic$/, "Prosthetics"]];
const SCREEN_MAP_ = [[/^(tv|television)$/, "TV playback"], [/^(laptop|computer screen|monitor|monitors)$/, "Computer screen graphics"], [/^(phone screen|text message|texts|facetime|video call|zoom call)$/, "Phone screen graphics"], [/^(news report|broadcast)$/, "News broadcast playback"], [/^(cctv|security footage)$/, "CCTV footage"], [/^screen shows$/, "Screen graphics"]];
function mapWord(map, w) { for (let i = 0; i < map.length; i++) if (map[i][0].test(w)) return map[i][1]; return undefined; }
const FIREARM_ = /^(gun|guns|pistol|revolver|rifle|rifles|shotgun|handgun|firearm|firearms|holster|ammo|ammunition|bullet|bullets|gunshot|gunshots|gunfire|grenade)$/;
const VEHICLE_WORD_ = /\b(car|cars|truck|trucks|van|vans|bus|taxi|cab|ute|utes|motorbike|motorcycle|scooter|limo|limousine|sedan|suv|4wd|tractor|caravan|campervan|ambulance|boat|yacht|ferry|tram|helicopter|hearse|train|jeep|convertible|mustang|holden|falcon|commodore|landcruiser|pickup|pick-up)\b/i;
const ANIMAL_WORD_ = /\b(dog|dogs|puppy|puppies|cat|cats|kitten|kittens|horse|horses|pony|bird|birds|parrot|chicken|chickens|cow|cows|sheep|goat|goats|pig|pigs|kangaroo|kangaroos|wallaby|koala|snake|snakes|spider|rabbit|rabbits|possum|lizard|cattle|duck|ducks|budgie|cockatoo|ferret|hamster|fish|goldfish)\b/i;
const WEAPON_WORD_ = /\b(cricket bat|tyre iron|tire iron|cleaver|hatchet|pitchfork|poker|gun|guns|pistol|revolver|rifle|rifles|shotgun|handgun|firearm|knife|knives|blade|machete|sword|swords|axe|crossbow|taser|grenade|baseball bat|crowbar)\b/i;

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
// ---------- More word lists (props, set dressing, food, graphics…) ----------
// Alternations are tried longest first, so "tea towel" wins over "tea" and "filing cabinet" over "cabinet".
const ALT_ = {};
function alt(list) { return ALT_[list] || (ALT_[list] = list.split("|").filter(Boolean).sort(function (a, b) { return b.length - a.length; }).join("|")); }
const PROPS_MORE_ = "rag|rags|cloth|sponge|broom|mop|bucket|hammer|wrench|spanner|pliers|screwdriver|drill|saw|duct tape|rope|chain|shovel|spade|rake|jerry can|fuel can|tarp|torch|lantern|towel|crowbar|jack|hose|toolbox|cooler|esky|thermos|first aid kit|megaphone|binoculars|compass|flare|flares|lighter|matches|candle|candles|handcuffs|zip ties|duffel|backpack|satchel|briefcase|wallet|purse|handbag|keys|key ring|lanyard|badge|id card|passport|ticket|tickets|clipboard|notepad|notebook|diary|journal|pen|pencil|marker|tea towel|landline|walkman|thermos|discman|ipod|cassette tape|cassette player|tape recorder|record player|polaroid camera|video camera|camcorder|film camera|tripod|torchlight|head torch|lantern|candle|matches|lighter|zippo|ashtray|cigarette packet|tobacco pouch|rolling papers|pipe|cigar|vape|walking stick|cane|crutches|wheelchair|zimmer frame|pram|stroller|car seat|baby bottle|dummy|nappy|rattle|teddy bear|doll|dollhouse|toy car|kite|frisbee|cricket ball|cricket bat|tennis racquet|golf club|surfboard|bodyboard|fishing rod|tackle box|esky|thermos flask|picnic basket|picnic rug|sleeping bag|tent|swag|backpack|duffel bag|holdall|shopping bag|plastic bag|paper bag|garbage bag|bin bag|suitcase|briefcase|handbag|wallet|purse|keys|key|car keys|keyring|padlock|chain|rope|tarp|toolbox|hammer|screwdriver|spanner|wrench|drill|saw|chainsaw|axe|shovel|spade|rake|pitchfork|hose|watering can|bucket|mop|broom|vacuum cleaner|iron|ironing board|laundry basket|clothes peg|umbrella|newspaper|magazine|book|notebook|diary|journal|sketchbook|letter|envelope|postcard|birthday card|card|photo|photograph|photo album|framed photograph|map|atlas|compass|ticket|boarding pass|passport|driver's licence|id card|badge|lanyard|business card|clipboard|folder|file|document|contract|will|bank statement|bill|invoice|receipt|cheque|cash|banknotes|coins|credit card|phone|mobile|mobile phone|smartphone|laptop|tablet|ipad|computer|keyboard|mouse|printer|charger|headphones|earbuds|radio|walkie-talkie|cb radio|remote|remote control|game controller|calculator|stapler|pen|pencil|marker|highlighter|ruler|scissors|tape measure|glue|paintbrush|paint tin|canvas|easel|guitar|acoustic guitar|electric guitar|violin|cello|trumpet|saxophone|drum|drums|harmonica|ukulele|microphone|mic|speaker|amp|whistle|stopwatch|clock|alarm clock|watch|wristwatch|ring|engagement ring|wedding ring|necklace|locket|bracelet|earrings|brooch|medal|trophy|rosette|ribbon|crown|wand|syringe|needle|pill bottle|pills|painkillers|medication|inhaler|first aid kit|bandages|thermometer|stethoscope|clipboard|handcuffs|baton|torch|flashlight|binoculars|telescope|magnifying glass|camera|film|negatives|usb|usb stick|hard drive|floppy disk|dvd|vhs tape|vinyl|record|cassette|cd|board game|deck of cards|cards|dice|chess set|jigsaw|puzzle|balloon|present|gift|parcel|package|box|crate|cardboard box|shoebox|jar|tin|can|bottle|flask|hip flask|glass|pint glass|wine glass|shot glass|tumbler|mug|cup|teacup|teapot|kettle|thermos|plate|bowl|cutlery|knife and fork|spoon|fork|chopsticks|tray|pan|frying pan|cast-iron pan|saucepan|pot|wok|spatula|tongs|chopping board|lunchbox|tupperware|thermos|water bottle|wine bottle|beer bottle|stubby|tinnie|can of beer|six-pack|carton|milk carton|pram|leash|lead|dog lead|collar|saddle|bridle|reins|horse float|hay bale|feed bucket|stockwhip|whip|lasso|net|trap|cage";
const FOOD_ = "eggs|egg|bacon|toast|cereal|porridge|sandwich|sandwiches|pizza|burger|burgers|fries|chips|steak|sausages|sausage|snags|meat pie|pie|pies|cake|birthday cake|biscuits|cookies|scones|fairy floss|candy floss|dagwood dog|dagwood dogs|hot dog|hot dogs|ice cream|icy pole|lollies|chocolate|apple|apples|banana|bananas|orange|oranges|fruit|soup|stew|noodles|rice|pasta|spaghetti|curry|salad|bread|roast|roast chicken|lamb chops|chops|prawns|oysters|fish and chips|takeaway|leftovers|popcorn|lamington|lamingtons|pavlova|vegemite toast|beer|beers|wine|champagne|whisky|whiskey|vodka|rum|gin|tequila|cocktail|tea|coffee|milk|juice|lemonade|soft drink|water|cordial|hot chocolate|milkshake";
const FURNITURE_ = "bar|bar counter|counter|bench|workbench|work bench|single bed|double bed|queen bed|king bed|bunk beds|bunk bed|hospital bed|bed|cot|crib|couch|sofa|lounge|armchair|recliner|rocking chair|chair|chairs|stool|stools|bar stool|bar stools|bench|pew|pews|table|tables|kitchen table|dining table|coffee table|laminex table|bedside table|nightstand|desk|dresser|chest of drawers|wardrobe|bookshelf|bookshelves|bookcase|shelves|cabinet|filing cabinet|filing cabinets|sideboard|hutch|fridge|refrigerator|freezer|stove|wood-fired stove|oven|microwave|dishwasher|sink|bath|bathtub|shower|toilet|washing machine|lamp|lamps|floor lamp|chandelier|ceiling fan|fan|heater|fireplace|mantelpiece|mantel|rug|carpet|curtains|blinds|wallpaper|mirror|clock|grandfather clock|calendar|painting|paintings|framed photos|family photos|portrait|poster|posters|footy posters|trophies|deer head|mounted deer head|antlers|neon sign|jukebox|pool table|dartboard|darts|piano|organ|television|tv|record player|radiogram|vase|ornaments|crucifix|altar|shrine|coffin|casket|heart monitor|iv drip|drip stand|wheelchair|gurney|stretcher|lockers|whiteboard|blackboard|cash register|till|vending machine|pokies|poker machines|windmill|water tank|rainwater tank|clothesline|hills hoist|trampoline|swing set|swing|hammock|bbq|barbecue|campfire|fire pit|hay bales|scarecrow|letterbox|mailbox|shed|chook pen|ferris wheel|carnival rides|show rides|stalls|bunting|balloons|streamers|fairy lights|christmas tree|christmas lights|decorations|tinsel|candles|graffiti|shopfronts|market stalls|tables and chairs";
const COMPOUND_MOD_ = /^(baseball|cricket|hockey|duct|masking|gaffer|claw|tyre|tire|garden|first aid|jump|pint|wine|shot|beer|water|milk|tea|coffee|filing|bank|walking|duffel|shopping|plastic|paper|garbage|bin|car|house|front|back|birthday|credit|business|boarding|first|tape|cassette|record|video|polaroid|film|head|alarm|wedding|engagement|cricket|tennis|golf|fishing|tackle|picnic|sleeping|hip|frying|saucepan|chopping|kitchen|dining|coffee|bedside|single|double|queen|king|bunk|hospital|bar|rocking|floor|ceiling|grandfather|family|footy|neon|pool|drip|cash|vending|poker|rainwater|water|swing|chook|ferris|carnival|show|market|christmas|fairy|dog|feed|horse|hay|board|game|usb|hard|floppy|vhs|electric|acoustic|remote|magnifying|tape|baby|toy|teddy|photo|framed|laminex|wood-fired|cast-iron|mounted|deer)$/;
// Nouns that are never props on their own (body parts, people, places, ideas)
const NOT_PROP_ = /^(hand|hands|head|heads|face|faces|eye|eyes|hair|arm|arms|shoulder|shoulders|leg|legs|foot|feet|finger|fingers|thumb|lip|lips|mouth|nose|chin|forehead|knee|knees|cheek|cheeks|throat|neck|chest|back|side|body|breath|tears|teeth|tongue|ear|ears|skin|wrist|wrists|hip|hips|waist|lap|fist|fists|palm|it|them|him|her|me|us|you|this|that|these|those|one|ones|something|anything|nothing|everything|way|time|moment|look|glance|smile|nod|step|steps|turn|chance|deep|attention|eye contact|place|seat|spot|room|house|home|door|doors|window|windows|wall|walls|floor|ground|ceiling|corner|edge|end|top|bottom|front|middle|air|light|lights|darkness|silence|sound|noise|voice|call|phone call|message|text|news|look|hold|grip|breath|sigh|shot|sip|bite|drag|swig|beat|pause|rest|lead|charge|care|control|notice|sight|view|scene|story|truth|lie|deal|question|answer|word|words|name|game|joke|lesson|role|part|job|work|mind|heart|life|world|money|bill|bills|song|songs|tune|music|game|games|show|trial|trials|match|race|party|meeting|class|lesson|dinner|lunch|breakfast|meal|break|cheers|applause|laugh|scream|cry|yell|shout|whisper|kiss|hug|wave|salute|signal|sign of|pain|blood|wound|cut|dry|wet|high|low|together|apart|away|aside|ahead|nearby|forward|backward|backwards|upright|tall|short|long|wide|narrow|tight|loose|hard|soft|slow|slowly|fast|quick|quickly|quiet|quietly|loud|loudly|still|alone|open|shut|closed|ajar|empty|full|free|clean|dirty|warm|cold|hot|cool|heavy|light|dark|bright|big|small|little|tiny|huge|gently|gentle|carefully|firmly|softly|laughter|chuckle|giggle|grin|frown|shrug|flinch|gasp|groan|moan|sob|sobs|shiver|tremble|stare|gaze|glare|squint|wince|blink|yawn|stretch|pose|posture|balance|silence|stillness|tension|relief|pride|shame|guilt|grief|joy|hope|fear|anger|rage)$/;
const QUANT_ = /^(stack|pile|pair|couple|handful|bunch|set|lot|lots|piece|pieces|bit|bits|kind|sort|load|heap|row|line|box|bag|bottle|glass|mug|cup|plate|bowl|packet|pack|tin|can|jar|slice|wad|roll|sheet|bundle|armful)$/;
const HANDLE_ = alt("picks up|pick up|picking up|grabs|grab|grabbing|snatches|holds|holding|hold up|holds up|hands|handing|passes|passing|gives|pours|pouring|sips|sipping|drinks|drinking|swigs|opens|opening|unlocks|reads|reading|carries|carrying|drops|dropping|throws|tosses|puts down|sets down|places|pulls out|pulling out|takes out|takes|produces|lights|lighting|loads|aims|points|clutches|clutching|wields|wielding|swings|unwraps|unfolds|signs|dials|answers|plugs in|switches on|turns on|switches off|fills|empties|wipes|polishes|polishing|sharpens|packs|packing|unpacks|unzips|eats|eating|chews|bites into|smokes|smoking|stubs out|offers|slides|shows|hides|pockets|grips|gripping|cradles|cradling|rifles through|rummages through|searches through|finds|fetches|lifts|raises|brandishes|nurses|stirs|fries|frying|cooks|cooking|chops|slices|serves|wraps|ties|buckles|cleans|repairs|fixes|rewinds|plays|holds out|pulls on|winds");
const STOPAT_ = /^(and|or|but|with|on|in|into|onto|to|from|at|off|over|under|across|behind|beside|next|toward|towards|as|while|then|before|after|out|up|down|by|for|of|against|around|through|between|so|that|which|who|until|again|back|away|here|there|now|closer|tight|tightly|hard|firmly|slowly|quickly|gently)$/;
const EXACT_NUM_ = /^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|fifty|a dozen|dozen|a couple of|couple of|a pair of)$/;
const NUMW_ = { "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "twenty": 20, "thirty": 30, "fifty": 50, "a dozen": 12, "dozen": 12, "dozens of": 24, "a few": 3, "few": 3, "a couple of": 2, "couple of": 2, "a handful of": 5, "handful of": 5, "several": 4, "some": 4, "a group of": 6, "group of": 6, "a pair of": 2, "hundreds of": 100, "thousands of": 500, "a crowd of": 50, "scores of": 40 };
const GROUP_MORE_ = "technicians|paramedics|ambos|stallholders|showgoers|carnies|jockeys|farmers|shearers|stockmen|truckies|miners|tradies|builders|labourers|cleaners|chefs|cooks|kitchen staff|band members|musicians|singers|choir|cheerleaders|players|teammates|referees|umpires|officials|guards|security guards|bouncers|reporters|journalists|photographers|camera crew|protesters|mourners|congregation|worshippers|parishioners|nuns|monks|priests|soldiers|troops|sailors|pilots|flight attendants|doctors|nurses|orderlies|patients|visitors|residents|tenants|neighbours|neighbors|kids|children|teenagers|teens|schoolkids|students|teachers|parents|families|couples|tourists|backpackers|surfers|swimmers|beachgoers|lifeguards|joggers|cyclists|skaters|drinkers|diners|patrons|customers|shoppers|commuters|passengers|pedestrians|locals|onlookers|bystanders|spectators|fans|audience|guests|partygoers|dancers|waiters|waitresses|bar staff|staff|workers|office workers|police|police officers|officers|cops|detectives|firefighters|crowd|crowds";
const LOC_BG_ = [[/\b(BAR|PUB|TAVERN|HOTEL BAR|CLUB|NIGHTCLUB|RSL)\b/, "Bar patrons"], [/\b(RESTAURANT|CAFE|CAFÉ|DINER|BISTRO|FOOD COURT|CANTEEN|CAFETERIA)\b/, "Diners"], [/\b(HOSPITAL|WARD|CLINIC|EMERGENCY|A&E|SURGERY)\b/, "Hospital staff & patients"], [/\b(SCHOOL|CLASSROOM|CORRIDOR|UNIVERSITY|LECTURE|PLAYGROUND)\b/, "Students"], [/\b(OFFICE|OFFICES|NEWSROOM|BANK)\b/, "Office workers"], [/\b(STREET|STREETS|MAIN STREET|LANEWAY|MALL|SHOPPING|MARKET)\b/, "Pedestrians"], [/\b(STATION|PLATFORM|AIRPORT|TERMINAL|BUS STOP)\b/, "Travellers"], [/\b(SUPERMARKET|SHOP|STORE|SERVO|SERVICE STATION)\b/, "Shoppers"], [/\b(BEACH|POOL|PARK)\b/, "Beachgoers & park users"], [/\b(CHURCH|CHAPEL|CATHEDRAL|FUNERAL)\b/, "Congregation"], [/\b(COURT|COURTROOM)\b/, "Court public"], [/\b(PARTY|WEDDING|RECEPTION|BALLROOM)\b/, "Guests"], [/\b(GYM|STADIUM|SHOWGROUND|RACECOURSE|ARENA|OVAL)\b/, "Spectators"], [/\b(POLICE STATION|PRECINCT)\b/, "Police & public"], [/\b(CASINO|THEATRE|THEATER|CINEMA)\b/, "Audience"]];
const PRIVATE_SUB_ = /\b(ROOM|BEDROOM|BATHROOM|ENSUITE|TOILET|STUDY|OFFICE OF|UPSTAIRS|ATTIC|CELLAR|STOREROOM|STOCKROOM|CUPBOARD|CLOSET|CAR|UTE|VAN)\b/;
const DEPICTED_ = /\b(photo|photograph|picture|painting|drawing|poster|portrait|image|figurine|statue|statuette|toy|cartoon|sketch|print|ornament|tattoo|model|photos|photographs|pictures|paintings|drawings|posters|book|story|dream)\s+of\b[^.!?\n]*$/i;
const BREED_ = /\b(kelpie|kelpies|heeler|heelers|blue heeler|cattle dog|labrador|retriever|terrier|poodle|alsatian|german shepherd|greyhound|collie|border collie|sheepdog|sheepdogs|mare|stallion|foal|gelding|bull|calf|calves|chook|chooks|magpie|crow|galah|galahs|lorikeet|emu|emus|wombat|echidna|platypus|goanna|camel|camels|donkey|alpaca|llama|ferret|guinea pig|mouse|mice|rat|rats|bees|fly|flies|mozzies|frog|frogs|crab|crabs)\b/i;
const MAKE_VEH_ = /\b(holden|ford|toyota|nissan|mitsubishi|mazda|subaru|volkswagen|vw|kombi|mercedes|bmw|jeep|land rover|range rover|commodore|falcon|kingswood|monaro|hilux|land ?cruiser|corolla|valiant|chrysler|chevy|chevrolet|cadillac|mustang|porsche|ferrari|volvo|kia|hyundai|suzuki|isuzu|mack|kenworth)\s+(ute|utes|van|wagon|sedan|truck|ute|4wd|hatchback|coupe|convertible|panel van|station wagon|bus|tray|troopy)\b/i;
const MORE_VEH_ = /\b(road train|semi-trailer|semitrailer|semi|quad bike|horse float|harvester|combine|tractor|trailer|ambulance|fire truck|police car|patrol car|paddy wagon|divvy van|hearse|limo|bus|coach|tram|train|campervan|motorhome|4wd|four-wheel drive|land ?cruiser|commodore|falcon|kingswood|holden|ute)\b/i;
const NO_SINGULAR_ = /^(towers|grazes|gumboots|boots|heels|sneakers|trainers|thongs|sandals|jodhpurs|blundstones|gloves|eggs|clothes|darts|painkillers|pills|keys|cuffs|handcuffs|reins|tongs|thermos|walkman|canvas|lens|gas|atlas|cactus|bus|chaos|pants|jeans|shorts|glasses|scissors|binoculars|darts|lockers|pokies|crutches|stairs|news|series|species|cattle|sheep|fish|deer|chips|fries|snags|lollies|leftovers|drums|cards|dice|decorations|streamers|balloons|bunting|tinsel|shelves|blinds|curtains|ornaments|stalls|trophies|posters|paintings)$/i;

// Built once (they're long): exact-match tests and scanners
const RX_ = {};
function rx(name, make) { return RX_[name] || (RX_[name] = make()); }
const FURN_EXACT_ = () => rx("furnExact", function () { return new RegExp("^(?:" + alt(FURNITURE_) + ")$", "i"); });
const FOOD_EXACT_ = () => rx("foodExact", function () { return new RegExp("^(?:" + alt(FOOD_) + ")$", "i"); });
const PROP_EXACT_ = () => rx("propExact", function () { return new RegExp("^(?:" + alt(PROPS_ + "|" + PROPS_MORE_) + ")$", "i"); });
const GARM_EXACT_ = () => rx("garmExact", function () { return new RegExp("^(?:" + GARMENT_ + ")$", "i"); });

function suggestScene(s, tx, ctx) {
  const items = []; const seen = {};
  // q = the words in the script it was found from (the editor colours them); taken from a “quoted” why when not given.
  // qty = how many (background), when the script says ("a dozen drinkers").  how = "handled" for props someone uses.
  const add = function (cat, name, why, q, qty, how) {
    if (!name) return null;
    const k = key(cat, name);
    if (!norm(name)) return null;
    if (q == null) { const m = /“([^”]+)”/.exec(why || ""); q = m ? m[1] : ""; }
    q = clean(q).replace(Q_LEAD_, "").replace(DET_LEAD_, "").replace(/^scene set in an? /i, "");
    if (seen[k] != null) {
      const it = items[seen[k]];
      if (q && it.q.indexOf(q) < 0) it.q.push(q);
      if (qty && qty > (it.qty || 0)) it.qty = qty;
      if (how) it.how = how;
      if (/\(caps\)/.test(why || "")) it.caps = true;
      return it;
    }
    seen[k] = items.length;
    const it = { c: cat, n: display(name, cat), k: k, why: why || "", q: q ? [q] : [] };
    if (/\(caps\)/.test(why || "")) it.caps = true;
    if (qty) it.qty = qty; if (how) it.how = how;
    items.push(it);
    return it;
  };
  const act = (tx && tx.action) ? tx.action.join("\n") : "";
  const actLow = act.toLowerCase();
  const fw = s.fw || {};
  const words = function (id) { return fw[id] || []; };
  const castWord = ctx.castWord;
  const heading = String(s.heading || "");
  const lastPart = heading.split(/\s+[-–—]\s+/).slice(1, -1).pop() || "";
  const isExt = /EXT/.test(String(s.ie || ""));
  // Is this word in the action for real, not only in a picture of it ("a photograph of a girl on a horse")?
  const realIn = function (w) {
    const re = new RegExp("\\b" + escapeRe(w) + "\\b", "gi"); let m, any = false;
    while ((m = re.exec(act)) !== null) {
      any = true;
      const before = act.slice(Math.max(0, m.index - 80), m.index);
      if (!DEPICTED_.test(before)) return true;
    }
    return !any;   // not in the action at all (found in the heading): trust it
  };
  // Whose is it? The nearest cast name before it in the same sentence
  const ownerBefore = function (text) {
    const capsNames = text.match(/\b[A-Z][A-Z'’\-]+(?:\s+[A-Z][A-Z'’\-]+){0,2}\b/g) || [];
    for (let i = capsNames.length - 1; i >= 0; i--) { const t = capsNames[i].split(/\s+/); for (let j = 0; j < t.length; j++) if (ctx.cast[t[j]] || ctx.cast[capsNames[i]]) return ctx.cast[capsNames[i]] ? capsNames[i] : t[j]; }
    let best = "", at = -1;
    Object.keys(ctx.cast).forEach(function (c) {
      const first = c.split(/\s+/)[0]; if (first.length < 3) return;
      const re = new RegExp("\\b" + first.charAt(0) + first.slice(1).toLowerCase() + "\\b", "g"); let m;
      while ((m = re.exec(text)) !== null) if (m.index > at) { at = m.index; best = c; }
    });
    return best;
  };
  const sentences = act.split(/(?<=[.!?])\s+|\n/);
  const nice = function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); };

  // ---- Cast: breakdown.js's list, plus anyone in the cast named here in normal case ("Ellie sleeps", "Frank's hat")
  (s.cast || []).forEach(function (n) { add("cast", n, "in the scene", n); });
  Object.keys(ctx.cast).forEach(function (c) {
    if ((s.cast || []).indexOf(c) >= 0) return;
    const parts = c.split(/\s+/);
    while (parts.length > 1 && /^(the|a|an|mr|mrs|ms|miss|mister|dr|doctor|sir|lady|lord|old|young|little|big|tall|short|first|second|third|other|new|and|of)\.?$/i.test(parts[0])) parts.shift();
    const first = parts[0].replace(/\.$/, "");
    if (first.length < 3 || /^(the|and|but|she|he|his|her|its|one|two|man|men|boy|girl|guy|lady|woman|women|cop|cops|man's)$/i.test(first)) return;
    const tc = escapeRe(first.charAt(0) + first.slice(1).toLowerCase());
    // a name that's also a word ("Frank", "Will") only counts when it's doing something: "Frank dozes", "Frank's hat"
    const re = COMMON_NAME_.test(first)
      ? new RegExp("\\b(" + escapeRe(c) + "|" + tc + "(?=['’]s\\b|\\s+[a-z]+(?:s|ed)\\b))(?:['’]s)?\\b")
      : new RegExp("\\b(" + escapeRe(c) + "|" + tc + ")(?:['’]s)?\\b");
    const m = re.exec(act);
    if (m && !DEPICTED_.test(act.slice(Math.max(0, m.index - 80), m.index))) add("cast", c, "named in the action", m[1]);
  });
  const minorHere = items.some(function (i) { return i.c === "cast" && ctx.cast[i.n] && ctx.cast[i.n].minor; });

  // ---- Background: who, and how many when the script says
  const groupRe = new RegExp("\\b(" + alt(GROUP_MORE_) + ")\\b", "gi");
  let gm, anyGroup = false;
  while ((gm = groupRe.exec(act)) !== null) {
    const g = gm[1].toLowerCase();
    if (/^(kids|children|teenagers|teens)$/.test(g) && minorHere) continue;
    const before = act.slice(Math.max(0, gm.index - 40), gm.index).toLowerCase();
    if (DEPICTED_.test(act.slice(Math.max(0, gm.index - 80), gm.index))) continue;
    if (/\b(the|a)\s+(police|staff|crowd)\s*$/.test(before + g) && g === "police" && /\b(police (car|station|tape|uniform))/i.test(act.slice(gm.index, gm.index + 20))) continue;
    const nm = /(\b(?:a dozen|dozens of|hundreds of|thousands of|a handful of|a couple of|a few|a pair of|a group of|a crowd of|scores of|several|some|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|fifty|\d+))\s+(?:[a-z'\-]+\s+){0,1}$/.exec(before);
    let qty = 0;
    // only counts the script actually gives ("a dozen", "fifty", "12"): never a guess ("some", "hundreds of", "a few")
    if (nm) { const w = nm[1].trim(); qty = /^\d+$/.test(w) ? Number(w) : (EXACT_NUM_.test(w) ? (NUMW_[w] || 0) : 0); }
    if (g === "crowd" || g === "crowds") { add("background", "Crowd", "“" + g + "”", g, qty); anyGroup = true; continue; }
    add("background", g.charAt(0).toUpperCase() + g.slice(1), "named in the action", gm[0], qty); anyGroup = true;
  }
  if (s.bg === "Crowd" && !items.some(function (i) { return i.c === "background" && i.k === "background|crowd"; })) add("background", "Crowd", "crowd in the action", "");
  if (s.bg === "Small group" && !anyGroup && !PRIVATE_SUB_.test(lastPart) && !(PRIVATE_SUB_.test(String(s.set || "")) && !/\b(BAR|PUB|RESTAURANT|CAFE)\b/.test(lastPart))) {
    let nm = "Background (small group)";
    for (let i = 0; i < LOC_BG_.length; i++) if (LOC_BG_[i][0].test(String(s.set || "").toUpperCase())) { nm = LOC_BG_[i][1]; break; }
    add("background", nm, "public place: " + String(s.set || "").toLowerCase());
  }

  // ---- What breakdown.js already flagged (its word lists know what doesn't count), checked in context here
  const hasVeh = words("vehicles").some(realIn) || words("driving").length > 0 || MORE_VEH_.test(act);
  const madeAll = {}; let mv0; const mre0 = new RegExp(MAKE_VEH_.source, "gi"); while ((mv0 = mre0.exec(act)) !== null) madeAll[mv0[2].toLowerCase()] = 1;
  words("vehicles").forEach(function (w) { if (realIn(w) && !madeAll[w]) add("vehicles", mapWord(VEH_MAP_, w) || w, "“" + w + "”"); });
  let vm; const makeRe = new RegExp(MAKE_VEH_.source, "gi"), madeOf = {};
  while ((vm = makeRe.exec(act)) !== null) if (!DEPICTED_.test(act.slice(Math.max(0, vm.index - 80), vm.index))) { add("vehicles", vm[1] + " " + vm[2], "“" + vm[0] + "”", vm[0]); madeOf[vm[2].toLowerCase()] = 1; madeOf[vm[1].toLowerCase()] = 1; }
  const vre = new RegExp(MORE_VEH_.source, "gi");
  while ((vm = vre.exec(act)) !== null) if (!madeOf[vm[1].toLowerCase()] && !DEPICTED_.test(act.slice(Math.max(0, vm.index - 80), vm.index))) add("vehicles", mapWord(VEH_MAP_, vm[1].toLowerCase()) || vm[1], "“" + vm[1] + "”");
  if (words("driving").length) add("equipment", "Tow rig / process trailer", "driving scene");
  const animals = words("animals").filter(function (w) { return realIn(w) && !/\b(dagwood|hot|corn|sausage roll)\s+dogs?\b/i.test(act.slice(Math.max(0, actLow.indexOf(w) - 9), actLow.indexOf(w) + w.length)); });
  let bm; const bre = new RegExp(BREED_.source, "gi");
  while ((bm = bre.exec(act)) !== null) if (!DEPICTED_.test(act.slice(Math.max(0, bm.index - 80), bm.index))) animals.push(bm[1].toLowerCase());
  animals.forEach(function (w) { add("animals", w, "“" + w + "”"); add("wrangler", singular(w) + " wrangler", "animal in scene"); });
  let firearm = false;
  words("weapons").forEach(function (w) {
    if (!realIn(w)) return;
    if (/^rifles?$/.test(w) && /\brifl(es|ing|ed) (through|around|about|in)\b/i.test(act) && !new RegExp("\\b(a|the|his|her|their)\\s+(?:[a-z-]+\\s+)?" + w + "\\b", "i").test(act)) return;   // "rifles through a drawer"
    add("weapons", mapWord(WEAPON_MAP_, w) || w, "“" + w + "”");
    if (FIREARM_.test(w)) firearm = true;
    if (/^(gunshot|gunshots|gunfire)$/.test(w)) { add("sfx", "Gunfire (blanks / squibs)", "“" + w + "”"); add("sound", "Gunshots", "“" + w + "”"); }
  });
  if (firearm) { add("labor", "Armourer", "firearm in scene"); add("security", "Weapons safety", "firearm in scene"); }
  words("sfx").forEach(function (w) { add("sfx", mapWord(SFX_MAP_, w) || w, "“" + w + "”"); });
  if (words("sfx").some(function (w) { return /^(rain|raining|rains|downpour|storm)$/.test(w); }) && isExt) add("equipment", "Rain towers", "rain on an exterior");
  if (/\b(fireworks?|pyrotechnics?|flares?)\b/i.test(act)) { add("sfx", "Fireworks (pyro)", "“" + (/\b(fireworks?|pyrotechnics?|flares?)\b/i.exec(act)[1]) + "”"); add("labor", "Pyrotechnician", "fireworks"); add("security", "Fire safety officer", "fireworks"); }
  if (/\b(flicker(s|ing)?|strobes?|strobing)\b/i.test(act)) add("equipment", "Practical light effect", "“" + /\b(flicker(?:s|ing)?|strobes?|strobing)\b/i.exec(act)[1] + "”");
  if (/\b(wind (machine|howls|whips|roars)|gale|gusts?)\b/i.test(act)) add("sfx", "Wind", "“" + /\b(wind (?:machine|howls|whips|roars)|gale|gusts?)\b/i.exec(act)[1] + "”");
  const wet = /\b(soaked|drenched|dripping|sopping|wet through|soaking wet|in (his|her|their) clothes)\b/i.exec(act);
  if (wet && (words("water").length || words("sfx").length || /\b(soaked|drenched|dripping|sopping)\b/i.test(act))) {
    const who = ownerBefore(act.slice(0, wet.index + 1)) || "";
    add("sfx", "Wet-down", "“" + wet[1] + "”");
    add("wardrobe", (who ? nice(who) + ": " : "") + "wet costume (doubles)", "“" + wet[1] + "”");
  }
  words("vfx").forEach(function (w) { add("vfx", mapWord(VFX_MAP_, w) || w, "“" + w + "”"); });
  words("stunts").forEach(function (w) {
    let n = mapWord(STUNT_MAP_, w) || w;
    if (hasVeh && (n === "Crash" || n === "Chase" || /^slams (into)?/.test(w) || /^(crash|collides|collision)/.test(w))) n = "Vehicle " + (n === "Chase" ? "chase" : "crash");
    else if (/^slams (him|her|them)/.test(w) || n === "Fight") n = "Fight";
    add("stunts", n, "“" + w + "”");
  });
  const horse = /\b(horse|horses|pony|ponies|mare|stallion|foal|gelding)\b/i.test(act) && animals.length;
  let sm;
  if (hasVeh && (sm = /\b(swerves?|fishtails?|skids?|spins out|rolls over|flips|careers?|tears around|screeches?)\b/i.exec(act))) add("stunts", "Precision driving", "“" + sm[1] + "”");
  if ((sm = /\b(bucks|bucked off|thrown from|falls hard|falls off|tumbles off|is thrown|gets thrown)\b/i.exec(act))) add("stunts", horse ? "Fall from horse" : "Fall", "“" + sm[1] + "”");
  if (horse && (sm = /\b(rides|riding|canters?|cantering|gallops?|galloping|bareback|mounts|trots|trotting)\b/i.exec(act))) add("stunts", "Horse riding", "“" + sm[1] + "”");
  if ((sm = /\b(dives (?:in|under|into)|jumps into the (?:water|river|dam|pool|sea|ocean)|plunges into)\b/i.exec(act))) add("stunts", "Dive", "“" + sm[1] + "”");
  // more physical action that needs a stunt performer or a coordinator's eye (first match of each kind)
  const STUNT_RULES_ = [
    [/\b(climbs?|climbing|scales?|scrambles? (?:up|over)|hangs? (?:from|off|by)|dangles?|swings? (?:from|across)|abseils?|rappels?|clambers? (?:up|over)|shimmies)\b/i, "Climb / work at height"],
    [/\b(leaps?|jumps?|vaults?|launches (?:himself|herself|themselves)|hurdles?)\s+(?:off|from|over|out of|through|across|down|onto|onto the|into the)\b/i, "Jump"],
    [/\b(chokes?|chokes? (?:him|her|them)|strangles?|throttles?|chokehold|headlock|pins? (?:him|her|them)|struggles? with|scuffles?|grapples?|wrestles?|brawl(?:s|ing)?|is (?:punched|slapped|kicked|shoved|dragged|bundled)|punches|shoves? (?:him|her|them) (?:down|against|into|back))\b/i, "Fight"],
    [/\b(is |gets |are )?(?:slammed|thrown|hurled|flung|knocked|smashed|rammed|pushed|shoved)\s+(?:against|into|across|through|down|out|back|over|to the (?:ground|floor))\b/i, "Impact / throw"],
    [/\b(knocked (?:out|unconscious|cold|down|over)|drops? (?:to the (?:floor|ground)|like a stone)|collapses? (?:onto|to the)|trips? and falls|stumbles? and falls|topples?|tumbles?|plummets?|falls? (?:down|through|from|off|backwards|forwards|to the (?:ground|floor)|hard))\b/i, "Fall"],
    [/\b(hit by (?:a|the) (?:car|truck|ute|van|bus|bike|motorbike)|run over|struck by (?:a|the) (?:car|truck|ute|van)|slams? into|crashes? (?:into|through)|smashes? (?:into|through)|plough(?:s|ed)? (?:into|through))\b/i, "Vehicle / object impact"],
    [/\b(catches fire|on fire|set (?:alight|ablaze|on fire)|burst(?:s)? into flames|engulfed in flames|burning (?:man|woman|body))\b/i, "Fire gag (stunt)"],
    [/\b(held underwater|struggles underwater|drown(?:s|ing|ed)|thrashes in the water|pulled under)\b/i, "Water stunt"],
    [/\b(blown (?:back|off|across|apart)|thrown by the (?:blast|explosion)|explosion throws)\b/i, "Explosion reaction"],
    [/\b(shot (?:in|dead|through)|is shot|gets shot|takes a bullet|bullet (?:hits|tears|rips)|stabbed|is stabbed|gets stabbed|stabs)\b/i, "Hit reaction (stunt)"]
  ];
  STUNT_RULES_.forEach(function (r) {
    if (r[1] === "Impact / throw" && items.some(function (i) { return i.c === "stunts" && /throw|fall|tackle/i.test(i.n); })) return;
    if (r[1] === "Vehicle / object impact" && !hasVeh && !/\b(hit by|run over|struck by)\b/i.test(act)) return;
    if (r[1] === "Vehicle / object impact" && items.some(function (i) { return i.c === "stunts" && /crash|chase|driving/i.test(i.n); })) return;
    const m = r[0].exec(act);
    if (m && !DEPICTED_.test(act.slice(Math.max(0, m.index - 80), m.index)) && !/\b(video game|film|movie|tv|show|dream|imagines?)\b/i.test(act.slice(Math.max(0, m.index - 60), m.index))) add("stunts", r[1], "“" + m[0].trim() + "”", m[0].trim());
  });
  if ((sm = /\b(shoots?|fires? (?:at|a|the|his|her)|opens fire|gunshots?|gunfire)\b/i.exec(act)) && !/\b(camera|photo|film|video|footage|shoots? (?:a )?(?:scene|film|movie|photo))/i.test(act.slice(sm.index, sm.index + 24))) {
    if (!items.some(function (i) { return i.c === "weapons"; })) add("weapons", "Firearm", "“" + sm[1] + "”", sm[1]);
    add("sfx", "Gunshot / muzzle flash", "“" + sm[1] + "”", sm[1]);
  }
  if ((sm = /\b(shot|stabbed|stabs|shoots) [^.!?]{0,40}\b(chest|leg|arm|shoulder|stomach|gut|head|back|neck|hand)\b|\bblood (?:sprays|spurts|splatters|splashes|pours|runs|seeps|soaks)\b/i.exec(act))) add("sfx", "Blood hit / squib", "“" + sm[0].trim() + "”", sm[0].trim());
  if (/\b(bikes?|bicycles?|bmx|scooters?|skateboards?|skates)\b/i.test(act) && /\b(ride|rides|riding|rode|pedals?|cycles?|cycling|zooms?|races?|wheels?)\b/i.test(act)) { sm = /\b(bikes?|bicycles?|bmx|scooters?|skateboards?)\b/i.exec(act); if (sm && !DEPICTED_.test(act.slice(Math.max(0, sm.index - 80), sm.index))) add("vehicles", /bmx/i.test(sm[1]) ? "BMX" : /scooter/i.test(sm[1]) ? "Scooter" : /skate/i.test(sm[1]) ? "Skateboard" : "Bicycle", "“" + sm[1] + "”", sm[1]); }
  if (items.some(function (i) { return i.c === "stunts"; })) { add("labor", "Stunt coordinator", "stunts in scene"); if (minorHere) add("labor", "Stunt double (child)", "child in a stunt"); }
  words("blood").forEach(function (w) {
    const n = mapWord(MAKEUP_FLAG_MAP_, w);
    if (n === null) add("props", "Body bag", "“" + w + "”"); else add("makeup", n || w, "“" + w + "”");
  });
  // Music: what plays, and how (live on camera, a recording, or source music in the room)
  const mw = words("music");
  const playback = /\b(we hear|plays (the|a|an)? ?(cassette|tape|record|cd|recording|voicemail|video)|on the (radio|tape|cassette|record))\b/i.test(act);
  mw.forEach(function (w) {
    if (/^jukebox$/.test(w)) return;
    let n = mapWord(MUSIC_MAP_, w) || "Source music";
    if (n === "Song performed on camera" && playback) n = "Recorded song (playback)";
    if (n === "Song") n = "Song (licence)";
    add("music", n, "“" + w + "”");
  });
  if (/\bjukebox\b/i.test(act)) add("music", "Jukebox playback", "“jukebox”");
  if ((sm = /\b(brass band|marching band|live band|pipe band|string quartet|choir)\b/i.exec(act))) { add("music", "Live band", "“" + sm[1] + "”"); add("background", sm[1].charAt(0).toUpperCase() + sm[1].slice(1).toLowerCase() + " (musicians)", "“" + sm[1] + "”", sm[1]); }
  if (!mw.length && /\b(music|radio|stereo|playlist|speakers? (blare|pump|thump))\b/i.test(act) && !/\b(no music|music stops|turns off the (music|radio|stereo))\b/i.test(act)) add("music", "Source music", "music in the action");
  words("screens").forEach(function (w) {
    // a TV that's just on in the background is set dressing; it only needs playback when something is shown on it
    if (/^(tv|television)$/.test(w) && !/\b(tv|television)\b[^.!?\n]{0,60}\b(shows?|showing|displays?|displaying|news|footage|broadcast|reads?|reporter|anchor|replay|clip|video)\b/i.test(act)) return;
    if (/^monitors?$/.test(w) && /\b(heart|baby|patient|ecg|cardiac)\s+monitors?\b/i.test(act)) { add("setdress", "Heart monitor", "“" + (/\b(heart|baby|patient|ecg|cardiac)\s+monitors?\b/i.exec(act)[0]) + "”"); return; }
    add("art", mapWord(SCREEN_MAP_, w) || "Screen graphics", "“" + w + "”");
  });
  const kidWords = words("minors").filter(realIn);
  if (minorHere || kidWords.length) add("labor", "Child chaperone", minorHere ? "child in the cast" : "child in scene");
  if (words("intimacy").length) { add("labor", "Intimacy coordinator", "intimate scene"); add("wardrobe", "Modesty garments", "intimate scene"); add("security", "Closed set", "intimate scene"); }
  if (words("water").length) { add("labor", "Water safety officer", "water work"); if (/\bunderwater\b/.test(actLow)) add("camera", "Underwater housing", "underwater"); }
  if (words("drone").length) add("camera", "Drone", "aerial shot");
  if (s.dn === "N" && isExt) add("equipment", "Night exterior lighting", "exterior at night");

  // ---- Graphics the art department makes: signs, screens, letters, inserts ("the sign reads", "INSERT - THE LETTER")
  const graphics = {};
  const grRe = /\b(sign|banner|screen|headline|note|letter|letters|label|poster|card|tape|cassette|cassette tape|box|jar|bottle|file|folder|photo|photograph|envelope|placard|plaque|tag|ticket|form|statement|document|newspaper|envelope|envelopes|notice|telegram|text message|message|t-shirt|tattoo|board|whiteboard|blackboard|chalkboard|billboard|menu)\b[^.!?\n][^.!?\n,;]{0,30}?\b(reads|read|says|said|labell?ed|marked|stamped|printed with|that reads|which reads|reading|headlined|titled)\b\s*:?\s*["“]?([^"”\n]{1,60})/gi;
  let gr;
  while ((gr = grRe.exec(act)) !== null) {
    const noun = gr[1].toLowerCase().replace(/^cassette$/, "cassette tape"), base = noun === "screen" ? (/\bphone\b/i.test(act) ? "Phone screen" : "Screen") : noun.charAt(0).toUpperCase() + singular(noun).slice(1);
    graphics[norm(singular(noun))] = 1;
    add("art", base + " (graphic)", "“" + clean(gr[0]).slice(0, 70) + "”", gr[1]);
  }
  let ins; const insRe = /(?:^|\n)\s*INSERT\s*[-–—:]\s*(?:THE\s+|A\s+|AN\s+|HIS\s+|HER\s+)?([A-Z][A-Z'’ \-]{1,30}?)\s*(?::|\.|$|\n)/g;
  while ((ins = insRe.exec(act)) !== null) { const n = ins[1].trim().toLowerCase(); graphics[norm(n)] = 1; add("art", n.charAt(0).toUpperCase() + n.slice(1) + " (insert)", "“INSERT - " + ins[1].trim() + "”", ins[1].trim()); }
  if (/\bINSERT\b/.test(heading)) { const n = heading.replace(/^.*INSERT\s*[-–—:]?\s*/, "").toLowerCase().trim(); if (n) add("art", n.charAt(0).toUpperCase() + n.slice(1) + " (insert)", "insert shot"); }

  // ---- Props: things people handle ("picks up a SHOTGUN", "hands her a mug of tea", "finds a bank statement, a will and a tape")
  const handled = {};
  const nounCat = function (head, phrase) {
    if (WEAPON_WORD_.test(phrase)) return "weapons";
    if (VEHICLE_WORD_.test(head) || MORE_VEH_.test(phrase)) return "vehicles";
    if (ANIMAL_WORD_.test(head) || BREED_.test(head)) return "animals";
    if (FURN_EXACT_().test(phrase) || FURN_EXACT_().test(head)) return "setdress";
    if (GARM_EXACT_().test(head)) return "wardrobe";
    return "props";
  };
  const isFood = function (w) { return FOOD_EXACT_().test(w); };
  const knownProp = function (w) { return PROP_EXACT_().test(w); };
  // One noun phrase from the start of `t`: [determiner] [up to 3 describing words] noun — stops at "and", "with", "on", punctuation…
  const takeNP = function (t) {
    const m = /^\s*((?:a pair of|a couple of|a stack of|a pile of|a handful of|a bunch of|a wad of|a set of|a box of|a bottle of|a glass of|a mug of|a cup of|a plate of|a bowl of|a packet of|a tin of|a can of|a jar of|a slice of|a roll of|a bundle of|a|an|the|his|her|their|its|my|your|our|this|that|these|those|some|two|three|four|several|another|each)\s+)?((?:[A-Za-z0-9][A-Za-z0-9'’\-]*\s+){0,4}?)([A-Za-z][A-Za-z'’\-]*)(?=\s*(?:[.,;:!?)\n]|$)|\s+(?:and|or|but|with|on|in|into|onto|to|from|at|off|over|under|across|behind|beside|next|toward|towards|as|while|then|before|after|out|up|down|by|for|of|against|around|through|between|until|again|back|away|closer|tight|tightly|hard|firmly|slowly|quickly|gently|now|instead)\b)/.exec(t);
    if (!m) return null;
    const det = (m[1] || "").trim().toLowerCase(), mods = clean(m[2]).split(" ").filter(Boolean);
    let head = m[3];
    if (/(ed|en)$/i.test(head) && mods.length && !/^(kitchen|garden|linen|oven|chicken|token|siren|screen|ten)$/i.test(head)) head = mods.pop();
    if (mods.some(function (w) { return STOPAT_.test(w.toLowerCase()); })) return null;
    return { det: det, mods: mods, head: head, len: m[0].length, quant: /\bof$/.test(det) ? det.replace(/^a\s+/, "").replace(/\s+of$/, "") : "" };
  };
  const nameOf = function (mods, head) {
    const h = head.toLowerCase().replace(/[’]/g, "'"), last = mods.length ? mods[mods.length - 1].toLowerCase() : "";
    if (last && (COMPOUND_MOD_.test(last) || knownProp(last + " " + h) || FURN_EXACT_().test(last + " " + h))) return last + " " + h;
    return h;
  };
  const handle = function (np, verb, at) {
    if (!np) return;
    const head = np.head, h = head.toLowerCase();
    if (h.length < 3 || NOT_PROP_.test(h) || /ing$/.test(h) && !knownProp(h) && !isFood(h) || /ly$/.test(h)) return;
    if (castWord[head.toUpperCase()] || ctx.cast[head.toUpperCase()] || PEOPLE_WORD_.test(h) || CAPS_SKIP_.test(head.toUpperCase()) && head === head.toUpperCase()) return;
    if (!np.det && !knownProp(h) && !isFood(h) && head !== head.toUpperCase()) return;   // "Maggie dials" — no object
    const phrase = nameOf(np.mods, head).toLowerCase();
    const c = nounCat(h, phrase);
    if (c === "wardrobe") return;   // garments: the wardrobe pass says whose
    const why = "“" + clean(verb + " " + (np.det ? np.det + " " : "") + np.mods.concat([head]).join(" ")).toLowerCase() + "”";
    const light = /^(picks? up|picking up|grabs?|grabbing|snatches|holds?|holding|holds? up|holds? out|hands|handing|passes|carries|carrying|throws|tosses|lifts|raises|brandishes|clutch(es|ing)|cradl(es|ing)|wields?|pockets|slides)$/i.test(verb);
    const it = add(c === "setdress" && light ? "props" : c, c === "animals" ? h : phrase, why, np.mods.concat([head]).join(" "), 0, c === "setdress" && !light ? "" : "handled");
    if (it) handled[it.k] = 1;
    if (isFood(h) || isFood(phrase)) add("props", phrase, why + " (practical food)", head);
  };
  const vRe = new RegExp(rx("handleSrc", function () { return { source: "\\b(" + HANDLE_ + ")\\s+" }; }).source + "(?:(?:him|her|them|me|us|it)\\s+(?=(?:a|an|the|his|her|their|some|two)\\b))?", "gi");
  let v;
  while ((v = vRe.exec(act)) !== null) {
    let rest = act.slice(v.index + v[0].length, v.index + v[0].length + 160).replace(/^(?:up|out|down|off|on|in|through|around)\s+/i, "");
    for (let n = 0; n < 4; n++) {
      const np = takeNP(rest); if (!np) break;
      if (np.quant && !QUANT_.test(np.head)) {}
      // "a mug of tea": the mug and the tea; "a stack of letters": the letters
      if (np.quant) {
        handle({ det: "a", mods: np.mods, head: np.head }, v[1], 0);   // "a set of pliers": the pliers too
        const after = takeNP(rest.slice(np.len).replace(/^\s*/, "a "));   // what's in it
        if (!/^(pair|couple|stack|pile|handful|bunch|wad|set|bundle|roll|slice|piece|pieces|sheet|armful|load|heap)$/.test(np.quant)) handle({ det: "a", mods: [], head: np.quant }, v[1], 0);
        if (after) handle(np.quant === "pair" ? after : Object.assign({}, after, { det: after.det || "a" }), v[1], 0);
      } else if (/^of$/i.test((rest.slice(np.len).match(/^\s*(\w+)/) || [])[1] || "") && QUANT_.test(np.head)) {
        const after = takeNP(rest.slice(np.len).replace(/^\s*of\s+/i, ""));
        handle({ det: "a", mods: np.mods, head: np.head }, v[1], 0);
        if (after) handle(Object.assign({}, after, { det: after.det || "a" }), v[1], 0);
      } else handle(np, v[1], 0);
      // a list: ", a will, and an old cassette tape" / " and bacon"
      let tail = rest.slice(np.len);
      const ppm = /^\s+(?:from|off|out of|under|behind|on|in|into|onto|beside|near|inside|above)\s+(?:the|a|an|his|her|their)\s+[a-z\-]+(?=\s*,|\s+and\b)/i.exec(tail);
      if (ppm) tail = tail.slice(ppm[0].length);   // "the keys from the hook, a set of pliers…"
      const lm = /^\s*(?:,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)(?=(?:a|an|the|his|her|their|some|two|three)\b|[a-z]+\b)/i.exec(tail);
      if (!lm) break;
      rest = tail.slice(lm[0].length);
      if (/^(?:she|he|they|it|we|then|turns|looks|walks|smiles|nods|stares|sits|stands)\b/i.test(rest)) break;
    }
  }
  // "wipes the bar with a rag", "reaches under the counter for a baseball bat"
  [/\b(?:with|using|armed with|wielding|brandishing)\s+(?=(?:a|an|the|his|her|their)\b)/gi, /\b(?:reach(?:es)?|lunges?|scrambles?|fumbles?|gropes?|goes|dives?|grabs?)\s+(?:[a-z]+\s+){0,3}?for\s+(?=(?:a|an|the|his|her|their)\b)/gi].forEach(function (re, ri) {
    let w;
    while ((w = re.exec(act)) !== null) {
      const np = takeNP(act.slice(w.index + w[0].length, w.index + w[0].length + 80)); if (!np) continue;
      const h = np.head.toLowerCase(), ph = nameOf(np.mods, np.head).toLowerCase();
      if (ri === 0 && !(knownProp(h) || knownProp(ph) || WEAPON_WORD_.test(ph) || isFood(h))) continue;   // "with a smile" is not a prop
      handle(np, ri === 0 ? "uses" : "reaches for", 0);
    }
  });
  // Everyday objects named with a/the/her in front ("the phone", "her old bag"), food anywhere it's eaten or drunk
  const dict = function (cat, list, why) {
    const re = new RegExp("\\b(" + DETC + "|[A-Z][A-Za-z]+['’]s)\\s+((?:[A-Za-z'\\-]+\\s+){0,2}?)(" + alt(list) + ")\\b", "gi");
    let m;
    while ((m = re.exec(act)) !== null) {
      const w = m[3];
      if (w === w.toUpperCase() && /[A-Z]{2}/.test(w)) continue;   // CAPS: the caps pass decides
      if (/^[A-Z]/.test(m[1]) && /^(TWO|THREE|FOUR|FIVE|SEVERAL|SOME)$/.test(m[1])) continue;
      if (/['’]s$/.test(m[1]) && !ctx.cast[m[1].replace(/['’]s$/, "").toUpperCase()]) { /* "the farm's" etc: still fine */ }
      const ofm = /^\s+of\s+((?:[a-z'\-]+\s+)??)([a-z][a-z'\-]+)/i.exec(act.slice(m.index + m[0].length));
      if (ofm && (knownProp(ofm[2]) || isFood(ofm[2]))) add("props", ofm[2], "“" + clean(m[0] + ofm[0]).toLowerCase() + "”", ofm[2]);
      if (AMBIG_.test(w) && (m[2] || NUM_DET_.test(m[1]))) continue;
      if (/^(-|'s\b)/.test(act.slice(m.index + m[0].length))) continue;   // "phone-call", "the book's" -> skip compounds
      if (castWord[w.toUpperCase()] && /[A-Z]/.test(w.charAt(0))) continue;
      if (DEPICTED_.test(act.slice(Math.max(0, m.index - 80), m.index)) && cat !== "props") continue;
      const mods = clean(m[2]).split(" ").filter(Boolean).map(function (x) { return x.toLowerCase(); });
      add(cat, nameOf(mods, w.toLowerCase()), why || ("“" + clean(m[0]).toLowerCase() + "”"), mods.concat([w]).join(" "));
    }
  };
  dict("props", PROPS_ + "|" + PROPS_MORE_);
  dict("greenery", GREENERY_);
  const fRe = new RegExp("\\b((?:[a-z'\\-]+\\s+)?)(" + alt(FOOD_) + ")\\b", "gi");
  let fm;
  if (/\b(eats?|eating|ate|fries|frying|cooks?|cooking|serves?|breakfast|lunch|dinner|tea time|feast|bbq|barbecue|picnic|munch|chews?|bites? into|sips?|drinks?|drinking|nurse|nurses|swigs?|pours?|clutches|toasts?|snacks?|stuffs)\b/i.test(act)) {
    while ((fm = fRe.exec(act)) !== null) {
      const w = fm[2].toLowerCase(), pre = (fm[1] || "").trim().toLowerCase();
      if (/^(water|tea|milk|orange|apple|pie|chips|fries|roast|chops|steak|toast|curry|rice)$/.test(w) && !/\b(of|a|the|some|her|his|their|cold|hot|iced|glass|cup|mug|bottle)\s*$/.test(act.slice(Math.max(0, fm.index - 12), fm.index + (fm[1] || "").length).toLowerCase())) continue;
      if (/^(tea|water)$/.test(w) && /^\s*(towel|tank|time|bag|cosy|tree|front|level|main|pistol)/i.test(act.slice(fm.index + fm[0].length))) continue;
      if (/^(dagwood|hot|corn)$/.test(pre) && /dogs?$/.test(w)) { add("props", pre + " " + w, "“" + fm[0].toLowerCase() + "” (practical food)", fm[0]); continue; }
      add("props", w, "“" + clean(fm[0]).toLowerCase() + "” (practical food)", fm[2]);
    }
    if (items.some(function (i) { return /practical food/.test(i.why); }) && /\b(eats?|eating|fries|frying|cooks?|cooking|serves?|breakfast|lunch|dinner|feast|bbq|barbecue|chews?|bites? into|munch)\b/i.test(act)) add("labor", "Food stylist / home economist", "food cooked or eaten on camera");
  }

  // ---- Set dressing: furniture and décor the scene describes ("a narrow single bed, peeling floral wallpaper")
  const furnRe = new RegExp("\\b((?:[a-z'\\-]+\\s+)?)(" + alt(FURNITURE_) + ")\\b", "gi");
  let fu;
  while ((fu = furnRe.exec(act)) !== null) {
    const w = fu[2].toLowerCase(), pre = (fu[1] || "").trim().toLowerCase();
    if (/^(bar|table|lounge|fan|swing|bench|stalls?|record|card|cabinet)$/.test(w) && /^(the|a|at|behind|across|to|from)?$/.test(pre) && /\b(across|behind|at|to|from|over) the$/i.test(act.slice(Math.max(0, fu.index - 14), fu.index + (fu[1] || "").length).trim())) continue;
    if (/^(fan|fans)$/.test(w) && !/\b(ceiling|electric|desk|pedestal)\s+$/.test(act.slice(Math.max(0, fu.index - 12), fu.index + (fu[1] || "").length).toLowerCase())) continue;
    if (/^(table|tables|chair|chairs|bed)$/.test(w) && /^\s*(?:of|is|was|turns)\b/.test(act.slice(fu.index + fu[0].length))) continue;
    if (/^(swing|lounge|bench|record|organ|till|bath|shower|portrait|painting|mirror)$/.test(w) && /^(to|will|can|she|he|they|i)$/.test(pre)) continue;
    if (DEPICTED_.test(act.slice(Math.max(0, fu.index - 80), fu.index))) continue;
    if (/^swing$/.test(w) && /\b(full|in)\s+$/.test(act.slice(Math.max(0, fu.index - 8), fu.index + (fu[1] || "").length) + " ")) continue;
    if (/^(neon sign)$/.test(w)) continue;
    const nm = nameOf(pre ? [pre] : [], w);
    if (/^(tv|television)$/.test(w)) { add("setdress", "Television", "“" + clean(fu[0]).toLowerCase() + "”", fu[2]); continue; }
    add("setdress", nm, "“" + clean(fu[0]).toLowerCase() + "”", (COMPOUND_MOD_.test(pre) ? pre + " " : "") + fu[2]);
  }
  let ns; const nsRe = /\bneon\s+((?:[A-Z0-9][A-Za-z0-9'&\-]*\s+){0,3})sign\b/g;
  while ((ns = nsRe.exec(act)) !== null) add("setdress", "Neon sign" + (ns[1].trim() ? " (" + ns[1].trim() + ")" : ""), "“" + ns[0] + "”", ns[0]);
  // Every set needs dressing: one entry per set the art department dresses (rooms, not open roads)
  if (s.set && !/^(\(|$)/.test(s.set) && !(isExt && !/\b(YARD|GARDEN|PORCH|VERANDAH|VERANDA|PATIO|DECK|DRIVEWAY|SHOWGROUND|MARKET|CAMPSITE|FARM|PADDOCK|BACKYARD|FRONT YARD|SHED|STALL)\b/.test(String(s.set).toUpperCase())) && !BG_VEHICLE_SET_.test(String(s.loc || "")))
    add("setdress", "Set dressing: " + nice(String(s.set).replace(/\s+-\s+/g, " – ")), "every set is dressed", "");
  dict("setdress", SETDRESS_);

  // ---- Wardrobe: "wearing a red dress", "in her school uniform", "a too-big Akubra hat and gumboots" — and whose it is
  const ADJW = "(?:(?!(?:in|on|at|the|a|an|and|with|of|to|by)\\b)[a-z'’\\-]+\\s+)";
  const gRe = new RegExp("\\b(?:wearing|wears|wore|dressed in|clad in|changes into|puts on|pulls on|in)\\s+(?:" + DET + "\\s+)?(" + ADJW + "{0,2}?)(" + GARMENT_ + ")\\b", "gi");
  const gMore = new RegExp("^(?:\\s*,\\s*|\\s+and\\s+|\\s*,\\s*and\\s+)(?:" + DET + "\\s+)?(" + ADJW + "{0,2}?)(" + GARMENT_ + ")\\b", "i");
  sentences.forEach(function (sen) {
    let m; gRe.lastIndex = 0;
    while ((m = gRe.exec(sen)) !== null) {
      const owner = ownerBefore(sen.slice(0, m.index));
      let mm = m, pos = m.index + m[0].length;
      for (let n = 0; n < 5 && mm; n++) {
        const adj = clean(mm[1]).toLowerCase().replace(/[’]/g, "'").replace(/\b(a|an|the|his|her|their|its|my|your|our|new|old|same|only|very)\b/g, "").trim();
        const garment = (adj ? adj + " " : "") + mm[2].toLowerCase();
        if (!/^(the |a )?(car|house|room|kitchen|bed|dark|rain|silence)$/.test(garment) && !(mm[2].toLowerCase() === "cap" && /\b(bottle|lens)\s*$/.test(adj)))
          add("wardrobe", owner ? nice(owner) + ": " + garment : garment, "“" + clean(mm[0]).toLowerCase() + "”", (adj ? mm[1].trim() + " " : "") + mm[2]);
        const nx = gMore.exec(sen.slice(pos));
        if (nx) pos += nx[0].length;
        mm = nx;
      }
    }
  });
  // Uniforms for background people ("two technicians in hi-vis") are background wardrobe
  const mkRe = new RegExp("\\b(" + MAKEUP_ + "|" + MAKEUP_MORE_ + ")\\b", "gi");
  let mk; while ((mk = mkRe.exec(act)) !== null) {
    const w = mk[1].toLowerCase();
    if (/^cast$/.test(w)) continue;
    const n = /tattoo/.test(w) ? "Tattoo" : /wig/.test(w) ? "Wig" : /beard|moustache|mustache|stubble/.test(w) ? "Facial hair" : /mascara|smeared/.test(w) ? "Smeared makeup" : /covered|caked|streaked/.test(w) ? "Dirt / grime" : /vomit/.test(w) ? "Vomit (SFX makeup)" : /sweat/.test(w) ? "Sweat" : /sunburn/.test(w) ? "Sunburn" : /aged|old-age|grey|gray/.test(w) ? "Ageing makeup" : /cut|gash|graze|scratch/.test(w) ? "Cuts & grazes" : /bandage|stitch|band-aid|plaster/.test(w) ? "Bandages" : /in a cast|plaster cast|sling|neck brace/.test(w) ? (/arm|wrist/.test(w) ? "Arm cast" : /leg/.test(w) ? "Leg cast" : /sling/.test(w) ? "Sling" : /neck/.test(w) ? "Neck brace" : "Plaster cast") : /pale|gaunt|sickly|clammy/.test(w) ? "Pallor (unwell)" : /pregnan/.test(w) ? null : /tears?|crying|weeps/.test(w) ? "Tears (tear stick)" : w;
    if (/pregnan/.test(w)) { add("wardrobe", "Pregnancy belly", "“" + w + "”"); continue; }
    if (n) add("makeup", n, "“" + w + "”");
  }
  const camRe = new RegExp("\\b(" + CAMERA_ + ")\\b", "gi");
  let cm; while ((cm = camRe.exec(act)) !== null) {
    const w = cm[1].toLowerCase();
    const n = /steadicam|snorricam/.test(w) ? (w === "snorricam" ? "Snorricam" : "Steadicam") : /crane|jib/.test(w) ? "Crane / jib" : /dolly/.test(w) ? "Dolly & track" : /hand-?held/.test(w) ? "Handheld rig" : /slow|high-speed/.test(w) ? "High-speed camera" : /time-?lapse/.test(w) ? "Time-lapse rig" : /split/.test(w) ? (w === "split screen" ? null : "Split diopter") : /go-?pro/.test(w) ? "Action camera" : /car mount|process/.test(w) ? "Car mount" : /underwater/.test(w) ? "Underwater housing" : /whip/.test(w) ? null : "One-take rig";
    if (w === "split screen") add("vfx", "Split screen", "“split screen”"); else if (n) add("camera", n, "“" + w + "”");
  }
  if (hasVeh && !isExt && /\b(UTE|CAR|VAN|TRUCK|TAXI|CAB|BUS|4WD|SEDAN)\b/.test(String(s.loc || "") + " " + String(s.set || ""))) add("camera", "Car mount", "scene inside a vehicle");

  // ---- Sounds: "we hear a dog bark", "the sound of sirens", a phone that rings
  const hRe = /\b(?:we hear|hear|hears|the sound of|sound of|noise of)\s+((?:(?:a|an|the|some|distant|faint|muffled|loud|low|sudden|soft|far-off)\s+)*)([a-z'\-]+(?:\s+[a-z'\-]+)?)/gi;
  let hm; while ((hm = hRe.exec(act)) !== null) {
    const w = hm[2].toLowerCase().replace(/\s+(in|on|at|from|of|and|as|outside|inside|behind|nearby|somewhere|softly|loudly|quietly|again)$/, "");
    if (/^(him|her|them|it|something|nothing|someone|footsteps? approaching|you|me|us|his|her|their)\b/.test(w)) { if (/footstep/.test(w)) add("sound", "Footsteps", "“" + w + "”"); continue; }
    add("sound", w, "“" + clean(hm[0]).toLowerCase() + "”", hm[2]);
  }
  if ((sm = /\b(phone|landline|mobile)\s+(rings|buzzes|vibrates|pings|chimes)\b/i.exec(act))) add("sound", "Phone " + (/ring/i.test(sm[2]) ? "ring" : "buzz") + " (playback)", "“" + sm[0] + "”", sm[0]);
  if ((sm = /\b(monitor|alarm|timer|microwave|machine)\s+(beeps|beeping|bleeps|blares|sounds)\b/i.exec(act))) add("sound", nice(sm[1]) + " beeps (playback)", "“" + sm[0] + "”", sm[0]);

  // ---- Words in CAPITALS that aren't the cast: screenwriters capitalise sounds and important props
  const capRe = /\b([A-Z][A-Z0-9'’\-]*[A-Z0-9](?:\s+[A-Z][A-Z0-9'’\-]*[A-Z0-9]){0,3})\b/g;
  let c; while ((c = capRe.exec(act)) !== null) {
    let ph = c[1].replace(/[’]/g, "'");
    if (ph.length < 3 && !/^(TV|DJ)$/.test(ph)) continue;
    const before = act.slice(Math.max(0, c.index - 40), c.index), after = act.slice(c.index + c[1].length, c.index + c[1].length + 14);
    if (/^INSERT\b/.test(ph) || /\bINSERT\s*[-–—:]\s*(?:THE\s+|A\s+)?$/.test(before)) continue;   // handled with graphics
    // the words ON a sign, letter, screen or label aren't things ("The screen reads: DAD", "marked FINAL NOTICE")
    if (/(\b(reads?|says|said|labell?ed|marked|stamped|printed|titled|headlined|reading|spells?|spelling|written)\s*:?\s*["“'(]?\s*|:\s*["“]?\s*|["“]\s*)$/i.test(before)) continue;
    if (/^\s*(neon\s+)?(sign|logo|label|brand|banner|poster|neon)\b/i.test(after) || /\bneon\s*$/i.test(before)) continue;
    let toks = ph.split(/\s+/);
    const own = toks[0].replace(/'S$/, "");
    if (/'S$/.test(toks[0]) && castWord[own]) toks.shift();             // "JIMMY'S BIKE" -> "BIKE"
    else if (toks.some(function (t) { return castWord[t.replace(/'S$/, "")]; })) continue;   // "MAGGIE REID", "FRANK REID": a cast member's full name
    if (!toks.length) continue;
    ph = toks.join(" ").replace(/'S$/, "");
    if (ctx.cast[ph] || ctx.locs[ph] || CAPS_SKIP_.test(ph)) continue;
    if (toks.every(function (t) { return castWord[t] || CAPS_SKIP_.test(t); })) continue;
    while (toks.length > 1 && CAPS_SKIP_.test(toks[0])) toks.shift();
    ph = toks.join(" ");
    if (/^\s*\(\s*\d/.test(after) || /^\s*,\s*\d/.test(after) || /^\s*\(\s*(early|mid|late)?\s*\d/i.test(after)) continue;   // someone introduced: NAME (40s)
    const sentenceBefore = before.split(/[.!?\n]/).pop();
    if (SOUND_CAPS_.test(ph) || /\b(hear|hears|sound of|noise of)\b/i.test(sentenceBefore)) { add("sound", ph, "“" + ph + "” (caps)", c[1]); continue; }
    if (PEOPLE_.test(ph) || PEOPLE_WORD_.test(toks[toks.length - 1])) {
      const nm = /(\b(?:a dozen|dozens of|hundreds of|a handful of|a couple of|a few|several|two|three|four|five|six|ten|twelve|twenty|\d+))\s+(?:[a-z'\-]+\s+){0,2}$/i.exec(before);
      add("background", ph, "“" + ph + "” (caps, not in cast)", c[1], nm ? (NUMW_[nm[1].toLowerCase()] || Number(nm[1]) || 0) : 0); continue;
    }
    if (toks.length === 1 && /(ING|ED|S)$/.test(ph) && !knownProp(ph.toLowerCase()) && !WEAPON_WORD_.test(ph) && !ANIMAL_WORD_.test(ph) && !VEHICLE_WORD_.test(ph)) {
      if (/(ING|ES|S)$/.test(ph) && !/(SS|US)$/.test(ph) && !/\b(a|an|the|his|her|their)\s+(?:[a-z-]+\s+)?$/i.test(before)) { add("sound", ph, "“" + ph + "” (caps)", c[1]); continue; }
    }
    // Props need a determiner in front, like any object: "picks up a SHOTGUN", "the old CHEST"
    if (!new RegExp("\\b" + DET + "\\s+(?:[a-z'\\-]+\\s+){0,2}$", "i").test(before)) continue;
    if (WEAPON_WORD_.test(ph)) add("weapons", ph, "“" + ph + "” (caps)", c[1]);
    else if (VEHICLE_WORD_.test(ph)) add("vehicles", ph, "“" + ph + "” (caps)", c[1]);
    else if (ANIMAL_WORD_.test(ph) || BREED_.test(ph)) add("animals", ph, "“" + ph + "” (caps)", c[1]);
    else add("props", ph, "“" + ph + "” (caps)", c[1]);
  }

  // ---- Tidy: one entry per thing, in the category that matters most
  const snd = items.filter(function (i) { return i.c === "sound"; });
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]; if (it.c !== "sound") continue;
    const nm = norm(it.n), big = snd.filter(function (o) { return o !== it && items.indexOf(o) >= 0 && norm(o.n).length > nm.length && (" " + norm(o.n) + " ").indexOf(" " + nm + " ") >= 0; })[0];
    if (big) { it.q.forEach(function (q) { if (big.q.indexOf(q) < 0) big.q.push(q); }); items.splice(i, 1); }
  }
  // A weapon/vehicle found by its own name replaces the generic one ("SHOTGUN" over "Gun")
  ["weapons", "vehicles", "animals"].forEach(function (cat) {
    const specific = items.filter(function (i) { return i.c === cat && (/\(caps\)/.test(i.why) || i.how === "handled"); });
    if (specific.length) for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.c === cat && !/\(caps\)/.test(it.why) && it.how !== "handled" && specific.some(function (w) { return w !== it && w.k.indexOf(it.k.split("|")[1]) >= 0; })) {
        specific.forEach(function (w) { if (w.k.indexOf(it.k.split("|")[1]) >= 0) it.q.forEach(function (q) { if (w.q.indexOf(q) < 0) w.q.push(q); }); });
        items.splice(i, 1);
      }
    }
  });
  // The same thing in two categories: graphic > weapon/vehicle/animal > wardrobe > prop someone handles > set dressing > other props
  const rank = function (it) {
    if (it.c === "art" && /\((graphic|insert)\)$/.test(it.n)) return 8;
    if (it.c === "weapons" || it.c === "vehicles" || it.c === "animals") return 7;
    if (it.c === "wardrobe") return 6;
    if (it.c === "props" && it.how === "handled") return 5;
    if (it.c === "setdress") return 4;
    if (it.c === "props") return 3;
    if (it.c === "greenery") return 2;
    return 0;
  };
  const baseOf = function (it) {
    const nm = norm(it.n.replace(/\s*\((graphic|insert|practical food)\)$/i, "").replace(/^[^:]+:\s*/, ""));
    return singular(nm.split(" ").pop());
  };
  const best = {};
  items.forEach(function (it, i) { if (!rank(it)) return; const b = baseOf(it); if (best[b] == null || rank(items[best[b]]) < rank(it)) best[b] = i; });
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]; if (!rank(it)) continue;
    const b = baseOf(it), keep = items[best[b]];
    if (keep !== it && !/^Set dressing:/.test(it.n)) { it.q.forEach(function (q) { if (keep.q.indexOf(q) < 0) keep.q.push(q); }); items.splice(i, 1); }
  }
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
    const per = {}, hits = {}, src = {}, qty = {};
    // hits: the words to colour for each element in this scene; src: found automatically, tagged by hand, or both
    const put = function (e, qs, how) {
      if (!e || offs[e.key]) return false;
      (per[e.cat] = per[e.cat] || []); if (per[e.cat].indexOf(e.key) < 0) per[e.cat].push(e.key);
      const h = hits[e.key] = hits[e.key] || [];
      (qs || []).forEach(function (q) { if (q && !/^(the|a|an|and|or|of|to|in|on|at|is|it|he|she|his|her|their|its|with|for)$/i.test(String(q).trim()) && h.indexOf(q) < 0) h.push(q); });
      src[e.key] = src[e.key] && src[e.key] !== how ? "both" : how;
      return true;
    };
    suggestScene(s, txOf(s, i), ctx).forEach(function (it) {
      if (offs[it.k] || offs[resolve(alias, it.k)]) return;
      const e = touch(it.k, it.c, it.n, s.n, s.eighths, true, it.why);
      if (put(e, it.q, "auto")) {
        if (it.qty && e) qty[e.key] = Math.max(qty[e.key] || 0, it.qty);
        if (e && (it.caps || it.how === "handled")) e.handledIn = (e.handledIn || 0) + 1;
        if (e && it.caps) e.caps = true;
      }
    });
    (tags[sk] || []).forEach(function (t) { if (!t || !CAT[t.c] || !clean(t.n)) return; put(touch(key(t.c, t.n), t.c, t.c === "cast" ? clean(t.n).toUpperCase() : clean(t.n).charAt(0).toUpperCase() + clean(t.n).slice(1), s.n, s.eighths, false, "tagged"), Array.isArray(t.q) && t.q.length ? t.q : [clean(t.n)], "hand"); });
    Object.keys(per).forEach(function (c) { per[c].sort(function (a, b) { return c === "cast" ? ((els[a].no || 999) - (els[b].no || 999)) : els[a].name.localeCompare(els[b].name); }); });
    const d = days[i] || {};
    const estAuto = estimate(s);
    return {
      n: s.n, id: s.id, key: sk, heading: s.heading, ie: s.ie, set: s.set, loc: s.loc, dn: s.dn, eighths: s.eighths, bg: s.bg, flags: s.flags || [],
      syn: clean(meta.syn) || s.syn || "", synAuto: !clean(meta.syn),
      day: clean(meta.day) || d.label || "", dayAuto: !clean(meta.day), storyDay: d.day || 1, flash: !!d.flash,
      est: Number(meta.est) > 0 ? Math.round(Number(meta.est)) : estAuto, estAuto: !(Number(meta.est) > 0),
      unit: clean(meta.unit) || "Main", note: clean(meta.note), els: per, hits: hits, src: src, qty: qty,
      count: Object.keys(per).reduce(function (a, c) { return a + per[c].length; }, 0)
    };
  });

  // Elements in a category, most-used first (cast by cast number)
  const byCat = {};
  CATS.forEach(function (c) { byCat[c.id] = []; });
  Object.keys(els).forEach(function (k) { const e = els[k]; e.scenes.sort(function (a, b) { return a - b; }); byCat[e.cat].push(k); });
  // Hero props: written in CAPS, or handled in three or more scenes — they need doubles and continuity care
  Object.keys(els).forEach(function (k) {
    const e = els[k];
    e.hero = (e.cat === "props" || e.cat === "weapons") && (!!e.caps || (e.handledIn || 0) >= 3 || (e.manual && e.scenes.length >= 3));
    delete e.handledIn; delete e.caps;
  });
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


// ---------- Feed the breakdown into scheduling (the element sheets are the one source of truth) ----------
// Returns a copy of the script analysis (breakdown.js) where each scene's cast and flags follow the elements,
// so edits made in the Breakdown tab or the editor reach auto-schedule, warnings, Day Out of Days and call sheets.
//   cast   = the cast who are elements of the scene (removing one from the sheet takes them off that day)
//   flags  = the old flags, plus one for each special category the scene has elements in
//            (a flag the plan ignores stays off; a flag whose elements were all removed by hand comes off)
//   needs  = { category: [element names] } for everything except cast
//   specials = element keys that need booking (animals, stunts, vehicles, effects, hero props, equipment…)
const NEED_FLAG_ = { animals: "animals", wrangler: "animals", stunts: "stunts", vehicles: "vehicles", weapons: "weapons", sfx: "sfx", mfx: "sfx", vfx: "vfx" };
const SPECIAL_ = { animals: 1, wrangler: 1, stunts: 1, vehicles: 1, weapons: 1, sfx: 1, mfx: 1, vfx: 1, equipment: 1, camera: 1, security: 1, labor: 1 };
function enrich(bd, model, store, opts) {
  if (!bd || !model) return bd;
  const alias = (store && store.alias) || {}, off = (store && store.off) || {}, fst = (opts && opts.flags) || {};
  const by = {}; model.scenes.forEach(function (m) { by[m.key] = m; });
  const scenes = (bd.scenes || []).map(function (s) {
    const sk = sceneKey(s), m = by[sk]; if (!m) return s;
    const els = m.els || {}, needs = {}, specials = [];
    Object.keys(els).forEach(function (c) {
      if (c === "cast") return;
      needs[c] = els[c].map(function (k) { return model.elements[k].name; });
      els[c].forEach(function (k) { if (SPECIAL_[c] || model.elements[k].hero) specials.push(k); });
    });
    const here = {}; (els.cast || []).forEach(function (k) { here[k] = 1; });
    const cast = (bd.cast || []).map(function (c) { return c.name; }).filter(function (n) { return here[resolve(alias, key("cast", n))]; });
    const flags = (s.flags || []).slice(), removed = {};
    (off[sk] || []).forEach(function (k) { removed[String(k).split("|")[0]] = 1; });
    Object.keys(NEED_FLAG_).forEach(function (c) {
      const f = NEED_FLAG_[c], has = (els[c] || []).length > 0, i = flags.indexOf(f);
      const ignored = fst[f] === "ignore" || fst[f + "@" + s.id] === "ignore";
      if (has && i < 0 && !ignored) flags.push(f);
    });
    ["animals", "stunts", "vehicles", "weapons", "sfx", "vfx"].forEach(function (f) {
      const cs = Object.keys(NEED_FLAG_).filter(function (c) { return NEED_FLAG_[c] === f; });
      const has = cs.some(function (c) { return (els[c] || []).length > 0; }), gone = cs.some(function (c) { return removed[c]; });
      const i = flags.indexOf(f);
      if (!has && gone && i >= 0) flags.splice(i, 1);
    });
    return Object.assign({}, s, { cast: cast, ocast: s.cast || [], flags: flags, needs: needs, specials: specials });
  });
  return Object.assign({}, bd, { scenes: scenes, fromElements: true });
}

// ---------- What the Schedule sheet and call sheets receive (Code.gs reads this as `breakdown`) ----------
function sheetPayload(model) {
  const scenes = {}, els = [];
  model.scenes.forEach(function (m) {
    const e = {};
    Object.keys(m.els).forEach(function (c) {
      e[c] = m.els[c].map(function (k) {
        const x = model.elements[k], o = { n: x.name };
        if (m.qty && m.qty[k] > 1) o.q = m.qty[k];
        if (x.hero) o.h = 1;
        return o;
      });
    });
    scenes[m.key] = { n: m.n, syn: m.syn, day: m.day, est: m.est, unit: m.unit, note: m.note, e: e };
  });
  Object.keys(model.elements).forEach(function (k) {
    const x = model.elements[k];
    els.push({ c: x.cat, n: x.name, sc: x.scenes.slice(), note: x.note || "", h: x.hero ? 1 : 0 });
  });
  return { v: 1, cats: model.cats.map(function (c) { return [c.id, c.label, c.color]; }), scenes: scenes, els: els };
}

// ---------- Store edits (pure: each returns a new store) ----------
function copy(st) { return JSON.parse(JSON.stringify(st && typeof st === "object" ? st : {})); }
function tag(st, sk, cat, name, quote) {
  st = copy(st); name = clean(name).slice(0, 60);
  if (!CAT[cat] || !name) return st;
  const k = key(cat, name), q = clean(quote).slice(0, 80);
  st.tags = st.tags || {}; const list = st.tags[sk] = st.tags[sk] || [];
  let t = null;
  list.forEach(function (x) { if (key(x.c, x.n) === k) t = x; });
  if (!t) { t = { c: cat, n: name }; list.push(t); }
  if (q) { t.q = Array.isArray(t.q) ? t.q : []; if (t.q.indexOf(q) < 0 && t.q.length < 6) t.q.push(q); }   // the words in the script that this element was tagged from
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


// ---------- Team sync (Firebase): the store as a tree of small entries, so each edit writes only what changed ----------
// projects/<pid>/breakdown/<scriptId>/
//   tags/<scene>/<element>: { c, n, q:[…] }   off/<scene>/<element>: true   drop/<element>: true
//   alias/<element>: "to"   names/<element>: "Name"   notes/<element>: "text"   scene/<scene>: { syn, day, est, unit, note }
// Firebase keys can't hold . # $ [ ] / or control characters, so keys are %-encoded.
function encKey(k) { return String(k).replace(/[%.#$\[\]\/\x00-\x1f\x7f]/g, function (c) { return "%" + ("0" + c.charCodeAt(0).toString(16).toUpperCase()).slice(-2); }); }
function decKey(k) { return String(k).replace(/%([0-9A-F]{2})/gi, function (_m, h) { return String.fromCharCode(parseInt(h, 16)); }); }
const MAPS_ = ["alias", "names", "notes"];
function toRemote(st) {
  st = st && typeof st === "object" ? st : {};
  const out = {};
  Object.keys(st.tags || {}).forEach(function (sk) {
    (st.tags[sk] || []).forEach(function (t) {
      if (!t || !CAT[t.c] || !clean(t.n)) return;
      const v = { c: t.c, n: clean(t.n).slice(0, 60) };
      if (Array.isArray(t.q) && t.q.length) v.q = t.q.slice(0, 6).map(function (x) { return String(x).slice(0, 80); });
      ((out.tags = out.tags || {})[encKey(sk)] = out.tags[encKey(sk)] || {})[encKey(key(t.c, t.n))] = v;
    });
  });
  Object.keys(st.off || {}).forEach(function (sk) { (st.off[sk] || []).forEach(function (k) { ((out.off = out.off || {})[encKey(sk)] = out.off[encKey(sk)] || {})[encKey(k)] = true; }); });
  (st.drop || []).forEach(function (k) { (out.drop = out.drop || {})[encKey(k)] = true; });
  MAPS_.forEach(function (m) { Object.keys(st[m] || {}).forEach(function (k) { if (st[m][k] != null && st[m][k] !== "") (out[m] = out[m] || {})[encKey(k)] = String(st[m][k]); }); });
  Object.keys(st.scene || {}).forEach(function (sk) { const v = st.scene[sk]; if (v && Object.keys(v).length) (out.scene = out.scene || {})[encKey(sk)] = JSON.parse(JSON.stringify(v)); });
  return out;
}
function fromRemote(r) {
  r = r && typeof r === "object" ? r : {};
  const st = {};
  const obj = function (x) { return x && typeof x === "object" ? x : {}; };
  Object.keys(obj(r.tags)).forEach(function (sk) {
    const list = Object.keys(obj(r.tags[sk])).map(function (ek) {
      const t = obj(r.tags[sk][ek]); if (!CAT[t.c] || !clean(t.n)) return null;
      const v = { c: t.c, n: clean(t.n) };
      const q = Array.isArray(t.q) ? t.q : Object.keys(obj(t.q)).map(function (i) { return t.q[i]; });   // Firebase can return arrays as objects
      if (q.length) v.q = q.map(String);
      return v;
    }).filter(Boolean);
    if (list.length) (st.tags = st.tags || {})[decKey(sk)] = list;
  });
  Object.keys(obj(r.off)).forEach(function (sk) { const l = Object.keys(obj(r.off[sk])).filter(function (k) { return r.off[sk][k]; }).map(decKey); if (l.length) (st.off = st.off || {})[decKey(sk)] = l; });
  const dr = Object.keys(obj(r.drop)).filter(function (k) { return r.drop[k]; }).map(decKey); if (dr.length) st.drop = dr;
  MAPS_.forEach(function (m) { Object.keys(obj(r[m])).forEach(function (k) { if (typeof r[m][k] === "string") (st[m] = st[m] || {})[decKey(k)] = r[m][k]; }); });
  Object.keys(obj(r.scene)).forEach(function (sk) { const v = obj(r.scene[sk]); if (Object.keys(v).length) (st.scene = st.scene || {})[decKey(sk)] = JSON.parse(JSON.stringify(v)); });
  return st;
}
// The entries that differ between two stores, as { "tags/<scene>/<element>": value | null, … } for one update()
const DEPTH_ = { tags: 3, off: 3, drop: 2, alias: 2, names: 2, notes: 2, scene: 2 };
function flat(r) {
  const out = {};
  Object.keys(DEPTH_).forEach(function (top) {
    const walk = function (node, path, d) {
      if (d === DEPTH_[top] || !node || typeof node !== "object") { out[path] = JSON.stringify(node); return; }
      Object.keys(node).forEach(function (k) { walk(node[k], path + "/" + k, d + 1); });
    };
    if (r[top] != null) walk(r[top], top, 1);
  });
  return out;
}
function diff(a, b) {
  const fa = flat(toRemote(a)), fb = flat(toRemote(b)), out = {};
  Object.keys(fa).forEach(function (p) { if (!(p in fb)) out[p] = null; });
  Object.keys(fb).forEach(function (p) { if (fa[p] !== fb[p]) out[p] = JSON.parse(fb[p]); });
  return out;
}
// Put two stores together without losing either's entries (b's single values win when both have one)
function mergeStores(a, b) {
  const ra = toRemote(a), rb = toRemote(b), out = JSON.parse(JSON.stringify(ra));
  Object.keys(rb).forEach(function (top) {
    out[top] = out[top] || {};
    Object.keys(rb[top]).forEach(function (k) {
      if ((top === "tags" || top === "off") && out[top][k]) Object.keys(rb[top][k]).forEach(function (e) {
        const x = out[top][k][e], y = rb[top][k][e];
        if (top === "tags" && x && y) { const q = (x.q || []).concat((y.q || []).filter(function (w) { return (x.q || []).indexOf(w) < 0; })).slice(0, 6); out[top][k][e] = Object.assign({}, y, q.length ? { q: q } : {}); }
        else out[top][k][e] = y;
      });
      else out[top][k] = rb[top][k];
    });
  });
  return fromRemote(out);
}
// Edits the editor made while the hub wasn't watching: [{ t:"tag", sk, c, n, q } | { t:"untag", sk, k }]
function applyOps(st, ops) {
  (Array.isArray(ops) ? ops : []).forEach(function (o) {
    if (!o || typeof o !== "object") return;
    if (o.t === "tag") st = tag(st, String(o.sk || ""), o.c, o.n, o.q);
    else if (o.t === "untag" && o.k) st = untag(st, String(o.sk || ""), String(o.k));
  });
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
      return (s.els[c.id] || []).map(function (k) { const e = b.elements[k]; return (e.no ? e.no + ". " : "") + e.name + (s.qty && s.qty[k] ? " x" + s.qty[k] : "") + (e.hero ? " (hero)" : ""); }).join("; ");
    }));
  });
  return [head].concat(rows).map(function (r) { return r.map(q).join(","); }).join("\n");
}

const api = { CATS: CATS, CAT: CAT, build: build, enrich: enrich, sheetPayload: sheetPayload, suggestScene: suggestScene, sceneTexts: sceneTexts, storyDays: storyDays, estimate: estimate,
  key: key, norm: norm, display: display, sceneKey: sceneKey, resolve: resolve,
  tag: tag, untag: untag, drop: dropEl, undrop: undrop, rename: rename, merge: merge, unmerge: unmerge, setNote: setNote, setScene: setScene,
  report: report, csv: csv, fmtEighths: fmtEighths,
  encKey: encKey, decKey: decKey, toRemote: toRemote, fromRemote: fromRemote, diff: diff, mergeStores: mergeStores, applyOps: applyOps };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.CampElements = api;
})(typeof window !== "undefined" ? window : this);
