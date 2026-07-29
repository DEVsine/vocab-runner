/**
 * characters.js — ตัวละครในร้านค้า (ข้อมูลล้วน ไม่มี three.js)
 *
 * ทุกตัวเล่นเหมือนกันเป๊ะ — ต่างแค่ "เปลือก + ชื่อเกราะ/อาวุธ"
 * ไอเทมกันตาย (เดิมคือไอพ่น) เปลี่ยนร่างตามตัวละคร: กดใส่แล้วอาวุธ/เกราะ
 * ของตัวนั้นจะเรืองแสง และข้อความในเกมเรียกชื่ออาวุธนั้นแทนคำว่าไอพ่น
 *
 * ⚠️ ห้ามให้ตัวละครที่ "ซื้อด้วยเหรียญ" เก่งกว่าตัวฟรี (pay-to-win)
 * เกมนี้วัดความรู้ศัพท์ ไม่ใช่ความหนาของกระเป๋า — ของซื้อคือความเท่เท่านั้น
 */

export const CHARACTERS = {
  astro: {
    id: 'astro', name: 'นักบินอวกาศ', emoji: '🧑‍🚀', price: 0,
    weapon: 'ไอพ่นสำรอง', weaponEmoji: '🚀',
    suit: 0xe9eff9, suitDim: 0xbcc6da, joint: 0x39445f, accent: 0x22d3ee,
    desc: 'ตัวเริ่มต้น — ไอพ่นพุ่งหนีความตาย',
  },
  spartan: {
    id: 'spartan', name: 'สปาตัน', emoji: '🛡️', price: 300,
    weapon: 'โล่ & หอก', weaponEmoji: '🛡️',
    suit: 0xb3402e, suitDim: 0x7e2a1e, joint: 0xd9b45c, accent: 0xffd166,
    desc: 'โล่กลมทองเหลือง + หอกยาวสะพายหลัง',
  },
  samurai: {
    id: 'samurai', name: 'ซามูไร', emoji: '⚔️', price: 500,
    weapon: 'ดาบคาตานะ', weaponEmoji: '⚔️',
    suit: 0x27364f, suitDim: 0x182335, joint: 0xe8eef8, accent: 0xf87171,
    desc: 'เกราะครามเข้ม คาตานะพร้อมชัก',
  },
  ninja: {
    id: 'ninja', name: 'นินจา', emoji: '🥷', price: 800,
    weapon: 'ดาวกระจาย', weaponEmoji: '✴️',
    suit: 0x232733, suitDim: 0x15181f, joint: 0x3f4657, accent: 0xa3e635,
    desc: 'ชุดดำเงียบกริบ ดาวกระจายคมกริบ',
  },
  darklord: {
    id: 'darklord', name: 'ลอร์ดมืด', emoji: '🌑', price: 1200,
    weapon: 'ดาบแสงสีแดง', weaponEmoji: '🔴',
    suit: 0x14161d, suitDim: 0x0b0d12, joint: 0x2a2e3a, accent: 0xff2d4d,
    desc: 'พลังด้านมืด — ดาบแสงแดงเดือด',
  },
};

export const CHARACTER_ORDER = ['astro', 'spartan', 'samurai', 'ninja', 'darklord'];

export function characterById(id) {
  return CHARACTERS[id] || CHARACTERS.astro;
}
