/**
 * exam-progress.js — จำว่า "สอบไปถึงข้อไหนแล้ว" ข้ามรอบ
 *
 * ── ปัญหาที่ไฟล์นี้แก้ ──
 * โหมดสอบมีเดิมพันจริง: ตอบผิดหรือชนอุปสรรค = จบรอบทันที (มันคือการสอบ ไม่ใช่ห้องซ้อม)
 * แต่ถ้าตายแล้วต้องเริ่มนับหนึ่งใหม่ ข้อสอบ 100 ข้อจะกลายเป็นข้อสอบที่ไม่มีใครทำจบ —
 * และที่แย่กว่านั้นคือ **ข้อ 1-50 ที่พิสูจน์มาแล้วถูกลบทิ้ง** ทั้งที่ความรู้นั้นไม่ได้หายไปไหน
 *
 * เส้นแบ่งที่ถูกต้องคือ: การตายควรลบ *ความคืบหน้าของรอบนั้น* (ต้องออกตัวใหม่)
 * ไม่ใช่ลบ *ผลการวัดที่เกิดขึ้นแล้ว* — ข้อที่ตอบไปแล้วคือข้อมูลที่จริงไปแล้ว
 *
 * ⚠️ localStorage เป็น synchronous API — ห้ามเรียกทุกเฟรม
 * ไฟล์นี้เขียนเฉพาะตอน "ตัดสินหนึ่งข้อเสร็จ" (~5 วินาทีครั้ง) ซึ่งปลอดภัย
 * เหตุผลที่ต้องเขียนทุกข้อ ไม่ใช่เขียนตอนตาย: การตายบางแบบไม่ผ่านโค้ดของเรา
 * (ปิดแท็บ แบตหมด เบราว์เซอร์ crash) — checkpoint ที่เขียนตอนตายจึงไม่ใช่ checkpoint
 *
 * ⚠️ เก็บแยกจาก CFG.storageKey ของ srs.js โดยตั้งใจ
 * สถิติ Leitner คือ "รู้คำนี้แค่ไหน" (ข้ามชุด ข้ามโหมด) ส่วนไฟล์นี้คือ
 * "ทำข้อสอบชุดนี้ไปถึงไหน" (ผูกกับชุดเดียว และล้างทิ้งเมื่อสอบจบ)
 * ปนกันเมื่อไหร่ การล้างอย่างหนึ่งจะลบอีกอย่างโดยไม่มีใครตั้งใจ
 */

import { CFG } from './config.js';

const KEY = `${CFG.storageKey}:exam`;

/** ค่าเริ่มต้นของ "ยังไม่เคยสอบชุดนี้" — ต้องมีรูปร่างเดียวกับของที่โหลดมาเสมอ */
function empty() {
  return { at: 0, correct: 0, wrong: [] };
}

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};   // โหมดส่วนตัวของ Safari / ข้อมูลเสีย → เริ่มสอบใหม่ ไม่ใช่เกมพัง
  }
}

/**
 * อ่าน checkpoint ของชุดนี้
 *
 * @param deckId  กุญแจของชุด (playDeckId) — ต้องคงที่ข้ามรอบ ไม่งั้น checkpoint หาไม่เจอ
 * @param total   จำนวนข้อของชุดตอนนี้ ใช้ตรวจว่า checkpoint ยัง "เข้ากันได้" อยู่ไหม
 *
 * ⚠️ ต้องตรวจ total ด้วย เพราะไฟล์ deck แก้ได้ — วันที่มีคนลบคำออกจาก 100 เหลือ 80
 * checkpoint ที่ค้างอยู่ที่ข้อ 95 จะทำให้ผู้เล่นเปิดมาแล้วเจอ "สอบจบแล้ว" ทันที
 * โดยไม่มีอะไรอธิบาย → เกินขอบเขต = ถือว่าเริ่มใหม่ ปลอดภัยกว่าเดาว่าเจ้าของอยากได้อะไร
 */
export function load(deckId, total = Infinity) {
  const saved = readAll()[deckId];
  if (!saved || typeof saved.at !== 'number') return empty();
  if (saved.at < 0 || saved.at >= total) return empty();
  return {
    at: saved.at,
    correct: Math.min(saved.correct ?? 0, saved.at),
    wrong: Array.isArray(saved.wrong) ? saved.wrong : [],
  };
}

export function save(deckId, progress) {
  try {
    const all = readAll();
    all[deckId] = { at: progress.at, correct: progress.correct, wrong: progress.wrong };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* เขียนไม่ได้ = สอบต่อได้ปกติ แค่ไม่มี checkpoint — ห้ามทำให้เกมสะดุด */ }
}

export function clear(deckId) {
  try {
    const all = readAll();
    delete all[deckId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* เช่นเดียวกับ save */ }
}
