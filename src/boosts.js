/**
 * boosts.js — ไอเทมแบบ "มีเวลาหมดอายุ" (แม่เหล็ก / คะแนน ×2) — EZL-71
 *
 * ไฟล์นี้ตั้งใจให้ "บริสุทธิ์" แบบเดียวกับ bonus.js: ไม่รู้จัก three.js, ไม่รู้จัก DOM
 * มันถือแค่ความจริงเดียว: "ตอนนี้ผลอะไรทำงานอยู่ และเหลือเวลาเท่าไร"
 * ส่วนผลลัพธ์จริง (ดูดเหรียญ, คูณคะแนน) เป็นหน้าที่ของคนอ่านสถานะ (main.js / pickups.js)
 *
 * ── ต่างจากเกราะ/ไอพ่น (pickups.js + run.jets) ยังไง ──
 * เกราะเป็นของ "สะสมเป็นชิ้น แล้วกดใช้เอง" — สถานะคือจำนวนเต็มในคลัง
 * ไอเทมชุดนี้เป็นของ "เก็บแล้วทำงานทันที แล้วหมดอายุเอง" — สถานะคือนาฬิกาถอยหลัง
 * สองคอนเซ็ปต์นี้อย่าพยายามยุบเป็นระบบเดียว: เงื่อนไขรีเซ็ต/ซ้อน/หมดเวลา
 * ของฝั่งนาฬิกาไม่มีความหมายกับฝั่งคลังเลย ยุบแล้วได้ if พันกันเปล่า ๆ
 *
 * ── กติกาจากใบงาน ──
 *   เก็บชนิดเดิมซ้ำระหว่างผลยังไม่หมด = รีเซ็ตเวลา "เต็มใหม่" (ไม่บวกสะสม)
 *   สองชนิดทำงานพร้อมกันได้ นาฬิกาแยกกันเดิน
 *   ตัวคูณคะแนนประกอบกันแบบ "คูณ" — ×2 เจอตัวคูณด่านโบนัส (2) = 4 เท่า
 *   สถานะ {ชนิด, เวลาคงเหลือ ms} ต้องเปิดให้ HUD อ่าน (EZL-70 เป็นคนวาด)
 */

import { CFG } from './config.js';

export const BOOST = { MAGNET: 'magnet', X2: 'x2' };

/**
 * @param {Record<string, {durationSeconds: number, multiplier?: number}>} items
 *        ก้อนตั้งค่าต่อไอเทม — ปริยายคือ CFG.boosts.items (inject ได้ตอนเทสต์)
 */
export function createBoosts(items = CFG.boosts.items) {
  /** @type {Map<string, number>} ชนิด → เวลาคงเหลือ (ms) — มีเฉพาะที่กำลังทำงาน */
  const remaining = new Map();

  return {
    /** เก็บไอเทม: เริ่มผลทันที / ถ้าผลเดิมยังไม่หมด = รีเซ็ตกลับไปเต็มเวลา */
    activate(type) {
      const cfg = items[type];
      if (!cfg) throw new Error(`unknown boost type: ${type}`);
      remaining.set(type, cfg.durationSeconds * 1000);
    },

    /**
     * เดินนาฬิกาด้วย dt ของลูปหลัก (วินาที)
     * @returns {string[]} ชนิดที่ "เพิ่งหมดผลในเฟรมนี้" — รายงานครั้งเดียว ไว้ต่อเสียง/เอฟเฟกต์
     */
    tick(dt) {
      const expired = [];
      for (const [type, ms] of remaining) {
        const left = ms - dt * 1000;
        if (left > 0) remaining.set(type, left);
        else { remaining.delete(type); expired.push(type); }
      }
      return expired;
    },

    isActive: type => remaining.has(type),

    /**
     * ตัวคูณคะแนนรวมจากไอเทมที่ทำงานอยู่ — ประกอบกันแบบ "คูณ"
     * แม่เหล็กไม่มี multiplier ใน config = คูณ 1 (ไม่ยุ่งกับคะแนน)
     * ทุกเส้นทางคิดคะแนนต้องผ่านค่านี้จุดเดียว (ดู addScore ใน main.js)
     */
    scoreMultiplier() {
      let m = 1;
      for (const type of remaining.keys()) m *= items[type].multiplier ?? 1;
      return m;
    },

    /** สถานะสำหรับ HUD: [{ type, remainingMs }] — EZL-70 เป็นคนวาดนับถอยหลัง */
    active() {
      return [...remaining].map(([type, remainingMs]) => ({ type, remainingMs }));
    },

    /** ล้างทุกผล — ใช้ตอนเริ่มรอบใหม่ */
    reset() { remaining.clear(); },
  };
}
