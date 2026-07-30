/**
 * inbox.js — "กล่องคำที่พลาด" ที่ส่งต่อจากเกมจริงเข้าสู่โหมดฝึก
 *
 * ── กับดักที่ไฟล์นี้มีไว้แก้ ──
 * ใน Battle Royale คนที่ตกรอบเร็วที่สุดคือคนที่รู้ศัพท์น้อยที่สุด
 * แต่ถ้าไม่ทำอะไรเลย เขาจะกลายเป็นคนที่ "ได้ฝึกน้อยที่สุด" ด้วย
 * (ตายไว = เจอคำน้อย = เรียนน้อย) — วงจรนี้ทำให้คนที่ต้องการเกมนี้มากที่สุด
 * ได้ประโยชน์จากมันน้อยที่สุด ซึ่งเป็นความล้มเหลวของเกมสอน ไม่ใช่ของเกม
 *
 * ทางแก้: ทุกคำที่พลาด (ตอบผิด/ตายเพราะคำนั้น/แพ้ศึกชิงคำ) จะถูกหย่อนลงกล่องนี้
 * แล้วโหมดฝึกจะ "ตักจากกล่องก่อนเสมอ" → ยิ่งตายเร็ว ยิ่งได้ซ้อมตรงจุดที่พลาด
 *
 * เก็บเป็นรายการ en เรียงตามลำดับที่พลาด (ล่าสุดอยู่ท้าย) แยกตาม deck
 * และตัดหางทิ้งเมื่อยาวเกิน MAX — กล่องนี้คือ "คิวงานที่ค้าง" ไม่ใช่ประวัติศาสตร์
 */

const KEY = 'vocab-runner:inbox:v1';
const MAX = 60;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch { /* โหมดส่วนตัวเขียนไม่ได้ — ไม่ใช่เรื่องคอขาดบาดตาย */ }
}

/** หย่อนคำที่พลาดลงกล่อง (ซ้ำได้ แต่จะถูกยุบเหลือครั้งเดียวโดยเลื่อนไปท้ายคิว) */
export function addMissed(deckId, ens) {
  const list = Array.isArray(ens) ? ens : [ens];
  const clean = list.filter(Boolean);
  if (!clean.length) return;

  const data = load();
  const cur = data[deckId] || [];
  // เอาของเดิมออกก่อนแล้วต่อท้าย = คำที่พลาดซ้ำจะถูกดัน "ขึ้นหน้า" ในคิวฝึก
  const next = cur.filter(en => !clean.includes(en)).concat(clean);
  data[deckId] = next.slice(-MAX);
  save(data);
}

/** ดูว่ามีคำค้างกี่คำ (ใช้โชว์ป้ายบนปุ่มโหมดฝึก) */
export function pendingCount(deckId) {
  return (load()[deckId] || []).length;
}

/** รายการคำที่ค้าง เรียง "พลาดล่าสุดก่อน" */
export function pending(deckId) {
  return (load()[deckId] || []).slice().reverse();
}

/** เอาคำออกจากกล่องเมื่อฝึกจนตอบถูกแล้ว */
export function clearWords(deckId, ens) {
  const list = new Set(Array.isArray(ens) ? ens : [ens]);
  const data = load();
  if (!data[deckId]) return;
  data[deckId] = data[deckId].filter(en => !list.has(en));
  save(data);
}

export function clearDeck(deckId) {
  const data = load();
  delete data[deckId];
  save(data);
}
