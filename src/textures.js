/**
 * textures.js — ภาพที่วาดด้วยโค้ดแล้วแปะเป็นผิวของวัตถุ 3D
 *
 * เดิมไฟล์นี้เคยมีหน้าที่วาด "คำศัพท์" ลงบนกำแพงด้วย แต่เราเลิกใช้ไปแล้ว
 * เพราะตัวหนังสือในโลก 3D ถูกจำกัดขนาดด้วยความกว้างเลนและถูกเปอร์สเปกทีฟบีบ
 * ตอนนี้คำตอบขึ้นเป็น "ธง" บน DOM แทน (ดู hud.js)
 *
 * เหลือไว้แค่ภาพห้วงอวกาศสำหรับหน้าต่างของสถานี — ซึ่งเป็นงานที่ texture
 * ทำได้ดีจริง ๆ คือ "รายละเอียดที่ไม่ต้องอ่าน"
 */

import * as THREE from 'three';

/**
 * จุดกลมนุ่ม ๆ สำหรับฝุ่นดาว
 *
 * ⚠️ THREE.Points โดยปริยายจะวาดเป็น "สี่เหลี่ยมทึบ" พอเม็ดไหนเข้ามาใกล้เลนส์
 * มันจะกลายเป็นบล็อกสี่เหลี่ยมเบลอเต็มจอ ซึ่งดูเหมือนภาพเสียมากกว่าฝุ่นดาว
 * ต้องแปะ texture ที่จางหายที่ขอบ ถึงจะได้จุดกลม ๆ ที่ดูเป็นธรรมชาติ
 */
export function createDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * แถบทางช้างเผือกสำหรับด่านโบนัส — เมฆก๊าซหลายชั้นซ้อนกัน
 *
 * เคล็ดลับให้ดูเป็นเนบิวลาไม่ใช่ "วงกลมเบลอ": ซ้อน radial gradient หลายวง
 * ขนาดต่างกันมาก ๆ แล้วโรยดาวทับด้านบน ความไม่สม่ำเสมอคือสิ่งที่ตาอ่านว่า "ธรรมชาติ"
 */
export function createNebulaTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, 1024, 256);

  const clouds = [
    ['rgba(99,102,241,0.30)', 260],
    ['rgba(236,72,153,0.24)', 200],
    ['rgba(34,211,238,0.22)', 170],
    ['rgba(168,85,247,0.26)', 230],
    ['rgba(59,130,246,0.20)', 150],
  ];
  for (let i = 0; i < 26; i++) {
    const [color, baseR] = clouds[i % clouds.length];
    const x = Math.random() * 1024;
    const y = 128 + (Math.random() - 0.5) * 150;
    const r = baseR * (0.35 + Math.random() * 0.8);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // แกนกลางสว่างของทางช้างเผือก
  const core = ctx.createLinearGradient(0, 90, 0, 170);
  core.addColorStop(0, 'rgba(255,255,255,0)');
  core.addColorStop(0.5, 'rgba(255,248,220,0.22)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 90, 1024, 80);

  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 1024;
    const y = 128 + (Math.random() - 0.5) * 210;
    const r = Math.random() < 0.92 ? Math.random() * 0.9 + 0.25 : Math.random() * 1.8 + 1.2;
    ctx.globalAlpha = 0.3 + Math.random() * 0.7;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * ภาพอวกาศสำหรับหน้าต่างของสถานี — สร้างด้วยโค้ด ไม่ใช้ไฟล์ภาพ
 * สร้างครั้งเดียวแล้วใช้ร่วมกันทุกบานหน้าต่าง (แชร์ texture = ประหยัด VRAM)
 */
export function createStarTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // ห้วงอวกาศลึก ไล่เฉดน้ำเงินม่วงบาง ๆ ให้ไม่ใช่ดำตายสนิท
  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#05060f');
  grad.addColorStop(0.5, '#0a0f26');
  grad.addColorStop(1, '#06080f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // เนบิวลาจาง ๆ ให้มีมิติ
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    const r = 60 + Math.random() * 90;
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
    g2.addColorStop(0, i % 2 ? 'rgba(34,211,238,0.10)' : 'rgba(244,114,182,0.09)');
    g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ดาว: ส่วนใหญ่จิ๋ว มีดวงใหญ่แทรกบ้าง — ความไม่สม่ำเสมอทำให้ดูเป็นธรรมชาติ
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    const r = Math.random() < 0.9 ? Math.random() * 0.9 + 0.3 : Math.random() * 1.6 + 1.1;
    ctx.globalAlpha = 0.35 + Math.random() * 0.65;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
