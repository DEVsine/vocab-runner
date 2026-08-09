/**
 * input.js — คีย์บอร์ด + ปัดนิ้ว แปลงเป็น "เจตนา" (action) กลาง ๆ
 *
 * ไฟล์นี้ไม่รู้จักเกมเลย มันรู้แค่ว่าผู้เล่นอยากทำอะไร
 * (แยก input ออกจาก logic = เพิ่มจอย/ปุ่มบนจอทีหลังได้โดยไม่แตะโค้ดเกม)
 *
 * ส่วน "input buffering" ไม่ได้อยู่ที่นี่ แต่อยู่ใน player.js
 * เพราะการเก็บปุ่มไว้ทำต่อ ต้องรู้ว่าตอนนี้ตัวละครกำลังทำอะไรอยู่
 */

import { CFG } from './config.js';

export const ACTIONS = {
  LEFT: 'left',
  RIGHT: 'right',
  JUMP: 'jump',
  SLIDE: 'slide',
  CONFIRM: 'confirm',   // Space / แตะจอ
  BACK: 'back',         // Esc
  FIRE: 'fire',         // F / ปุ่มยิงบนจอ — ยิงอาวุธใส่เป้าที่เล็งไว้
  SWITCH: 'switch',     // Q / แตะป้ายกระสุน — สลับชนิดกระสุน
};

/**
 * ⚠️ ต้องแมปด้วย e.code ไม่ใช่ e.key
 *
 * e.key = "ตัวอักษรที่พิมพ์ออกมา" ซึ่งขึ้นกับ layout ที่เลือกอยู่
 * ถ้าคุณสลับแป้นเป็นภาษาไทยแล้วกด W A S D จะได้ "ไ ฟ ห ก" → เกมจะไม่รับปุ่มเลย
 * e.code = "ปุ่มทางกายภาพ" (KeyW, KeyA…) ไม่เปลี่ยนตามภาษา จึงถูกต้องเสมอ
 *
 * นี่เป็นบั๊กที่คนไทยเจอบ่อยมากในเกมเว็บ และเจ้าของเกมมักหาไม่เจอ
 * เพราะตอนเทสต์ตัวเองใช้แป้นอังกฤษอยู่
 */
const CODE_MAP = {
  ArrowLeft: ACTIONS.LEFT,   KeyA: ACTIONS.LEFT,
  ArrowRight: ACTIONS.RIGHT, KeyD: ACTIONS.RIGHT,
  ArrowUp: ACTIONS.JUMP,     KeyW: ACTIONS.JUMP,
  ArrowDown: ACTIONS.SLIDE,  KeyS: ACTIONS.SLIDE,
  Space: ACTIONS.CONFIRM,
  Enter: ACTIONS.CONFIRM,
  NumpadEnter: ACTIONS.CONFIRM,
  Escape: ACTIONS.BACK,
  KeyF: ACTIONS.FIRE,
  KeyQ: ACTIONS.SWITCH,
};

// เผื่อกรณีที่ e.code ว่าง (เบราว์เซอร์เก่า, คีย์บอร์ดบนจอ, เครื่องมือทดสอบอัตโนมัติ)
const KEY_FALLBACK = {
  ArrowLeft: ACTIONS.LEFT,   a: ACTIONS.LEFT,  A: ACTIONS.LEFT,
  ArrowRight: ACTIONS.RIGHT, d: ACTIONS.RIGHT, D: ACTIONS.RIGHT,
  ArrowUp: ACTIONS.JUMP,     w: ACTIONS.JUMP,  W: ACTIONS.JUMP,
  ArrowDown: ACTIONS.SLIDE,  s: ACTIONS.SLIDE, S: ACTIONS.SLIDE,
  ' ': ACTIONS.CONFIRM,
  Spacebar: ACTIONS.CONFIRM,
  Enter: ACTIONS.CONFIRM,
  Escape: ACTIONS.BACK,
  f: ACTIONS.FIRE, F: ACTIONS.FIRE,
  q: ACTIONS.SWITCH, Q: ACTIONS.SWITCH,
};

export function createInput(target, onAction) {
  let touchStart = null;

  function handleKey(e) {
    // ⚠️ ถ้ากำลังพิมพ์ในช่องข้อความ (ชื่อ/รหัสห้อง) ต้องปล่อยผ่าน
    // ไม่งั้น e.code='KeyA' จะถูกแมปเป็น "เลี้ยวซ้าย" แล้ว preventDefault() บล็อกการพิมพ์
    // SELECT ก็ต้องปล่อยผ่านด้วย: Space/↑↓ คือวิธีเปิดและเลื่อนตัวเลือกในกล่อง
    // ถ้าดักไว้ ช่องเลือกชุดคำศัพท์/ธีม/ความเร็วจะใช้คีย์บอร์ดไม่ได้เลย
    // (SELECT ไม่เคยอยู่บนจอตอนวิ่ง จึงไม่มีทางไปกินคีย์ควบคุมของเกม)
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

    const action = CODE_MAP[e.code] || KEY_FALLBACK[e.key];
    if (!action) return;
    // กัน ↑↓ Space เลื่อนหน้าจอระหว่างเล่น
    e.preventDefault();
    if (e.repeat) return;     // กดค้างไม่ควรยิงซ้ำรัว ๆ
    onAction(action);
  }

  function onTouchStart(e) {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
  }

  function onTouchEnd(e) {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const min = CFG.input.swipeMinPx;
    touchStart = null;

    if (Math.abs(dx) < min && Math.abs(dy) < min) {
      onAction(ACTIONS.CONFIRM);     // แตะเฉย ๆ = ยืนยัน (ใช้ตอนเริ่ม/เล่นใหม่)
      return;
    }
    // แกนที่ปัดไปไกลกว่าเป็นตัวตัดสิน — ป้องกันการปัดเฉียงแล้วได้สองคำสั่ง
    if (Math.abs(dx) > Math.abs(dy)) {
      onAction(dx > 0 ? ACTIONS.RIGHT : ACTIONS.LEFT);
    } else {
      onAction(dy > 0 ? ACTIONS.SLIDE : ACTIONS.JUMP);
    }
  }

  window.addEventListener('keydown', handleKey);
  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchend', onTouchEnd, { passive: true });

  return {
    dispose() {
      window.removeEventListener('keydown', handleKey);
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchend', onTouchEnd);
    },
  };
}
