/**
 * gates.js — ด่านสแกน: ป้อมปืนเลเซอร์ 3 กระบอก + แผ่นพื้นเรืองแสง 3 เลน
 *
 * ── ทำไมถึงเลิกใช้ "กำแพงที่มีตัวหนังสือ" ──
 * ตัวหนังสือที่อยู่ในโลก 3D ถูกจำกัดขนาดด้วยความกว้างของเลน และถูกบีบ
 * ด้วยเปอร์สเปกทีฟตอนอยู่ไกล ยิ่งเกมเร็วขึ้น ด่านยิ่งต้องเกิดไกลขึ้น
 * ตัวอักษรก็ยิ่งเล็กลง — เป็นสมการที่แพ้ตั้งแต่ต้น
 *
 * ทางออก: ย้ายตัวเลือกไปเป็น "ธง" บน HUD (DOM) ซึ่งคมและใหญ่คงที่เสมอ
 * แล้วให้โลก 3D ทำหน้าที่ที่มันเก่งแทน คือ **บอกตำแหน่งและอันตราย**:
 *   - แผ่นพื้นเรืองแสงสีประจำเลน = ตัวเชื่อมว่า "ธงใบซ้าย = เลนซ้าย"
 *   - ป้อมปืนบนเพดาน = คำเตือนว่าอีกไม่กี่วินาทีตรงนี้จะมีอะไรเกิดขึ้น
 *   - เลเซอร์ที่ยิงลงมาเมื่อหมดเวลา = บทลงโทษที่อ่านออกทันทีโดยไม่ต้องอ่านอะไรเลย
 *
 * นี่คือหลักการ "ให้แต่ละสื่อทำสิ่งที่มันเก่ง" — ข้อความให้ DOM, พื้นที่ให้ 3D
 */

import * as THREE from 'three';
import { CFG } from './config.js';
import { PALETTE } from './scene.js';

const LANE_X = i => (i - 1) * CFG.world.laneWidth;

function createGate(scene) {
  const group = new THREE.Group();
  group.visible = false;

  const trackWidth = CFG.world.laneWidth * CFG.world.laneCount + 2.2;
  const frameMat = new THREE.MeshLambertMaterial({ color: PALETTE.frame });
  const warnMat = new THREE.MeshBasicMaterial({ color: PALETTE.amber });

  // โครงประตูสแกน
  const top = new THREE.Mesh(new THREE.BoxGeometry(trackWidth + 1.2, 0.5, 0.7), frameMat);
  top.position.y = CFG.gate.archY;
  group.add(top);

  const warnStripe = new THREE.Mesh(new THREE.BoxGeometry(trackWidth + 1.2, 0.12, 0.74), warnMat);
  warnStripe.position.y = CFG.gate.archY - 0.32;
  group.add(warnStripe);

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, CFG.gate.archY, 0.7), frameMat
    );
    post.position.set(side * (trackWidth / 2 + 0.3), CFG.gate.archY / 2, 0);
    group.add(post);
  }

  // ต่อเลน: ป้อมปืน + เลนส์ + แผ่นพื้น + ลำแสง
  const lanes = [];
  for (let i = 0; i < CFG.world.laneCount; i++) {
    const color = CFG.world.laneColors[i];

    const turret = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 0.7),
      new THREE.MeshLambertMaterial({ color: 0x59657f })
    );
    turret.position.set(LANE_X(i), CFG.gate.turretY, 0);
    group.add(turret);

    const lensMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.22, 12), lensMat);
    lens.position.set(LANE_X(i), CFG.gate.turretY - 0.32, 0);
    group.add(lens);

    // แผ่นพื้นสีประจำเลน — สิ่งที่ทำให้ผู้เล่นจับคู่ธงบนจอกับเลนจริงได้
    const padMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 });
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(CFG.world.laneWidth * 0.88, 0.06, CFG.gate.padLength),
      padMat
    );
    pad.position.set(LANE_X(i), 0.05, 0);
    group.add(pad);

    const laserMat = new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0 });
    const laser = new THREE.Mesh(
      new THREE.CylinderGeometry(CFG.gate.laserRadius, CFG.gate.laserRadius, CFG.gate.laserHeight, 14),
      laserMat
    );
    laser.position.set(LANE_X(i), CFG.gate.laserHeight / 2, 0);
    laser.visible = false;
    group.add(laser);

    lanes.push({ turret, lens, lensMat, pad, padMat, laser, laserMat, color, laserT: 1 });
  }

  scene.add(group);

  return {
    group,
    lanes,
    active: false,
    resolved: false,
    question: null,
    spawnZ: 0,

    spawn(question, z, harmless = false) {
      this.question = question;
      this.harmless = harmless;    // ด่านมุกกวนในโบนัส: ไม่มีเลเซอร์ ไม่มีใครตาย
      this.active = true;
      this.resolved = false;
      this.spawnZ = z;
      group.visible = true;
      group.position.set(0, 0, z);

      lanes.forEach((lane, i) => {
        lane.padMat.color.setHex(lane.color);
        lane.padMat.opacity = 0.5;
        lane.lensMat.color.setHex(lane.color);
        lane.laserMat.opacity = 0;
        lane.laser.visible = false;
        lane.laserT = 1;
      });
    },

    /** เรียกตอนตัวละครแตะระนาบด่าน — ยิงเลเซอร์ทุกเลนที่เป็นคำตอบผิด */
    resolve(correctIndex) {
      this.resolved = true;
      lanes.forEach((lane, i) => {
        if (i === correctIndex) {
          lane.padMat.color.setHex(PALETTE.lime);
          lane.padMat.opacity = 0.95;
          lane.lensMat.color.setHex(PALETTE.lime);
        } else {
          // ด่านมุกกวน: แค่หรี่ลง ไม่ยิงอะไรทั้งนั้น
          lane.padMat.color.setHex(this.harmless ? 0x64748b : 0xff4d6d);
          lane.padMat.opacity = this.harmless ? 0.45 : 0.9;
          lane.lensMat.color.setHex(this.harmless ? 0x64748b : 0xff4d6d);
          if (!this.harmless) {
            lane.laserT = 0;               // เริ่มอนิเมชันยิง
            lane.laser.visible = true;
          }
        }
      });
    },

    update(dt, speed) {
      if (!this.active) return;
      group.position.z += speed * dt;

      let firing = false;
      for (const lane of lanes) {
        if (lane.laserT >= 1) continue;
        firing = true;
        lane.laserT = Math.min(1, lane.laserT + dt / (CFG.gate.laserDurationMs / 1000));
        const t = lane.laserT;
        // ลำแสงพุ่งกว้างออกแล้วจางหาย — อ่านออกว่า "ยิง" ไม่ใช่ "ค้างอยู่"
        const widen = 0.35 + t * 1.15;
        lane.laser.scale.set(widen, 1, widen);
        lane.laserMat.opacity = (1 - t) * 0.92;
        if (t >= 1) lane.laser.visible = false;
      }

      // เก็บด่านทิ้งทันทีที่ยิงจบและเลยตัวละครไปแล้ว
      // ไม่งั้นโครงประตูกว้าง ๆ จะบานเต็มจอตอนผ่านหน้าเลนส์
      const done = this.resolved && !firing;
      if ((done && group.position.z > 1.2) || group.position.z > CFG.world.despawnZ) {
        this.active = false;
        group.visible = false;
      }
    },

    z() { return group.position.z; },
  };
}

export function createGatePool(scene) {
  const gates = Array.from({ length: CFG.gate.poolSize }, () => createGate(scene));

  return {
    gates,

    spawn(question, z, harmless = false) {
      const gate = gates.find(g => !g.active);
      if (!gate) {
        console.warn('[gates] pool เต็ม — เพิ่ม CFG.gate.poolSize');
        return null;
      }
      gate.spawn(question, z, harmless);
      return gate;
    },

    update(dt, speed) {
      for (const g of gates) g.update(dt, speed);
    },

    /** ด่านที่ยังไม่ถูกตัดสินและอยู่ใกล้ผู้เล่นที่สุด (ใช้คำนวณแถบเวลา) */
    pending() {
      let best = null;
      for (const g of gates) {
        if (!g.active || g.resolved) continue;
        if (!best || g.z() > best.z()) best = g;
      }
      return best;
    },

    reset() {
      for (const g of gates) {
        g.active = false;
        g.resolved = false;
        g.group.visible = false;
      }
    },
  };
}
