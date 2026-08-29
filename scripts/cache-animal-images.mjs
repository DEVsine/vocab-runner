#!/usr/bin/env node
/**
 * Builds the offline animal-photo cache from Wikimedia Commons.
 *
 * Every downloaded derivative is paired with source and licence metadata in
 * assets/animals/attribution.json.  Existing hand-curated pilot photos are
 * deliberately retained. Run from games/vocab-runner:
 *   node scripts/cache-animal-images.mjs
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const deckPath = new URL('../decks/animals.json', import.meta.url);
const outputDir = new URL('../assets/animals/', import.meta.url);
const attributionPath = new URL('../assets/animals/attribution.json', import.meta.url);
const api = 'https://commons.wikimedia.org/w/api.php';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const requestedReplacements = new Set(
  (process.argv.find(arg => arg.startsWith('--replace=')) || '')
    .slice('--replace='.length)
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
);

// Commons contains many non-animal uses of these words (vehicles, places and
// people).  These additions make a repeatable audit pass favour the animal.
const searchTerms = {
  'turkey': 'turkey bird', 'turkey bird': 'wild turkey bird',
  'panther': 'black panther animal', 'buffalo': 'water buffalo animal',
  'bull': 'bull cattle animal', 'ox': 'ox cattle animal',
  'goldfish': 'goldfish fish', 'piglet': 'piglet animal', 'lamb': 'lamb sheep',
  'chicken': 'chicken bird', 'gibbon': 'gibbon primate', 'gorilla': 'gorilla animal',
  'antelope': 'antelope animal', 'gazelle': 'gazelle animal',
  'porcupine': 'porcupine animal', 'beaver': 'beaver animal', 'platypus': 'platypus animal',
  'mole': 'mole animal', 'rat': 'rat animal', 'chipmunk': 'chipmunk animal',
  'hare': 'hare animal', 'whale': 'whale animal', 'dolphin': 'dolphin animal',
  'crab': 'crab animal', 'lobster': 'lobster animal', 'shrimp': 'shrimp animal',
  'stingray': 'stingray animal', 'seal': 'seal animal', 'tropical fish': 'tropical fish animal',
  'hawk': 'hawk bird', 'snake': 'snake animal', 'cobra': 'cobra snake',
  'python': 'python snake', 'tortoise': 'tortoise animal', 'salamander': 'salamander animal',
  'newt': 'newt animal', 'dinosaur': 'dinosaur animal', 'beetle': 'beetle insect',
  'cricket': 'cricket insect', 'caterpillar': 'caterpillar insect', 'worm': 'earthworm animal',
  'firefly': 'firefly insect', 'puppy': 'puppy dog', 'swordfish': 'swordfish fish',
  'wombat': 'wombat animal', 'locust': 'locust insect',
};

// A small curated set for words whose top Commons search hit is still a
// homonym (for example Mole Antonelliana or a platypus-named crab).
const preferredFiles = {
  platypus: 'Duck-billed platypus (Ornithorhynchus anatinus) Scottsdale.jpg',
  mole: 'Mol (Talpa europaea) 03.JPG',
  piglet: 'Piglets at Mudchute Farm - geograph.org.uk - 7008181.jpg',
  dolphin: '010 Atlantic bottlenose dolphin jumping at Pelican point Photo by Giles Laurent.jpg',
  shrimp: 'Palaemon serratus Croazia.jpg',
  python: 'Heller Tigerpython Python molurus molurus.jpg',
  salamander: 'Fire salamander (Salamandra Salamandra).jpg',
  flea: 'Ctenocephalides felis subsp. felis, Hayling Island (53138287149).jpg',
  swordfish: 'Xiphias gladius in the sea.jpg',
};

function slug(word) {
  return word.en.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function stripHtml(value = '') {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

async function request(url, headers, attempt = 0) {
  const response = await fetch(url, { headers });
  if (response.status === 429 && attempt < 5) {
    const retrySeconds = Math.max(Number(response.headers.get('retry-after')) || 0, 15 * (attempt + 1));
    process.stderr.write(`Rate limited; waiting ${retrySeconds}s before retrying…\n`);
    await sleep(retrySeconds * 1000);
    return request(url, headers, attempt + 1);
  }
  return response;
}

async function json(url) {
  const response = await request(url, { 'User-Agent': 'EZLearn-VocabRunner/1.0 (educational offline cache; contact: hello@ezlearn.app)' });
  if (!response.ok) throw new Error(`Commons returned ${response.status}`);
  return response.json();
}

async function findPhoto(term) {
  const searchTerm = searchTerms[term.toLowerCase()] || `${term} animal`;
  const params = new URLSearchParams({
    action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|mime',
    iiurlwidth: '640', format: 'json', origin: '*',
  });
  const preferred = preferredFiles[term.toLowerCase()];
  if (preferred) params.set('titles', `File:${preferred}`);
  else {
    params.set('generator', 'search');
    params.set('gsrsearch', `${searchTerm} filetype:bitmap`);
    params.set('gsrnamespace', '6');
    params.set('gsrlimit', '8');
  }
  const data = await json(`${api}?${params}`);
  const pages = Object.values(data.query?.pages || {});
  const candidates = pages.map(page => ({ page, info: page.imageinfo?.[0] })).filter(({ info }) =>
    info?.thumburl && /image\/(jpeg|png|webp)/.test(info.mime || '') && info.extmetadata?.LicenseShortName?.value,
  );
  if (preferred) return candidates[0];
  // Keep search results whose filename actually names the requested animal.
  const normalized = term.replace(/[^a-z]/gi, '').toLowerCase();
  return candidates.sort((a, b) => {
    const score = item => {
      const title = item.page.title.toLowerCase().replace(/[^a-z]/g, '');
      return (title.includes(normalized) ? 8 : 0) +
        (title.includes('animal') ? 2 : 0) +
        (title.includes('bird') || title.includes('fish') || title.includes('insect') ? 1 : 0);
    };
    return score(b) - score(a);
  })[0];
}

async function download(url, destination) {
  const response = await request(url, { 'User-Agent': 'EZLearn-VocabRunner/1.0 (educational offline cache; contact: hello@ezlearn.app)' });
  if (!response.ok) throw new Error(`image download returned ${response.status}`);
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}

function command(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)));
  });
}

async function cacheWord(word, attribution) {
  const name = `${slug(word)}.webp`;
  const output = join(outputDir.pathname, name);
  const replacing = requestedReplacements.has(word.en.toLowerCase());
  if (existsSync(output) && attribution[word.en] && !replacing) {
    word.img ||= `animals/${name}`;
    return 'existing';
  }
  const found = await findPhoto(word.en);
  if (!found) throw new Error('no suitable Commons bitmap result');
  const { page, info } = found;
  const temporary = join(outputDir.pathname, `.download-${slug(word)}.${info.mime === 'image/png' ? 'png' : 'jpg'}`);
  await download(info.thumburl, temporary);
  await command('cwebp', ['-quiet', '-q', '80', '-resize', '512', '0', temporary, '-o', output]);
  await rm(temporary, { force: true });
  const meta = info.extmetadata || {};
  const pageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/^File:/, 'File:'))}`;
  attribution[word.en] = {
    title: stripHtml(meta.ObjectName?.value) || page.title.replace(/^File:/, ''),
    creator: stripHtml(meta.Artist?.value) || 'Wikimedia Commons contributor',
    license: stripHtml(meta.LicenseShortName?.value),
    licenseUrl: meta.LicenseUrl?.value || pageUrl,
    sourceUrl: pageUrl,
    originalUrl: info.descriptionurl || pageUrl,
    cachedFrom: 'Wikimedia Commons',
  };
  word.img = `animals/${name}`;
  return 'downloaded';
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const deck = JSON.parse(await readFile(deckPath, 'utf8'));
  const attribution = existsSync(attributionPath) ? JSON.parse(await readFile(attributionPath, 'utf8')) : {};
  let downloaded = 0;
  const failures = [];
  const persist = () => Promise.all([
    writeFile(deckPath, `${JSON.stringify(deck, null, 2)}\n`),
    writeFile(attributionPath, `${JSON.stringify(attribution, null, 2)}\n`),
  ]);
  for (const [index, word] of deck.words.entries()) {
    if (requestedReplacements.size && !requestedReplacements.has(word.en.toLowerCase())) continue;
    try {
      const result = await cacheWord(word, attribution);
      if (result === 'downloaded') downloaded++;
      await persist(); // the batch is safe to resume after an interrupted network run
      process.stdout.write(`${index + 1}/${deck.words.length} ${word.en}: ${result}\n`);
    } catch (error) {
      failures.push({ word: word.en, error: error.message });
      process.stderr.write(`${index + 1}/${deck.words.length} ${word.en}: ${error.message}\n`);
    }
    await sleep(850);
  }
  if (failures.length) {
    process.stderr.write(`Failed: ${JSON.stringify(failures)}\n`);
    process.exitCode = 1;
    return;
  }
  await persist();
  process.stdout.write(`Cached ${downloaded} new images.\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
