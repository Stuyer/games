// Алиасы, русские названия, народные сокращения и аббревиатуры для поиска игр.
// Правила применяются автоматически ко всем играм, в названии которых встречаются
// слова из поля `match`, плюс генерируются автоматические аббревиатуры и
// конвертация римских/арабских цифр (например, V <-> 5, II <-> 2).

export const normalizeSearchPart = (value) =>
  String(value ?? '').toLowerCase().replace(/ё/g, 'е').trim();

export const splitSearchWords = (value) =>
  normalizeSearchPart(value).split(/[^a-zа-я0-9]+/i).filter(Boolean);

export const hasWordPrefixMatch = (words, token) => {
  const subTokens = Array.isArray(token) ? token : splitSearchWords(token);
  if (!subTokens.length) return false;
  return subTokens.every(sub => words.some(word => word.startsWith(sub)));
};

const ROMAN_TO_ARABIC = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13',
  xiv: '14',
  xv: '15',
  xvi: '16'
};

const ARABIC_TO_ROMAN = Object.fromEntries(
  Object.entries(ROMAN_TO_ARABIC).map(([roman, arabic]) => [arabic, roman])
);

const EDITION_STOP_WORDS = new Set([
  'remake',
  'remastered',
  'definitive',
  'special',
  'edition',
  'director',
  'directors',
  'cut',
  'goty',
  'enhanced',
  'complete'
]);

const LEADING_ARTICLES = new Set(['the', 'a', 'an']);

// Правила синонимов по играм и сериям.
// Если все слова из `match` присутствуют в названии игры (с учётом конвертации
// римских цифр), игра получает указанные алиасы.
export const GAME_ALIAS_RULES = [
  // Серия The Witcher
  { match: 'witcher', aliases: 'ведьмак, витчер, геральт, geralt, tw' },
  { match: 'witcher 3', aliases: 'дикая охота, в3, ведьмак3, tw3, w3' },
  { match: 'witcher 2', aliases: 'убийцы королей, в2, ведьмак2, tw2, w2' },
  { match: 'the witcher', exact: true, aliases: 'в1, ведьмак1, tw1, w1, 1' },
  { match: 'thronebreaker', aliases: 'кровная вражда, гвинт, gwent' },

  // Red Dead Redemption
  { match: 'red dead', aliases: 'rdr, rdr2, рдр, рдр2, ред дед, редемпшен, редемпшн, артур морган, датч, ковбои' },

  // Grand Theft Auto
  { match: 'grand theft auto', aliases: 'gta, гта, гранд зефт авто' },
  { match: 'grand theft auto 5', aliases: 'gta5, gtav, гта5, гтаv' },

  // Cyberpunk 2077
  { match: 'cyberpunk', aliases: 'киберпанк, сайберпанк, кп, кп77, кп2077, cp, cp77, cp2077, джонни сильверхенд' },

  // The Last of Us
  { match: 'last of us', aliases: 'одни из нас, ласт оф ас, ластуха, тлоу, tlou, джоэл, элли' },
  { match: 'last of us 1', aliases: 'tlou1, тлоу1, ластуха1' },
  { match: 'last of us 2', aliases: 'tlou2, тлоу2, ластуха2, эбби' },

  // Alan Wake
  { match: 'alan wake', aliases: 'алан вейк, алан уэйк, aw, ав' },
  { match: 'alan wake 2', aliases: 'aw2, ав2, сага андерсон' },

  // Clair Obscur: Expedition 33
  { match: 'clair obscur', aliases: 'клер обскюр, экспедиция, экспедиция 33, coe33, e33, э33' },

  // Hollow Knight
  { match: 'hollow knight', aliases: 'холлоу найт, полый рыцарь, hk, хк' },
  { match: 'silksong', aliases: 'силксонг, шелковая песнь, hks, хкс, хорнет' },

  // 007 First Light
  { match: '007', aliases: 'бонд, джеймс бонд, агент 007, james bond, первый свет' },

  // Split Fiction / It Takes Two / A Way Out (Hazelight)
  { match: 'split fiction', aliases: 'сплит фикшн, сплит фикшен, sf, сф' },
  { match: 'it takes two', aliases: 'ит тейкс ту, двоих, itt, итт' },
  { match: 'way out', aliases: 'вей аут, вэй аут, выход есть, побег, awo' },

  // Divinity: Original Sin
  { match: 'divinity', aliases: 'дивинити, ориджинал син, первородный грех, dos, дос' },
  { match: 'divinity 2', aliases: 'dos2, дос2' },

  // Silent Hill
  { match: 'silent hill', aliases: 'сайлент хилл, тихий холм, сх, sh' },
  { match: 'silent hill 2', aliases: 'сх2, sh2, sh2r, джеймс сандерленд' },

  // The Elder Scrolls / Skyrim
  { match: 'elder scrolls', aliases: 'древние свитки, элдер скроллс, тес, tes' },
  { match: 'skyrim', aliases: 'скайрим, скурим, довакин, тес5, tes5, tesv' },

  // The Callisto Protocol
  { match: 'callisto protocol', aliases: 'каллисто протокол, протокол каллисто, каллисто, tcp' },

  // Resident Evil
  { match: 'resident evil', aliases: 'резидент ивил, резидент эвил, резик, обитель зла, re, ре' },
  { match: 'resident evil 2', aliases: 're2, re2r, ре2, резик2, леон' },
  { match: 'resident evil 4', aliases: 're4, re4r, ре4, резик4, леон' },
  { match: 'resident evil 7', aliases: 'биохазард, re7, ре7, резик7, итан' },
  { match: 'resident evil village', aliases: 'вилладж, деревня, re8, ре8, резик8, резидент 8, димитреску, итан, 8, viii' },
  { match: 'resident evil requiem', aliases: 'реквием, re9, ре9, резик9, резидент 9, 9, ix' },

  // Black Myth: Wukong
  { match: 'wukong', aliases: 'черный миф, вуконг, укун, царь обезьян, обезьяна, bmw' },

  // Dead Space
  { match: 'dead space', aliases: 'дед спейс, дэд спейс, мертвый космос, айзек кларк, ds, dsr, дс' },

  // The Walking Dead
  { match: 'walking dead', aliases: 'ходячие мертвецы, вокинг дед, twd, твд, клементина, ли эверетт' },
  { match: 'walking dead season two', aliases: 'сезон 2, twd2, твд2, 2' },

  // Quantic Dream (Detroit, Heavy Rain, Beyond, Fahrenheit)
  { match: 'detroit become human', aliases: 'детройт, детроит, стать человеком, коннор, кэра, маркус, dbh, дбх' },
  { match: 'heavy rain', aliases: 'хеви рейн, хэви рейн, ливень, проливной дождь, шон, итан марс, hr, хр' },
  { match: 'beyond two souls', aliases: 'бейонд, за гранью, две души, джоди, bts, бтс, 2' },
  { match: 'fahrenheit', aliases: 'фаренгейт, пророчество индиго, лукас кейн' },

  // Elden Ring / Souls / FromSoftware
  { match: 'elden ring', aliases: 'элден ринг, елден ринг, кольцо элден, маления, er, ер' },
  { match: 'dark souls', aliases: 'дарк соулс, темные души, ds, дс' },
  { match: 'bloodborne', aliases: 'бладборн, порождение крови, bb, бб' },
  { match: 'sekiro', aliases: 'секиро, волк' },

  // God of War
  { match: 'god of war', aliases: 'год оф вар, бог войны, кратос, атрей, gow, гов' },

  // Doom
  { match: 'doom', aliases: 'дум, думгай, палач рока' },
  { match: 'doom eternal', aliases: 'дум этернал, етернал, вечный, de' },
  { match: 'doom dark ages', aliases: 'темные века, дарк эйджес, tda' },

  // REANIMAL / Little Nightmares
  { match: 'reanimal', aliases: 'реанимал, рианимал' },
  { match: 'little nightmares', aliases: 'литл найтмерс, маленькие кошмары, кошмарики, шестая, моно, ln, лн' },

  // Dead Island
  { match: 'dead island', aliases: 'дед айленд, дэд айленд, мертвый остров, di, ди' },

  // Batman
  { match: 'batman', aliases: 'бэтмен, бетмен, брюс уэйн, готэм' },
  { match: 'arkham', aliases: 'аркхем, аркхэм, рыцарь аркхема, bak, ак' },

  // Half-Life / Portal
  { match: 'half life', aliases: 'халф лайф, халфа, халва, гордон фримен, hl, хл' },
  { match: 'portal', aliases: 'портал, гладос, челл, уитли' },

  // PRAGMATA
  { match: 'pragmata', aliases: 'прагмата' },

  // Ori
  { match: 'ori', aliases: 'ори' },
  { match: 'will of the wisps', aliases: 'воля огоньков, ori 2, ори 2, 2' },
  { match: 'blind forest', aliases: 'слепой лес, ori 1, ори 1, 1' },

  // Outlast
  { match: 'outlast', aliases: 'аутласт, оутласт, маунт мэссив, ol, ол' },

  // What Remains of Edith Finch
  { match: 'edith finch', aliases: 'эдит финч, едит финч, что осталось от эдит финч, финч' },

  // High on Life
  { match: 'high on life', aliases: 'хай он лайф, говорящие пушки, hol' },

  // Atomic Heart
  { match: 'atomic heart', aliases: 'атомик харт, атомное сердце, майор нечаев, п3, близняшки, ah, ах' },

  // Playdead (Inside, Limbo)
  { match: 'inside', aliases: 'инсайд, внутри' },
  { match: 'limbo', aliases: 'лимбо, лимб' },

  // Inscryption
  { match: 'inscryption', aliases: 'инскрипшен, инскрипшн, леший' },

  // Hellblade
  { match: 'hellblade', aliases: 'хеллблейд, хелблейд, сенуа, жертва сенуа' },

  // A Plague Tale
  { match: 'plague tale', aliases: 'плейг тейл, плаг тейл, чумная сказка, невинность, реквием, амиция, гюго, apt' },

  // Scorn
  { match: 'scorn', aliases: 'скорн' },

  // Firewatch
  { match: 'firewatch', aliases: 'фаервотч, файрвотч, пожарный дозор, генри, делайла, fw' },

  // Still Wakes the Deep
  { match: 'still wakes the deep', aliases: 'стилл вейкс, буровая, swtd' },

  // Far Cry
  { match: 'far cry', aliases: 'фар край, фаркрай, fc, фк' },
  { match: 'far cry 3', aliases: 'ваас, безумие, джейсон броуди, fc3, фк3' },

  // Stray
  { match: 'stray', aliases: 'стрей, стрэй, бродяга, кот, котик' },

  // Lies of P
  { match: 'lies of p', aliases: 'лайс оф пи, лайз оф пи, ложь пи, пиноккио, lop, лоп' },

  // Shadow of the Colossus
  { match: 'shadow of the colossus', aliases: 'шадоу оф зе колоссус, тень колосса, колоссы, вандер, sotc' },

  // Just Cause
  { match: 'just cause', aliases: 'джаст кауз, джаст коз, рико родригес, jc, дк' },

  // DREDGE
  { match: 'dredge', aliases: 'дредж, дрэдж, рыбалка' },

  // Kholat
  { match: 'kholat', aliases: 'холат, перевал дятлова' },

  // My Friend Pedro
  { match: 'my friend pedro', aliases: 'май френд педро, мой друг педро, педро, банан, mfp' },

  // Mafia
  { match: 'mafia', aliases: 'мафия, вито скалетта, джо барбаро, томми анджело' },

  // Fran Bow
  { match: 'fran bow', aliases: 'фран боу, фрэн боу, fb, фб' },

  // Другие популярные серии (на случай добавления в каталог)
  { match: 'baldur gate', aliases: 'балдурс гейт, врата балдура, bg, бг' },
  { match: 'mass effect', aliases: 'масс эффект, шепард, me, мэ' },
  { match: 'bioshock', aliases: 'биошок, восторг, колумбия, bs' },
  { match: 'dishonored', aliases: 'дисхоноред, дизонорд, корво' },
  { match: 'metro', aliases: 'метро, артем' },
  { match: 'stalker', aliases: 'сталкер, чернобыль, стрелок, зов припяти, тень чернобыля, чистое небо' },
  { match: 'fallout', aliases: 'фоллаут, фолыч, фаллаут, убежище, нью вегас, fnv' },
  { match: 'assassin creed', aliases: 'ассасин, ассасинс крид, ac, ак' },
  { match: 'kingdom come', aliases: 'кингдом кам, индржих, генри, богемия, kcd, ккд' },
  { match: 'death stranding', aliases: 'дез стрендинг, дес стрендинг, сэм бриджес, кодзима, курьер' },
  { match: 'control', aliases: 'контрол, джесси фейден, фбк' },
  { match: 'max payne', aliases: 'макс пейн, макс пэйн, mp, мп' },
  { match: 'subnautica', aliases: 'сабнатика, сабнавтика' },
  { match: 'disco elysium', aliases: 'диско элизиум, гарри дюбуа, ким кицураги, de' },
  { match: 'devil may cry', aliases: 'девил мей край, данте, вергилий, неро, dmc, дмк' },
  { match: 'metal gear', aliases: 'метал гир, снейк, биг босс, кодзима, mgs, мгс' },
  { match: 'uncharted', aliases: 'анчартед, натан дрейк' },
  { match: 'horizon', aliases: 'хорайзон, элой, hzd, hfw' },
  { match: 'ghost of tsushima', aliases: 'призрак цусимы, гост оф цусима, дзин сакай, got' },
  { match: 'spider man', aliases: 'человек паук, спайдермен, питер паркер, майлз моралес' },
  { match: 'hogwarts legacy', aliases: 'хогвартс легаси, наследие хогвартса, гарри поттер' },
  { match: 'life is strange', aliases: 'лайф из стрейндж, макс колфилд, хлоя, лис, lis' },
  { match: 'until dawn', aliases: 'антил даун, дожить до рассвета, ud' }
];

const addAcronymVariants = (words, targetSet) => {
  if (words.length < 2) return;
  const full = words.map(w => (/^\d+$/.test(w) ? w : w[0])).join('');
  if (full.length >= 2) targetSet.add(full);

  // Вариант без 'part' (например, The Last of Us Part II -> tlou2)
  const withoutPart = words.filter(w => w !== 'part' && w !== 'season');
  if (withoutPart.length >= 2 && withoutPart.length !== words.length) {
    const acronymNoPart = withoutPart.map(w => (/^\d+$/.test(w) ? w : w[0])).join('');
    if (acronymNoPart.length >= 2) targetSet.add(acronymNoPart);
  }
};

const searchCache = new Map();

export const getGameSearchData = (game) => {
  const title = String(game?.title ?? '');
  const developer = String(game?.developer ?? '');
  const cacheKey = `${title}\u0000${developer}`;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const rawTitleWords = splitSearchWords(title);
  const devWords = splitSearchWords(developer);
  const expandedSet = new Set(rawTitleWords);

  // 1. Конвертация римских и арабских цифр (например, V <-> 5, II <-> 2)
  const arabicTitleWords = rawTitleWords.map(word => {
    if (ROMAN_TO_ARABIC[word]) {
      expandedSet.add(ROMAN_TO_ARABIC[word]);
      return ROMAN_TO_ARABIC[word];
    }
    if (ARABIC_TO_ROMAN[word]) {
      expandedSet.add(ARABIC_TO_ROMAN[word]);
    }
    return word;
  });

  // Извлекаем номера части игры (например, "2", "3", "5", "2077") для склейки с алиасами
  const numberTokens = arabicTitleWords.filter(w => /^\d+$/.test(w));

  // 2. Автоматические аббревиатуры (например, Red Dead Redemption 2 -> rdr2, rdr)
  const coreWords = arabicTitleWords.filter(w => !EDITION_STOP_WORDS.has(w));
  const rawCoreWords = rawTitleWords.filter(w => !EDITION_STOP_WORDS.has(w));

  addAcronymVariants(rawTitleWords, expandedSet);
  addAcronymVariants(arabicTitleWords, expandedSet);
  addAcronymVariants(rawCoreWords, expandedSet);
  addAcronymVariants(coreWords, expandedSet);

  // Варианты аббревиатур без начального артикля The / A
  if (coreWords.length > 2 && LEADING_ARTICLES.has(coreWords[0])) {
    addAcronymVariants(coreWords.slice(1), expandedSet);
    addAcronymVariants(rawCoreWords.slice(1), expandedSet);
  }

  // Базовая аббревиатура без конечного номера части (Red Dead Redemption 2 -> rdr)
  const coreWithoutTrailingNum = coreWords.filter(w => !/^\d+$/.test(w) && w !== 'part');
  if (coreWithoutTrailingNum.length >= 2) {
    addAcronymVariants(coreWithoutTrailingNum, expandedSet);
    if (coreWithoutTrailingNum.length > 2 && LEADING_ARTICLES.has(coreWithoutTrailingNum[0])) {
      addAcronymVariants(coreWithoutTrailingNum.slice(1), expandedSet);
    }
  }

  // Слитное написание коротких названий с цифрой (Just Cause 3 -> justcause3, Mafia 2 -> mafia2)
  if (coreWords.length >= 2 && coreWords.length <= 4) {
    expandedSet.add(coreWords.join(''));
    if (LEADING_ARTICLES.has(coreWords[0]) && coreWords.length >= 3) {
      expandedSet.add(coreWords.slice(1).join(''));
    }
  }

  // 3. Применение словаря алиасов и народных названий
  const normalizedJoinedTitle = rawTitleWords.join(' ');
  const matchableWordSet = new Set([...rawTitleWords, ...arabicTitleWords]);
  for (const rule of GAME_ALIAS_RULES) {
    const requiredWords = splitSearchWords(rule.match);
    if (!requiredWords.length) continue;
    const isMatch = rule.exact
      ? normalizedJoinedTitle === requiredWords.join(' ')
      : requiredWords.every(req => matchableWordSet.has(req));
    if (!isMatch) continue;

    const aliasPhrases = String(rule.aliases || '').split(',');
    for (const phrase of aliasPhrases) {
      const words = splitSearchWords(phrase);
      if (!words.length) continue;
      for (const w of words) {
        expandedSet.add(w);
        // Склеиваем однословные алиасы с номером части (например, "ведьмак" + "3" -> "ведьмак3", "рдр" + "2" -> "рдр2")
        for (const num of numberTokens) {
          if (!w.endsWith(num)) {
            expandedSet.add(`${w}${num}`);
          }
        }
      }
      if (words.length > 1) {
        expandedSet.add(words.join(''));
      }
    }
  }

  const result = {
    titleWords: Array.from(expandedSet),
    devWords
  };
  searchCache.set(cacheKey, result);
  return result;
};
