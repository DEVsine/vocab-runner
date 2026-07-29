/**
 * practice.js — โหมดฝึก: สอนคำใหม่ทีละชุด แล้วออกวิ่งกับคำชุดนั้นล้วน ๆ
 *
 * วงจรการฝึก (ตามหลัก teach → retrieve → repeat):
 *   1) สอน 10 คำ (การ์ดทีละคำ: เห็นคำ+คำแปล+รูป+เสียง)
 *   2) วิ่งกับ 10 คำนั้น — แต่ละคำเจอ 2 ครั้ง คนละรูปแบบโจทย์ (อ่าน/ดูรูป/ฟัง)
 *      เพราะการ "ดึงความจำ" (retrieval) ผ่านหลายช่องทางคือสิ่งที่ทำให้จำติด
 *      ไม่ใช่การเห็นซ้ำเฉย ๆ
 *   3) ตอบผิด = ไม่ตาย แค่คำนั้นวนกลับมาถามใหม่ท้ายคิว — ฝึกจนกว่าจะได้
 *   4) ครบทุกคำ → สรุปผล → สอนชุดถัดไป (คำใหม่ถูกเลือกจากสถิติ SRS เสมอ)
 *
 * ── "ดูจากการเรียนของเขาว่าควรเสริมคำอะไร" ──
 * ใช้ข้อมูล Leitner ที่เกมเก็บอยู่แล้ว: คำที่ยังไม่เคยเจอมาก่อน → คำที่พลาดบ่อย
 * (กล่อง 1) → กล่อง 2 → กล่อง 3 ดังนั้นยิ่งเล่น ชุดฝึกยิ่งตรงจุดอ่อนของคนคนนั้น
 */

import { statOf, isUnseen } from './srs.js';

export const PRACTICE_BATCH = 10;

/** เลือกคำสำหรับชุดฝึกถัดไป — จุดอ่อนก่อนเสมอ (ยังไม่เจอ → กล่อง 1 → 2 → 3) */
export function pickPracticeWords(deck, n = PRACTICE_BATCH) {
  const rank = w => (isUnseen(deck.id, w.en) ? 0 : statOf(deck.id, w.en).box);
  const jitter = new Map(deck.words.map(w => [w.en, Math.random()]));  // สุ่มลำดับในกลุ่มเดียวกัน
  const sorted = [...deck.words].sort(
    (a, b) => rank(a) - rank(b) || jitter.get(a.en) - jitter.get(b.en)
  );
  return sorted.slice(0, Math.min(n, sorted.length));
}

/**
 * สร้างคิวโจทย์ของรอบวิ่งฝึก: แต่ละคำ 2 ข้อ คนละโหมด, สลับคำไม่ให้คำเดิมติดกัน
 * @returns {Array<{word:object, mode:string}>}
 */
export function buildPracticeQueue(words, { speechOk = false } = {}) {
  const shuffle = arr => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const round1 = [];
  const round2 = [];
  for (const w of words) {
    const modes = shuffle(['text', ...(w.emoji ? ['image'] : []), ...(speechOk ? ['audio'] : [])]);
    round1.push({ word: w, mode: modes[0] });
    round2.push({ word: w, mode: modes[1 % modes.length] });   // คำที่มีโหมดเดียวก็ซ้ำโหมดเดิม
  }
  return [...shuffle(round1), ...shuffle(round2)];
}
