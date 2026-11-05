// Канонические жанры сайта и алиасы для нормализации внешних источников.
// Модуль используется и фронтендом (app.jsx), и импортёром data/games.json,
// поэтому здесь не должно быть DOM/React-зависимостей.

export const GENRE_RULES = [
  { label: "РПГ", aliases: "rpg, ролев" },
  { label: "Экшен", aliases: "экшн, action" },
  { label: "Инди", aliases: "indie, индю" },
  { label: "Хоррор", aliases: "horror, ужас, страш, страх" },
  { label: "Приключение", aliases: "приключ, adventure, адвенч" },
  { label: "Шутер", aliases: "shooter, стрелял" },
  { label: "Платформер", aliases: "platformer" },
  { label: "Сюжетная", aliases: "сюжет, story, narrative" },
  { label: "Кооператив", aliases: "кооп, coop, co-op, совместн" },
  { label: "Головоломка", aliases: "головолом, пазл, puzzle" },
  { label: "Фэнтези", aliases: "фентези, fantasy" },
  { label: "Открытый мир", aliases: "открыт, open, мир" },
  { label: "Стелс", aliases: "stealth" },
  { label: "Соулс-лайк", aliases: "соулс, souls, сосалик" },
  { label: "Киберпанк", aliases: "cyberpunk" },
  { label: "Выживание", aliases: "выжива, выживал, survival" },
  { label: "Карточная", aliases: "карточ, card" },
  { label: "Метроидвания", aliases: "метроид, metroid" },
  { label: "QTE", aliases: "qte, quick" },
  { label: "Научная фантастика", aliases: "фантасти, scifi, sci-fi, научн, скайфай" },
  { label: "Постапокалипсис", aliases: "постапокалип, постап, postap" },
  { label: "Интерактивное кино", aliases: "интер, кино, inter" },
];

export const normalizeGenreText = (value) =>
  String(value ?? '').toLowerCase().replace(/ё/g, 'е').trim();

export const GENRES = GENRE_RULES
  .map(({ label }) => label)
  .sort((a, b) => a.localeCompare(b, 'ru'));

export const GENRE_ALIAS_INDEX = GENRE_RULES.map(({ label, aliases }) => ({
  label,
  aliases: [label, ...aliases.split(",")].map(normalizeGenreText).filter(Boolean),
}));

// Приводит одно значение жанра к каноническому названию.
// Сначала ищет точное совпадение с алиасом, затем самое длинное вхождение —
// так «Action RPG» станет «РПГ», а не «Экшен» из-за короткого «action».
export const canonicalizeGenre = (value) => {
  const text = normalizeGenreText(value);
  if (!text) return null;

  for (const rule of GENRE_ALIAS_INDEX) {
    if (rule.aliases.some((alias) => alias === text)) return rule.label;
  }

  let best = null;
  let bestLength = 0;
  for (const rule of GENRE_ALIAS_INDEX) {
    for (const alias of rule.aliases) {
      if (alias.length < 3) continue;
      if (text.includes(alias) && alias.length > bestLength) {
        best = rule.label;
        bestLength = alias.length;
      }
    }
  }
  return best;
};

// Приводит массив «сырых» жанров к каноническим: без дублей, в порядке GENRES.
// Возвращает также значения, которые не удалось распознать, — импортёр
// выводит их в отчёт, чтобы можно было дополнить алиасы.
export const canonicalizeGenres = (values) => {
  const source = Array.isArray(values)
    ? values
    : String(values ?? '').split(/[,;|]/);
  const matched = new Set();
  const unmapped = [];

  for (const raw of source) {
    if (raw === null || raw === undefined) continue;
    const canonical = canonicalizeGenre(raw);
    if (canonical) matched.add(canonical);
    else if (normalizeGenreText(raw)) unmapped.push(String(raw).trim());
  }

  return {
    genres: Array.from(matched).sort((a, b) => GENRES.indexOf(a) - GENRES.indexOf(b)),
    unmapped,
  };
};
