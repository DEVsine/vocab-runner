/**
 * practice.js — โหมดฝึก: สอนคำใหม่ทีละชุด แล้วออกวิ่งกับคำชุดนั้นล้วน ๆ
 *
 * วงจรการฝึก (ตามหลัก teach → retrieve → repeat):
 *   1) สอนคำทีละใบ (เห็นคำ+คำแปล+รูป+เสียง)
 *   2) วิ่งกับคำชุดนั้น — คนละรูปแบบโจทย์ (อ่าน/ดูรูป/ฟัง)
 *      เพราะการ "ดึงความจำ" (retrieval) ผ่านหลายช่องทางคือสิ่งที่ทำให้จำติด
 *      ไม่ใช่การเห็นซ้ำเฉย ๆ
 *   3) ตอบผิด = ไม่ตาย แค่คำนั้นวนกลับมาถามใหม่ท้ายคิว — ฝึกจนกว่าจะได้
 *   4) ครบทุกคำ → สรุปผล → ชุดถัดไป
 *
 * ── สองอย่างที่ห้องซ้อมต้อง "ไม่มี" ──
 * ไม่มีเหรียญ ไม่มีเกราะ ไม่มีดาว ไม่มีตาย
 * ของสะสมคือรางวัลที่ดีในเกมจริง แต่ในห้องซ้อมมันคือคู่แข่งของความสนใจ:
 * ทุกวินาทีที่สายตาไปอยู่ที่แถวเหรียญ คือวินาทีที่ไม่ได้อยู่กับตัวคำ
 * ห้องซ้อมที่ดีต้องมีสิ่งเดียวให้สนใจ
 *
 * ── "คำที่ต้องทวน" ต้องมาบ่อยกว่า ──
 * ความถี่ในการฝึกต้องแปรผกผันกับความแม่น ไม่ใช่เท่ากันหมด:
 *   ชุดคำถูกเลือกโดยสงวนช่องส่วนใหญ่ให้ "คำที่พลาดมาแล้ว" ก่อนคำใหม่
 *   และภายในรอบวิ่ง คำที่ไม่แม่นจะถูกถามซ้ำมากครั้งกว่าคำที่แม่นแล้ว
 * คำที่ตอบผิดในเกมจริงจะไหลเข้ามาทาง inbox.js โดยอัตโนมัติ
 */

import { CFG } from './config.js';
import { playDeckId } from './deck.js';
import { statOf, isUnseen, itemId } from './srs.js';
import { pending as inboxPending } from './inbox.js';

export const PRACTICE_BATCH = CFG.practice.batch;

function shuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 0 = ยังไม่เคยเจอ, 1–3 = กล่อง Leitner */
function boxOf(deckId, item) {
  return isUnseen(deckId, item) ? 0 : statOf(deckId, item).box;
}

/**
 * เลือกคำสำหรับชุดฝึกถัดไป
 *
 * ลำดับความสำคัญ (สูง→ต่ำ):
 *   1) คำที่เพิ่งพลาดในเกมจริง (มาจากกล่อง inbox — ตายเพราะคำไหน ได้ซ้อมคำนั้น)
 *   2) คำที่เคยเจอแต่ยังไม่แม่น (กล่อง 1 ก่อน แล้วกล่อง 2) เรียงตามจำนวนครั้งที่ผิด
 *   3) คำใหม่ที่ยังไม่เคยเจอ
 * โดยสงวน "อย่างน้อย" reviewSlots ช่องแรกไว้ให้กลุ่ม 1–2 เสมอ
 * ถ้าไม่มีคำต้องทวนเลย (ผู้เล่นใหม่) ชุดจะกลายเป็นคำใหม่ล้วนโดยอัตโนมัติ
 */
export function pickPracticeWords(deck, n = PRACTICE_BATCH) {
  const deckKey = playDeckId(deck);
  const byId = new Map(deck.words.map(w => [itemId(w), w]));

  // 1) ข้อที่พลาดล่าสุดจากเกมจริง (เรียงตามลำดับที่พลาด ล่าสุดก่อน)
  const fromInbox = inboxPending(deckKey).map(id => byId.get(id)).filter(Boolean);

  const inInbox = new Set(fromInbox.map(w => itemId(w)));
  const seen = deck.words.filter(w => !inInbox.has(itemId(w)) && !isUnseen(deckKey, w));
  // คำใหม่คงลำดับของเด็ค (สั้น→ยาวภายในแต่ละระดับ) ไม่สุ่ม — เด็กได้เจอคำสั้นก่อน
  const fresh = deck.words.filter(w => !inInbox.has(itemId(w)) && isUnseen(deckKey, w));

  // 2) ข้อที่เคยเจอแต่ยังไม่แม่น — ผิดเยอะสุดก่อน แล้วกล่องต่ำสุด
  const review = seen
    .filter(w => statOf(deckKey, w).box < CFG.srs.boxCount)
    .sort((a, b) => {
      const sa = statOf(deckKey, a);
      const sb = statOf(deckKey, b);
      return (sb.wrong - sa.wrong) || (sa.box - sb.box) || (sa.last - sb.last);
    });

  const reviewQueue = [...fromInbox, ...review];
  const out = [];
  const take = (list, count) => {
    for (const w of list) {
      if (out.length >= n || count <= 0) break;
      if (out.some(x => itemId(x) === itemId(w))) continue;
      out.push(w);
      count -= 1;
    }
  };

  take(reviewQueue, Math.min(CFG.practice.reviewSlots, n));   // ทวนก่อน
  take(fresh, n - out.length);                                 // แล้วเติมคำใหม่
  take(reviewQueue, n - out.length);                           // คำใหม่หมดแล้ว → ทวนเพิ่ม
  // 3) เกมมาถึงตรงนี้แปลว่า deck เล็กมาก — เติมด้วยอะไรก็ได้ที่เหลือ
  take(shuffle(deck.words.filter(w => statOf(deckKey, w).box >= CFG.srs.boxCount)), n - out.length);

  return out;
}

/**
 * สร้างคิวโจทย์ของรอบวิ่งฝึก
 *
 * จำนวนครั้งที่แต่ละคำถูกถาม = ฟังก์ชันของความไม่แม่น (repsByBox)
 *   ยังไม่เคยเจอ → 2 ครั้ง | กล่อง 1 → 3 ครั้ง | กล่อง 2 → 2 | กล่อง 3 → 1
 *
 * ⚠️ วิธีเรียงสำคัญพอ ๆ กับจำนวนครั้ง: เราไม่ได้เอาคำเดิมมาต่อกันรัว ๆ
 * (การถามซ้ำติดกันคือการทดสอบ "ความจำระยะสั้น" ซึ่งไม่ได้แปลว่าจำได้จริง)
 * แต่จัดเป็น "รอบ" — รอบที่ r บรรจุทุกคำที่ยังเหลือครั้งมากกว่า r แล้วสับไพ่ในรอบ
 * ผลคือคำที่ไม่แม่นจะโผล่ในรอบท้าย ๆ ด้วย = ได้ระยะห่างก่อนถูกถามซ้ำเสมอ
 */
export function buildPracticeQueue(words, { speechOk = false, deckId = '' } = {}) {
  const plan = words.map(w => {
    const box = boxOf(deckId, w);
    const reps = CFG.practice.repsByBox[box] ?? 2;
    /* ⚠️ deck วิชามีรูปแบบโจทย์เดียว — ห้ามสลับ text/image/audio
     * เพราะสามโหมดนั้นแปลว่า "เห็นคำแปล / เห็นรูป / ได้ยินคำ" ซึ่งเป็นการ
     * มองคำศัพท์จากหลายช่องทาง แต่โจทย์วิชาคือคำถามหนึ่งคำถามที่มีตัวเลือกตายตัว
     * ถ้าถูกตั้งเป็นโหมด image มันจะไม่มีรูปให้ดู = โจทย์ว่างเปล่าที่ตอบไม่ได้ */
    const modes = w.subject
      ? ['subject']
      : shuffle(['text', ...(w.emoji ? ['image'] : []), ...(speechOk ? ['audio'] : [])]);
    return { word: w, reps, modes };
  });

  const maxReps = plan.reduce((m, p) => Math.max(m, p.reps), 0);
  const queue = [];
  for (let r = 0; r < maxReps; r++) {
    const round = plan
      .filter(p => p.reps > r)
      .map(p => ({ word: p.word, mode: p.modes[r % p.modes.length] }));
    queue.push(...shuffle(round));
  }
  return queue;
}
