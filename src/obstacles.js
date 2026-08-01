/**
 * obstacles.js — อันตรายระหว่างทาง 3 ชนิด ธีมอวกาศ
 *
 *   ☄️ อุกกาบาต (meteor)   — เตี้ย ต้อง "กระโดด" ข้าม
 *   🛰️ ขยะอวกาศ (junk)     — ห้อยลงมา ต้อง "สไลด์" ลอด
 *   ⛔ ม่านพลังงาน (barrier) — เต็มความสูง กระโดด/สไลด์ไม่ช่วย ต้อง "เปลี่ยนเลน"
 *
 * ทำไมต้องมีชนิดที่สาม? เพราะสองชนิดแรกแก้ด้วยปุ่มขึ้น/ลงเท่านั้น
 * ผู้เล่นจะเล่นโดยไม่ต้องคิดเรื่อง "ตำแหน่ง" เลย พอเพิ่มม่านพลังงานเข้ามา
 * แกนซ้าย-ขวาซึ่งเป็นแกนเดียวกับการตอบคำถาม ก็ถูกดึงเข้ามาใช้ด้วย
 * → เกิดการวางแผนล่วงหน้า "ต้องหลบไปเลนไหน แล้วเลนนั้นจะตอบคำถามทันไหม"
 *
 * ⚠️ กฎเหล็ก: อันตรายทั้งหมดต้องไม่โผล่ในช่วง answer window
 * (บังคับใช้ที่ scheduleBreather ใน main.js)
 */

import * as THREE from 'three';
import { CFG } from './config.js';
import { PALETTE, toonMat } from './scene.js';

export const OBSTACLE = { METEOR: 'meteor', JUNK: 'junk', BARRIER: 'barrier' };

/** สุ่มชนิดอันตรายตามน้ำหนัก — ม่านพลังงานจะยังไม่โผล่ในช่วงต้นเกม */
export function pickObstacleType(gatesPassed, rand = Math.random) {
  const w = { ...CFG.obstacles.typeWeights };
  if (gatesPassed < CFG.obstacles.barrierAfterGates) w.barrier = 0;

  const total = Object.values(w).reduce((s, x) => s + x, 0);
  let roll = rand() * total;
  for (const [type, weight] of Object.entries(w)) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return OBSTACLE.METEOR;
}

export function createObstaclePool(scene) {
  const { width, depth, lowHeight, highY, barrierHeight } = CFG.obstacles;

  /* ── วัสดุ/รูปทรงที่แชร์กันทุกชิ้น (สร้างครั้งเดียว) ──
   *
   * ⭐ ทำไมอุปสรรคเดิม "มืดจนมองไม่เห็น": ฉากพื้นหลังเข้ม (0x05060f) + มีหมอก
   * ส่วนหินอุกกาบาต/แผงขยะเป็น MeshLambertMaterial ที่ "ต้องรอแสงมาส่องถึงจะเห็นสี"
   * base color ก็เข้ม + emissive (แสงในตัว) เกือบดำ → เลยจมหายเข้ากับพื้นหลัง
   *
   * เทคนิคแก้: ดัน **emissive** ให้สว่างขึ้นเป็นหลัก (ไม่ใช่แค่ base color)
   * เพราะ emissive เรืองแสงด้วยตัวเองเสมอ ไม่ขึ้นกับแสงในฉากและไม่โดนหมอกกลืน
   * → วัตถุ "ป็อป" ออกมาจากพื้นหลังมืดได้ทันทีแม้อยู่ไกล
   */
  const M = {
    rock: toonMat(0xc09274, { emissive: 0x8a4a1e }),
    magma: new THREE.MeshBasicMaterial({ color: 0xffab4a }),
    trail: new THREE.MeshBasicMaterial({ color: 0xffb877, transparent: true, opacity: 0.55 }),
    panel: toonMat(0x5f74b4, { emissive: 0x2f57a6 }),
    metal: toonMat(0xc6d0e6, { emissive: 0x2b3350 }),
    solar: new THREE.MeshBasicMaterial({ color: 0x4a90e2 }),
    cable: new THREE.MeshBasicMaterial({ color: 0x8996b4 }),
    field: new THREE.MeshBasicMaterial({
      color: 0xff5d79, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    }),
    fieldEdge: new THREE.MeshBasicMaterial({ color: 0xff8aa1 }),
  };

  /* ── ขนาด: อุปสรรคต้อง "อ่านออกตอนยังไกล" ไม่ใช่ตอนถึงตัว ────
   * เวลาตอบสนองที่เรามีให้คือ ~1 วินาที (CFG.pacing.obstacleLeadFloor)
   * ถ้าผู้เล่นใช้เวลา 0.4 วิ ไป "เพ่งว่านั่นอะไร" ก็เหลือเวลาหลบจริงแค่ครึ่งเดียว
   * ของที่ใหญ่และทรงเรียบง่ายจึงไม่ใช่เรื่องความสวย แต่คือการคืนเวลาให้ผู้เล่น
   *
   * ⚠️ ใหญ่ได้เฉพาะ "ส่วนที่มองเห็น" เท่านั้น — กล่องชนอยู่ใน obstacles.checkHit
   * ซึ่งอิงค่า CFG (width/lowHeight/highY) ไม่ได้อิงขนาด mesh
   * ถ้าดันเลยจนภาพใหญ่กว่ากล่องชนมาก ผู้เล่นจะรู้สึกว่า "เฉียดแล้วแต่ไม่โดน" = เกมโกง
   * ตัวเลขข้างล่างจึงขยายแบบพอดี ๆ ให้ภาพยังตรงกับกล่องชน */
  const G = {
    rock: new THREE.DodecahedronGeometry(lowHeight * 0.82, 0),
    core: new THREE.SphereGeometry(lowHeight * 0.34, 10, 8),
    trail: new THREE.ConeGeometry(lowHeight * 0.5, 1.7, 10, 1, true),
    panel: new THREE.BoxGeometry(width * 0.95, 0.22, depth * 1.7),
    solar: new THREE.BoxGeometry(width * 0.46, 0.09, depth * 1.35),
    body: new THREE.BoxGeometry(0.62, 0.52, 0.62),
    cable: new THREE.BoxGeometry(0.05, 2.2, 0.05),
    field: new THREE.PlaneGeometry(CFG.world.laneWidth * 0.92, barrierHeight),
    fieldEdge: new THREE.BoxGeometry(CFG.world.laneWidth * 0.94, 0.1, 0.12),
  };

  function buildMeteor() {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(G.rock, M.rock);
    rock.position.y = lowHeight * 0.55;
    g.add(rock);

    const core = new THREE.Mesh(G.core, M.magma);
    core.position.set(0.1, lowHeight * 0.5, -0.12);
    g.add(core);

    // หางไฟชี้ไปข้างหลัง (ทิศที่มันพุ่งมา) — บอกทิศทางและความเร็วได้ในภาพเดียว
    const trail = new THREE.Mesh(G.trail, M.trail);
    trail.rotation.x = -Math.PI / 2;
    trail.position.set(0, lowHeight * 0.55, -1.1);
    g.add(trail);

    return { group: g, spin: rock };
  }

  function buildJunk() {
    const g = new THREE.Group();

    const cable = new THREE.Mesh(G.cable, M.cable);
    cable.position.y = highY + 1.4;
    g.add(cable);

    const panel = new THREE.Mesh(G.panel, M.panel);
    panel.position.y = highY;
    g.add(panel);

    const body = new THREE.Mesh(G.body, M.metal);
    body.position.y = highY + 0.28;
    g.add(body);

    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(G.solar, M.solar);
      wing.position.set(side * width * 0.42, highY - 0.12, 0);
      wing.rotation.z = side * 0.22;
      g.add(wing);
    }

    return { group: g, spin: null };
  }

  function buildBarrier() {
    const g = new THREE.Group();

    const field = new THREE.Mesh(G.field, M.field);
    field.position.y = barrierHeight / 2;
    g.add(field);

    for (const y of [0.06, barrierHeight]) {
      const edge = new THREE.Mesh(G.fieldEdge, M.fieldEdge);
      edge.position.y = y;
      g.add(edge);
    }

    return { group: g, spin: null };
  }

  const items = [];
  for (let i = 0; i < CFG.obstacles.poolSize; i++) {
    const parts = {
      [OBSTACLE.METEOR]: buildMeteor(),
      [OBSTACLE.JUNK]: buildJunk(),
      [OBSTACLE.BARRIER]: buildBarrier(),
    };
    const holder = new THREE.Group();
    for (const p of Object.values(parts)) {
      p.group.visible = false;
      holder.add(p.group);
    }
    holder.visible = false;
    scene.add(holder);
    items.push({ holder, parts, active: false, type: null, lane: 1, age: 0 });
  }

  let clock = 0;

  return {
    items,

    /** ทาสีสิ่งกีดขวางตามธีม — geometry เดิม กติกาเดิม เปลี่ยนแค่เปลือก */
    applyTheme(t) {
      const o = t.obstacles;
      M.rock.color.setHex(o.rock);
      M.rock.emissive.setHex(o.rockGlow);
      M.magma.color.setHex(o.core);
      M.trail.color.setHex(o.trail);
      M.panel.color.setHex(o.panel);
      M.panel.emissive.setHex(o.panelGlow);
      M.metal.color.setHex(o.metal);
      M.solar.color.setHex(o.wing);
      M.field.color.setHex(o.field);
      M.fieldEdge.color.setHex(o.fieldEdge);
    },

    spawn(type, lane, z) {
      const item = items.find(o => !o.active);
      if (!item) return null;
      item.active = true;
      item.type = type;
      item.lane = lane;
      item.age = 0;
      for (const [key, p] of Object.entries(item.parts)) p.group.visible = (key === type);
      item.holder.visible = true;
      item.holder.position.set((lane - 1) * CFG.world.laneWidth, 0, z);
      return item;
    },

    update(dt, speed) {
      clock += dt;
      for (const o of items) {
        if (!o.active) continue;
        o.age += dt;
        o.holder.position.z += speed * dt;

        const part = o.parts[o.type];
        if (part.spin) {
          part.spin.rotation.x += dt * 4.2;
          part.spin.rotation.z += dt * 2.6;
        }
        if (o.type === OBSTACLE.JUNK) {
          part.group.rotation.z = Math.sin(clock * 1.8 + o.lane) * 0.14;  // แกว่งเบา ๆ
        }
        if (o.type === OBSTACLE.BARRIER) {
          part.group.children[0].material.opacity = 0.44 + Math.sin(clock * 7) * 0.12;
        }

        if (o.holder.position.z > CFG.world.despawnZ) {
          o.active = false;
          o.holder.visible = false;
        }
      }
    },

    /** ตรวจการชน — คืนสิ่งกีดขวางที่ชนโดน หรือ null */
    checkHit(player) {
      const px = player.x();
      const py = player.group.position.y;
      const halfZ = CFG.obstacles.depth / 2 + CFG.player.radius * 0.7;

      for (const o of items) {
        if (!o.active) continue;
        if (Math.abs(o.holder.position.z - CFG.world.playerZ) > halfZ) continue;

        const halfX = (o.type === OBSTACLE.BARRIER ? CFG.world.laneWidth * 0.46 : width / 2)
                    + CFG.player.radius * 0.7;
        if (Math.abs(o.holder.position.x - px) > halfX) continue;

        if (o.type === OBSTACLE.METEOR) {
          // รอดถ้าเท้าลอยพ้นยอดอุกกาบาต
          if (py >= lowHeight - 0.05) continue;
        } else if (o.type === OBSTACLE.JUNK) {
          // รอดถ้ากำลังย่อตัว (หัวต่ำกว่าใต้ซากดาวเทียม)
          const headY = py + (player.isSliding() ? CFG.player.slideHeight : CFG.player.height);
          if (headY <= highY - 0.3) continue;
        }
        // BARRIER: อยู่ในเลนนั้นคือโดน ไม่มีท่าไหนรอด
        return o;
      }
      return null;
    },

    reset() {
      for (const o of items) {
        o.active = false;
        o.holder.visible = false;
      }
    },
  };
}
