/**
 * wallet.js — กระเป๋าเหรียญถาวร + ตัวละครที่ครอบครอง (localStorage)
 *
 * เหรียญที่เก็บ "ในรอบ" กับเหรียญ "ในกระเป๋า" เป็นคนละบัญชีโดยตั้งใจ:
 * ระหว่างวิ่งเหรียญคือคะแนน/ความสนุกชั่วคราว พอจบรอบ (ตาย/จบฝึก) ค่อยโอนเข้า
 * กระเป๋าเป็นสกุลเงินถาวรไว้ซื้อของในร้าน — จบรอบทุกครั้งจึง "ได้อะไรกลับมา" เสมอ
 * แม้รอบนั้นจะตายเร็ว = แรงจูงใจให้กดเล่นอีกครั้งแบบเดียวกับเกม endless runner จริง
 */

import { CFG } from './config.js';

const KEY = `${CFG.storageKey}:wallet`;

function load() {
  try {
    const w = JSON.parse(localStorage.getItem(KEY)) || {};
    return {
      coins: Math.max(0, w.coins | 0),
      owned: Array.isArray(w.owned) ? w.owned : [],
      selected: w.selected || 'astro',
    };
  } catch {
    return { coins: 0, owned: [], selected: 'astro' };
  }
}

let state = load();
if (!state.owned.includes('astro')) state.owned.push('astro');   // ตัวเริ่มต้นฟรีเสมอ

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* โหมดส่วนตัว */ }
}

export const wallet = {
  coins: () => state.coins,
  owned: (id) => state.owned.includes(id),
  selected: () => state.selected,

  /** โอนเหรียญจากรอบที่จบเข้ากระเป๋า — คืนยอดใหม่ */
  deposit(n) {
    state.coins += Math.max(0, n | 0);
    save();
    return state.coins;
  },

  /** ซื้อตัวละคร — คืน true เมื่อสำเร็จ (เงินพอ + ยังไม่มี) */
  buy(id, price) {
    if (state.owned.includes(id) || state.coins < price) return false;
    state.coins -= price;
    state.owned.push(id);
    save();
    return true;
  },

  select(id) {
    if (!state.owned.includes(id)) return false;
    state.selected = id;
    save();
    return true;
  },
};
