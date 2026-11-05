#!/usr/bin/env node
// Импорт справочника игр из data/games.json в public.game_catalog.
// Запуск: npm run import:games (SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY
// читаются из локального .env или переменных окружения).
// Флаг --dry-run проверяет файл, ничего не записывая в Supabase.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { GENRES, canonicalizeGenres } from '../genres.js';

const projectRoot = resolveProjectRoot();
const DEFAULT_FILE = path.join(projectRoot, 'data', 'games.json');
const CHUNK_SIZE = 300;

function resolveProjectRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

function parseArgs(argv) {
  const options = { dryRun: false, file: DEFAULT_FILE, verbose: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run' || arg === '--dry') {
      options.dryRun = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--file' || arg === '-f') {
      const next = argv[index + 1];
      if (!next) throw new Error('После --file нужен путь к JSON.');
      options.file = path.resolve(process.cwd(), next);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}`);
    }
  }
  return options;
}

async function loadDotEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  const raw = await readFile(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const normalizeTitle = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const titleKeyFor = (value) => normalizeTitle(value).toLowerCase().replace(/ё/g, 'е');

const TRANSLITERATION = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
};

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .split('')
    .map((character) => (TRANSLITERATION[character] !== undefined ? TRANSLITERATION[character] : character))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function pickFirst(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function normalizeStudio(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean).join(', ');
  }
  return normalizeTitle(value);
}

function normalizeYear(value) {
  if (value === null || value === undefined || value === '') return { year: null, problem: '' };
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  if (!match) return { year: null, problem: `не удалось разобрать год «${value}»` };
  const year = Number(match[0]);
  if (year < 1950 || year > 2100) return { year: null, problem: `год вне диапазона 1950–2100: ${value}` };
  return { year, problem: '' };
}

async function readDataset(file) {
  if (!existsSync(file)) {
    throw new Error(`Файл не найден: ${file}`);
  }
  let parsed;
  try {
    const raw = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Не удалось прочитать JSON (${file}): ${error.message}`);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.games)) return parsed.games;
  throw new Error('Ожидался массив игр или объект вида { "games": [...] }.');
}

function normalizeDataset(items) {
  const rows = [];
  const duplicates = [];
  const problems = [];
  const unmappedCounter = new Map();
  const slugCounter = new Map();
  const identitySeen = new Map();
  let missingYear = 0;
  let missingStudio = 0;
  let emptyGenres = 0;

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      problems.push(`#${index + 1}: элемент не является объектом`);
      return;
    }

    const title = normalizeTitle(pickFirst(item, ['title', 'name', 'game', 'game_title', 'название', 'игра']));
    if (!title) {
      problems.push(`#${index + 1}: пустое название`);
      return;
    }

    const studio = normalizeStudio(pickFirst(item, ['studio', 'studios', 'developer', 'developers', 'developer_studio', 'студия', 'разработчик']));
    if (!studio) missingStudio += 1;

    const yearResult = normalizeYear(pickFirst(item, ['year', 'release_year', 'releaseYear', 'release', 'released', 'год', 'год_релиза', 'год выхода']));
    if (yearResult.problem) problems.push(`#${index + 1} «${title}»: ${yearResult.problem}`);
    if (yearResult.year === null) missingYear += 1;

    const rawGenres = pickFirst(item, ['genres', 'genre', 'genres_list', 'жанры', 'жанр']);
    const { genres, unmapped } = canonicalizeGenres(rawGenres);
    for (const value of unmapped) {
      const key = value.toLowerCase();
      unmappedCounter.set(key, (unmappedCounter.get(key) || 0) + 1);
    }
    if (genres.length === 0) emptyGenres += 1;

    const titleKey = titleKeyFor(title);
    const identity = `${titleKey}|${yearResult.year ?? ''}`;
    if (identitySeen.has(identity)) {
      duplicates.push(`«${title}» (${yearResult.year ?? 'без года'}) — уже есть под #${identitySeen.get(identity) + 1}`);
      return;
    }
    identitySeen.set(identity, index);

    let slug = normalizeTitle(pickFirst(item, ['id', 'slug', 'key']));
    if (slug) {
      slug = slugify(slug);
    } else {
      slug = slugify(yearResult.year ? `${title} ${yearResult.year}` : title) || `game-${index + 1}`;
    }
    if (!slug) slug = `game-${index + 1}`;
    const slugUsage = slugCounter.get(slug) || 0;
    slugCounter.set(slug, slugUsage + 1);
    if (slugUsage > 0) {
      problems.push(`«${title}»: одинаковый id/slug «${slug}», добавлен суффикс -${slugUsage + 1}`);
      slug = `${slug}-${slugUsage + 1}`;
    }

    rows.push({
      slug,
      title,
      studio,
      release_year: yearResult.year,
      genres,
    });
  });

  return {
    rows,
    duplicates,
    problems,
    unmapped: Array.from(unmappedCounter.entries()).sort((a, b) => b[1] - a[1]),
    stats: { source: items.length, accepted: rows.length, missingYear, missingStudio, emptyGenres },
  };
}

function printReport(report, { verbose } = {}) {
  const { stats, rows, duplicates, problems, unmapped } = report;
  console.log(`\nКаталог игр: ${stats.source} записей в источнике, ${stats.accepted} готово к импорту.`);
  console.log(`Без года: ${stats.missingYear} · без студии: ${stats.missingStudio} · без жанров: ${stats.emptyGenres}`);
  if (duplicates.length) {
    console.log(`\nПовторы (по названию и году), пропущены: ${duplicates.length}`);
    duplicates.slice(0, 20).forEach(line => console.log(`  - ${line}`));
    if (duplicates.length > 20) console.log(`  … и ещё ${duplicates.length - 20}`);
  }
  if (problems.length) {
    console.log(`\nЗамечания: ${problems.length}`);
    problems.slice(0, 30).forEach(line => console.log(`  - ${line}`));
    if (problems.length > 30) console.log(`  … и ещё ${problems.length - 30}`);
  }
  if (unmapped.length) {
    console.log(`\nЖанры вне канонического списка (первые 40):`);
    unmapped.slice(0, 40).forEach(([value, count]) => console.log(`  - ${value} ×${count}`));
  }
  const genreCounts = new Map(GENRES.map(genre => [genre, 0]));
  rows.forEach(row => row.genres.forEach(genre => genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1)));
  const usedGenres = Array.from(genreCounts.entries()).filter(([, count]) => count > 0);
  console.log(`\nЖанры: ${usedGenres.map(([genre, count]) => `${genre} (${count})`).join(', ') || 'ни одного'}`);

  if (verbose) {
    console.log('\nПервые записи:');
    rows.slice(0, 10).forEach(row => console.log(`  ${row.slug} · ${row.title} · ${row.studio || '—'} · ${row.release_year ?? '—'} · ${row.genres.join(', ') || '—'}`));
  }
}

async function runImport(rows) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (локальный .env или переменные окружения).');
  }

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const totals = { inserted: 0, updated: 0, skipped: 0 };
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE);
    const { data, error } = await client.rpc('import_game_catalog', { p_rows: chunk });
    if (error) {
      throw new Error(`Импорт остановлен на записи ${offset + 1}: ${error.message}`);
    }
    totals.inserted += Number(data?.inserted) || 0;
    totals.updated += Number(data?.updated) || 0;
    totals.skipped += Number(data?.skipped) || 0;
    console.log(`  загружено ${Math.min(offset + chunk.length, rows.length)} / ${rows.length}`);
  }

  console.log(`\nГотово: добавлено ${totals.inserted}, обновлено ${totals.updated}, пропущено ${totals.skipped}.`);

  const { data: relink, error: relinkError } = await client.rpc('relink_games_to_catalog');
  if (relinkError) {
    console.warn(`Связать карточки не удалось: ${relinkError.message}`);
    return;
  }
  console.log(`Карточки связаны: ${relink?.cards ?? 0}, заявки: ${relink?.submissions ?? 0}, заглушек создано: ${relink?.stubs ?? 0}.`);
  if (relink?.cards_failed || relink?.submissions_failed) {
    console.warn(`Не удалось обновить: карточек ${relink.cards_failed ?? 0}, заявок ${relink.submissions_failed ?? 0}.`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Использование: npm run import:games -- [--dry-run] [--file <путь>] [--verbose]');
    console.log('  --dry-run  проверить файл без записи в Supabase');
    console.log('  --file     другой JSON вместо data/games.json');
    console.log('  --verbose  показать первые записи');
    return;
  }

  await loadDotEnv();
  const items = await readDataset(options.file);
  const report = normalizeDataset(items);
  printReport(report, options);

  if (!report.rows.length) {
    throw new Error('В файле нет ни одной корректной игры — импорт отменён.');
  }
  if (options.dryRun) {
    console.log('\nРежим --dry-run: в Supabase ничего не записано.');
    return;
  }
  await runImport(report.rows);
}

main().catch(error => {
  console.error(`\nОшибка: ${error.message}`);
  process.exitCode = 1;
});
