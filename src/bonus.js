/**
 * bonus.js — ตัวจัดตารางของด่านโบนัส "ทางช้างเผือก"
 *
 * ไฟล์นี้ตั้งใจให้ "บริสุทธิ์" คือไม่รู้จัก three.js, ไม่รู้จัก DOM
 * มันทำหน้าที่เดียว: บอกว่า "วินาทีที่เท่าไร ควรมีอะไรมาถึงตัวผู้เล่น"
 * ส่วนการสร้างวัตถุจริงเป็นหน้าที่ของ main.js
 *
 * แยกแบบนี้เพราะการออกแบบ "ลวดลายเหรียญ" เป็นงานที่ต้องลองผิดลองถูกเยอะ
 * ถ้ามันพันอยู่กับโค้ดเรนเดอร์ จะแก้ทีต้องกลัวพังทั้งเกม
 *
 * ── ปรัชญาของด่านโบนัส ──
 * หน้าที่ของมันคือ "ปลดความกดดัน" (pacing relief) ไม่ใช่ความท้าทายอีกชั้น
 * เกมที่กดดันตลอดเวลาจะทำให้คนเลิกเล่นเร็ว เพราะไม่มีจังหวะให้รู้สึกเก่ง
 * ด่านโบนัสคือรางวัลของการเล่นดี — ต้องไม่มีอะไรฆ่าผู้เล่นได้เลย
 */

import { CFG } from './config.js';

const LANES = [0, 1, 2];

/** ลวดลายการวางเหรียญ — คืน array ของ { lane, high } เรียงตามลำดับเวลา */
const PATTERNS = {
  /** เส้นตรงยาว ๆ ในเลนเดียว ระดับเดียว — ให้ได้หายใจ */
  line(rand) {
    const lane = LANES[Math.floor(rand() * 3)];
    const high = rand() < 0.5;
    return Array.from({ length: 10 + Math.floor(rand() * 5) }, () => ({ lane, high }));
  },

  /** ไล่ซ้าย→ขวา→ซ้าย เหมือนคลื่น บังคับให้ขยับตลอด */
  wave(rand) {
    const out = [];
    const seq = rand() < 0.5 ? [0, 1, 2, 1] : [2, 1, 0, 1];
    for (let i = 0; i < 16; i++) out.push({ lane: seq[i % seq.length], high: false });
    return out;
  },

  /** สลับสูง-ต่ำในเลนเดียว — ฝึกใช้ปุ่มขึ้น/ลงตอนบิน */
  ladder(rand) {
    const lane = LANES[Math.floor(rand() * 3)];
    return Array.from({ length: 14 }, (_, i) => ({ lane, high: Math.floor(i / 3) % 2 === 1 }));
  },

  /** โค้งขึ้นแล้วลง เหมือนสะพานดาว */
  arc(rand) {
    const lane = LANES[Math.floor(rand() * 3)];
    const out = [];
    for (let i = 0; i < 12; i++) out.push({ lane, high: i > 2 && i < 9 });
    return out;
  },
};

const PATTERN_NAMES = Object.keys(PATTERNS);

/**
 * วางแผนทั้งด่านโบนัสไว้ล่วงหน้าเป็นรายการเหตุการณ์ตาม "เวลามาถึง"
 * @returns {{duration:number, events:Array<{time:number, kind:string, lane:number, high:boolean}>}}
 */
export function planBonus(jokeCount, rand = Math.random) {
  const duration = CFG.bonus.durationSeconds;
  const events = [];

  // แทรกมุกกวนให้ห่างกันพอสมควร และเว้นหัว-ท้ายไว้
  const jokeTimes = [];
  if (CFG.bonus.jokeGates && jokeCount > 0) {
    for (let i = 0; i < jokeCount; i++) {
      jokeTimes.push(duration * ((i + 1) / (jokeCount + 1)));
    }
  }
  for (const time of jokeTimes) events.push({ time, kind: 'joke', lane: 1, high: false });

  // เติมเหรียญเป็นลวดลายต่อกันไปเรื่อย ๆ จนเต็มเวลา
  // เว้นช่วงรอบ ๆ มุกกวนไว้ ไม่งั้นผู้เล่นจะต้องอ่านคำถามพร้อมไล่เก็บเหรียญ
  const CLEAR_AROUND_JOKE = 1.1;
  let t = 0.8;
  while (t < duration - 0.8) {
    const pattern = PATTERNS[PATTERN_NAMES[Math.floor(rand() * PATTERN_NAMES.length)]](rand);
    for (const coin of pattern) {
      if (t >= duration - 0.8) break;
      const nearJoke = jokeTimes.some(jt => Math.abs(jt - t) < CLEAR_AROUND_JOKE);
      if (!nearJoke) events.push({ time: t, kind: 'coin', lane: coin.lane, high: coin.high });
      t += CFG.bonus.coinGapSeconds;
    }
    t += 0.45;   // เว้นช่องระหว่างลวดลาย ให้ตาแยกออกว่าเป็นคนละชุด
  }

  events.sort((a, b) => a.time - b.time);
  return { duration, events };
}
