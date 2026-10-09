/* breakdown.js — Camp's script breakdown engine (scenes, page eighths, cast per scene, locations, flags).
   This is the SAME code as budgetAnalyze_ and its helpers in the Main Apps Script (Code.gs), so the
   production docs and the in-app Production panel always agree. If you change one, copy it to the other;
   tests/breakdown.test.js checks the behaviour on every deploy.
   Browser: window.CampBreakdown.analyze(doc). Node: require("./breakdown.js").analyze(doc). */
(function (root) {
"use strict";
// Characters per line for each element, matching Final Draft and the Camp editor (Courier 12pt)
const BG_COLS_ = { scene: 61, action: 61, character: 38, dialogue: 35, parenthetical: 25, transition: 61, shot: 61, dual: 28 };
function runsText_(runs) {
  if (!Array.isArray(runs)) return "";
  return runs.map(function (r) { return String((r && r.t) || ""); }).join("");
}
function wrapRows_(text, width) {
  text = String(text || "").replace(/\s+/g, " ").trim();
  if (!text) return 1;
  const words = text.split(" ");
  let rows = 1, cur = 0;
  for (let i = 0; i < words.length; i++) {
    let w = words[i].length;
    while (w > width) { if (cur) { rows++; cur = 0; } w -= width; rows++; }
    if (cur === 0) cur = w;
    else if (cur + 1 + w <= width) cur += 1 + w;
    else { rows++; cur = w; }
  }
  return rows;
}
function estimatePages_(doc) {
  // Matches the editor: blank lines are real empty lines, scene headings get one extra line above.
  const lines = (doc && Array.isArray(doc.lines)) ? doc.lines : [];
  if (!lines.length) return 1;
  const size = String((doc.pageSettings && doc.pageSettings.pageSize) || "").toLowerCase();
  const perPage = size.indexOf("letter") >= 0 ? 54 : 58;
  const W = BG_COLS_;
  let pages = 1, y = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] || {};
    const t = String(l.type || "action");
    let rows;
    if (t === "dual") {
      const d = l.dual || {};
      const side = function (s) { s = s || {}; return 1 + wrapRows_(runsText_(s.dialogueRuns), BG_COLS_.dual); };
      rows = Math.max(side(d.left), side(d.right));
    } else {
      rows = wrapRows_(runsText_(l.runs), W[t] || BG_COLS_.action);
    }
    const gap = (y > 0 && t === "scene") ? 1 : 0;
    if (y > 0 && y + gap + rows > perPage) { pages++; y = rows; }
    else y += gap + rows;
  }
  return pages;
}
function escapeRe_(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function bgClean_(s) { return String(s == null ? "" : s).replace(/[ ​﻿]/g, " ").replace(/\s+/g, " ").trim(); }
function bgOneLiner_(text) {
  let t = bgClean_(String(text || ""));
  if (t.length <= 90) return t;
  t = t.slice(0, 90);
  const sp = t.lastIndexOf(" ");
  if (sp > 40) t = t.slice(0, sp);
  return t + "…";
}
function bgPlain_(runs) { return bgClean_(runsText_(runs)); }
function bgWords_(s) { const m = String(s || "").match(/[A-Za-z0-9'’]+/g); return m ? m.length : 0; }

const BG_TIME_N_ = /^(NIGHT|MIDNIGHT|LATE NIGHT|EVENING|EARLY EVENING|NIGHTTIME|NIGHT TIME|PRE-DAWN|PREDAWN)$/;
const BG_TIME_M_ = /^(DAWN|DUSK|SUNSET|SUNRISE|MAGIC HOUR|TWILIGHT|GOLDEN HOUR|FIRST LIGHT)$/;
const BG_TIME_D_ = /^(DAY|MORNING|AFTERNOON|NOON|MIDDAY|LATE AFTERNOON|EARLY MORNING|DAYTIME|LATE MORNING|LUNCHTIME)$/;
const BG_TIME_C_ = /^(CONTINUOUS|CONT|CONT'D|LATER|MOMENTS LATER|A MOMENT LATER|SAME|SAME TIME|SIMULTANEOUS|MINUTES LATER|SECONDS LATER|HOURS LATER|FLASHBACK|PRESENT|INTERCUT|MONTAGE)$/;

function bgTimeClass_(t) {
  t = String(t || "").toUpperCase().replace(/[^A-Z' -]/g, "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (BG_TIME_N_.test(t)) return "N";
  if (BG_TIME_M_.test(t)) return "M";
  if (BG_TIME_D_.test(t)) return "D";
  if (BG_TIME_C_.test(t)) return "C";
  if (/\bNIGHT\b/.test(t)) return "N";
  if (/\b(DAWN|DUSK|SUNSET|SUNRISE)\b/.test(t)) return "M";
  if (/\b(DAY|MORNING|AFTERNOON)\b/.test(t)) return "D";
  if (/\b(LATER|CONTINUOUS|SAME)\b/.test(t)) return "C";
  return "";
}

// "INT. HOUSE - KITCHEN - NIGHT" -> { ie:"INT", set:"HOUSE - KITCHEN", primary:"HOUSE", time:"NIGHT", tcls:"N" }
function bgParseHeading_(raw) {
  let s = bgClean_(raw).toUpperCase().replace(/[–—]/g, "-");
  s = s.replace(/^[0-9]+[A-Z]?[.)]?\s+/, "").replace(/\s+[0-9]+[A-Z]?\s*$/, "");
  let ie = "";
  const m = s.match(/^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\s*\/\s*E\.?|INT\.?|EXT\.?|EST\.?)(\s+|$)/);
  if (m) {
    const p = m[1].replace(/\s+/g, "");
    ie = p.indexOf("/") >= 0 ? "INT/EXT" : (p.indexOf("INT") === 0 ? "INT" : "EXT");
    s = s.slice(m[0].length).trim();
  }
  const parts = s.split(/\s+-+\s+/).map(function (x) { return x.trim(); }).filter(String);
  let time = "", tcls = "";
  if (parts.length > 1) {
    const last = parts[parts.length - 1].replace(/[()]/g, "").trim();
    const cls = bgTimeClass_(last);
    if (cls) { time = last; tcls = cls; parts.pop(); }
  }
  let set = parts.join(" - ").replace(/\s*\((CONTINUOUS|CONT'D|CONT|LATER|FLASHBACK|PRESENT DAY|PRESENT|DAY|NIGHT)\)\s*/g, " ").trim();
  if (!set) set = "UNKNOWN LOCATION";
  let primary = (parts[0] || set).replace(/\s*\(.*?\)\s*/g, " ").replace(/[.,:;]+$/, "").replace(/\s+/g, " ").trim();
  if (!primary) primary = set;
  return { ie: ie, set: set, primary: primary, time: time, tcls: tcls };
}

// "SARAH (V.O.) (CONT'D)" -> { name:"SARAH", vo:true }
function bgCharName_(raw) {
  let s = bgClean_(raw).toUpperCase();
  const vo = /\(\s*V\.?\s*O\.?\s*\)|\(\s*VOICE\s*\)|\(\s*(ON|OVER)\s+(THE\s+)?(PHONE|RADIO|TV|SPEAKER|SPEAKERPHONE|INTERCOM|SCREEN)\s*\)|\(\s*PRE-?LAP\s*\)|\(\s*FILTERED\s*\)/.test(s);
  s = s.replace(/\(.*?\)/g, " ").replace(/\bCONT['’]?D\b/g, " ").replace(/[^A-Z0-9'’ .&#\-]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[\s.\-]+$/, "");
  return { name: s, vo: vo };
}

// Cues that are a group speaking, not one person
const BG_GROUP_CUE_ = /^(EVERYONE|EVERYBODY|ALL|ALL OF THEM|CROWD|THE CROWD|AUDIENCE|THE AUDIENCE|KIDS|THE KIDS|CHILDREN|BOTH|TOGETHER|GROUP|THE GROUP|VOICES|OTHERS|GUESTS|PARENTS|TEAM|THE TEAM|CHORUS|PEOPLE|VARIOUS|MEN|WOMEN|STUDENTS|CLASS|THE CLASS)$/;
// Words that are also ordinary English, so "Will", "Hope", "Bill"… in normal case aren't taken as the
// character. Written in CAPITALS they always count.
const BG_COMMON_WORD_ = /^(WILL|MAY|JUNE|APRIL|AUGUST|HOPE|GRACE|FAITH|JOY|ROSE|IVY|LILY|DAISY|DAWN|SKY|STORM|RAIN|SUMMER|WINTER|AUTUMN|BILL|MARK|JACK|ART|BOB|PAT|ROB|SUE|RAY|MATT|NICK|WOODY|GUY|DREW|CHASE|HUNTER|PRINCE|KING|QUEEN|BISHOP|DEAN|JUSTICE|MAJOR|SARGE|DOC|BOSS|CHIEF|SON|BABY|KID|MAN|WOMAN|GIRL|BOY|FRANK|HARPER|MASON|CARTER|PARKER|CAMP|RIVER|STONE|WOLF|FOX|BEAR|DUCK|BIRD|PIP|TINY|SMALL|BIG|RED|BLUE|GREEN|BLACK|WHITE|GREY|GRAY|BROWN)$/;
// Does this scene's action name the character? CAPS always; Normal Case only for unambiguous names.
function bgMentionTest_(name, capsOnly) {
  name = String(name || "").trim();
  if (!name) return function () { return false; };
  const body = name.split(/\s+/).map(escapeRe_).join("\\s+");
  const up = new RegExp("(^|[^A-Za-z0-9])" + body + "(?![A-Za-z0-9])");
  const title = name.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  const useTitle = !capsOnly && name.length >= 3 && !/^(THE|A|AN)\s/.test(name) && !BG_COMMON_WORD_.test(name) && /[A-Z]/.test(name);
  const tl = useTitle ? new RegExp("(^|[^A-Za-z0-9])" + title.split(/\s+/).map(escapeRe_).join("\\s+") + "(?![A-Za-z0-9])") : null;
  return function (txt) { return up.test(txt) || (!!tl && tl.test(txt)); };
}
const BG_VEHICLE_LOC_ = /\b(CAR(?![ -]?(PARK|WASH|YARD|DEALERSHIP))|CARS|VAN|TRUCK|BUS|TAXI|CAB|UTE|LIMO|LIMOUSINE|SEDAN|SUV|4WD|AMBULANCE|POLICE CAR|BOAT|YACHT|FERRY|TRAIN|TRAM|PLANE|AIRPLANE|AEROPLANE|HELICOPTER|CARAVAN|MOTORBIKE|MOTORCYCLE|CAMPERVAN|HEARSE)\b/;
const BG_PUBLIC_LOC_ = /\b(BAR|PUB|RESTAURANT|CAFE|CAFÉ|DINER|CLUB|NIGHTCLUB|HOSPITAL|WARD|SCHOOL|CLASSROOM|CORRIDOR|UNIVERSITY|LECTURE|OFFICE|OFFICES|MALL|SHOPPING|STATION|AIRPORT|TERMINAL|SUPERMARKET|STREET|STREETS|CHURCH|COURT|COURTROOM|PARTY|GYM|STADIUM|MARKET|LIBRARY|HOTEL LOBBY|LOBBY|WAITING ROOM|CANTEEN|CAFETERIA|FOOD COURT|CASINO|THEATRE|THEATER|CINEMA|BEACH|PARK|PLATFORM|POLICE STATION|PRECINCT|NEWSROOM|FACTORY|WAREHOUSE FLOOR|KITCHEN OF A RESTAURANT|BALLROOM|WEDDING|FUNERAL)\b/;
const BG_CROWD_ = /\b(crowd|crowds|audience|spectators|protesters|protestors|rally|festival|concert|stadium|parade|congregation|mourners|hundreds|dozens of|throng|mob|revellers|revelers|dance floor|mosh)\b/i;
const BG_SMALL_ = /\b(patrons|diners|customers|shoppers|passers-by|passersby|passer-by|pedestrians|commuters|students|guests|partygoers|party-goers|birthday party|kids['’]? party|children['’]?s party|onlookers|bystanders|tourists|workers|staff|nurses|doctors|police officers|officers|cops|soldiers|dancers|people|drinkers|punters|regulars|clients|travellers|travelers|passengers|classmates|colleagues|coworkers|co-workers|office workers|kids play|children play|families|couples|locals|villagers|inmates|prisoners|waiters|waitresses|bar staff|background|crowded|packed)\b/i;
// Private residential exterior spaces — filming here is on private property, so it's kept out of the
// public-outdoor-location permit count (unlike a street, park or other public exterior).
const BG_PRIVATE_EXT_ = /\b(BACK ?YARD|FRONT ?YARD|YARD|GARDEN|DRIVEWAY|PORCH|PATIO|DECK|BALCONY|CARPORT|GARAGE)\b/;
const BG_EMPTY_ = /\b(empty|deserted|abandoned|alone|closed for the night|after hours)\b/i;

// Things in the script that usually cost money. Searched in scene headings + action (not dialogue).
// re  = words that count.  not = phrases that DON'T count, even though they contain a word from re
//       (e.g. "playing pool" is not water, "she waves goodbye" is not the ocean).
const BG_FLAGS_ = [
  { id: "night", label: "Night scenes", use: "Extra lighting" },
  { id: "vehicles", label: "Picture vehicles", use: "Picture vehicles",
    re: "\\b(car(?![ -]?(park|wash|yard|dealership|keys?))|cars|truck|trucks|van|vans|bus|taxi|cab|ute|utes|motorbike|motorcycle|scooter|limo|limousine|sedan|suv|4wd|tractor|caravan|campervan|police car|patrol car|ambulance|fire truck|fire engine|boat|yacht|ferry|tram|helicopter|hearse|(the|a|an|his|her|their|on|next|last|passing|moving|express|freight) train|train (carriage|tracks?|doors?))\\b",
    not: "\\b((bus|tram|taxi|cab) (stop|station|shelter|ticket|timetable|rank|fare)|(to|at|from|towards?) the (bus|tram) (stop|station|shelter)|monster truck|toy (car|truck|train|boat)|(van|cab) (gogh|der|de)\\b)" },
  { id: "driving", label: "Driving scenes", use: "Tow / safety vehicle",
    re: "\\b(drives|driving|drive off|drives off|drives away|speeds off|speeds away|pulls up (outside|at|in front|beside|alongside|next to|to the)|pulls over|behind the wheel|swerves|accelerates)\\b",
    not: "\\b(drives (him|her|them|me|us|you) (crazy|mad|nuts|insane|up the wall)|drives (the|a|his|her) (point|nail|stake|wedge|message)|driving (rain|force|range|me|him|her|them|us) ?(crazy|mad|nuts)?|(heart|pulse|breathing|breath) accelerates|pulls over (his|her|their|a|the) (head|shirt|jumper|hoodie|jacket|dress|top|sweater|blanket|hood))\\b" },
  { id: "stunts", label: "Stunts & action", use: "Stunt coordinator & safety gear",
    re: "\\b(fight|fights|fighting|punch|punches|punched|kick|kicks|kicked|brawl|brawls|tackle|tackles|tackled|falls (down|over|from|off|to the|backwards)|fell (down|from|off)|thrown|throws (him|her|them)|crash|crashes|crashed|collides|collision|chase|chases|chased|chasing|jumps (off|from|out|through)|stabs|stabbed|strangles|slams (him|her|them|into)|hit by|gunfight|shootout|shoot-out|explosion|dragged|wrestles|grapples|headbutts|tumbles|smashes through)\\b",
    not: "\\b(fights? (back|off|against)? ?(tears|sleep|a smile|a laugh|the urge|a yawn|the feeling)|fight or flight|(pillow|food|water|snowball|thumb) fights?|punch ?line|punchline|fruit punch|punch(es|ed)? (in|out) (the )?(code|numbers?|clock|card)|kicks? (off )?(his|her|their) (shoes|boots|heels|thongs)|kicks? back|kick(s|ed)? off|kick(s|ed)? (in|out) (of )?(the|a) (bar|pub|club|house|party|class|team)|kicked out|crash(es|ed)? (on|at|out|into bed)|crash(es|ed)? the party|crash (course|pad|diet)|party crash(ers?)?|(the )?(market|computer|website|server|app|system) crash(es|ed)?|chases? (it )?down|chases? (the|a|his|her) (thought|dream|feeling|high|clock)|throws (him|her|them) (a|an) (look|glance|smile|wink|grin|nod|towel|bone|curveball)|thrown (off|by) (the|this|that|her|his|it|a)|thrown out|jumps out of (bed|(his|her|their) skin)|hit by (a )?(wave of|realisation|realization|thought|memory|the smell|the heat)|dragged (on|out)|time dragged)\\b" },
  { id: "weapons", label: "Weapons", use: "Weapons safety & prop weapons",
    re: "\\b(gun|guns|pistol|revolver|rifle|rifles|shotgun|handgun|firearm|firearms|knife|knives|blade|machete|sword|swords|axe|crossbow|taser|gunshot|gunshots|gunfire|holster|ammo|ammunition|bullet|bullets|grenade)\\b",
    not: "\\b((glue|nail|staple|water|nerf|toy|hair|finger|heat|spray|starting|radar|speed|squirt|paint|caulking|tattoo) guns?|guns? (it|the engine)|(shoulder|rotor|razor|fan|grass|propeller|oar) blades?|blades? of grass|roller ?blades?|(butter|bread|steak|palette|putty|craft|stanley|utility) knife|knife and fork|knives and forks|(knife|knives) (and|&) (fork|forks|spoons?)|(chops|slices|dices|cuts|spreads|butters|carves|peels) [a-z ]{0,25}(with a|the) knife|bullet (points?|journal|train|list)|bite the bullet|dodged? a bullet|axe body|(talks?|talking|jokes?|joking|asks?|asking|thinks?|thinking|wonders?|wondering|dreams?|dreamed|remembers?|recalls?|reads?|hears?|heard) about (a |the |his |her |their |that |this |buying |getting |owning )?(gun|guns|pistol|rifle|knife|weapon)s?|(mentions?|mentioned) (a |the |his |her |their )?(gun|guns|pistol|rifle|knife|weapon)s?|(story|rumou?rs?|joke) about (a |the )?(gun|guns|pistol|rifle))\\b" },
  { id: "animals", label: "Animals", use: "Animal wrangler & animal fees",
    re: "\\b(dog|dogs|puppy|puppies|cat|cats|kitten|kittens|horse|horses|pony|bird|birds|parrot|chicken|chickens|cow|cows|sheep|goat|goats|pig|pigs|kangaroo|kangaroos|wallaby|koala|snake|snakes|spider|rabbit|rabbits|possum|lizard|cattle|duck|ducks|budgie|cockatoo|ferret|hamster)\\b",
    not: "\\b(hot ?dogs?|corn ?dogs?|dog[- ]eared|dog[- ]tired|sea ?dogs?|top dog|(roast|fried|grilled|cooked|crumbed|butter|chilli|chili|bbq|barbecued?|leftover|cold) chicken|chicken (salad|soup|nuggets?|wings?|burgers?|sandwich(es)?|curry|parma|parmi|schnitzel|pie|kiev|breast|thighs?|drumsticks?|out|shit)|chickens? out|playing chicken|(roast|peking|confit) duck|ducks? (under|behind|out|down|into|through|low|back|inside|for|his|her|their|away|as|and|the)|(snakes?|snaking) (through|around|along|its way|his way|her way|their way|up|down|past)|snake oil|bird'?s[- ]eye|birds[- ]eye|early bird|horse (around|play)|dark horse|high horse|cat ?(walk|call|nap|flap|litter)|scaredy[- ]cat|fat cat|cash cow|holy cow|pig (out|sty)|pigs out|guinea pig|rabbit hole|lounge lizard|spider[- ]?man)\\b" },
  { id: "sfx", label: "Special effects (practical)", use: "SFX technician & materials",
    re: "\\b(rain|raining|rains|downpour|storm|thunder|lightning|snow|snowing|fog|foggy|mist|smoke|fire|fires|flames|burning|burns|blaze|explosion|explodes|sparks|flood|flooding|shatters|smashes|wind whips|gale|steam)\\b",
    not: "\\b(storms? (out|off|in|into|away|past|through|up|down|upstairs|downstairs|over|back|across|toward|towards)|brainstorm|fires? (him|her|them|you|me|us|back|off|up|questions?|a (shot|question|look|glance))|(fire|smoke) (alarm|exit|escape|door|station|extinguisher|fighters?|truck|engine|brigade|department|detector|break|drill)|opens fire|under fire|ceasefire|cease fire|smoke (break|detector)|sparks (a|an|up|his|her) (lighter|cigarette|joint|conversation|interest|debate|idea|memory|argument)|(lets|let) off steam|picks up steam|steams? ahead|burning (desire|question|eyes|cheeks|sensation|up)|(cheeks|ears|face|eyes) burns?|burns (the midnight|bridges|with)|floods? (of|back|in) (memories|light|tears|emotion|relief)?|floods? of|memories flood|(eyes|vision) mists?|brain fog|fog of (war|confusion)|lightning[- ](fast|quick|bolt tattoo)|like lightning|stolen thunder|steals? (his|her|their|my) thunder|rain ?check|snow ?globe|smashes (the|a) (ball|record|it)|shatters (the|a|her|his) (silence|mood|illusion|record))\\b" },
  { id: "blood", label: "Blood, wounds & SFX makeup", use: "SFX makeup",
    re: "\\b(blood|bloody|bleeding|bleeds|wound|wounds|wounded|gash|bruise|bruised|bruises|scar|stitches|cut lip|black eye|injury|injured|corpse|dead body|body bag|prosthetic)\\b",
    not: "\\b(bloody (hell|oath|idiot|mess|good|great|legend|thing|nora)|blood (test|type|pressure|orange|moon|relatives?|brothers?|bank)|wound (up|down|tight)|(emotional|old|deep) wounds|bruised (ego|pride|feelings)|in stitches|injury time)\\b" },
  { id: "vfx", label: "Visual effects", use: "VFX shots",
    re: "\\b(vfx|cgi|green screen|greenscreen|hologram|holographic|spaceship|alien|aliens|monster|creature|ghost|ghostly|disappears into thin air|vanishes into thin air|teleports|morphs|levitates|portal|superpower|robot|dragon|time freezes)\\b",
    not: "\\b(ghost (of a|town|writer|story|stories|train)|ghosts? (him|her|them)|monster (truck|energy|drink|mash)|(feels|seems|looks) alien|alien to|(online|web|job|staff|customer|booking) portal|robot vacuum|creature comforts?|dragon ?(fruit|boat))\\b" },
  { id: "minors", label: "Children (under 18)", use: "Child chaperone & permits",
    re: "\\b(child|children|kid|kids|baby|babies|toddler|toddlers|infant|infants|newborn|teenager|teenagers|schoolkids?|schoolboys?|schoolgirls?|(little|young|small|tiny|teenage|school) (boy|boys|girl|girls)|(boy|girl)s? (aged|of) (\\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)|\\d{1,2}[- ]year[- ]olds?)\\b",
    not: "\\b(like a (child|kid|baby)|kid (around|gloves)|kidding|baby (steps|face|faced|blue|blues|shower|oil|boomers?|monitor|photos?)|(her|his|their|my|your|our) inner child|child(ish|like|hood)|kids' table|grown[- ]up kids|(1[89]|[2-9]\\d)[- ]year[- ]olds?)\\b" },
  { id: "water", label: "Water work", use: "Water safety",
    re: "\\b(swimming pool|swims|swimming|swim|underwater|drowns|drowning|drowned|dives into (the )?(water|pool|sea|ocean|river|lake|surf|waves)|(in|into|under|across|beside|out of|by|near|at the edge of) the (pool|water|surf|waves|ocean|sea|river|lake|creek|dam|bay)|ocean|surf|surfing|surfboard|(crashing|breaking|rolling|big|the) waves|river|lake|creek|jetty|pier|rock ?pool)\\b",
    not: "\\b((play|plays|playing|shoot|shoots|shooting|game of|games of) pool|pool (table|tables|cue|cues|hall|room|shark|balls?)|(car|office|typing|talent|gene|betting|money) pool|pool (resources|money|together)|swimming (in|with) (debt|paperwork|money|emails|thoughts|tears)|in hot water|(glass|bottle|jug|cup|drink|drinks|sip|sips|mouthful|gulp|gulps) of water|water (bottle|glass|jug|cooler|tank|stain|damage|main|bill)|(sea|ocean) of (faces|people|red|blue|green|white|black|bodies|hands|heads|paper)|(fall|falls|fell|falling|feel|feels) out of the water|wave(s|d)? (goodbye|hello|him|her|them|at|off|away|to|back|a|an|his|her|their)|lake (drive|view|road|street)|river (road|street|drive|city)|surf(s|ing)? (the )?(web|net|internet|channels?))\\b" },
  { id: "intimacy", label: "Intimate scenes / nudity", use: "Intimacy coordinator",
    re: "\\b(sex scene|have sex|having sex|had sex|sex with|naked|nude|nudity|undresses|undressing|topless|makes love|making love|intimate scene|in bed together)\\b",
    not: "\\b(naked eye|naked truth|nude (colour|color|lipstick|heels|tones?|palette))\\b" },
  { id: "drone", label: "Drone / aerial shots", use: "Drone operator",
    re: "\\b(drone shot|drone footage|a drone|the drone|drones|aerial (shot|view|footage|of)|helicopter shot|bird's-eye (shot|view)|birds-eye (shot|view)|overhead shot)\\b",
    not: "\\b((the |a )?drone of (the )?(traffic|engine|bees|voices|the fridge|machinery|a plane)|drones on)\\b" },
  { id: "music", label: "Source music & performance", use: "Music licences",
    re: "\\b(sings|singing|sang|song|songs|band plays|music plays|radio plays|jukebox|dj|karaoke|concert|plays the piano|plays the guitar|plays piano|plays guitar|dances to|record player|stereo blares)\\b",
    not: "\\b(sings (his|her|their) praises|for a song|song and dance)\\b" },
  { id: "screens", label: "Screens & playback", use: "Screen graphics",
    re: "\\b(tv|television|laptop|computer screen|phone screen|monitor|monitors|screen shows|text message|texts|facetime|video call|zoom call|news report|broadcast|cctv|security footage)\\b",
    not: "\\b(monitors? (him|her|them|the situation|his|her|their))\\b" }
];

function bgAgeNum_(s) {
  s = String(s || "").toUpperCase();
  const m = s.match(/(\d{1,2})/);
  if (!m) return null;
  return Number(m[1]);
}

function budgetAnalyze_(doc) {
  doc = (doc && typeof doc === "object") ? doc : {};
  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  const W = BG_COLS_;
  const scenes = [];
  const chars = {};
  const intros = {};   // silent-role introductions: NAME (30s)
  let cur = null, lastT = "D", speaker = null;

  const startScene = function (heading, id, pseudo) {
    const h = pseudo ? { ie: "", set: "(BEFORE THE FIRST SCENE HEADING)", primary: "(NO SCENE HEADING)", time: "", tcls: "" } : bgParseHeading_(heading);
    let dn = h.tcls;
    if (!dn || dn === "C") dn = lastT; else lastT = dn;
    cur = { n: scenes.length + 1, id: String(id || ""), heading: pseudo ? "" : bgClean_(heading).toUpperCase(), ie: h.ie, set: h.set, loc: h.primary,
      time: h.time, dn: dn, rows: 0, cast: [], castSeen: {}, action: "", eighths: 0 };
    scenes.push(cur);
    speaker = null;
  };
  const charRec = function (name) {
    if (!chars[name]) chars[name] = { name: name, scenes: {}, onCam: {}, lines: 0, words: 0, first: cur ? cur.n : 1, voLines: 0, age: null };
    return chars[name];
  };
  const seeChar = function (name, vo) {
    if (!name || !cur) return null;
    // "EVERYONE", "CROWD", "KIDS"… speak as a group: background, not a cast member
    if (BG_GROUP_CUE_.test(name)) { cur.groupCue = true; return null; }
    const c = charRec(name);
    c.scenes[cur.n] = true;
    if (!vo) { c.onCam[cur.n] = true; if (!cur.castSeen[name]) { cur.castSeen[name] = true; cur.cast.push(name); } }
    else c.voLines++;
    return c;
  };
  const scanIntros = function (text) {
    const re = /\b((?:[A-Z][A-Z0-9'’.\-]*)(?:\s+[A-Z][A-Z0-9'’.\-]*){0,3})\s*\(\s*((?:EARLY |MID |LATE |MID-|LATE-|EARLY-|early |mid |late |mid-|late-|early-)?\d{1,2}(?:[Ss]|'[Ss])?(?:\s*-\s*\d{1,2}[Ss]?)?)\s*\)/g;
    let m;
    while ((m = re.exec(String(text || ""))) !== null) {
      let nm = m[1].replace(/^(A|AN|THE|HER|HIS|THEIR|OUR)\s+/, "").trim();
      if (!nm || nm.length < 2 || nm.length > 28) continue;
      if (/^(INT|EXT|CUT|FADE|V\.O|O\.S|CONT)/.test(nm)) continue;
      if (/^(TWO|THREE|FOUR|FIVE|SIX|SEVERAL|SOME|MANY|DOZENS|HUNDREDS)\b/.test(nm)) continue;
      const age = bgAgeNum_(m[2]);
      if (!intros[nm]) intros[nm] = { name: nm, age: age, scene: cur ? cur.n : 1 };
    }
  };

  lines.forEach(function (l) {
    l = l || {};
    const t = String(l.type || "action");
    if (t === "scene") {
      startScene(runsText_(l.runs), l.id, false);
      cur.rows += (scenes.length > 1 ? 2 : 1);
      return;
    }
    let rows;
    if (t === "dual") {
      const d = l.dual || {};
      const side = function (s) { s = s || {}; return 1 + wrapRows_(runsText_(s.dialogueRuns), BG_COLS_.dual); };
      rows = Math.max(side(d.left), side(d.right));
    } else {
      rows = wrapRows_(runsText_(l.runs), W[t] || BG_COLS_.action);
    }
    const text = t === "dual" ? "" : bgPlain_(l.runs);
    if (!cur) {
      if (!text && t !== "dual") return;   // blank lines before the first scene
      startScene("", "", true);
    }
    cur.rows += rows;
    if (t === "character") {
      const cn = bgCharName_(text);
      speaker = cn.name ? seeChar(cn.name, cn.vo) : null;
    } else if (t === "dialogue") {
      if (speaker && text) { speaker.lines++; speaker.words += bgWords_(text); }
    } else if (t === "parenthetical") {
      // belongs to the current speaker
    } else if (t === "dual") {
      const d = l.dual || {};
      ["left", "right"].forEach(function (k) {
        const s = d[k] || {};
        const cn = bgCharName_(bgPlain_(s.characterRuns));
        const c = cn.name ? seeChar(cn.name, cn.vo) : null;
        const dl = bgPlain_(s.dialogueRuns);
        if (c && dl) { c.lines++; c.words += bgWords_(dl); }
      });
      speaker = null;
    } else {
      speaker = null;
      if (text) { cur.action += " " + text; scanIntros(text); }
    }
  });

  // ---- Who is in each scene without speaking ----
  // A character cue only shows who talks. Anyone named in the scene's action ("JIMMY looks up",
  // "Cheryl nods") is on set too, so they count for that scene: cast days, schedule and budget.
  const mentionTests = {};
  Object.keys(chars).forEach(function (name) { mentionTests[name] = bgMentionTest_(name); });
  scenes.forEach(function (s) {
    const txt = String(s.action || "");
    if (!txt) return;
    Object.keys(chars).forEach(function (name) {
      if (s.castSeen[name] || !mentionTests[name](txt)) return;
      const c = chars[name];
      c.scenes[s.n] = true; c.onCam[s.n] = true;
      s.castSeen[name] = true; s.cast.push(name);
    });
    if (s.groupCue && !s.cast.length) s.groupOnly = true;
  });

  // ---- Page lengths (in eighths), scaled to the script's real page count ----
  const totalRows = scenes.reduce(function (a, s) { return a + s.rows; }, 0) || 1;
  let docPages = 0;
  try { docPages = Number(doc.meta && doc.meta.pages) || 0; } catch (_e) {}
  if (!(docPages > 0)) docPages = estimatePages_(doc);
  const totalEighths = Math.max(1, Math.round(docPages * 8));
  scenes.forEach(function (s) { s.eighths = Math.max(1, Math.round(s.rows / totalRows * totalEighths)); });
  // Rounding each scene can drift from the real page count: settle the difference on the longest scenes
  if (scenes.length) {
    let diff = totalEighths - scenes.reduce(function (t, s) { return t + s.eighths; }, 0);
    const byLen = scenes.slice().sort(function (a, b) { return b.eighths - a.eighths; });
    for (let i = 0; diff !== 0 && i < byLen.length * 4; i++) {
      const s = byLen[i % byLen.length];
      if (diff > 0) { s.eighths++; diff--; } else if (s.eighths > 1) { s.eighths--; diff++; }
    }
  }

  // ---- Background extras & flags per scene ----
  const flagDefs = BG_FLAGS_.map(function (f) { return { def: f, re: f.re ? new RegExp(f.re, "gi") : null, not: f.not ? new RegExp(f.not, "gi") : null, scenes: [], words: {}, eighths: 0 }; });
  const castWords = {};
  Object.keys(chars).forEach(function (n) { n.split(/\s+/).forEach(function (w) { if (w.length > 1) castWords[w] = true; }); });
  const flagById = {}; flagDefs.forEach(function (f) { flagById[f.def.id] = f; });
  const addFlag = function (id, s, word) {
    const f = flagById[id]; if (!f) return;
    if (f.scenes.indexOf(s.n) < 0) { f.scenes.push(s.n); f.eighths += s.eighths; }
    if (word) { const w = String(word).toLowerCase().replace(/\s+/g, " "); f.words[w] = (f.words[w] || 0) + 1; }
    if (s.flags.indexOf(id) < 0) s.flags.push(id);
  };
  scenes.forEach(function (s) {
    s.flags = [];
    const hay = (s.heading + " . " + s.action);
    if (BG_CROWD_.test(s.action)) s.bg = "Crowd";
    else if (s.groupCue) s.bg = "Small group";
    else if (BG_SMALL_.test(s.action) || (BG_PUBLIC_LOC_.test(s.set) && !BG_EMPTY_.test(s.action))) s.bg = "Small group";
    else s.bg = "None";
    if (s.dn === "N") addFlag("night", s, "night");
    const vehicleLoc = BG_VEHICLE_LOC_.test(s.loc);
    if (vehicleLoc) {
      const vm = s.loc.match(BG_VEHICLE_LOC_);
      addFlag("vehicles", s, vm ? vm[1] : "vehicle");
      if (!/\b(parked|stationary|pulled over|idling)\b/i.test(s.action)) addFlag("driving", s, "scene set in a " + (vm ? vm[1].toLowerCase() : "vehicle"));
    }
    flagDefs.forEach(function (f) {
      if (!f.re) return;
      // Spans of text that look like a match but aren't (read in context)
      const skip = [];
      if (f.not) {
        f.not.lastIndex = 0;
        let n;
        while ((n = f.not.exec(hay)) !== null) { skip.push([n.index, n.index + n[0].length]); if (n[0].length === 0) f.not.lastIndex++; }
      }
      f.re.lastIndex = 0;
      let m, hits = 0;
      while ((m = f.re.exec(hay)) !== null && hits < 20) {
        if (m[0].length === 0) { f.re.lastIndex++; continue; }
        const a = m.index, b = m.index + m[0].length;
        const inSkip = skip.some(function (r) { return a < r[1] && b > r[0]; });
        // A character's name isn't a thing ("RIVER walks in", "DUCK nods")
        const isName = castWords[m[0].toUpperCase()] && /[A-Z]/.test(m[0].charAt(0));
        if (!inSkip && !isName) { addFlag(f.def.id, s, m[0]); hits++; }
      }
    });
  });

  // ---- Cast ----
  const introNames = Object.keys(intros);
  const TITLES = { "DR": 1, "DR.": 1, "MR": 1, "MR.": 1, "MRS": 1, "MRS.": 1, "MS": 1, "MS.": 1, "MISS": 1, "SIR": 1, "OLD": 1, "YOUNG": 1, "LITTLE": 1, "AUNT": 1, "UNCLE": 1, "OFFICER": 1, "DETECTIVE": 1, "SERGEANT": 1, "CONSTABLE": 1, "NURSE": 1, "FATHER": 1, "SISTER": 1, "THE": 1, "A": 1, "AN": 1 };
  // Generic, one-word descriptions ("THE MAN", "A WOMAN", "THE GIRL") are common for unnamed, unrelated
  // background figures — don't let a bare word like this alone match them up to a different named character.
  const GENERIC_ = { "MAN": 1, "WOMAN": 1, "GIRL": 1, "BOY": 1, "GUY": 1, "LADY": 1, "KID": 1, "PERSON": 1, "FIGURE": 1, "STRANGER": 1, "VOICE": 1, "MEN": 1, "WOMEN": 1 };
  const nameTokens = function (n) { return String(n).split(/\s+/).filter(function (t) { return t && !TITLES[t]; }); };
  const speakerFor = {};   // intro name -> speaking character name
  introNames.forEach(function (nm) {
    if (chars[nm]) { speakerFor[nm] = nm; return; }
    // "THE MAN (late 30s)" is introduced as MAN but speaks as THE MAN: same person
    const withArt = ["THE ", "A ", "AN "].map(function (a) { return a + nm; }).filter(function (k) { return chars[k]; })[0];
    if (withArt) { speakerFor[nm] = withArt; return; }
    const it = nameTokens(nm);
    Object.keys(chars).forEach(function (cn) {
      if (speakerFor[nm]) return;
      const ct = nameTokens(cn);
      if (ct.length && it.length && ct.some(function (t) { return it.indexOf(t) >= 0 && !GENERIC_[t]; })) speakerFor[nm] = cn;
    });
  });
  introNames.forEach(function (nm) {
    const cn = speakerFor[nm];
    if (cn && chars[cn] && intros[nm].age != null && chars[cn].age == null) chars[cn].age = intros[nm].age;
  });
  const castList = Object.keys(chars).map(function (n) { return chars[n]; }).filter(function (c) { return c.name && Object.keys(c.scenes).length; });
  const sceneCount = Math.max(1, scenes.length);
  const allWords = castList.reduce(function (a, c) { return a + c.words; }, 0) || 1;
  castList.sort(function (a, b) { return (b.words - a.words) || (Object.keys(b.onCam).length - Object.keys(a.onCam).length) || a.name.localeCompare(b.name); });
  let leads = 0;
  const cast = castList.map(function (c) {
    const onCam = Object.keys(c.onCam).map(Number).sort(function (a, b) { return a - b; });
    const all = Object.keys(c.scenes).map(Number).sort(function (a, b) { return a - b; });
    const share = c.words / allWords, sceneShare = onCam.length / sceneCount;
    let type;
    if (!onCam.length) type = "Voice only";
    else if (leads < 4 && ((share >= 0.12 && sceneShare >= 0.15) || sceneShare >= 0.3)) { type = "Lead"; leads++; }
    else if (onCam.length >= 3 || share >= 0.04) type = "Supporting";
    else type = "Day player";
    const eighths = onCam.reduce(function (a, n) { return a + (scenes[n - 1] ? scenes[n - 1].eighths : 0); }, 0);
    const notes = [];
    if (c.age != null && c.age < 18) notes.push("Minor (age " + c.age + ")");
    if (c.voLines && onCam.length) notes.push("Also has voice-over");
    return { name: c.name, type: type, scenes: onCam.length ? onCam : all, onCamCount: onCam.length, lines: c.lines, words: c.words, eighths: eighths,
      first: all.length ? all[0] : 0, note: notes.join("; "), minor: c.age != null && c.age < 18 };
  });
  // Non-speaking featured roles: introduced as NAME (30s) in action but never speak
  const speaking = {}; cast.forEach(function (c) { speaking[c.name] = true; });
  introNames.forEach(function (nm) {
    const it = intros[nm];
    if (speaking[nm] || speakerFor[nm]) return;
    const single = nm.replace(/S$/, "");
    if (speaking[single]) return;
    if (cast.length > 120) return;
    const minor = it.age != null && it.age < 18;
    // every scene they're named in (in capitals); one-word generic roles ("MAN") only their intro scene
    const generic = nm.split(/\s+/).length === 1 && GENERIC_[nm];
    const seen = generic ? [it.scene] : scenes.filter(function (s) { return s.n === it.scene || bgMentionTest_(nm, true)(s.action || ""); }).map(function (s) { return s.n; });
    const sEighths = seen.reduce(function (a, n) { return a + (scenes[n - 1] ? scenes[n - 1].eighths : 0); }, 0);
    seen.forEach(function (n) { const sc = scenes[n - 1]; if (sc && !sc.castSeen[nm]) { sc.castSeen[nm] = true; sc.cast.push(nm); } });
    cast.push({ name: nm, type: "Featured (non-speaking)", scenes: seen, onCamCount: seen.length, lines: 0, words: 0, eighths: sEighths || 1, first: it.scene,
      note: minor ? "Minor (age " + it.age + ")" : "", minor: minor });
    speaking[nm] = true;
  });
  const typeOrder = { "Lead": 0, "Supporting": 1, "Day player": 2, "Featured (non-speaking)": 3, "Voice only": 4 };
  cast.sort(function (a, b) { return (typeOrder[a.type] - typeOrder[b.type]) || (b.words - a.words) || (a.first - b.first); });
  // Minors from the cast list count as child scenes
  cast.forEach(function (c) { if (c.minor) c.scenes.forEach(function (n) { if (scenes[n - 1]) addFlag("minors", scenes[n - 1], "character " + c.name + " is under 18"); }); });

  // ---- Locations ----
  const locMap = {};
  scenes.forEach(function (s) {
    const key = s.loc;
    if (!locMap[key]) locMap[key] = { name: key, ie: {}, d: 0, n: 0, m: 0, scenes: [], eighths: 0, sets: {}, vehicle: BG_VEHICLE_LOC_.test(key), first: s.n };
    const L = locMap[key];
    if (s.ie) L.ie[s.ie] = true;
    if (s.dn === "N") L.n++; else if (s.dn === "M") L.m++; else L.d++;
    L.scenes.push(s.n); L.eighths += s.eighths;
    if (s.set && s.set !== key) L.sets[s.set.replace(key + " - ", "")] = true;
  });
  const locs = Object.keys(locMap).map(function (k) {
    const L = locMap[k];
    const ies = Object.keys(L.ie);
    const type = L.vehicle ? "Vehicle" : (ies.length === 0 ? "" : (ies.length > 1 || ies[0] === "INT/EXT") ? "INT/EXT" : ies[0]);
    return { name: L.name, type: type, d: L.d + L.m, n: L.n, scenes: L.scenes, eighths: L.eighths, sets: Object.keys(L.sets), vehicle: L.vehicle, first: L.first };
  }).sort(function (a, b) { return (b.eighths - a.eighths) || (a.first - b.first); });

  const flags = flagDefs.map(function (f) {
    const words = Object.keys(f.words).sort(function (a, b) { return f.words[b] - f.words[a]; }).slice(0, 8);
    return { id: f.def.id, label: f.def.label, use: f.def.use, scenes: f.scenes.sort(function (a, b) { return a - b; }), eighths: f.eighths, words: words };
  });

  let title = "";
  try { title = bgClean_(doc.title && typeof doc.title === "object" ? doc.title.title : doc.title); } catch (_e) {}
  let writer = "";
  try { writer = bgClean_(doc.title && doc.title.name); } catch (_e) {}
  const pageSize = /letter/i.test(String((doc.pageSettings && doc.pageSettings.pageSize) || "")) ? "US Letter" : "A4";

  return {
    title: title, writer: writer, pageSize: pageSize,
    scenes: scenes.map(function (s) { return { n: s.n, id: s.id, heading: s.heading, ie: s.ie, set: s.set, loc: s.loc, dn: s.dn, eighths: s.eighths, cast: s.cast, bg: s.bg, flags: s.flags, syn: bgOneLiner_(s.action) }; }),
    cast: cast, locs: locs, flags: flags,
    totals: { eighths: scenes.reduce(function (a, s) { return a + s.eighths; }, 0), scenes: scenes.length }
  };
}

const api = { analyze: budgetAnalyze_, cols: BG_COLS_, mentions: bgMentionTest_ };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.CampBreakdown = api;
})(typeof window !== "undefined" ? window : this);
