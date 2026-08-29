/**
 * srs.js — ระบบจำว่าคุณแม่นคำไหนแล้ว (Leitner 3 กล่อง)
 *
 * ทำไมเป็น Leitner ไม่ใช่ SM-2 แบบ Anki?
 * SM-2 คำนวณ "วันที่ควรทบทวนครั้งหน้า" ซึ่งเหมาะกับการเปิดวันละครั้ง
 * แต่เกมนี้เล่นรอบละ 1-2 นาที เจอคำสิบกว่าคำรวด — หน่วยเวลาที่ถูกต้อง
 * จึงเป็น "ความถี่ที่คำจะถูกสุ่มมา" ไม่ใช่ "วันที่"
 *
 *   กล่อง 1 = ยังไม่แม่น  → โผล่บ่อยสุด, ตัวลวงใจดี
 *   กล่อง 2 = เริ่มได้     → โผล่ปานกลาง
 *   กล่อง 3 = แม่นแล้ว    → โผล่นาน ๆ ครั้ง, ตัวลวงหน้าตาคล้ายเพื่อทดสอบจริง
 *   ตอบถูก → เลื่อนขึ้น 1 กล่อง / ตอบผิด → ตกกลับกล่อง 1 ทันที
 *
 * ⚠️ localStorage เป็น synchronous API — เขียนทีนึงคือหยุด main thread รอ
 * ห้ามเรียกทุกเฟรมเด็ดขาด ไฟล์นี้จึงเขียนเฉพาะตอน "ตอบถูก/ผิด/จบรอบ"
 *
 * ⚠️ localStorage ผูกกับ origin — ถ้าเปลี่ยนพอร์ตจาก 8000 เป็น 8001
 * สถิติจะ "หายไป" (จริง ๆ ยังอยู่ แต่คนละบ้าน) → ใช้พอร์ตเดิมเสมอ
 */

import { CFG } from './config.js';

const EMPTY = { version: 1, decks: {}, best: {} };

/**
 * กุญแจถาวรของ "หนึ่งข้อ" ในชุดใด ๆ
 *
 * ⚠️ ทำไมไม่ตั้งฟิลด์ `id` ให้ deck คำศัพท์เดิมแล้วเขียน migration:
 * สถิติของผู้เล่นอยู่ใน localStorage ของเครื่องเขา ไม่ใช่ในไฟล์ที่เราคุมได้
 * ถ้าเปลี่ยนกุญแจ ผู้เล่นเดิมจะ "เปิดมาแล้วสถิติหายหมด" ซึ่งเป็นความเสียหาย
 * ที่กู้คืนไม่ได้และมองไม่เห็นตอนรีวิวโค้ด
 * → กติกาจึงเป็น "ใช้ id ถ้ามี ไม่มีก็ใช้ en" ทำให้ deck ศัพท์เดิมได้กุญแจ
 *   ชุดเดิมเป๊ะโดยไม่ต้อง migrate อะไรเลย ส่วน deck วิชาใช้ id ของตัวเอง
 *
 * รับได้ทั้ง string (โค้ดเก่าที่ส่ง en มาตรง ๆ) และ object ของข้อ
 */
export function itemId(item) {
  if (typeof item === 'string') return item;
  return item?.id ?? item?.en ?? '';
}

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(CFG.storageKey);
    state = raw ? { ...EMPTY, ...JSON.parse(raw) } : structuredClone(EMPTY);
  } catch (err) {
    console.warn('[srs] อ่านสถิติเดิมไม่ได้ เริ่มใหม่:', err);
    state = structuredClone(EMPTY);
  }
  if (!state.decks) state.decks = {};
  if (!state.best) state.best = {};
  return state;
}

function persist() {
  try {
    localStorage.setItem(CFG.storageKey, JSON.stringify(load()));
  } catch (err) {
    console.warn('[srs] บันทึกสถิติไม่สำเร็จ:', err);
  }
}

function deckStats(deckId) {
  const s = load();
  if (!s.decks[deckId]) s.decks[deckId] = {};
  return s.decks[deckId];
}

/** สถิติของหนึ่งข้อ (ข้อที่ยังไม่เคยเจอจะได้ box 1 และ seen 0) */
export function statOf(deckId, item) {
  return deckStats(deckId)[itemId(item)] || { box: 1, seen: 0, correct: 0, wrong: 0, last: 0 };
}

export function isUnseen(deckId, item) {
  return !deckStats(deckId)[itemId(item)];
}

/** บันทึกผลการตอบ 1 ครั้ง แล้วขยับกล่อง */
export function record(deckId, item, correct) {
  const key = itemId(item);
  const stats = deckStats(deckId);
  const cur = stats[key] || { box: 1, seen: 0, correct: 0, wrong: 0, last: 0 };

  cur.seen += 1;
  cur.last = Date.now();
  if (correct) {
    cur.correct += 1;
    cur.box = Math.min(CFG.srs.boxCount, cur.box + 1);
  } else {
    cur.wrong += 1;
    cur.box = 1;   // ผิดทีเดียวตกลงกล่องแรกเสมอ — ความแม่นต้องพิสูจน์ใหม่
  }

  stats[key] = cur;
  persist();
  return cur;
}

/* ── สถิติสูงสุดต่อ deck ────────────────────────────────────── */

export function getBest(deckId) {
  return load().best[deckId] || { score: 0, gates: 0 };
}

export function submitScore(deckId, score, gates) {
  const s = load();
  const best = s.best[deckId] || { score: 0, gates: 0 };
  const improved = score > best.score;
  s.best[deckId] = {
    score: Math.max(best.score, score),
    gates: Math.max(best.gates, gates),
  };
  persist();
  return improved;
}

/* ── สรุปผลสำหรับหน้าสถิติ ─────────────────────────────────── */

export function summarize(deck) {
  const deckId = deck.statsId ?? deck.id;
  const stats = deckStats(deckId);
  const rows = deck.words.map(word => {
    const st = stats[itemId(word)];
    return {
      // deck วิชาไม่มีคำอังกฤษ — ตัว normalize ใน deck.js จึงเติม en/th ให้เป็น
      // "โจทย์/ใบความรู้" เพื่อให้หน้าสถิติเดิมอ่านได้โดยไม่ต้องมีสองเส้นทาง
      en: word.en,
      th: word.th,
      box: st ? st.box : 0,          // 0 = ยังไม่เคยเจอ
      seen: st ? st.seen : 0,
      correct: st ? st.correct : 0,
      wrong: st ? st.wrong : 0,
    };
  });

  // เรียงคำที่ควรซ้อมก่อน: ผิดเยอะสุดขึ้นก่อน แล้วค่อยคำที่อยู่กล่องต่ำ
  rows.sort((a, b) => (b.wrong - a.wrong) || (a.box - b.box) || b.seen - a.seen);

  return {
    rows,
    total: deck.words.length,
    seen: rows.filter(r => r.seen > 0).length,
    mastered: rows.filter(r => r.box === CFG.srs.boxCount).length,
    struggling: rows.filter(r => r.box === 1 && r.seen > 0).length,
  };
}

/* ── นำเข้า/ส่งออก (กันสถิติหายตอนล้างเบราว์เซอร์) ──────────── */

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

export function importJSON(text) {
  const incoming = JSON.parse(text);
  if (!incoming || typeof incoming !== 'object' || !incoming.decks) {
    throw new Error('ไฟล์นี้ไม่ใช่สถิติของ Vocab Runner');
  }
  state = { ...EMPTY, ...incoming };
  persist();
  return state;
}

export function resetDeck(deckId) {
  const s = load();
  delete s.decks[deckId];
  delete s.best[deckId];
  persist();
}
