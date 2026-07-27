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
import { statOf, isUnseen } from './srs.js';

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
  const res = await fetch(`./decks/${file}`, NO_CACHE);
  if (!res.ok) throw new Error(`โหลด deck "${file}" ไม่ได้ (HTTP ${res.status})`);
  const deck = await res.json();
  if (!Array.isArray(deck.words) || deck.words.length < 4) {
    throw new Error(`deck "${file}" ต้องมีคำอย่างน้อย 4 คำ`);
  }
  return deck;
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
  const pool = deck.words.filter(w => !recent.has(w.en));
  const candidates = pool.length >= 4 ? pool : deck.words;

  const weights = candidates.map(w => {
    if (isUnseen(deck.id, w.en)) return CFG.srs.unseenWeight;
    return CFG.srs.boxWeights[statOf(deck.id, w.en).box] ?? 1;
  });

  const total = weights.reduce((sum, x) => sum + x, 0);
  let roll = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
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
export function chooseMode(word, { speechEnabled = true } = {}, rand = Math.random) {
  const w = CFG.question.weights;
  const pool = [['text', w.text]];
  if (word.emoji) pool.push(['image', w.image]);
  if (speechEnabled) pool.push(['audio', w.audio]);

  const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rand() * total;
  for (const [mode, weight] of pool) {
    roll -= weight;
    if (roll <= 0) return mode;
  }
  return 'text';
}

export function buildQuestion(deck, answer, opts = {}, rand = Math.random) {
  const box = isUnseen(deck.id, answer.en) ? 1 : statOf(deck.id, answer.en).box;

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
    mode: chooseMode(answer, opts, rand),
  };
}
