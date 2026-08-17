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
import { PALETTE, toonMat } from './scene.js';

export const PICKUP = { COIN: 'coin', JET: 'jet', STAR: 'star' };
// ไอเทมจับเวลา (EZL-71): collect() คืน "ชนิด" ตรงจาก CFG.boosts.items (magnet/x2)
// ไม่ใส่ใน PICKUP เพราะรายชื่อจริงอยู่ที่ config — pool/รูปทรง/สีตามชนิดใหม่ได้เอง
// (แต่ "พฤติกรรม" ของชนิดใหม่ยังต้องเขียนโค้ดอยู่ดี เช่น แรงดูดของ magnet ข้างล่าง)

/** รูปทรงกล่องไอเทมที่เลือกได้จาก config (`shape`) — ผิดคีย์ = ถอยไปใช้กล่อง */
const BOOST_GEO = {
  cube: () => new THREE.BoxGeometry(0.55, 0.55, 0.55),
  diamond: () => new THREE.OctahedronGeometry(0.42, 0),
  sphere: () => new THREE.SphereGeometry(0.4, 18, 14),
};

const LANE_X = i => (i - 1) * CFG.world.laneWidth;

export function createPickupPool(scene) {
  /* ── เหรียญ ─────────────────────────────────────────────── */
  const coinGeo = new THREE.TorusGeometry(0.26, 0.085, 8, 20);
  const coinMat = toonMat(0xfbbf24, { emissive: 0x6b4708 });
  const coins = [];
  for (let i = 0; i < CFG.coins.poolSize; i++) {
    const mesh = new THREE.Mesh(coinGeo, coinMat);
    mesh.visible = false;
    scene.add(mesh);
    coins.push({ mesh, active: false });
  }

  /* ── เกราะ/อาวุธสำรอง ─────────────────────────────────────
   * หมวดของไอเทมยังใช้ PICKUP.JET เพื่อรักษา save/gameplay contract เดิม แต่ภาพที่เห็น
   * ไม่ควรถูกล็อกเป็นถังไอพ่น: Black Panther เก็บ "กรงเล็บ" และตัวอื่นเก็บอุปกรณ์
   * ประจำตัวของตัวเอง การแยก visual ออกจากชนิดไอเทมทำให้กติกาคงเดิมแต่ภาพไม่โกหกผู้เล่น */
  const jets = [];
  for (let i = 0; i < CFG.powerup.poolSize; i++) {
    const g = new THREE.Group();
    const jetVisual = new THREE.Group();
    jetVisual.name = 'jet-pickup';
    g.add(jetVisual);

    for (const x of [-0.16, 0.16]) {
      const tank = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.13, 0.34, 4, 10),
        toonMat(0xe8eef8, { emissive: 0x1b2a3a })
      );
      tank.position.x = x;
      jetVisual.add(tank);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.3, 10),
        new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.9 })
      );
      flame.rotation.x = Math.PI;
      flame.position.set(x, -0.42, 0);
      jetVisual.add(flame);
    }

    // กรงเล็บสามแฉกบนถุงมือดำ: silhouette ต้องอ่านออกตั้งแต่ไกล ไม่ใช่กล่องสีม่วง
    // ใบมีดชี้ขึ้นและกางเล็กน้อย จึงยังเห็นครบสามซี่แม้ไอเทมกำลังหมุนรอบแกน Y
    const clawVisual = new THREE.Group();
    clawVisual.name = 'claw-pickup';
    clawVisual.visible = false;
    clawVisual.rotation.z = -0.12;

    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.16, 0.22, 6),
      toonMat(0x11131a, { emissive: 0x180b2c })
    );
    cuff.position.y = -0.22;
    clawVisual.add(cuff);

    const glove = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.25, 0),
      toonMat(0x1f2430, { emissive: 0x26113f })
    );
    glove.scale.set(1.05, 0.78, 0.62);
    glove.position.y = -0.04;
    clawVisual.add(glove);

    const clawGlow = [];
    for (const finger of [-1, 0, 1]) {
      const knuckle = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.065, 0),
        toonMat(0x555e70)
      );
      knuckle.position.set(finger * 0.115, 0.105, -0.04);
      clawVisual.add(knuckle);

      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.048, 0.48, 5),
        toonMat(0xe8edff, { emissive: 0x7e22ce, emissiveIntensity: 0.65 })
      );
      blade.position.set(finger * 0.13, 0.34, -0.035);
      blade.rotation.z = finger * -0.13;
      clawVisual.add(blade);
      clawGlow.push(blade);
    }

    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.095, 0),
      new THREE.MeshBasicMaterial({ color: 0xc084fc })
    );
    gem.position.set(0, -0.035, -0.175);
    clawVisual.add(gem);
    g.add(clawVisual);

    // วงแหวนเรืองแสงรอบตัว ทำให้เห็นแต่ไกลว่า "นี่ของหายาก"
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.035, 8, 24),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.75 })
    );
    halo.rotation.x = Math.PI / 2;
    g.add(halo);

    g.visible = false;
    scene.add(g);
    jets.push({ group: g, halo, jetVisual, clawVisual, clawGlow, gem, active: false });
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

  /* ── ไอเทมจับเวลา: แม่เหล็ก / คะแนน ×2 (EZL-71) ─────────────
   * รูปทรง+สีมาจาก config ทั้งหมด — จูนหน้าตาไอเทมได้โดยไม่แตะโค้ดนี้
   * มีวงแหวนเรืองแสงแบบเดียวกับไอพ่น = ภาษาภาพเดียวกันว่า "ของพิเศษ เก็บเถอะ" */
  const boosts = [];
  for (const [type, bc] of Object.entries(CFG.boosts.items)) {
    for (let i = 0; i < CFG.boosts.poolPerType; i++) {
      const g = new THREE.Group();

      const core = new THREE.Mesh(
        (BOOST_GEO[bc.shape] || BOOST_GEO.cube)(),
        toonMat(bc.color, { emissive: bc.emissive })
      );
      g.add(core);

      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.52, 0.035, 8, 24),
        new THREE.MeshBasicMaterial({ color: bc.color, transparent: true, opacity: 0.75 })
      );
      halo.rotation.x = Math.PI / 2;
      g.add(halo);

      g.visible = false;
      scene.add(g);
      boosts.push({ type, group: g, halo, active: false });
    }
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

    spawnJet(lane, z, style = 'jet') {
      const j = jets.find(o => !o.active);
      if (!j) return null;
      const claws = style === 'claws';
      j.jetVisual.visible = !claws;
      j.clawVisual.visible = claws;
      j.halo.material.color.setHex(claws ? 0xa855f7 : PALETTE.cyan);
      j.group.userData.pickupStyle = claws ? 'claws' : 'jet';
      j.active = true;
      j.group.visible = true;
      j.group.position.set(LANE_X(lane), CFG.powerup.y, z);
      return j;
    },

    spawnBoost(type, lane, z) {
      const b = boosts.find(o => o.type === type && !o.active);
      if (!b) return null;
      b.active = true;
      b.group.visible = true;
      b.group.position.set(LANE_X(lane), CFG.boosts.y, z);
      return b;
    },

    /**
     * @param {{x:number,y:number}|null} [magnetAt]
     *        ตำแหน่งผู้เล่น (x, y ที่เท้า) ตอน "แม่เหล็กทำงาน" — main เป็นคนส่งเข้ามา
     *        โมดูลนี้แปลงเป็น "กลางลำตัว" เอง ด้วยกติกาเดียวกับ collect() ข้างล่าง
     *        (offset +0.8 ต้องมีเจ้าของที่เดียว — ถ้าให้ผู้เรียกบวกมาเอง จูนทีต้องแก้สองไฟล์)
     */
    update(dt, speed, magnetAt = null) {
      spin += dt;
      const mg = CFG.boosts.items.magnet;

      for (const c of coins) {
        if (!c.active) continue;
        const p = c.mesh.position;

        // แม่เหล็ก: เหรียญ "ทุกเลน" ในระยะบินเข้าหาตัวเป็นเส้นตรง แล้วถูกเก็บ
        // ผ่านเส้นทาง collect ปกติ (ได้ทั้งคะแนน/ยอดเหรียญจริง ไม่ใช่หายไปเฉย ๆ)
        // ความเร็วดูด = ความเร็วโลก + pullSpeed → ไล่ทันเสมอไม่ว่าเกมเร็วแค่ไหน
        // และ clamp ก้าวสุดท้ายไม่ให้วิ่งเลยเป้าจนแกว่งไปมา
        //
        // ขอบเขตของ "ทุกเลน" (สำคัญ — เลน ≠ ทุกที่บนจอ):
        //   แนวลึก: เฉพาะเหรียญที่ยัง "อยู่ข้างหน้า" — ของที่พลาดไปแล้วไม่ย้อนกลับมา
        //   แนวตั้ง (attractY): เหรียญบนหลังคายานต้องไม่ถูกลากทะลุตัวยานลงมา
        //   เพราะมันคือรางวัลของการเสี่ยงกระโดดขึ้นไป — แม่เหล็กห้ามแจกของชั้นนั้นฟรี
        //   (ยืนบนหลังคาแล้วเปิดแม่เหล็ก = ดูดชั้นหลังคาแทน ซึ่งถูกต้องตามเจตนา)
        const ty = magnetAt ? magnetAt.y + 0.8 : 0;
        if (magnetAt
            && p.z > -mg.attractZ && p.z < CFG.world.playerZ + 0.6
            && Math.abs(p.y - ty) <= mg.attractY) {
          const dx = magnetAt.x - p.x, dy = ty - p.y, dz = CFG.world.playerZ - p.z;
          const dist = Math.hypot(dx, dy, dz);
          const step = (speed + mg.pullSpeed) * dt;
          if (dist > 1e-6) {
            const k = Math.min(1, step / dist);
            p.x += dx * k; p.y += dy * k; p.z += dz * k;
          }
        } else {
          p.z += speed * dt;
        }

        c.mesh.rotation.y = spin * 3.2;      // หมุนให้แวบสะท้อนแสง = ตาจับได้ง่าย
        if (p.z > CFG.world.despawnZ) {
          c.active = false;
          c.mesh.visible = false;
        }
      }

      for (const b of boosts) {
        if (!b.active) continue;
        b.group.position.z += speed * dt;
        b.group.rotation.y = spin * 2.0;
        b.group.position.y = CFG.boosts.y + Math.sin(spin * 3) * 0.12;
        b.halo.scale.setScalar(1 + Math.sin(spin * 5) * 0.08);
        if (b.group.position.z > CFG.world.despawnZ) {
          b.active = false;
          b.group.visible = false;
        }
      }

      for (const j of jets) {
        if (!j.active) continue;
        j.group.position.z += speed * dt;
        j.group.rotation.y = spin * 1.6;
        j.group.position.y = CFG.powerup.y + Math.sin(spin * 3) * 0.12;
        j.halo.scale.setScalar(1 + Math.sin(spin * 5) * 0.08);
        if (j.clawVisual.visible) {
          const pulse = 1 + Math.sin(spin * 8) * 0.08;
          j.gem.scale.setScalar(pulse);
          for (const blade of j.clawGlow) blade.material.emissiveIntensity = 0.5 + pulse * 0.22;
        }
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

      for (const b of boosts) {
        if (!b.active) continue;
        const p = b.group.position;
        if (Math.abs(p.z - CFG.world.playerZ) > CFG.boosts.pickRadius) continue;
        if (Math.abs(p.x - px) > CFG.boosts.pickRadius) continue;
        if (Math.abs(p.y - (py + 0.8)) > 1.6) continue;
        b.active = false;
        b.group.visible = false;
        got.push(b.type);
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
      for (const b of boosts) { b.active = false; b.group.visible = false; }
    },
  };
}
