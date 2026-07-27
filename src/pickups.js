/**
 * pickups.js — ของที่เก็บได้ระหว่างทาง: เหรียญ และ ไอพ่นสำรอง
 *
 * หน้าที่ในดีไซน์ (ไม่ใช่แค่ "ของแถม"):
 *   เหรียญ = ให้ช่วงพักมีอะไรทำ และสร้าง "ทางเลือก" เล็ก ๆ ว่าจะไล่เก็บไหม
 *   ไอพ่น  = ตาข่ายนิรภัย ทำให้ระบบ 1 ชีวิตไม่โหดจนเลิกเล่น โดยที่ยัง
 *            นับว่าตอบผิดอยู่ (คำนั้นตกกล่อง 1 และถูกคิวมาถามใหม่)
 *            → รอดในเชิงเกม แต่ไม่รอดในเชิงการเรียนรู้ ซึ่งเป็นสิ่งที่เราต้องการ
 *
 * ⚠️ ระยะห่างของเหรียญคิดเป็น "เวลา" ไม่ใช่ "ระยะทาง"
 * ถ้าใช้ระยะคงที่ พอเกมเร็วขึ้นเหรียญจะไหลผ่านเร็วจนเก็บไม่ทัน
 * แต่ถ้าคิดเป็นเวลา ความรู้สึกตอนเก็บจะเหมือนเดิมตลอดเกม
 */

import * as THREE from 'three';
import { CFG } from './config.js';
import { PALETTE } from './scene.js';

export const PICKUP = { COIN: 'coin', JET: 'jet', STAR: 'star' };

const LANE_X = i => (i - 1) * CFG.world.laneWidth;

export function createPickupPool(scene) {
  /* ── เหรียญ ─────────────────────────────────────────────── */
  const coinGeo = new THREE.TorusGeometry(0.26, 0.085, 8, 20);
  const coinMat = new THREE.MeshLambertMaterial({ color: 0xfbbf24, emissive: 0x6b4708 });
  const coins = [];
  for (let i = 0; i < CFG.coins.poolSize; i++) {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.visible = false;
    scene.add(mesh);
    coins.push({ mesh, active: false });
  }

  /* ── ไอพ่นสำรอง ─────────────────────────────────────────── */
  const jets = [];
  for (let i = 0; i < CFG.powerup.poolSize; i++) {
    const g = new THREE.Group();

    for (const x of [-0.16, 0.16]) {
      const tank = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.13, 0.34, 4, 10),
        new THREE.MeshLambertMaterial({ color: 0xe8eef8, emissive: 0x1b2a3a })
      );
      tank.position.x = x;
      g.add(tank);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.3, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.9 })
      );
      flame.rotation.x = Math.PI;
      flame.position.set(x, -0.42, 0);
      g.add(flame);
    }

    // วงแหวนเรืองแสงรอบตัว ทำให้เห็นแต่ไกลว่า "นี่ของหายาก"
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.035, 8, 24),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.75 })
    );
    halo.rotation.x = Math.PI / 2;
    g.add(halo);

    g.visible = false;
    scene.add(g);
    jets.push({ group: g, halo, active: false });
  }

  /* ── ดาวสะสม (ปลดล็อกด่านโบนัส) ─────────────────────────
   * วางไว้สูงกว่าเหรียญ ต้องกระโดดเก็บ = เป็น "การตัดสินใจ" ไม่ใช่ของแจกฟรี
   * และการกระโดดกลางช่วงพักมีความเสี่ยงจริง เพราะอาจลงมาเจออุกกาบาตพอดี */
  const stars = [];
  for (let i = 0; i < CFG.stars.poolSize; i++) {
    const g = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0 })
    );
    core.scale.set(1, 1.45, 1);
    g.add(core);

    const glow = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.52, 0),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.32 })
    );
    glow.scale.set(1, 1.5, 1);
    g.add(glow);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.03, 8, 26),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI / 2.2;
    g.add(ring);

    g.visible = false;
    scene.add(g);
    stars.push({ group: g, core, glow, ring, active: false });
  }

  let spin = 0;

  return {
    spawnStar(lane, z) {
      const s = stars.find(o => !o.active);
      if (!s) return null;
      s.active = true;
      s.group.visible = true;
      s.group.position.set(LANE_X(lane), CFG.stars.y, z);
      return s;
    },

    /** @param {number} [y] ระบุความสูงเองได้ (ด่านโบนัสมีเหรียญ 2 ชั้น) */
    spawnCoin(lane, z, y = CFG.coins.y) {
      const c = coins.find(o => !o.active);
      if (!c) return null;
      c.active = true;
      c.mesh.visible = true;
      c.mesh.position.set(LANE_X(lane), y, z);
      return c;
    },

    spawnJet(lane, z) {
      const j = jets.find(o => !o.active);
      if (!j) return null;
      j.active = true;
      j.group.visible = true;
      j.group.position.set(LANE_X(lane), CFG.powerup.y, z);
      return j;
    },

    update(dt, speed) {
      spin += dt;

      for (const c of coins) {
        if (!c.active) continue;
        c.mesh.position.z += speed * dt;
        c.mesh.rotation.y = spin * 3.2;      // หมุนให้แวบสะท้อนแสง = ตาจับได้ง่าย
        if (c.mesh.position.z > CFG.world.despawnZ) {
          c.active = false;
          c.mesh.visible = false;
        }
      }

      for (const j of jets) {
        if (!j.active) continue;
        j.group.position.z += speed * dt;
        j.group.rotation.y = spin * 1.6;
        j.group.position.y = CFG.powerup.y + Math.sin(spin * 3) * 0.12;
        j.halo.scale.setScalar(1 + Math.sin(spin * 5) * 0.08);
        if (j.group.position.z > CFG.world.despawnZ) {
          j.active = false;
          j.group.visible = false;
        }
      }

      for (const s of stars) {
        if (!s.active) continue;
        s.group.position.z += speed * dt;
        s.group.rotation.y = spin * 2.4;
        s.group.position.y = CFG.stars.y + Math.sin(spin * 2.6) * 0.16;
        s.glow.scale.setScalar(1 + Math.sin(spin * 6) * 0.12);
        s.ring.rotation.z = spin * 1.4;
        if (s.group.position.z > CFG.world.despawnZ) {
          s.active = false;
          s.group.visible = false;
        }
      }
    },

    /** คืนรายการของที่เก็บได้ในเฟรมนี้ */
    collect(player) {
      const px = player.x();
      const py = player.group.position.y;
      const got = [];

      for (const c of coins) {
        if (!c.active) continue;
        const p = c.mesh.position;
        if (Math.abs(p.z - CFG.world.playerZ) > CFG.coins.pickRadius) continue;
        if (Math.abs(p.x - px) > CFG.coins.pickRadius) continue;
        // เทียบกับ "กลางลำตัว" (เท้า + 0.8) และช่วงรับต้องแคบกว่าระยะห่าง
        // ระหว่างชั้นบิน 2 ชั้น (1.7) ไม่งั้นบินชั้นล่างจะดูดเหรียญชั้นบนไปด้วย
        if (Math.abs(p.y - (py + 0.8)) > 1.35) continue;
        c.active = false;
        c.mesh.visible = false;
        got.push(PICKUP.COIN);
      }

      for (const j of jets) {
        if (!j.active) continue;
        const p = j.group.position;
        if (Math.abs(p.z - CFG.world.playerZ) > CFG.powerup.pickRadius) continue;
        if (Math.abs(p.x - px) > CFG.powerup.pickRadius) continue;
        if (Math.abs(p.y - (py + 0.8)) > 1.6) continue;
        j.active = false;
        j.group.visible = false;
        got.push(PICKUP.JET);
      }

      for (const s of stars) {
        if (!s.active) continue;
        const p = s.group.position;
        if (Math.abs(p.z - CFG.world.playerZ) > CFG.stars.pickRadius) continue;
        if (Math.abs(p.x - px) > CFG.stars.pickRadius) continue;
        // ช่วงรับใจกว้างเท่าเหรียญ — วิ่งผ่านในเลนเดียวกันก็เก็บได้ (หรือกระโดดผ่านก็ได้)
        // "เดินผ่านดาวแล้วต้องเก็บได้" คือสิ่งที่ผู้เล่นคาดหวัง
        if (Math.abs(p.y - (py + 0.8)) > CFG.stars.pickY) continue;
        s.active = false;
        s.group.visible = false;
        got.push(PICKUP.STAR);
      }

      return got;
    },

    reset() {
      for (const c of coins) { c.active = false; c.mesh.visible = false; }
      for (const j of jets) { j.active = false; j.group.visible = false; }
      for (const s of stars) { s.active = false; s.group.visible = false; }
    },
  };
}
