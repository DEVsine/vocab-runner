/**
 * player.js — นักบินอวกาศ: เปลี่ยนเลน กระโดด สไลด์ และ "การจำปุ่มที่กดค้างไว้"
 *
 * ── ตัวละครประกอบจากรูปทรงพื้นฐานล้วน ไม่มีไฟล์โมเดล ──
 * แคปซูล 2 อัน = ขา, แคปซูล 2 อัน = แขน, กล่อง = ลำตัว/ถังออกซิเจน, ทรงกลม = หมวก
 * เคล็ดลับที่ทำให้มัน "ดูเป็นคน" ไม่ใช่กองกล่อง คือ **จุดหมุน (pivot)**:
 * แขนขาต้องหมุนรอบข้อไหล่/สะโพก ไม่ใช่รอบจุดกึ่งกลางของตัวมันเอง
 * เราจึงใส่แขน/ขาไว้ใน Group ที่วางไว้ตรงข้อต่อ แล้วเลื่อนตัว mesh ลงมาครึ่งความยาว
 *
 * ── input buffering: จุดที่ทำให้เกมรู้สึกลื่นหรือหนืด ──
 * สมมติผู้เล่นกดขวาแล้วตัวละครกำลังเลื่อนอยู่ (ใช้เวลา 140ms)
 * ถ้ากดขวาซ้ำกลางทาง โค้ดแบบง่าย ๆ จะ "ทิ้ง" ปุ่มนั้นเพราะยังเลื่อนไม่เสร็จ
 * ผู้เล่นจะรู้สึกว่า "เกมไม่รับปุ่มกู" ซึ่งเป็นคำบ่นอันดับหนึ่งของเกมแนวนี้
 * ทางแก้: เก็บปุ่มใส่ buffer แล้วทำต่อทันทีที่ว่าง (แต่หมดอายุใน 240ms
 * ไม่งั้นเกมจะเด้งไปเลนที่ผู้เล่นกดไว้ตั้งแต่เมื่อวินาทีที่แล้ว)
 */

import * as THREE from 'three';
import { CFG } from './config.js';
import { PALETTE } from './scene.js';

/** easeOutQuad — ออกตัวเร็วแล้วผ่อนเข้าที่ ให้ความรู้สึก "กระฉับกระเฉง" */
const easeOutQuad = t => 1 - (1 - t) * (1 - t);

/** สร้างนักบินอวกาศสูง ~1.65 หน่วย (เท่ากับ CFG.player.height ที่ใช้คิด hitbox) */
function buildAstronaut() {
  const rig = new THREE.Group();

  const mat = {
    suit: new THREE.MeshLambertMaterial({ color: 0xe9eff9 }),
    suitDim: new THREE.MeshLambertMaterial({ color: 0xbcc6da }),
    joint: new THREE.MeshLambertMaterial({ color: 0x39445f }),
    pack: new THREE.MeshLambertMaterial({ color: 0x808da8 }),
    visor: new THREE.MeshBasicMaterial({ color: 0x0a1526 }),
    cyan: new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
    amber: new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  };

  const HIP_Y = 0.70;
  const SHOULDER_Y = 1.14;

  // ── ลำตัว ──
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.32), mat.suit);
  torso.position.y = 0.96;
  rig.add(torso);

  // แถบสะท้อนแสงรอบตัว (แถบส้มบนชุด NASA) — ช่วยให้ตาแยกตัวละครออกจากพื้นหลังเข้ม
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.34), mat.amber);
  belt.position.y = 0.78;
  rig.add(belt);

  // ── ถังออกซิเจนด้านหลัง (เราเห็นตัวละครจากข้างหลัง มันเลยเป็นด้านที่เด่นที่สุด) ──
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.22), mat.pack);
  pack.position.set(0, 0.99, 0.26);
  rig.add(pack);

  for (const x of [-0.11, 0.11]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), mat.cyan);
    light.position.set(x, 1.14, 0.39);
    rig.add(light);
  }
  const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.24), mat.amber);
  packStripe.position.set(0, 0.86, 0.26);
  rig.add(packStripe);

  // ── คอ + หมวก ──
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.08, 12), mat.joint);
  neck.position.y = 1.255;
  rig.add(neck);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 16), mat.suit);
  helmet.position.y = 1.44;
  rig.add(helmet);

  // กระจกหน้ากาก (อยู่ด้านหน้า = ฝั่งที่หันออกจากกล้อง เห็นแค่ขอบ ๆ)
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), mat.visor);
  visor.scale.set(1, 0.82, 0.55);
  visor.position.set(0, 1.45, -0.085);
  rig.add(visor);

  // ตะเข็บหมวกเรืองแสง — ทำให้มองเห็นหัวชัดจากข้างหลังในทางเดินมืด ๆ
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.212, 0.018, 8, 28), mat.cyan);
  seam.rotation.y = Math.PI / 2;
  seam.position.y = 1.44;
  rig.add(seam);

  // ── แขน: Group อยู่ที่ข้อไหล่ แล้วเลื่อน mesh ลงครึ่งความยาว ──
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.29, SHOULDER_Y, 0);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.28, 4, 10), mat.suit);
    arm.position.y = -0.23;
    pivot.add(arm);

    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 0.15), mat.joint);
    glove.position.y = -0.45;
    pivot.add(glove);

    rig.add(pivot);
    return pivot;
  }

  // ── ขา ──
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.135, HIP_Y, 0);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.41, 4, 10), mat.suitDim);
    leg.position.y = -0.31;
    pivot.add(leg);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.29), mat.joint);
    boot.position.set(0, -0.58, -0.05);
    pivot.add(boot);

    rig.add(pivot);
    return pivot;
  }

  const armL = makeArm(-1);
  const armR = makeArm(1);
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // ── เปลวไอพ่นตอนกระโดด (โผล่เฉพาะตอนลอย) ──
  const thrusters = [];
  for (const x of [-0.13, 0.13]) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.3, 10),
      new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.85 })
    );
    flame.rotation.x = Math.PI;      // ชี้ลงพื้น
    flame.position.set(x, 0.72, 0.28);
    flame.visible = false;
    rig.add(flame);
    thrusters.push(flame);
  }

  return { rig, armL, armR, legL, legR, torso, helmet, thrusters };
}

export function createPlayer(scene) {
  const group = new THREE.Group();
  const a = buildAstronaut();
  group.add(a.rig);

  // วงแหวนใต้เท้า ช่วยให้เห็นว่าตัวเองอยู่เลนไหนตอนลอยอยู่กลางอากาศ
  const shadowRing = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.52, 22),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.3 })
  );
  shadowRing.rotation.x = -Math.PI / 2;
  shadowRing.position.y = 0.06;
  group.add(shadowRing);

  group.position.set(0, 0, CFG.world.playerZ);
  scene.add(group);

  const state = {
    lane: 1,                 // 0 = ซ้าย, 1 = กลาง, 2 = ขวา
    x: 0,
    laneFrom: 0,
    laneTo: 0,
    laneT: 1,                // 1 = เลื่อนเสร็จแล้ว
    jumpT: 1,                // < 1 = กำลังกระโดด
    slideT: 1,               // < 1 = กำลังสไลด์
    boostT: 1,               // < 1 = กำลังพุ่งด้วยไอพ่นสำรอง
    flying: false,           // อยู่ในด่านโบนัส "ทางช้างเผือก"
    flyBlend: 0,             // 0 = ยืนบนพื้น, 1 = ลอยเต็มตัว (ไล่ขึ้น/ลงแบบนุ่ม ๆ)
    flyLevel: 0,             // 0 = ระดับต่ำ, 1 = ระดับสูง (สลับด้วย ↑/↓)
    flyCurY: CFG.bonus.flyLowY,
    buffer: null,            // { action, at }
    runT: 0,
    lastHalfCycle: 0,        // ใช้จับจังหวะฝีเท้า

    // ── มิติแนวตั้ง: "พื้นใต้เท้า" ไม่ใช่ 0 เสมอไปอีกแล้ว ──
    // ทุกท่า (กระโดด/สไลด์/วิ่ง) คำนวณเทียบ baseY แทนพื้นโลก
    // → ขึ้นไปอยู่บนหลังคายานได้โดย "ไม่ต้องแก้สูตรท่าไหนเลย" แค่ยกฐานขึ้น
    baseY: 0,                // ความสูงพื้นที่ยืนอยู่จริงตอนนี้
    platformY: 0,            // ความสูงพื้นเป้าหมาย (main บอกมาทุกเฟรมจากตำแหน่งยาน)
    armed: false,            // ใส่ไอพ่นอยู่ → มีเปลวที่หลังตลอด (กันตาย 1 ครั้ง)
    wasAirborne: false,      // เฟรมก่อนลอยอยู่ไหม — ใช้จับจังหวะ "เท้าแตะพื้น" เพื่อเสียงตุบ
    justMounted: false,      // เพิ่งเหยียบหลังคายานเฟรมนี้ (มีเสียง mount แล้ว ไม่ต้องตุบซ้ำ)
  };

  const laneX = i => (i - 1) * CFG.world.laneWidth;

  function startLaneMove(dir) {
    const target = Math.max(0, Math.min(CFG.world.laneCount - 1, state.lane + dir));
    if (target === state.lane) return false;
    state.laneFrom = state.x;
    state.laneTo = laneX(target);
    state.lane = target;
    state.laneT = 0;
    return true;
  }

  function isBusy() {
    return state.laneT < 1;
  }

  /** รับ action จาก input — ถ้ายังทำไม่ได้ ให้เก็บไว้ในบัฟเฟอร์ */
  function handle(action, sfx) {
    const now = performance.now();

    if (action === 'left' || action === 'right') {
      if (isBusy()) {
        state.buffer = { action, at: now };
        return;
      }
      if (startLaneMove(action === 'left' ? -1 : 1)) sfx?.lane();
      return;
    }

    // ด่านโบนัส "ทางช้างเผือก": บินระดับเดียว เลื่อนซ้าย/ขวาอย่างเดียว
    // ปุ่มขึ้น/ลงถูกปิดที่นี่ (return ทิ้งไปเฉย ๆ) — ถ้าไม่ดักไว้ มันจะตกไปเข้ากติกา
    // กระโดด/สไลด์ด้านล่างแล้วตัวละครจะเด้งขึ้น/หมอบระหว่างบิน ซึ่งไม่ใช่สิ่งที่ต้องการ
    if (state.flying) return;

    if (action === 'jump') {
      if (state.jumpT < 1 || state.slideT < 1) {
        state.buffer = { action, at: now };
        return;
      }
      state.jumpT = 0;
      sfx?.jump();
      return;
    }

    if (action === 'slide') {
      if (state.slideT < 1 || state.jumpT < 1) {
        state.buffer = { action, at: now };
        return;
      }
      state.slideT = 0;
      sfx?.slide();
    }
  }

  function consumeBuffer(sfx) {
    if (!state.buffer) return;
    const age = performance.now() - state.buffer.at;
    if (age > CFG.input.bufferMs) { state.buffer = null; return; }

    const { action } = state.buffer;
    const canLane = (action === 'left' || action === 'right') && !isBusy();
    const canAir = (action === 'jump' || action === 'slide') && state.jumpT >= 1 && state.slideT >= 1;
    if (canLane || canAir) {
      state.buffer = null;
      handle(action, sfx);
    }
  }

  function update(dt, sfx) {
    state.runT += dt;

    // เลื่อนเลน
    if (state.laneT < 1) {
      state.laneT = Math.min(1, state.laneT + dt / (CFG.player.laneChangeMs / 1000));
      state.x = state.laneFrom + (state.laneTo - state.laneFrom) * easeOutQuad(state.laneT);
    }

    // กระโดด: พาราโบลา y = h·4t(1−t) → สูงสุดที่กลางอากาศพอดี
    let y = 0;
    let airborne = state.jumpT < 1;
    if (airborne) {
      state.jumpT = Math.min(1, state.jumpT + dt / (CFG.player.jumpMs / 1000));
      y = CFG.player.jumpHeight * 4 * state.jumpT * (1 - state.jumpT);
    }

    // ไอพ่นสำรอง: ลอยสูงกว่าและนานกว่าการกระโดดปกติมาก
    // ใช้ sin แทนพาราโบลาเพราะอยากให้ "ค้างอยู่บนยอด" นานหน่อย = รู้สึกว่ากำลังบิน
    if (state.boostT < 1) {
      state.boostT = Math.min(1, state.boostT + dt / (CFG.powerup.boostMs / 1000));
      y = Math.max(y, CFG.powerup.boostHeight * Math.sin(state.boostT * Math.PI));
      airborne = true;
    }

    // สไลด์: ทิ้งตัวลงนอนหงาย (หมุนรอบเท้า) — ดูเป็นการสไลด์จริง ไม่ใช่ตัวหดแบน
    let slideK = 0;
    if (state.slideT < 1) {
      state.slideT = Math.min(1, state.slideT + dt / (CFG.player.slideMs / 1000));
      slideK = Math.sin(state.slideT * Math.PI);   // ลงแล้วค่อยลุกกลับ
    }

    // ── โหมดบิน (ด่านโบนัส) ──
    // ไล่ค่า 2 ชั้น: flyBlend = "ลอยขึ้นแค่ไหนแล้ว", flyCurY = "อยู่ระดับไหน"
    // แยกกันเพราะช่วงทะยานขึ้น/ร่อนลงต้องช้า (ให้รู้สึกยิ่งใหญ่)
    // แต่การสลับระดับระหว่างบินต้องไว (ไม่งั้นเก็บเหรียญไม่ทัน)
    const flyRate = 1 / (state.flying ? CFG.bonus.liftSeconds : CFG.bonus.landSeconds);
    state.flyBlend = Math.max(0, Math.min(1,
      state.flyBlend + (state.flying ? flyRate : -flyRate) * dt));

    if (state.flyBlend > 0) {
      const target = state.flyLevel ? CFG.bonus.flyHighY : CFG.bonus.flyLowY;
      state.flyCurY += (target - state.flyCurY) * Math.min(1, dt / (CFG.bonus.flyLevelMs / 1000));
      const hover = state.flyCurY + Math.sin(state.runT * 2.2) * 0.12;
      y = y * (1 - state.flyBlend) + hover * state.flyBlend;
      if (state.flyBlend > 0.15) airborne = true;
    }

    // ── พื้นใต้เท้า (หลังคายานลำเลียง) ──
    // ขาขึ้น: setPlatform จัดการ snap แล้ว (เหยียบปุ๊บยืนปั๊บ ไม่มีเด้ง)
    // ขาลง: ร่วงด้วยอัตราคงที่ — พ้นท้ายยาน/เปลี่ยนเลนออก = ตกสู่พื้นแบบมีน้ำหนัก
    if (state.baseY > state.platformY) {
      state.baseY = Math.max(state.platformY, state.baseY - dt * 11);
      if (state.baseY > state.platformY) airborne = true;   // ท่าลอยตัวระหว่างร่วง
    } else {
      state.baseY = state.platformY;
    }

    group.position.x = state.x;
    group.position.y = state.baseY + y;

    /* ── ท่าทาง ─────────────────────────────────────────── */
    const cadence = state.runT * 12;
    const swing = Math.sin(cadence);

    if (airborne) {
      // ลอยอยู่: เก็บขา กางแขนไปข้างหลังเล็กน้อย
      a.legL.rotation.x = THREE.MathUtils.lerp(a.legL.rotation.x, 0.85, dt * 14);
      a.legR.rotation.x = THREE.MathUtils.lerp(a.legR.rotation.x, 0.35, dt * 14);
      a.armL.rotation.x = THREE.MathUtils.lerp(a.armL.rotation.x, -0.9, dt * 14);
      a.armR.rotation.x = THREE.MathUtils.lerp(a.armR.rotation.x, -0.9, dt * 14);
    } else if (slideK > 0.05) {
      // สไลด์: ขาเหยียดไปข้างหน้า แขนแนบตัว
      a.legL.rotation.x = THREE.MathUtils.lerp(a.legL.rotation.x, 1.1, dt * 16);
      a.legR.rotation.x = THREE.MathUtils.lerp(a.legR.rotation.x, 0.9, dt * 16);
      a.armL.rotation.x = THREE.MathUtils.lerp(a.armL.rotation.x, 0.3, dt * 16);
      a.armR.rotation.x = THREE.MathUtils.lerp(a.armR.rotation.x, 0.3, dt * 16);
    } else {
      // วิ่ง: แขนขาสลับข้างกัน (นี่คือสิ่งที่ทำให้อ่านออกว่า "กำลังวิ่ง")
      a.legL.rotation.x = swing * 0.78;
      a.legR.rotation.x = -swing * 0.78;
      a.armL.rotation.x = -swing * 0.62;
      a.armR.rotation.x = swing * 0.62;

      // เสียงฝีเท้าตรงจังหวะที่ขาแตะพื้นจริง ๆ (ทุกครึ่งรอบของ sin)
      // เสียงที่ไม่ตรงกับภาพจะรู้สึก "ผิด" ทันทีแม้อธิบายไม่ถูกว่าผิดตรงไหน
      const halfCycle = Math.floor(cadence / Math.PI);
      if (halfCycle !== state.lastHalfCycle) {
        state.lastHalfCycle = halfCycle;
        sfx?.step();
      }
    }

    // เอนหลังตอนสไลด์ (หมุนบวก = หัวไปทาง +z คือเอนเข้าหากล้อง)
    a.rig.rotation.x = slideK * 1.0;
    a.rig.position.y = -slideK * 0.06;

    // เอียงตัวตามทิศที่เลื่อนเลน + เด้งขึ้นลงตอนวิ่ง = ดูมีชีวิต
    const laneVel = state.laneT < 1 ? (state.laneTo - state.laneFrom) : 0;
    a.rig.rotation.z = THREE.MathUtils.lerp(a.rig.rotation.z, -laneVel * 0.09, dt * 12);
    a.torso.position.y = 0.96 + (airborne || slideK > 0.05 ? 0 : Math.abs(Math.cos(cadence)) * 0.035);
    a.helmet.rotation.y = Math.sin(state.runT * 2.2) * 0.12;

    // เปลวไอพ่น: ตอนลอย = เปลวเต็ม, ตอน "ใส่ไอพ่น" อยู่ = เปลวเลียเบา ๆ ตลอด (ความเท่!)
    for (const flame of a.thrusters) {
      flame.visible = airborne || state.armed;
      if (airborne) flame.scale.y = 0.7 + Math.random() * 0.6;        // เปลวไฟกระพริบ
      else if (state.armed) flame.scale.y = 0.3 + Math.random() * 0.15; // ติดเครื่องรอ
    }

    shadowRing.material.opacity = 0.3 * (1 - Math.min(1, y / CFG.player.jumpHeight) * 0.75);
    shadowRing.scale.setScalar(1 - Math.min(1, y / CFG.player.jumpHeight) * 0.3);

    // เสียง "ตุบ" ตอนเท้าแตะพื้น — จับจังหวะเปลี่ยนสถานะ ลอย→ยืน
    // ครอบคลุมทุกทาง: จบการกระโดด, จบบูสต์ไอพ่น, ร่วงจากหลังคายาน, ร่อนลงจากโบนัส
    // ยกเว้นตอนเพิ่งเหยียบหลังคายาน (มีเสียง mount ของตัวเองแล้ว ตุบซ้อนจะรก)
    if (state.wasAirborne && !airborne && !state.justMounted) sfx?.land();
    state.wasAirborne = airborne;
    state.justMounted = false;

    consumeBuffer(sfx);
  }

  function reset() {
    state.lane = 1;
    state.x = 0;
    state.laneFrom = 0;
    state.laneTo = 0;
    state.laneT = 1;
    state.jumpT = 1;
    state.slideT = 1;
    state.boostT = 1;
    state.flying = false;
    state.flyBlend = 0;
    state.flyLevel = 0;
    state.flyCurY = CFG.bonus.flyLowY;
    state.buffer = null;
    state.baseY = 0;
    state.platformY = 0;
    state.armed = false;
    state.wasAirborne = false;
    state.justMounted = false;
    group.position.set(0, 0, CFG.world.playerZ);
    a.rig.rotation.set(0, 0, 0);
    a.rig.position.y = 0;
  }

  /** ใช้ไอพ่นสำรอง — พุ่งขึ้นเหนือลำแสงเลเซอร์ */
  function boost() {
    state.boostT = 0;
    state.jumpT = 1;
    state.slideT = 1;
    state.buffer = null;
  }

  /** เข้า/ออกโหมดบินของด่านโบนัส */
  function setFlying(on) {
    state.flying = on;
    if (on) {
      state.jumpT = 1;
      state.slideT = 1;
      state.boostT = 1;
      state.flyLevel = 0;
      state.buffer = null;
    }
  }

  /**
   * บอกความสูง "พื้นใต้เท้า" ของเฟรมนี้ (0 = พื้นสถานี, roofY = บนหลังคายาน)
   * ตอนยกขึ้น (เหยียบหลังคา) ต้องตัดการกระโดดทิ้งด้วย — ไม่งั้นพาราโบลาที่ค้างอยู่
   * จะไปบวกทับฐานใหม่ ตัวละครเด้งขึ้นเกินหลังคาไปอีกชั้น
   */
  function setPlatform(h) {
    if (h > state.baseY + 0.05) {
      state.jumpT = 1;
      state.baseY = h;       // เหยียบปุ๊บยืนปั๊บ — main ยืนยันแล้วว่าสูงถึงระดับหลังคา
      state.justMounted = true;   // เฟรมถัดไปไม่ต้องเล่นเสียง land ซ้อนเสียง mount
    }
    state.platformY = h;
  }

  return {
    group,
    state,
    handle,
    update,
    reset,
    boost,
    setFlying,
    setPlatform,
    onPlatform() { return state.baseY > 0.4; },
    setArmed(on) { state.armed = on; },
    isFlying() { return state.flying || state.flyBlend > 0.02; },

    /**
     * เลนที่ใช้ "ตัดสินคำตอบ" = เลนที่ใกล้ตัวละครที่สุดจริง ๆ ตอนแตะกำแพง
     * ไม่ใช่เลนเป้าหมายที่กดไว้ — เพื่อให้การสไลด์วินาทีสุดท้ายยังทัน
     * (ถ้าเลื่อนไปได้เกินครึ่งทางแล้ว ถือว่าถึงเลนใหม่)
     */
    nearestLane() {
      const i = Math.round(state.x / CFG.world.laneWidth) + 1;
      return Math.max(0, Math.min(CFG.world.laneCount - 1, i));
    },

    isJumping() { return state.jumpT > 0.08 && state.jumpT < 0.92; },
    isSliding() { return state.slideT > 0.08 && state.slideT < 0.92; },
    isBoosting() { return state.boostT < 1; },
    x() { return state.x; },
  };
}
