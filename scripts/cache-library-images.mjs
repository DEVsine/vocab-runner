#!/usr/bin/env node
/**
 * Build a resumable, attribution-complete offline photo cache for a library
 * deck.  The selections deliberately skip concepts that cannot be shown by a
 * single unambiguous photograph (for example "hope" or "month"). Sources
 * are Openverse results restricted to CC0, CC-BY, and CC-BY-SA licenses.
 *
 * Usage (from games/vocab-runner):
 *   node scripts/cache-library-images.mjs verbs
 *   node scripts/cache-library-images.mjs nouns
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const deckId = process.argv[2];
if (!['verbs', 'nouns'].includes(deckId)) throw new Error('Pass either verbs or nouns.');
const deckPath = new URL(`../decks/${deckId}.json`, import.meta.url);
const outputDir = new URL(`../assets/${deckId}/`, import.meta.url);
const attributionPath = new URL(`../assets/${deckId}/attribution.json`, import.meta.url);
const api = 'https://api.openverse.org/v1/images/';
const refresh = process.argv.includes('--refresh');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// These words need context, a sequence, or a metaphor. A generic photo would
// teach an accidental meaning, so the library uses its word-card fallback.
const OMITTED_VERBS = new Set([
  'think', 'learn', 'remember', 'forget', 'understand', 'guess', 'imagine', 'plan', 'decide', 'know', 'believe', 'doubt', 'focus',
  'say', 'tell', 'answer', 'thank', 'apologize', 'agree', 'refuse', 'promise', 'warn', 'explain',
  'spend', 'save', 'earn', 'work', 'hire', 'serve', 'manage', 'lead', 'follow', 'wait', 'help',
  'love', 'hate', 'like', 'want', 'need', 'hope', 'wish', 'fear', 'worry', 'enjoy', 'miss', 'care', 'trust', 'respect', 'admire', 'forgive',
  'see', 'hear', 'feel', 'notice', 'start', 'stop', 'finish', 'begin', 'end', 'change', 'become', 'increase', 'decrease', 'improve', 'repeat', 'continue', 'join', 'separate', 'share', 'add', 'remove', 'replace', 'win', 'lose', 'bend',
]);
const OMITTED_NOUNS = new Set(['day', 'night', 'morning', 'week', 'month', 'year', 'hour', 'minute']);
const omissions = deckId === 'verbs' ? OMITTED_VERBS : OMITTED_NOUNS;

// A few words have common noun meanings. Supplying a scene phrase biases
// Commons search towards the intended child-facing action instead.
const SEARCH_TERMS = {
  'wake up': 'person waking up', brush: 'brushing teeth', shower: 'person showering', bathe: 'child bathing', comb: 'combing hair', shave: 'man shaving', iron: 'ironing clothes',
  fold: 'folding clothes', hang: 'hanging clothes', pack: 'packing suitcase', wear: 'wearing clothes', rest: 'person resting', relax: 'person relaxing',
  count: 'child counting', review: 'student studying', speak: 'people speaking', talk: 'people talking', ask: 'person asking question', shout: 'person shouting', whisper: 'people whispering', call: 'telephone call', greet: 'people greeting', argue: 'people arguing', complain: 'person complaining',
  buy: 'person shopping', sell: 'market seller', pay: 'person paying', build: 'construction worker building', fix: 'repairing object', grow: 'plant growing', drive: 'person driving car', ride: 'child riding bicycle', deliver: 'delivery person', measure: 'measuring ruler',
  open: 'opening door', close: 'closing door', push: 'person pushing', pull: 'person pulling', hold: 'person holding object', grab: 'person grabbing', drop: 'object falling', carry: 'person carrying', lift: 'person lifting', press: 'pressing button', squeeze: 'squeezing lemon', twist: 'twisting object', bend: 'bending arm', break: 'broken glass', tear: 'tearing paper', pour: 'pouring water', fill: 'filling glass', mix: 'mixing bowl', stir: 'stirring bowl', tie: 'tying shoelace', wipe: 'wiping table', scratch: 'scratching skin',
  look: 'person looking', watch: 'child watching television', smell: 'person smelling flower', taste: 'person tasting food', touch: 'child touching object', stare: 'person staring',
  bow: 'person bowing', wave: 'person waving', nod: 'person nodding', point: 'person pointing', clap: 'people clapping', stretch: 'person stretching', yawn: 'person yawning', sneeze: 'person sneezing', cough: 'person coughing', blink: 'person blinking', breathe: 'person breathing',
  fly: 'bird flying', catch: 'catching ball', slide: 'child sliding playground', roll: 'rolling ball', spin: 'spinning top', skip: 'child skipping rope', hop: 'child hopping', leap: 'person leaping', float: 'person floating water', sink: 'object sinking water', chase: 'dog chasing ball', race: 'running race', gallop: 'horse galloping', arrive: 'person arriving', leave: 'person leaving',
  'ice cream': 'ice cream', alarm: 'alarm clock', plane: 'airplane', train: 'train locomotive', ship: 'ship boat', nail: 'metal nail', letter: 'postal letter',
};

function slug(word) { return word.en.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }
function stripHtml(value = '') { return String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
async function request(url, attempt = 0) {
  const response = await fetch(url, { headers: { 'User-Agent': 'EZLearn-VocabRunner/1.0 (educational offline cache; hello@ezlearn.app)' } });
  if (response.status === 429 && attempt < 5) { await sleep(15000 * (attempt + 1)); return request(url, attempt + 1); }
  return response;
}
async function json(url) { const response = await request(url); if (!response.ok) throw new Error(`Openverse returned ${response.status}`); return response.json(); }
async function findPhoto(word) {
  const term = SEARCH_TERMS[word.en] || word.en;
  // Commercially usable Creative Commons and public-domain material only.
  const params = new URLSearchParams({ q: term, page_size: '5', license: 'by,by-sa,cc0,pdm' });
  const data = await json(`${api}?${params}`);
  return (data.results || []).filter(item => item.thumbnail && item.license && item.foreign_landing_url);
}
function command(program, args) { return new Promise((resolve, reject) => { const p = spawn(program, args, { stdio: 'ignore' }); p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`))); }); }
async function download(url, destination) { const response = await request(url); if (!response.ok) throw new Error(`image download returned ${response.status}`); await writeFile(destination, new Uint8Array(await response.arrayBuffer())); }

async function main() {
  await mkdir(outputDir, { recursive: true });
  const deck = JSON.parse(await readFile(deckPath, 'utf8'));
  const attribution = existsSync(attributionPath) ? JSON.parse(await readFile(attributionPath, 'utf8')) : { omissions: {} };
  attribution.omissions ||= {};
  let downloaded = 0; const failures = [];
  const persist = () => Promise.all([writeFile(deckPath, `${JSON.stringify(deck, null, 2)}\n`), writeFile(attributionPath, `${JSON.stringify(attribution, null, 2)}\n`)]);
  for (const word of deck.words) {
    if (omissions.has(word.en)) attribution.omissions[word.en] = 'ภาพถ่ายเดียวไม่สื่อความหมายนี้ได้ชัดเจน';
  }
  await persist();
  const candidates = deck.words.map((word, index) => ({ word, index })).filter(({ word }) => !omissions.has(word.en));
  let next = 0;
  async function cacheOne({ index, word }) {
    const name = `${slug(word)}.webp`; const output = join(outputDir.pathname, name);
    if (!refresh && existsSync(output) && attribution[word.en]) { word.img ||= `${deckId}/${name}`; return; }
    try {
      const temporary = join(outputDir.pathname, `.download-${slug(word)}.jpg`);
      const found = await findPhoto(word); if (!found.length) throw new Error('no suitable Openverse result');
      let selected; let lastError;
      for (const candidate of found) {
        try { await download(candidate.thumbnail, temporary); await command('cwebp', ['-quiet', '-q', '80', '-resize', '512', '0', temporary, '-o', output]); selected = candidate; break; }
        catch (error) { lastError = error; await rm(temporary, { force: true }); }
      }
      if (!selected) throw lastError;
      const foundResult = selected;
      attribution[word.en] = { title: stripHtml(foundResult.title) || word.en, creator: stripHtml(foundResult.creator) || 'Openverse contributor', license: foundResult.license.toUpperCase(), licenseUrl: foundResult.license_url || 'https://creativecommons.org/licenses/', sourceUrl: foundResult.foreign_landing_url, originalUrl: foundResult.url || foundResult.foreign_landing_url, cachedFrom: `Openverse (${foundResult.source || 'Creative Commons'})` };
      word.img = `${deckId}/${name}`; downloaded++; process.stdout.write(`${index + 1}/${deck.words.length} ${word.en}\n`);
    } catch (error) { failures.push({ word: word.en, error: error.message }); process.stderr.write(`${index + 1}/${deck.words.length} ${word.en}: ${error.message}\n`); }
    await sleep(100);
  }
  // Four independent requests keep a large deck practical, while each group is
  // persisted together so an interruption loses at most four selections.
  async function worker() { while (next < candidates.length) { const item = candidates[next++]; await cacheOne(item); if (next % 4 === 0) await persist(); } }
  await Promise.all(Array.from({ length: 4 }, worker));
  await persist();
  process.stdout.write(`Cached ${downloaded}; omitted ${Object.keys(attribution.omissions).length}; failed ${failures.length}.\n`);
  if (failures.length) { writeFile(join(outputDir.pathname, 'failures.json'), `${JSON.stringify(failures, null, 2)}\n`); process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
