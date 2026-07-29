/**
 * ghosts.js — ร่าง "โกสต์" ของเพื่อนร่วมห้องในโหมด Battle Royale
 *
 * ── ทำไมเห็นเพื่อนได้ทั้งที่ "โลกใครโลกมัน" ──
 * แต่ละเครื่องสุ่มด่าน/อุปสรรคของตัวเอง (ตั้งใจ — ดูเหตุผลใน net.js) เราจึงไม่มีทาง
 * วาดเพื่อน "ในตำแหน่งจริงของโลกเขา" ได้ แต่สิ่งที่มีความหมายข้ามโลกคือ
 * **เลนที่เขาอยู่ + ความสูงที่เขาลอย** — สองค่านี้ถูกส่งมากับสถานะอยู่แล้ว (~6 ครั้ง/วิ)
 * เราเลยวาดเพื่อนเป็นร่างโปร่งแสงวิ่ง "เคียงข้างเรา" ที่เลน/ความสูงจริงของเขา
 * → เห็นกันหลบซ้ายขวา กระโดด ขึ้นหลังคายาน แบบสด ๆ โดยไม่ต้อง sync โลกเลย
 *
 * ── เทคนิคความลื่น: เป้าหมาย + lerp ──
 * ข้อมูลมาเป็นห้วง ๆ (ทุก ~150ms) ถ้าวางตำแหน่งตรง ๆ โกสต์จะกระตุกวาร์ป
 * จึงเก็บเป็น "เป้าหมาย" แล้วไล่ตำแหน่งจริงเข้าหาทุกเฟรม (exponential smoothing)
 * ตามันอ่านเป็นการเคลื่อนไหวต่อเนื่อง ทั้งที่ข้อมูลจริงมากระปริดกระปรอย
 */

import * as THREE from 'three';
import { CFG } from './config.js';
import { playerHue } from './net.js';

const POOL = 7;                       // รองรับเพื่อนร่วมห้องพร้อมกันสูงสุด 7 คน
const LANE_X = i => (i - 1) * CFG.world.laneWidth;

/** ป้ายชื่อลอยเหนือหัว — วาดลง canvas แล้วแปะเป็น sprite (หันเข้ากล้องเสมอ) */
function makeNameTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false,
  }));
  sprite.scale.set(2.2, 0.55, 1);
  sprite.position.y = 2.35;

  function setText(name, cssColor) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = '700 34px "Noto Sans Thai", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // เงาเข้มรอบตัวอักษร ให้ชื่ออ่านออกบนทุกฉากหลัง
    ctx.fillStyle = 'rgba(3,6,17,0.72)';
    const w = Math.min(240, ctx.measureText(name).width + 34);
    if (ctx.roundRect) {                       // Safari เก่า (<16) ไม่มี roundRect
      ctx.beginPath();
      ctx.roundRect((256 - w) / 2, 6, w, 52, 14);
      ctx.fill();
    } else {
      ctx.fillRect((256 - w) / 2, 6, w, 52);
    }
    ctx.fillStyle = cssColor;
    ctx.fillText(name, 128, 34);
    texture.needsUpdate = true;
  }
  return { sprite, setText };
}

/** ร่างนักบินแบบย่อ (แคปซูล+หมวก) — จงใจให้เรียบกว่าตัวเราเพื่อไม่แย่งสายตา */
function buildGhostBody() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55 });
  const trimMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.62, 4, 12), bodyMat);
  body.position.y = 0.78;
  g.add(body);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), bodyMat);
  helmet.position.y = 1.42;
  g.add(helmet);

  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.02, 6, 20), trimMat);
  seam.rotation.y = Math.PI / 2;
  seam.position.y = 1.42;
  g.add(seam);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.26, 0.44, 20),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);

  return { group: g, bodyMat, trimMat, ringMat: ring.material };
}

export function createGhosts(scene) {
  const items = [];
  for (let i = 0; i < POOL; i++) {
    const body = buildGhostBody();
    const tag = makeNameTag();
    body.group.add(tag.sprite);
    body.group.visible = false;
    scene.add(body.group);
    items.push({
      ...body, tag,
      active: false,
      id: null,
      curX: 0, targetX: 0,
      curY: 0, targetY: 0,
      slotZ: 0,
      bob: Math.random() * Math.PI * 2,
    });
  }

  return {
    /**
     * จับคู่โกสต์กับผู้เล่นคนอื่นที่ยังไม่ตกรอบ (เรียกทุกครั้งที่ roster มาใหม่)
     * จับคู่ด้วย id เดิมก่อนเสมอ — โกสต์ของคนเดิมต้องเป็นตัวเดิม ไม่งั้น lerp จะวาร์ป
     */
    sync(players, selfId) {
      const others = players.filter(p => p.id !== selfId && !p.finished);

      // ปลดโกสต์ของคนที่ไม่อยู่แล้ว (ตกรอบ/ออกห้อง)
      for (const g of items) {
        if (g.active && !others.some(p => p.id === g.id)) {
          g.active = false;
          g.group.visible = false;
          g.id = null;
        }
      }

      others.forEach((p, idx) => {
        let g = items.find(o => o.active && o.id === p.id);
        if (!g) {
          g = items.find(o => !o.active);
          if (!g) return;                         // เกิน pool — ตัดคนเกินออกจากการวาด
          g.active = true;
          g.id = p.id;
          g.curX = LANE_X(p.lane ?? 1);
          g.curY = p.py ?? 0;
          const hue = playerHue(p.id);
          const color = new THREE.Color().setHSL(hue / 360, 0.75, 0.62);
          g.bodyMat.color = color;
          g.trimMat.color = color;
          g.ringMat.color = color;
          g.tag.setText(p.name || 'ผู้เล่น', `hsl(${hue}, 90%, 72%)`);
          g.group.visible = true;
        }
        // โกสต์เรียงถอยหลังไปทีละนิด — ไม่ทับตัวเรา และไม่ทับกันเอง
        g.slotZ = -1.4 - idx * 1.0;
        g.targetX = LANE_X(p.lane ?? 1);
        g.targetY = p.py ?? 0;
      });
    },

    update(dt) {
      for (const g of items) {
        if (!g.active) continue;
        // exponential smoothing: ไล่เข้าเป้า ~90% ภายใน ~0.18 วิ — ลื่นแต่ไม่หน่วง
        const k = Math.min(1, dt * 13);
        g.curX += (g.targetX - g.curX) * k;
        g.curY += (g.targetY - g.curY) * k;
        g.bob += dt * 9;
        g.group.position.set(g.curX, g.curY + Math.abs(Math.sin(g.bob)) * 0.05, g.slotZ);
      }
    },

    reset() {
      for (const g of items) {
        g.active = false;
        g.id = null;
        g.group.visible = false;
      }
    },
  };
}
