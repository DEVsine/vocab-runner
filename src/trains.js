/**
 * trains.js — ยานลำเลียงสินค้า: มิติแนวตั้งแบบ "วิ่งบนหลังคารถไฟ" ของ Subway Surfers
 *
 * มี 2 แบบ ซึ่งให้ความรู้สึกคนละขั้ว:
 *   🚃 RIDE     — ตู้ลำเลียงที่ "จอดนิ่งบนราง" (เคลื่อนเข้าหาเราด้วยความเร็วโลกเหมือน
 *                 ของทุกอย่าง) กระโดดขึ้นไปวิ่งบนหลังคาได้ มีแถวเหรียญบนนั้นล่อใจ
 *   🚄 ONCOMING — ยานวิ่งสวนทาง พุ่งเข้าหาเร็วกว่าความเร็วโลก ไฟหน้าจ้า + หวูดเตือน
 *                 กระโดดข้ามไม่ได้ (สูงทั้งคัน) ต้องหลบเลนเท่านั้น = ความตื่นเต้นล้วน ๆ
 *
 * ── กลไก "ยืนบนหลังคา" อยู่ที่ไหน ──
 * ไฟล์นี้ตอบแค่คำถามเชิงเรขาคณิต: "ตรงตำแหน่งผู้เล่นตอนนี้ มีหลังคาไหม สูงเท่าไร"
 * (ฟังก์ชัน rideSurface) ส่วนการตัดสินใจว่า ขึ้นได้/ชนตาย/ตกลง เป็นหน้าที่ของ
 * main.js + player.js เพราะต้องรู้สถานะการกระโดดซึ่งไฟล์นี้ไม่ควรรู้
 *
 * ⚠️ ยานมี "ความยาว" ต่างจาก obstacle จุดเดียว — ทุกการคำนวณจึงเทียบช่วง
 * [zFront, zBack] ไม่ใช่จุดเดียว และ despawn ต้องรอ "ท้ายยาน" พ้นจอ ไม่ใช่หัว
 */

import * as THREE from 'three';
import { CFG } from './config.js';
import { PALETTE, toonMat } from './scene.js';

export const TRAIN = { RIDE: 'ride', ONCOMING: 'oncoming' };

const LANE_X = i => (i - 1) * CFG.world.laneWidth;

function buildTram() {
  const { length, width, roofY } = CFG.trains;
  const g = new THREE.Group();

  const mat = {
    hull: toonMat(0x7e8db0, { emissive: 0x232c47 }),
    roof: toonMat(0xaeb9d6, { emissive: 0x2c3550 }),
    stripe: new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
    window: new THREE.MeshBasicMaterial({ color: 0x9fdcff }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff6c8 }),
    warnHull: toonMat(0xa64d5e, { emissive: 0x5c1020 }),
  };

  // ── ตัวถัง ──
  const bodyH = roofY - 0.5;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(width, bodyH, length), mat.hull);
  hull.position.y = 0.5 + bodyH / 2;
  g.add(hull);

  // หลังคา (แผ่นบางอีกชั้น ให้ขอบอ่านออกว่า "พื้นยืนได้")
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 1.04, 0.12, length), mat.roof);
  roof.position.y = roofY - 0.06;
  g.add(roof);

  // ล้อ/แม่เหล็กลอยใต้ท้อง
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.82, 0.5, length * 0.92),
    toonMat(0x39445f)
  );
  skirt.position.y = 0.25;
  g.add(skirt);

  // แถบสีคาดข้าง + หน้าต่างเรียงเป็นแถว (ให้ตาอ่าน "ความยาว" ของยานได้ไว ๆ)
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.14, length * 0.96), mat.stripe);
  stripe.position.y = roofY - 0.42;
  g.add(stripe);

  const windows = [];
  const winGeo = new THREE.BoxGeometry(width + 0.06, 0.34, 0.9);
  for (let z = -length / 2 + 1.4; z < length / 2 - 1.2; z += 2.1) {
    const win = new THREE.Mesh(winGeo, mat.window);
    win.position.set(0, roofY - 1.0, z);
    g.add(win);
    windows.push(win);
  }

  // ไฟหน้า (หันเข้าหาผู้เล่น = ด้าน +z) — จ้าเฉพาะแบบวิ่งสวน
  const lights = [];
  for (const x of [-width * 0.28, width * 0.28]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat.head);
    lamp.position.set(x, 1.15, length / 2 + 0.05);
    g.add(lamp);
    lights.push(lamp);
  }
  // กรวยแสงพุ่งหน้า (โผล่เฉพาะ oncoming — คำเตือนที่เห็นก่อนตัวยานเสียอีก)
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff2b8, transparent: true, opacity: 0.28, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.05, 7, 12, 1, true), beamMat);
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(0, 1.15, length / 2 + 3.5);
  beam.visible = false;
  g.add(beam);

  return { group: g, hull, stripe, beam, beamMat, lights, matHull: mat.hull, matWarn: mat.warnHull };
}

export function createTrainPool(scene) {
  const { length, width, roofY } = CFG.trains;

  const items = [];
  for (let i = 0; i < CFG.trains.poolSize; i++) {
    const parts = buildTram();
    parts.group.visible = false;
    scene.add(parts.group);
    items.push({ parts, active: false, type: null, lane: 1, extraSpeed: 0 });
  }

  return {
    items,

    /**
     * @param {number} z ตำแหน่ง "หัวยาน" (ขอบด้าน +z ที่จะถึงผู้เล่นก่อน)
     * @param {number} extraSpeed ความเร็วเพิ่มจากโลก (0 = ตู้จอดนิ่งบนราง)
     */
    spawn(type, lane, z, extraSpeed = 0) {
      const t = items.find(o => !o.active);
      if (!t) return null;
      t.active = true;
      t.type = type;
      t.lane = lane;
      t.extraSpeed = extraSpeed;

      const p = t.parts;
      p.group.visible = true;
      // origin ของ group อยู่กึ่งกลางตัวยาน → หัวยานอยู่ที่ z ตามสัญญา จึงเลื่อนถอยครึ่งคัน
      p.group.position.set(LANE_X(lane), 0, z - length / 2);

      const oncoming = type === TRAIN.ONCOMING;
      p.hull.material = oncoming ? p.matWarn : p.matHull;
      p.beam.visible = oncoming;
      return t;
    },

    update(dt, worldSpeed) {
      for (const t of items) {
        if (!t.active) continue;
        t.parts.group.position.z += (worldSpeed + t.extraSpeed) * dt;
        if (t.type === TRAIN.ONCOMING) {
          // ไฟหน้ากะพริบเร่งความรู้สึก "กำลังพุ่งเข้ามา"
          t.parts.beamMat.opacity = 0.22 + Math.abs(Math.sin(performance.now() / 90)) * 0.14;
        }
        // despawn เมื่อ "ท้ายยาน" พ้นหลังกล้องแล้วเท่านั้น
        if (t.parts.group.position.z - length / 2 > CFG.world.despawnZ + 2) {
          t.active = false;
          t.parts.group.visible = false;
        }
      }
    },

    /**
     * มีหลังคาให้ยืนไหมตรงตำแหน่งผู้เล่น (เฉพาะแบบ RIDE)
     * @returns {{roofY:number, enteredBy:number}|null}
     *   enteredBy = หัวยานเลยตัวผู้เล่นมาแล้วกี่หน่วย (ใช้ให้ grace ช่วงเพิ่งเจอกัน)
     */
    rideSurface(px) {
      for (const t of items) {
        if (!t.active || t.type !== TRAIN.RIDE) continue;
        if (Math.abs(LANE_X(t.lane) - px) > width * 0.5) continue;
        const zc = t.parts.group.position.z;
        const zFront = zc + length / 2;
        const zBack = zc - length / 2;
        if (zFront < CFG.world.playerZ || zBack > CFG.world.playerZ) continue;
        return { roofY, enteredBy: zFront - CFG.world.playerZ };
      }
      return null;
    },

    /** ชนยานวิ่งสวนไหม (อยู่เลนเดียวกัน + ช่วงตัวยานคร่อมผู้เล่น = โดน ไม่มีท่ารอด) */
    oncomingHit(px) {
      for (const t of items) {
        if (!t.active || t.type !== TRAIN.ONCOMING) continue;
        if (Math.abs(LANE_X(t.lane) - px) > width * 0.5 + CFG.player.radius * 0.5) continue;
        const zc = t.parts.group.position.z;
        if (zc + length / 2 >= CFG.world.playerZ - 0.3 && zc - length / 2 <= CFG.world.playerZ + 0.3) {
          return t;
        }
      }
      return null;
    },

    /** มียาน RIDE ใช้งานอยู่ในเลนนี้ไหม (director ใช้กันวางของซ้อนเลน) */
    hasRideInLane(lane) {
      return items.some(t => t.active && t.type === TRAIN.RIDE && t.lane === lane);
    },

    /** ทำลายยานที่ช่วงลำตัวยานทับกับหน้าคลื่น แล้วคืนจุดกึ่งกลางไว้สร้างเศษพลัง */
    destroyBetween(nearZ, farZ) {
      const hi = Math.max(nearZ, farZ);
      const lo = Math.min(nearZ, farZ);
      const destroyed = [];
      for (const t of items) {
        if (!t.active) continue;
        const z = t.parts.group.position.z;
        const front = z + length / 2;
        const back = z - length / 2;
        if (front < lo || back > hi) continue;
        destroyed.push({ x: LANE_X(t.lane), y: roofY * 0.6, z: Math.max(lo, Math.min(hi, z)) });
        t.active = false;
        t.parts.group.visible = false;
      }
      return destroyed;
    },

    reset() {
      for (const t of items) {
        t.active = false;
        t.parts.group.visible = false;
      }
    },
  };
}
