/**
 * deck.js — โหลดชุดคำ, เลือกคำที่จะถาม, และ "ปั้นตัวเลือกลวง"
 *
 * ตัวลวง (distractor) คือส่วนที่เงียบที่สุดแต่สำคัญที่สุดของเกมฝึกศัพท์
 * เพราะมันเป็นตัวกำหนดว่าเกม "วัดอะไรจริง ๆ":
 *
 *   โจทย์ "กังวล" + ตัวเลือก anxious / table / run
 *     → ผู้เล่นไม่ต้องรู้จัก anxious เลย แค่ตัดตัวที่รู้ออก = ฝึกทำข้อสอบ ไม่ใช่ฝึกภาษา
 *   โจทย์ "กังวล" + ตัวเลือก anxious / ancient / awkward
 *     → ต้องอ่านรูปคำจริง ๆ = ฝึกภาษา
 *
 * กลยุทธ์ที่ใช้ (ปรับตามกล่อง Leitner ของคำนั้น):
 *   กล่อง 1 (คำใหม่)   → ตัวลวงชนิดคำเดียวกัน คนละหมวด — พอให้ตัดทางลัด ไม่โหด
 *   กล่อง 2            → ตัวลวงชนิดคำเดียวกัน ระดับใกล้กัน
 *   กล่อง 3 (แม่นแล้ว) → ตัวลวง "หน้าตาคล้าย" วัดด้วย edit distance
 */

import { CFG } from './config.js';
import { statOf, isUnseen, itemId } from './srs.js';

/* ── โหลดไฟล์ ───────────────────────────────────────────────── */

// ⚠️ ต้องปิดแคชสำหรับไฟล์ deck โดยเฉพาะ
// deck คือ "ข้อมูล" ที่ผู้เล่นจะแก้เองบ่อย ๆ (เพิ่มคำ/แก้คำแปล/สร้าง deck ใหม่)
// ถ้าเบราว์เซอร์แคชไว้ ผู้เล่นแก้ไฟล์แล้ว reload ก็ยังเห็นของเก่า แล้วงงว่าทำไมไม่เปลี่ยน
// (โค้ด JS ไม่ต้องกังวลเรื่องนี้เพราะมันเปลี่ยนน้อยกว่ามาก)
const NO_CACHE = { cache: 'no-store' };

export async function loadDeckIndex() {
  const res = await fetch('./decks/index.json', NO_CACHE);
  if (!res.ok) throw new Error(`โหลดรายการ deck ไม่ได้ (HTTP ${res.status})`);
  return res.json();
}

export async function loadDeck(file) {
  await loadStudyLevelsCatalog();
  const res = await fetch(`./decks/${file}`, NO_CACHE);
  if (!res.ok) throw new Error(`โหลด deck "${file}" ไม่ได้ (HTTP ${res.status})`);
  return normalizeDeck(await res.json(), file);
}

/* ── ชนิดของ deck ───────────────────────────────────────────
 *
 * มีสองชนิด และ "ไม่มี field type" = คำศัพท์ (vocab) เสมอ
 * ตั้งใจให้ค่าโดยปริยายคือของเดิม เพราะ deck ศัพท์ 9 อันที่ผู้เล่นใช้อยู่
 * ต้องทำงานเหมือนเดิมเป๊ะโดยไม่ต้องแก้ไฟล์แม้แต่ตัวอักษรเดียว
 *
 *   vocab   → { words: [{en, th, pos, level, topic, emoji?, img?}] }  ตัวลวงถูกปั้นจากคำอื่นในชุด
 *   subject → { type:"subject", items: [{id, q, options[3], answer, fact, page}] }
 *             ตัวเลือกเขียนตายตัวมากับไฟล์ ไม่ผ่านตัวปั้นตัวลวงเลย
 */
export function isSubjectDeck(deck) {
  return deck?.type === 'subject';
}

export const ALL_CHAPTERS = 'all';

export function chapterById(deck, chapterId) {
  if (!isSubjectDeck(deck) || chapterId === ALL_CHAPTERS) return null;
  return deck.chapters?.find(chapter => chapter.id === chapterId) ?? null;
}

/**
 * สร้าง learning scope สำหรับหนึ่งบท โดยคง deck.id เดิมไว้ให้ SRS รายข้อไม่แตก
 * scopeKey แยกเฉพาะสถิติระดับ "รอบ" เพราะคะแนนของ 10 ข้อเทียบกับ 100 ข้อไม่ได้
 */
export function chapterDeck(deck, chapterId = ALL_CHAPTERS) {
  if (!isSubjectDeck(deck) || chapterId === ALL_CHAPTERS) {
    return { ...deck, chapterId: ALL_CHAPTERS, scopeKey: deck.id };
  }
  const chapter = chapterById(deck, chapterId);
  if (!chapter) return chapterDeck(deck, ALL_CHAPTERS);
  const words = deck.words.filter(word => word.chapterId === chapter.id);
  return {
    ...deck,
    chapterId: chapter.id,
    chapter,
    words,
    items: deck.items.filter(item => item.chapterId === chapter.id),
    scopeKey: `${deck.id}:${chapter.id}`,
  };
}

/* ── deck คำตรงข้าม (โหมดสอบ) ──────────────────────────────
 *
 *   antonym → { type:"antonym", words: [{en, ant, th, antTh, level}] }
 *             โจทย์คือ "คำตรงข้ามของ X" — ตัวเลือกเป็นคำ `ant` ของคำอื่นในชุด
 *
 * deck ชนิดนี้คือ "โหมดสอบ": อ่านอย่างเดียว ไม่มีเสียง ไม่มีเกราะกันตาย
 * เพื่อให้ผลคะแนนสะท้อนความรู้จริง ไม่ใช่ไอเทมที่เก็บได้ระหว่างทาง
 */
export function isAntonymDeck(deck) {
  return deck?.type === 'antonym';
}

/**
 * deck นี้ต้องเล่นแบบ "โหมดสอบ" ไหม — ตอนนี้มีแค่คำตรงข้าม
 * แยกชื่อฟังก์ชันไว้ตั้งแต่แรก เพราะกติกาโหมดสอบ (เงียบ/ไม่มีเกราะ/โจทย์ตัวหนังสือ)
 * เป็นของ "ประเภทการเล่น" ไม่ใช่ของ deck คำตรงข้ามโดยเฉพาะ
 */
export function isExamDeck(deck) {
  return isAntonymDeck(deck);
}

/**
 * แปลง "ข้อของวิชา" ให้เป็น object หน้าตาเดียวกับ "คำ" ของ deck ศัพท์
 *
 * ⚠️ นี่คือการตัดสินใจเชิงสถาปัตยกรรมที่สำคัญที่สุดของฟีเจอร์นี้
 * ทางเลือกที่พิจารณา:
 *   (ก) ให้ทุกจุดที่แตะ word เช็ก `if (subject)` เอง — เกมมีจุดแบบนั้นราว 25 จุด
 *       (HUD, จอตาย, หน้าสถิติ, ห้องซ้อม, inbox, ผู้ชมในโหมดแข่ง) ทุกจุดที่ลืม
 *       จะกลายเป็น "undefined" โผล่บนจอ และไม่มีเทสต์ไหนจับได้
 *   (ข) แปลงร่างที่ "ปากทางเข้า" ครั้งเดียว ให้ข้างในเห็นของหน้าตาเดียวกันหมด
 * เลือก (ข) — โค้ดที่แสดงผลจึงไม่ต้องรู้จักคำว่า subject เลย ยกเว้นจุดที่
 * *ตั้งใจ* ให้ต่าง (ตัวโจทย์บน HUD / เสียงอ่านภาษาไทย / คำอธิบายตอนเฉลย)
 *
 * การจับคู่ช่องเดิม:
 *   en ← q     "หน้าตาของข้อ" ที่หน้าสถิติและจอตายใช้อ้างถึงข้อนี้
 *   th ← fact  "ความหมาย" ที่ระบบเดิมเผยตอนเฉลย = ใบความรู้ของข้อนี้พอดี
 * ทั้งคู่เป็นแค่ช่องสำหรับ *แสดงผล* — กุญแจสถิติใช้ `id` เสมอ (ดู srs.itemId)
 */
export function toSubjectWord(item) {
  return {
    id: item.id,
    subject: true,
    q: item.q,
    fact: item.fact ?? '',
    page: item.page,
    chapterId: item.chapterId,
    choices: item.options,
    answer: item.answer,
    en: item.q,
    th: item.fact ?? '',
  };
}

/**
 * ตรวจไฟล์ deck แล้วคืนรูปแบบภายในที่เกมใช้ได้ทันที (โค้ดบริสุทธิ์ — เทสต์ได้)
 * @param {object} deck ข้อมูลดิบจากไฟล์ JSON
 * @param {string} file ชื่อไฟล์ (ใช้ในข้อความ error เท่านั้น)
 */
export function normalizeDeck(deck, file = deck?.id ?? '?') {
  if (isSubjectDeck(deck)) {
    if (!Array.isArray(deck.items) || deck.items.length < 4) {
      throw new Error(`deck วิชา "${file}" ต้องมีอย่างน้อย 4 ข้อ`);
    }
    if (!Array.isArray(deck.chapters) || !deck.chapters.length) {
      throw new Error(`deck วิชา "${file}": ต้องประกาศ chapters อย่างน้อย 1 บท`);
    }
    const chapterIds = new Set(deck.chapters.map(chapter => chapter.id));
    if (chapterIds.size !== deck.chapters.length || chapterIds.has(undefined)) {
      throw new Error(`deck วิชา "${file}": chapter id หายหรือซ้ำ`);
    }
    const seen = new Set();
    for (const item of deck.items) {
      if (!item.id) throw new Error(`deck วิชา "${file}": มีข้อที่ไม่มี id`);
      if (seen.has(item.id)) throw new Error(`deck วิชา "${file}": id ซ้ำ "${item.id}"`);
      seen.add(item.id);
      if (!chapterIds.has(item.chapterId)) {
        throw new Error(`deck วิชา "${file}" ข้อ "${item.id}": chapterId ไม่ตรงกับ chapters`);
      }
      if (!Array.isArray(item.options) || item.options.length !== 3) {
        throw new Error(`deck วิชา "${file}" ข้อ "${item.id}": ต้องมีตัวเลือก 3 ตัวพอดี`);
      }
      if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer > 2) {
        throw new Error(`deck วิชา "${file}" ข้อ "${item.id}": answer ต้องเป็น 0–2`);
      }
    }
    for (const chapter of deck.chapters) {
      const count = deck.items.filter(item => item.chapterId === chapter.id).length;
      if (count < 4) throw new Error(`deck วิชา "${file}" บท "${chapter.id}": ต้องมีอย่างน้อย 4 ข้อ`);
    }
    return { ...deck, words: deck.items.map(toSubjectWord) };
  }

  if (isAntonymDeck(deck)) {
    if (!Array.isArray(deck.words) || deck.words.length < 4) {
      throw new Error(`deck คำตรงข้าม "${file}" ต้องมีอย่างน้อย 4 คู่`);
    }
    for (const w of deck.words) {
      // ต้องครบทั้ง 4 ช่องทุกคู่ — โจทย์สลับภาษา (en/th) และตัวเลือกเผยคำแปล (antTh)
      // ขาดช่องเดียวจะกลายเป็นโจทย์/เฉลยว่างเปล่ากลางเกมโดยไม่มี error ฟ้อง
      if (!w.en || !w.ant || !w.th || !w.antTh) {
        throw new Error(`deck คำตรงข้าม "${file}" คู่ "${w.en ?? '?'}": ต้องมี en/ant/th/antTh ครบ`);
      }
    }
    return attachStudyLevels(deck);
  }

  if (!Array.isArray(deck.words) || deck.words.length < 4) {
    throw new Error(`deck "${file}" ต้องมีคำอย่างน้อย 4 คำ`);
  }
  return attachStudyLevels(deck);
}

/* ── ชุดคำย่อย (~10 คำต่อชุด) ─────────────────────────────────
 *
 * แบ่งอัตโนมัติจากลำดับ topic (คุ้นเคยก่อน) + สั้น→ยาวภายใน topic
 * ผู้เล่นเลือกชุดที่ N ได้ 2 แบบ:
 *   - เฉพาะชุดนี้ (~10 คำ) — เหมาะรอบสั้น ๆ วนซ้ำจำได้เร็ว
 *   - รวมชุด 1..N — ทบทวนสะสม
 * สถิติ SRS แยกตาม playDeckId() เช่น animals@I3 (ชุด 3 อย่างเดียว) / animals@C3 (รวม)
 */

let studyLevelsCatalog = null;

export async function loadStudyLevelsCatalog() {
  if (studyLevelsCatalog) return studyLevelsCatalog;
  const res = await fetch('./decks/study-levels.json', NO_CACHE);
  if (!res.ok) throw new Error(`โหลดลำดับหมวดย่อยไม่ได้ (HTTP ${res.status})`);
  studyLevelsCatalog = await res.json();
  return studyLevelsCatalog;
}

/** ใช้ในเทสต์เท่านั้น — inject catalog โดยไม่ fetch */
export function setStudyLevelsCatalog(catalog) {
  studyLevelsCatalog = catalog;
}

/** @param {object} deck deck หลัง normalizeDeck */
export function studyLevelPlan(deck) {
  if (!deck?.id || isSubjectDeck(deck)) return null;
  return studyLevelsCatalog?.[deck.id] ?? {};
}

/** กุญแจสถิติ — แยกตามชุด+โหมดรวม/ไม่รวม */
export function playDeckId(deck) {
  return deck?.statsId ?? deck?.id ?? '';
}

/** นับตัวอักษรอังกฤษอย่างเดียว — เว้นวรรค/เครื่องหมายไม่นับ ("polar bear" = 9) */
export function englishLetterCount(en) {
  return String(en ?? '').replace(/[^a-zA-Z]/g, '').length;
}

function byShortestEnglish(a, b) {
  const diff = englishLetterCount(a.en) - englishLetterCount(b.en);
  if (diff !== 0) return diff;
  return String(a.en ?? '').localeCompare(String(b.en ?? ''));
}

function topicRank(topic, order, fallback) {
  if (!topic) return fallback;
  const idx = order.indexOf(topic);
  return idx >= 0 ? idx : fallback + order.length;
}

/** เรียงคำก่อนแบ่งชุด: topic ที่คุ้นเคยก่อน แล้วสั้น→ยาว */
export function sortWordsForStudy(words, plan = {}) {
  if (plan.mode === 'difficulty') {
    return words.slice().sort((a, b) =>
      ((a.level ?? 2) - (b.level ?? 2)) || byShortestEnglish(a, b),
    );
  }

  const order = plan.topicOrder ?? [];
  const seen = new Set(order);
  for (const w of words) {
    if (w.topic && !seen.has(w.topic)) {
      order.push(w.topic);
      seen.add(w.topic);
    }
  }

  return words.slice().sort((a, b) =>
    topicRank(a.topic, order, 50) - topicRank(b.topic, order, 50) ||
    byShortestEnglish(a, b),
  );
}

/** แบ่งเป็นก้อน ~wordsPerStep · ถ้าท้ายเหลือ < minWordsPerStep ให้รวมกับชุดก่อน */
export function chunkStudyWords(words, wordsPerStep, minWordsPerStep = 4) {
  if (!words.length) return [];
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerStep) {
    chunks.push(words.slice(i, i + wordsPerStep));
  }
  if (chunks.length > 1 && chunks[chunks.length - 1].length < minWordsPerStep) {
    chunks[chunks.length - 2].push(...chunks.pop());
  }
  return chunks;
}

function dominantTopic(chunk) {
  const counts = new Map();
  for (const w of chunk) {
    if (!w.topic) continue;
    counts.set(w.topic, (counts.get(w.topic) ?? 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [topic, n] of counts) {
    if (n > bestN) { best = topic; bestN = n; }
  }
  return best;
}

function stepName(step, chunk, plan) {
  // plan ตั้ง stepNaming:"level" ได้ เมื่อชุดที่ N ตรงกับระดับความยากที่ N พอดี
  // (เช่น deck คำตรงข้ามที่จัด 10 คู่ต่อระดับมาแล้วจากไฟล์)
  if (plan?.stepNaming === 'level') return `ระดับ ${step}`;
  const topicLabels = plan?.topicLabels;
  const topic = dominantTopic(chunk);
  const label = topic && topicLabels?.[topic] ? topicLabels[topic] : null;
  return label ? `${label} · ชุด ${step}` : `ชุดที่ ${step}`;
}

/** ใส่ studyStep ให้ทุกคำ + meta ชุดไว้บน deck */
export function attachStudyLevels(deck) {
  if (isSubjectDeck(deck)) {
    return { ...deck, studyLevels: null, allWords: deck.words, statsId: deck.id };
  }

  const plan = studyLevelsCatalog?.[deck.id] ?? {};
  const { wordsPerStep, minWordsPerStep } = CFG.studySteps;
  const sorted = sortWordsForStudy(deck.words, plan);
  const chunks = chunkStudyWords(sorted, wordsPerStep, minWordsPerStep);

  if (chunks.length <= 1 && sorted.length <= wordsPerStep) {
    return { ...deck, studyLevels: null, allWords: sorted, words: sorted, statsId: deck.id };
  }

  const allWords = [];
  let cumulative = 0;
  const studyLevels = chunks.map((chunk, i) => {
    const step = i + 1;
    for (const w of chunk) allWords.push({ ...w, studyStep: step });
    cumulative += chunk.length;
    return {
      level: step,
      name: stepName(step, chunk, plan),
      stepCount: chunk.length,
      cumulativeCount: cumulative,
    };
  });

  return {
    ...deck,
    allWords,
    words: allWords,
    studyLevels,
  };
}

/**
 * เลือกชุดคำ — cumulative=false = เฉพาะชุดนี้ (~10 คำ) · true = รวมชุด 1..N
 */
export function applyStudyLevel(deck, step, { cumulative = false } = {}) {
  if (!deck?.studyLevels?.length || !deck.allWords) return deck;
  const n = Number(step);
  const row = deck.studyLevels.find(r => r.level === n);
  if (!row) return deck;

  const words = cumulative
    ? deck.allWords.filter(w => w.studyStep <= n)
    : deck.allWords.filter(w => w.studyStep === n);

  if (words.length < CFG.studySteps.minWordsPerStep) return deck;

  const mode = cumulative ? 'C' : 'I';
  return {
    ...deck,
    words,
    activeStudyLevel: n,
    activeStudyLevelName: row.name,
    activeStudyCumulative: cumulative,
    statsId: `${deck.id}@${mode}${n}`,
  };
}

export function defaultStudyLevel(deck) {
  if (!deck?.studyLevels?.length) return null;
  return deck.studyLevels[0].level;
}

export function maxStudyLevel(deck) {
  if (!deck?.studyLevels?.length) return null;
  return deck.studyLevels[deck.studyLevels.length - 1].level;
}

/* ── เครื่องมือ ─────────────────────────────────────────────── */

/**
 * Levenshtein distance — จำนวนครั้งที่ต้องเพิ่ม/ลบ/แก้ตัวอักษร
 * เพื่อเปลี่ยนคำหนึ่งให้เป็นอีกคำ ใช้วัดว่า "หน้าตาคล้ายกันแค่ไหน"
 */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur.slice();
  }
  return prev[n];
}

/** ความคล้ายของรูปคำ 0..1 (1 = เหมือนกันเป๊ะ) */
function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a.toLowerCase(), b.toLowerCase()) / longest;
}

/**
 * กันตัวลวงที่ "ถูกได้เหมือนกัน"
 * ถ้าคำแปลไทยซ้อนทับกัน (เช่น "ยืม" กับ "ให้ยืม") ผู้เล่นจะถูกลงโทษ
 * เพราะความกำกวมของภาษา ไม่ใช่เพราะไม่รู้ศัพท์
 *
 * ⚠️ ทำไมไม่ใช้ includes() เฉย ๆ: ภาษาไทยเขียนติดกันไม่มีเว้นวรรค
 * "ดิน" จึงเป็น substring ของ "แผ่นดินไหว" และ "กระเป๋าเดินทาง" ทั้งที่
 * ความหมายไม่เกี่ยวกันเลย → ต้องเช็คสัดส่วนความยาวด้วย ถ้าคำสั้นกินพื้นที่
 * ไม่ถึงครึ่งของคำยาว แปลว่าบังเอิญตัวอักษรพ้องกัน ไม่ใช่ความหมายทับกัน
 */
function meaningsClash(a, b) {
  const x = a.th.replace(/\s/g, '');
  const y = b.th.replace(/\s/g, '');
  if (x === y) return true;
  if (!x.includes(y) && !y.includes(x)) return false;
  const ratio = Math.min(x.length, y.length) / Math.max(x.length, y.length);
  return ratio >= 0.45;
}

function shuffle(arr, rand) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── เลือกคำที่จะถาม ────────────────────────────────────────── */

/**
 * สุ่มแบบถ่วงน้ำหนักตามกล่อง Leitner
 * ใช้การสุ่มแทนคิวตายตัว เพราะคิวจะทำให้เดาลำดับได้และน่าเบื่อ
 */
export function pickWord(deck, recentQueue, rand = Math.random) {
  const recent = new Set(recentQueue);
  const pool = deck.words.filter(w => !recent.has(itemId(w)));
  const candidates = pool.length >= 4 ? pool : deck.words;

  const weights = candidates.map(w => {
    const deckKey = playDeckId(deck);
    if (isUnseen(deckKey, w)) return CFG.srs.unseenWeight;
    return CFG.srs.boxWeights[statOf(deckKey, w).box] ?? 1;
  });

  const total = weights.reduce((sum, x) => sum + x, 0);
  let roll = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * เลือกคำแบบ "ไม่พึ่งสถิติของใครเลย" — ใช้เฉพาะรอบชิงของ Battle Royale
 *
 * ⚠️ ทำไมห้ามใช้ pickWord ตอนรอบชิง: pickWord ถ่วงน้ำหนักตามกล่อง Leitner
 * ของ *เครื่องนั้น* ดังนั้นแม้ส่งเมล็ดสุ่มเดียวกันไป แต่ละคนก็จะได้คนละคำ
 * เพราะน้ำหนักต่างกัน → "แทร็กเดียวกัน" จะพังทันทีโดยที่ตัวสุ่มไม่ได้ผิดอะไรเลย
 * รอบชิงจึงต้องสุ่มจากรายการคำดิบ ๆ ล้วน ๆ
 */
export function pickWordSeeded(deck, recentQueue, rand) {
  const recent = new Set(recentQueue);
  const pool = deck.words.filter(w => !recent.has(itemId(w)));
  const candidates = pool.length >= 4 ? pool : deck.words;
  return candidates[Math.floor(rand() * candidates.length)];
}

/* ── ปั้นโจทย์ 1 ข้อ ────────────────────────────────────────── */

/**
 * เลือก "รูปแบบโจทย์" ของข้อนี้ — สลับไปมาระหว่างอ่าน/ดู/ฟัง
 *
 * ทำไมต้องสลับ? เพราะความจำที่ผูกกับช่องทางเดียวจะใช้ได้แค่ในช่องทางนั้น
 * คนที่ฝึกจากตัวหนังสืออย่างเดียวจะ "อ่านออกแต่ฟังไม่ออก" ซึ่งเป็นอาการ
 * คลาสสิกของคนไทยที่เรียนศัพท์จากหนังสือ การสลับสื่อบังคับให้สมองสร้าง
 * เส้นทางเข้าถึงคำเดียวกันหลายเส้น
 *
 * เงื่อนไข: โหมดรูปใช้ได้เฉพาะคำที่มี emoji, โหมดเสียงใช้ได้เมื่อเปิดเสียงอ่าน
 */
export function chooseMode(word, { speechEnabled = true, allow = null } = {}, rand = Math.random) {
  const w = CFG.question.weights;
  let pool = [['text', w.text]];
  // img = รูปถ่ายจริงที่อยู่ในเครื่อง (เด็คผลไม้) · emoji = ตัวยืนแบบเดิม
  // มีอย่างใดอย่างหนึ่งก็เล่นโหมดภาพได้ — คำที่มี img ไม่จำเป็นต้องมี emoji
  if (word.emoji || word.img) pool.push(['image', w.image]);
  if (speechEnabled) pool.push(['audio', w.audio]);

  /* allow = รายการโหมดที่ผู้เล่นเปิดไว้ในหน้าตั้งค่า
   * ⚠️ ถ้ากรองแล้วไม่เหลืออะไรเลย ต้องถอยกลับไปใช้ pool เดิม **ห้ามคืนค่าว่าง**
   * เคสจริงที่เกิดได้: เปิดเฉพาะ "รูป" แต่คำนั้นไม่มีทั้ง emoji และรูป
   * ถ้าดันให้เป็นโหมดรูปทั้งที่ไม่มีรูป ผู้เล่นจะได้โจทย์ว่างเปล่าที่ตอบไม่ได้เลย
   * ผิดคำสั่งผู้ใช้หนึ่งข้อ ดีกว่าปล่อยโจทย์ที่เล่นต่อไม่ได้ */
  if (allow?.length) {
    const kept = pool.filter(([mode]) => allow.includes(mode));
    if (kept.length) pool = kept;
  }

  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [mode, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return mode;
  }
  return 'text';
}

/**
 * "โซนลงจอด" ของ Battle Royale — หั่น deck เหลือเฉพาะคำในระดับที่เลือก
 *
 * คืน object หน้าตาเหมือน deck เดิมทุกอย่าง (คง id ไว้เพื่อให้สถิติ SRS ยังตรงชุดเดิม)
 * ⚠️ ต้องมีตาข่ายกันพัง: ถ้าระดับที่เลือกมีคำน้อยเกินไป ตัวลวงจะซ้ำจนจำได้
 * ภายในไม่กี่ข้อ → ถอยกลับไปใช้ deck เต็มแทน ดีกว่าให้ผู้เล่นเจอโจทย์เดิมวนซ้ำ
 */
/**
 * กรองเด็คให้เหลือคำที่เด็กเล่นได้ — สั้นและอยู่ระดับต้น
 *
 * ⚠️ "สั้น" นับจากตัวอักษรอังกฤษ ไม่ใช่จากระดับความยาก เพราะสองอย่างนี้ไม่เท่ากัน
 * `mangosteen` ระดับ 2 แต่ยาว 10 ตัว เด็กที่เพิ่งหัดอ่านสะกดไม่ไหวถึงจะรู้จักผลไม้
 * ส่วน `ripe` ระดับ 1 ยาว 4 ตัว อ่านออกทันที
 *
 * คืนเด็คเดิมถ้ากรองแล้วเหลือน้อยเกินไป — เด็คที่ไม่มีคำง่ายพอ (เช่นศัพท์การเงิน)
 * ไม่ควรถูกบีบจนตัวลวงวนซ้ำคำเดิมทุกข้อ ยอมให้โหมดเด็กไม่มีผลดีกว่าเกมพัง
 */
export function kidsDeck(deck) {
  // deck วิชาไม่มีแกน "ระดับ/ความยาวคำอังกฤษ" ให้กรอง — คืนทั้งชุดไปตรง ๆ
  // (โหมดเด็กยังมีผลกับความเร็ว ซึ่งเป็นส่วนที่ช่วยได้จริงสำหรับโจทย์ยาว)
  if (isSubjectDeck(deck)) return deck;
  const { tiers, minWords } = CFG.kids;
  let best = null;
  for (const { maxLevel, maxLetters } of tiers) {
    const words = deck.words.filter(w =>
      (w.level ?? 2) <= maxLevel && (w.en?.length ?? 99) <= maxLetters
    );
    best = words;                       // จำขั้นล่าสุดไว้ เผื่อไม่มีขั้นไหนถึงเกณฑ์
    if (words.length >= minWords) return { ...deck, words };
  }
  // ไม่มีขั้นไหนได้คำพอ — ใช้ขั้นหลวมสุดถ้ายังพอเล่นได้ ไม่งั้นยอมคืนเด็คเต็ม
  // (ต้องมีอย่างน้อย 3 คำ ไม่งั้นตัวลวงจะซ้ำกับคำตอบ)
  return best && best.length >= 3 ? { ...deck, words: best } : deck;
}

export function zoneDeck(deck, levels) {
  if (isSubjectDeck(deck)) return deck;      // ไม่มีระดับให้แบ่งโซน
  if (!Array.isArray(levels) || !levels.length) return deck;
  const words = deck.words.filter(w => levels.includes(w.level ?? 2));
  if (words.length < 12) return deck;
  return { ...deck, words };
}

/**
 * @param {object} opts
 *   speechEnabled — เปิดโหมดฟังได้ไหม
 *   box — บังคับกลยุทธ์ตัวลวง (ใช้ตอน "รอบชิง" ที่ทุกเครื่องต้องได้โจทย์เหมือนกันเป๊ะ
 *         ถ้าปล่อยให้อ่านจากสถิติของแต่ละคน ตัวลวงจะไม่ตรงกันแม้เมล็ดสุ่มจะเดียวกัน)
 */
/**
 * ปั้นโจทย์ของ deck วิชา — ตัวเลือกมากับไฟล์ ไม่มีการปั้นตัวลวงเลย
 *
 * ทำไมไม่ให้ระบบปั้นตัวลวงเหมือนคำศัพท์? เพราะ "ความใกล้เคียง" ของคำตอบวิชา
 * ไม่ได้อยู่ที่รูปคำหรือชนิดคำ แต่อยู่ที่มโนทัศน์ที่ผู้เรียนมักสับสน (เช่น
 * "อยุธยา" กับ "ธนบุรี") ซึ่งเป็นความรู้ของคนออกข้อสอบ ไม่ใช่สิ่งที่ edit distance รู้
 * → ตัวเลือกจึงเป็นส่วนหนึ่งของ "เนื้อหา" ไม่ใช่ของ "เอนจิน"
 *
 * สิ่งเดียวที่สุ่มคือ *ลำดับเลน* เพื่อไม่ให้จำได้ว่าข้อนี้คำตอบอยู่เลนไหน
 */
export function buildSubjectQuestion(deck, answer, opts = {}, rand = Math.random) {
  const slots = shuffle(
    answer.choices.map((text, i) => ({ en: text, correct: i === answer.answer })),
    rand,
  );
  return {
    word: answer,
    options: slots.map(s => ({ en: s.en })),
    correctIndex: slots.findIndex(s => s.correct),
    mode: 'subject',
  };
}

/**
 * ปั้นโจทย์คำตรงข้าม (โหมดสอบ) — "คำตรงข้ามของ X คืออะไร"
 *
 * ตัวเลือกทุกใบเป็นคำ `ant`: คำตอบถูกคือ ant ของคำที่ถาม ตัวลวงคือ ant ของคู่อื่น
 * ⚠️ ตัวลวงต้องไม่ใช่คำในคู่ของโจทย์เอง — deck มีคู่กลับด้าน (dry—wet และ wet—dry)
 * ถ้าโจทย์คือ "wet" แล้วตัวลวงหยิบ ant ของคู่ dry—wet มา จะได้ "wet" ซ้ำกับโจทย์
 * หรือ "dry" ซ้ำกับคำตอบ = มีคำตอบถูกสองใบ/ตัวเลือกไร้สาระ
 *
 * โจทย์สลับภาษาแบบสุ่ม: ถามด้วยคำอังกฤษ (en) หรือคำไทย (th) — promptLang บอก HUD
 * ว่าจะโชว์ "คำตรงข้ามของ hot" หรือ "คำตรงข้ามของ ร้อน"
 * โหมดเป็น text เสมอ: โหมดสอบวัดการอ่าน ไม่มีเสียงและไม่มีรูป
 */
export function buildAntonymQuestion(deck, answer, opts = {}, rand = Math.random) {
  const seen = new Set([answer.ant, answer.en]);   // กันซ้ำทั้งกับคำตอบและตัวโจทย์
  const pool = [];
  for (const w of deck.words) {
    if (w.en === answer.en) continue;
    if (seen.has(w.ant) || w.ant === answer.th) continue;
    seen.add(w.ant);                                // dedupe ข้อความตัวเลือก (ant ซ้ำข้ามคู่ได้ เช่น slow)
    pool.push(w);
  }

  const distractors = shuffle(pool, rand).slice(0, 2)
    .map(w => ({ en: w.ant, th: w.antTh }));        // เก็บ antTh ไว้เผยคำแปลตอนเฉลย

  const options = shuffle(
    [{ en: answer.ant, th: answer.antTh }, ...distractors],
    rand,
  );
  return {
    word: answer,
    options,
    correctIndex: options.findIndex(o => o.en === answer.ant),
    mode: 'text',
    antonym: true,
    promptLang: rand() < 0.5 ? 'en' : 'th',
  };
}

export function buildQuestion(deck, answer, opts = {}, rand = Math.random) {
  if (isSubjectDeck(deck)) return buildSubjectQuestion(deck, answer, opts, rand);
  if (isAntonymDeck(deck)) return buildAntonymQuestion(deck, answer, opts, rand);

  const deckKey = playDeckId(deck);
  const box = opts.box ?? (isUnseen(deckKey, answer) ? 1 : statOf(deckKey, answer).box);

  // 1) ตั้งต้นจากคำชนิดเดียวกัน (คำนาม/กริยา/คุณศัพท์/กริยาวิเศษณ์)
  //    เพราะถ้าปนชนิดคำ ผู้เล่นจะเดาถูกจากไวยากรณ์แทนความหมาย
  let pool = deck.words.filter(w =>
    w.en !== answer.en && w.pos === answer.pos && !meaningsClash(w, answer)
  );

  // ถ้าชนิดคำนั้นมีน้อยเกินไป ค่อยขยายไปทุกชนิด (ไม่งั้นตัวลวงจะซ้ำจนจำได้)
  if (pool.length < CFG.distractor.minCandidatePool) {
    pool = deck.words.filter(w => w.en !== answer.en && !meaningsClash(w, answer));
  }

  let ranked;
  if (box >= 3) {
    // แม่นแล้ว → เอาคำที่ "หน้าตาคล้าย" มาท้าทาย แต่ไม่คล้ายจนอ่านไม่ทัน
    ranked = pool
      .map(w => ({ w, s: similarity(w.en, answer.en) }))
      .filter(x => x.s >= CFG.distractor.similarMinRatio && x.s <= CFG.distractor.similarMaxRatio)
      .sort((a, b) => b.s - a.s)
      .map(x => x.w);
    if (ranked.length < 2) ranked = shuffle(pool, rand);   // ไม่มีคำคล้ายพอ ก็ถอยกลับไปสุ่ม
  } else if (box === 2) {
    // เริ่มได้ → คำระดับใกล้กัน (ยากพอ ๆ กัน)
    ranked = shuffle(pool, rand).sort(
      (a, b) => Math.abs((a.level ?? 2) - (answer.level ?? 2)) -
                Math.abs((b.level ?? 2) - (answer.level ?? 2))
    );
  } else {
    // คำใหม่ → คนละหมวดความหมาย เพื่อไม่ให้สับสนตั้งแต่เจอครั้งแรก
    const different = pool.filter(w => w.topic !== answer.topic);
    ranked = shuffle(different.length >= 2 ? different : pool, rand);
  }

  const distractors = ranked.slice(0, 2);
  while (distractors.length < 2) {
    // กันเหนียวสำหรับ deck จิ๋ว ๆ
    const filler = deck.words.find(
      w => w.en !== answer.en && !distractors.some(d => d.en === w.en)
    );
    if (!filler) break;
    distractors.push(filler);
  }

  const options = shuffle([answer, ...distractors], rand);
  return {
    word: answer,
    options,
    correctIndex: options.findIndex(o => o.en === answer.en),
    mode: opts.mode ?? chooseMode(answer, opts, rand),
  };
}
