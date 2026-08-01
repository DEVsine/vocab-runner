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
import { PALETTE, toonMat } from './scene.js';
import { characterById } from './characters.js';

/** easeOutQuad — ออกตัวเร็วแล้วผ่อนเข้าที่ ให้ความรู้สึก "กระฉับกระเฉง" */
const easeOutQuad = t => 1 - (1 - t) * (1 - t);

/**
 * สร้างนักบินอวกาศสูง ~1.65 หน่วย (เท่ากับ CFG.player.height ที่ใช้คิด hitbox)
 *
 * ── สัดส่วนแบบเกมวิ่ง: ~3.5 หัว ไม่ใช่ 7.5 หัวแบบคนจริง ──
 * ในเกมวิ่ง ผู้เล่นเห็นตัวละคร "จากด้านหลัง สูงราว 150px" ตลอดเวลา
 * ที่ขนาดนั้นรายละเอียดใบหน้าไม่มีใครเห็น สิ่งที่เห็นคือ "เงาทึบที่ขยับ"
 * เพราะฉะนั้นทุกอย่างที่บอกว่านี่คือตัวละครต้องอยู่ในเส้นรอบรูป ไม่ใช่ในพื้นผิว
 *
 * กติกาที่ใช้ปั้น:
 *   หัวกว้างเกือบเท่าไหล่ (0.50 vs 0.52) — หัวคือสิ่งแรกที่ตาจับได้
 *   มือกับเท้าใหญ่เกินจริง — เพราะมันคือส่วนที่ "ขยับ" เวลาวิ่ง ถ้าเล็กจะอ่านท่าไม่ออก
 *   ขาสั้น ลำตัวหนา — ทำให้ทรงล่างมั่นคง ดูเป็นตัวการ์ตูนไม่ใช่หุ่นไม้
 *
 * เทสต์ที่ใช้ตัดสิน (silhouette test): ถมสีดำทั้งตัวแล้วย่อให้สูง 100px
 * ถ้ายังบอกได้ว่าเป็นตัวไหน = ผ่าน — ของที่ยื่นออกจากทรง (ถังออกซิเจน ครีบหมวก)
 * มีไว้เพื่อข้อนี้ข้อเดียว ไม่ได้มีไว้ให้ดูสวยตอนซูมเข้า
 */
function buildAstronaut() {
  const rig = new THREE.Group();

  const mat = {
    suit: toonMat(0xf2f6ff),
    suitDim: toonMat(0xc3cde3),
    joint: toonMat(0x3d4a68),
    pack: toonMat(0x7d8bab),
    visor: new THREE.MeshBasicMaterial({ color: 0x0a1526 }),
    cyan: new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
    amber: new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  };

  const HIP_Y = 0.62;
  const SHOULDER_Y = 1.06;

  // ── ลำตัว: กว้างและสั้น ──
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.54, 0.36), mat.suit);
  torso.position.y = 0.87;
  rig.add(torso);

  // แถบสะท้อนแสงรอบตัว (แถบส้มบนชุด NASA) — ช่วยให้ตาแยกตัวละครออกจากพื้นหลังเข้ม
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.39), mat.amber);
  belt.position.y = 0.66;
  rig.add(belt);

  // ── ถังออกซิเจนด้านหลัง ──
  // เราเห็นตัวละครจากข้างหลังตลอด ถังจึงเป็น "ตัวชูโรงของเส้นรอบรูป" ไม่ใช่ของประดับ
  // ทำให้ยื่นออกไปชัด ๆ และมีบ่าเฉียง เพื่อให้เงาทึบยังบอกได้ว่าเป็นนักบินอวกาศ
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.26), mat.pack);
  pack.position.set(0, 0.92, 0.3);
  rig.add(pack);

  for (const x of [-0.13, 0.13]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), mat.cyan);
    light.position.set(x, 1.08, 0.44);
    rig.add(light);
  }
  const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.28), mat.amber);
  packStripe.position.set(0, 0.77, 0.3);
  rig.add(packStripe);

  // ── คอ + หมวก (หัวโต = หัวใจของสัดส่วนแบบเกมวิ่ง) ──
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.07, 12), mat.joint);
  neck.position.y = 1.16;
  rig.add(neck);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.25, 22, 18), mat.suit);
  helmet.position.y = 1.4;
  rig.add(helmet);

  // กระจกหน้ากาก (อยู่ด้านหน้า = ฝั่งที่หันออกจากกล้อง เห็นแค่ขอบ ๆ)
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.225, 18, 14), mat.visor);
  visor.scale.set(1, 0.84, 0.58);
  visor.position.set(0, 1.41, -0.1);
  rig.add(visor);

  // ครีบบนหมวก — ของที่ "ยื่นออกจากทรงกลม" ทำให้เงาทึบไม่ใช่แค่ลูกบอลบนกล่อง
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.3), mat.amber);
  fin.position.set(0, 1.6, 0.02);
  rig.add(fin);

  // ตะเข็บหมวกเรืองแสง — ทำให้มองเห็นหัวชัดจากข้างหลังในทางเดินมืด ๆ
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.252, 0.022, 8, 28), mat.cyan);
  seam.rotation.y = Math.PI / 2;
  seam.position.y = 1.4;
  rig.add(seam);

  // ── แขน: Group อยู่ที่ข้อไหล่ แล้วเลื่อน mesh ลงครึ่งความยาว ──
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.31, SHOULDER_Y, 0);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.2, 4, 10), mat.suit);
    arm.position.y = -0.2;
    pivot.add(arm);

    // ถุงมือใหญ่เกินจริง — ปลายแขนคือจุดที่แกว่งไกลที่สุดตอนวิ่ง
    // ถ้ามือเล็ก ตาจะจับจังหวะขาไม่ได้เลยที่ระยะ 150px
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.19, 0.21), mat.joint);
    glove.position.y = -0.4;
    pivot.add(glove);

    rig.add(pivot);
    return pivot;
  }

  // ── ขา: สั้นและหนา รองเท้าใหญ่ ──
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.145, HIP_Y, 0);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.24, 4, 10), mat.suitDim);
    leg.position.y = -0.24;
    pivot.add(leg);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.17, 0.36), mat.joint);
    boot.position.set(0, -0.53, -0.06);
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

  /* ══ อาวุธประจำตัวละคร ══════════════════════════════════════
   *
   * ── สามสถานะ ไม่ใช่สองสถานะ ──
   * เดิมอาวุธโผล่ค้างอยู่ตลอดเวลาไม่ว่าจะมีเกราะหรือไม่ ซึ่งทำให้มันกลายเป็น
   * "เครื่องประดับ" — ตาชินแล้วเลิกมองภายในสิบวินาที และที่แย่กว่านั้นคือ
   * มันโกหกผู้เล่น: เห็นดาบอยู่ในมือแต่ชนแล้วตาย เพราะจริง ๆ ยังไม่ได้ใส่เกราะ
   *
   *   มือเปล่า      (ไม่มีเกราะ)          → ไม่มีอะไรเลย
   *   พกไว้         (เก็บเกราะมาแล้ว)      → ฝัก/สายรัด/ด้ามคาดเอว — เห็นว่า "มีของ"
   *   ชักออกมาถือ   (กดใส่เกราะแล้ว)       → อาวุธอยู่ในมือ + เรืองแสง
   *
   * ทีนี้อาวุธไม่ใช่เครื่องประดับอีกต่อไป แต่เป็น **มาตรวัดสถานะที่อ่านได้จากตัวละคร**
   * ผู้เล่นรู้ว่าตัวเองรอดตายได้อีกครั้งไหมโดยไม่ต้องละสายตาไปดู HUD เลย
   *
   * ── ของที่ถืออยู่ต้องผูกกับ "มือ" ไม่ใช่ลำตัว ──
   * ถ้าแปะไว้กับ rig ดาบจะลอยนิ่งอยู่ข้างตัวขณะที่แขนแกว่งไปมา = ดูเป็นสติกเกอร์
   * เราจึงแขวนมันไว้ใต้ pivot ของแขน ให้มันแกว่งไปพร้อมกันโดยไม่ต้องเขียนโค้ดอนิเมชันเพิ่มเลย
   */
  const weaponMat = toonMat(0xd9b45c);          // ทองเหลือง
  const darkMetal = toonMat(0x46506b);
  const steel = toonMat(0xd9e0f0);
  const wrapMat = toonMat(0x232a3d);
  const leather = toonMat(0x6b4a2e);
  const lacquer = toonMat(0x1b2030);
  const weapons = {};

  /** จุดแขวนของที่ "ถืออยู่ในมือ" — อยู่ใต้ pivot ของแขน จึงแกว่งตามแขนเอง */
  function handMount(pivot) {
    const g = new THREE.Group();
    g.position.y = -0.42;          // ระดับถุงมือ
    pivot.add(g);
    return g;
  }

  /* ── สปาตัน: โล่กลม + หอก + หงอนหมวก ─────────────────────── */
  {
    const restG = new THREE.Group();   // สายรัดหลัง — เห็นเมื่อ "มีของ"
    const stowG = new THREE.Group();   // โล่+หอกพาดหลัง
    const holdL = handMount(armL);
    const holdR = handMount(armR);
    const crest = new THREE.Group();   // หงอนบนหมวก — เอกลักษณ์ของสปาตันในเงาทึบ

    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.08), leather);
    strap.position.set(0, 1.02, 0.44);
    strap.rotation.z = 0.5;
    restG.add(strap);

    /** โล่กลมมีขอบยก + ปุ่มกลาง + ซี่กากบาท — "สมประกอบ" คือมีชั้นความลึก ไม่ใช่แผ่นเรียบ */
    function buildShield() {
      const g = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.055, 24), weaponMat);
      disc.rotation.z = Math.PI / 2;
      g.add(disc);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.038, 8, 28), darkMetal);
      rim.rotation.y = Math.PI / 2;
      g.add(rim);
      for (let i = 0; i < 4; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.52, 0.05), darkMetal);
        rib.rotation.x = (i * Math.PI) / 4;
        rib.position.x = -0.036;
        g.add(rib);
      }
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 10), darkMetal);
      boss.position.x = -0.05;
      g.add(boss);
      const glow = new THREE.Mesh(
        new THREE.TorusGeometry(0.305, 0.024, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd166 })
      );
      glow.rotation.y = Math.PI / 2;
      g.add(glow);
      return { g, glow };
    }

    /** หอก: ด้ามหนัง + ปลอกรัด 3 วง + ใบทรงใบไม้ + ส้นถ่วงน้ำหนัก */
    function buildSpear() {
      const g = new THREE.Group();
      // ⚠️ ยาว 1.3 ไม่ใช่ 1.8 — หอกยาวเท่าของจริงจะสูงกว่าตัวละครทั้งตัว
      // แล้วเงาทึบจะกลายเป็น "เสา" ที่กลบทุกอย่างอื่นในเส้นรอบรูป
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.033, 1.3, 8), leather);
      g.add(shaft);
      for (const y of [-0.38, 0, 0.38]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.065, 8), darkMetal);
        band.position.y = y;
        g.add(band);
      }
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.032, 0.13, 8), darkMetal);
      collar.position.y = 0.71;
      g.add(collar);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.088, 0.34, 4), steel);
      head.position.y = 0.94;
      head.rotation.y = Math.PI / 4;
      g.add(head);
      const butt = new THREE.Mesh(new THREE.ConeGeometry(0.046, 0.15, 6), darkMetal);
      butt.rotation.x = Math.PI;
      butt.position.y = -0.72;
      g.add(butt);
      return g;
    }

    // ── พกไว้: โล่แนบหลัง + หอกพาดเฉียง ──
    // ⚠️ buildShield หมุนจานให้ "แกนอยู่ตามแนว X" ไว้แล้ว (หน้าโล่หันซ้าย-ขวา)
    // ถ้าหมุนกลุ่มอีก PI/2 รอบ Z แกนจะกลายเป็นแนว Y = โล่นอนราบเหมือนโต๊ะ
    // ต้องหมุนรอบ Y แทน เพื่อให้หน้าโล่หันไปด้านหน้า-หลัง แล้วแนบกับแผ่นหลังพอดี
    const shieldStow = buildShield();
    shieldStow.g.rotation.y = Math.PI / 2;
    shieldStow.g.position.set(0, 1.0, 0.5);
    shieldStow.glow.visible = false;
    stowG.add(shieldStow.g);
    const spearStow = buildSpear();
    spearStow.position.set(0.26, 1.12, 0.34);
    spearStow.rotation.z = 0.3;
    stowG.add(spearStow);

    // ── ถือ: โล่ที่แขนซ้าย หันหน้าออก / หอกในมือขวาชี้เฉียงขึ้น ──
    const shieldHold = buildShield();
    shieldHold.g.position.set(-0.16, -0.02, -0.06);
    shieldHold.g.rotation.y = 0.18;
    holdL.add(shieldHold.g);

    const spearHold = buildSpear();
    spearHold.position.set(0.04, 0.28, 0.02);
    spearHold.rotation.set(-0.22, 0, -0.14);
    holdR.add(spearHold);

    // หงอนหมวก: 7 แผ่นเรียงเป็นสัน สูงกลาง เตี้ยปลาย
    const plume = toonMat(0xd6453f);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const h = 0.09 + Math.sin(t * Math.PI) * 0.15;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.058, h, 0.075), plume);
      seg.position.set(0, 1.6 + h / 2, 0.2 - t * 0.42);
      crest.add(seg);
    }

    weapons.spartan = {
      rest: [restG], stow: [stowG], hold: [holdL, holdR, crest],
      glow: shieldHold.glow, mounts: [restG, stowG, crest],
    };
  }

  /* ── ซามูไร: คาตานะ + ฝักดาบ ─────────────────────────────── */
  {
    const restG = new THREE.Group();
    const stowG = new THREE.Group();
    const holdR = handMount(armR);

    /** ดาบครบชิ้น: ด้ามพัน + ทสึบะ (การ์ด) + ใบดาบมีคมสว่าง + ปลายแหลม */
    function buildKatana() {
      const g = new THREE.Group();
      const tsuka = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.32, 0.078), wrapMat);
      tsuka.position.y = -0.17;
      g.add(tsuka);
      for (let i = 0; i < 4; i++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.028, 0.086), weaponMat);
        band.position.y = -0.05 - i * 0.075;
        g.add(band);
      }
      const kashira = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.09), darkMetal);
      kashira.position.y = -0.34;
      g.add(kashira);
      const tsuba = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.092, 0.024, 4), darkMetal);
      tsuba.rotation.y = Math.PI / 4;
      g.add(tsuba);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.94, 0.095), steel);
      blade.position.y = 0.49;
      g.add(blade);
      // คมดาบ: แถบสว่างบาง ๆ ด้านเดียว — นี่คือสิ่งที่ทำให้ "แผ่นสี่เหลี่ยม" อ่านเป็น "ดาบ"
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.94, 0.03),
        new THREE.MeshBasicMaterial({ color: 0xfff6dd })
      );
      edge.position.set(0, 0.49, -0.036);
      g.add(edge);
      const kissaki = new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.17, 4), steel);
      kissaki.position.y = 1.03;
      kissaki.rotation.y = Math.PI / 4;
      g.add(kissaki);
      return { g, edge };
    }

    // ฝักดาบคาดหลัง — อยู่ทั้งตอนพกและตอนชักออก (ฝักเปล่า) เหมือนของจริง
    const saya = new THREE.Mesh(new THREE.BoxGeometry(0.082, 1.02, 0.115), lacquer);
    saya.position.set(-0.16, 1.02, 0.42);
    saya.rotation.z = -0.46;
    restG.add(saya);
    for (const t of [-0.3, 0.1]) {
      const cord = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.045, 0.128), weaponMat);
      cord.position.set(-0.16 + t * 0.46 * Math.sin(-0.46), 1.02 + t, 0.42);
      cord.rotation.z = -0.46;
      restG.add(cord);
    }

    const katanaStow = buildKatana();
    katanaStow.g.position.set(-0.16, 1.02, 0.42);
    katanaStow.g.rotation.z = -0.46;
    katanaStow.g.scale.set(1, 0.98, 1);
    stowG.add(katanaStow.g);

    const katanaHold = buildKatana();
    katanaHold.g.position.set(0.04, 0.42, -0.04);
    katanaHold.g.rotation.set(-0.35, 0, -0.22);
    holdR.add(katanaHold.g);

    weapons.samurai = {
      rest: [restG], stow: [stowG], hold: [holdR],
      glow: katanaHold.edge, mounts: [restG, stowG],
    };
  }

  /* ── นินจา: ดาวกระจาย + ผ้าพันคอ ─────────────────────────── */
  {
    const alwaysG = new THREE.Group();   // ผ้าพันคอ/สายคาด = เสื้อผ้าประจำตัว ไม่ใช่ของที่เก็บมา
    const restG = new THREE.Group();
    const stowG = new THREE.Group();
    const holdR = handMount(armR);

    /** ดาว 4 แฉกปลายเรียว + ดุมกลาง — ไม่ใช่กากบาทแบน ๆ */
    function buildShuriken(scale = 1) {
      const g = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const holder = new THREE.Group();
        const pt = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 4), steel);
        pt.position.y = 0.16;
        holder.add(pt);
        holder.rotation.z = (i * Math.PI) / 2;
        g.add(holder);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 12), darkMetal);
      hub.rotation.x = Math.PI / 2;
      g.add(hub);
      const glow = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.02, 8, 16),
        new THREE.MeshBasicMaterial({ color: 0xa3e635 })
      );
      g.add(glow);
      g.scale.setScalar(scale);
      return { g, glow };
    }

    // ผ้าพันคอ — ของที่ "สะบัดอยู่หลังตัว" ทำให้เงาทึบของนินจาแยกออกจากตัวอื่นทันที
    // ⚠️ สีต้องตัดกับตัวละคร ไม่ใช่กลมกลืน — นินจาตัวดำบนทางเดินมืด
    // ผ้าสีน้ำเงินเข้มจะหายไปทั้งผืน (ลองมาแล้ว มองไม่เห็นเลย)
    // ผ้าแดงคือสิ่งเดียวในตัวนินจาที่ตาจับได้จากระยะไกล และเป็นเอกลักษณ์อยู่แล้ว
    const scarfMat = toonMat(0xd63b3b);
    const scarfSegs = [];
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.22 - i * 0.025, 0.05, 0.3), scarfMat);
      seg.position.set(0, 1.18 - i * 0.05, 0.44 + i * 0.26);
      alwaysG.add(seg);
      scarfSegs.push(seg);
    }
    // ปมผ้าที่คอ — จุดเริ่มของผ้า ทำให้มันดูผูกอยู่จริงไม่ใช่ลอยตามหลัง
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.3), scarfMat);
    knot.position.set(0, 1.19, 0.2);
    alwaysG.add(knot);
    // สายคาดอกใส่ดาว
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.4), wrapMat);
    sash.position.set(0, 0.98, 0.16);
    sash.rotation.z = -0.42;
    alwaysG.add(sash);

    // พกไว้: ดาวเล็ก 2 ดวงเสียบที่สายคาด
    for (const x of [-0.2, 0.2]) {
      const s = buildShuriken(0.52);
      s.g.position.set(x, 0.98 - x * 0.42, 0.4);
      s.glow.visible = false;
      stowG.add(s.g);
    }

    // ถือ: ดาวใหญ่ในมือขวา หมุนตลอดเวลา (ตั้งค่าใน update)
    const spin = buildShuriken(1.35);
    spin.g.position.set(0.06, -0.02, -0.14);
    holdR.add(spin.g);

    weapons.ninja = {
      always: [alwaysG], rest: [restG], stow: [stowG], hold: [holdR],
      glow: spin.glow, spin: spin.g, scarf: scarfSegs, mounts: [alwaysG, restG, stowG],
    };
  }

  /* ── ลอร์ดมืด: ไลต์เซเบอร์ที่ "จุดติด" ตอนใส่เกราะ ────────── */
  {
    const restG = new THREE.Group();
    const stowG = new THREE.Group();
    const holdR = handMount(armR);

    /** ด้ามดาบครบชิ้น: ปลอกปล่อยแสง + ร่องจับ + แผ่นสวิตช์ + ท้ายด้าม */
    function buildHilt() {
      const g = new THREE.Group();
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.22, 12), darkMetal);
      g.add(grip);
      for (let i = 0; i < 4; i++) {
        const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.016, 12), toonMat(0x9aa3b8));
        rib.position.y = -0.07 + i * 0.045;
        g.add(rib);
      }
      const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.04, 0.085, 12), toonMat(0xbcc4d6));
      emitter.position.y = 0.15;
      g.add(emitter);
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.032, 0.055, 0.09),
        new THREE.MeshBasicMaterial({ color: 0xff2d4d })
      );
      plate.position.set(0, 0.03, -0.046);
      g.add(plate);
      const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.032, 0.055, 12), toonMat(0x9aa3b8));
      pommel.position.y = -0.135;
      g.add(pommel);
      return g;
    }

    /** ใบดาบ = แกนขาวสว่าง + ปลอกแดงโปร่ง — สองชั้นคือสิ่งที่ทำให้มัน "เรืองแสง"
     *  ทรงกระบอกสีแดงชั้นเดียวจะดูเหมือนแท่งพลาสติกแดง ไม่ใช่ลำแสง */
    function buildBlade() {
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.019, 0.016, 1.18, 10),
        new THREE.MeshBasicMaterial({ color: 0xfff0f2 })
      );
      core.position.y = 0.78;
      g.add(core);
      const halo = new THREE.Mesh(
        new THREE.CylinderGeometry(0.044, 0.036, 1.18, 14),
        new THREE.MeshBasicMaterial({ color: 0xff2d4d, transparent: true, opacity: 0.5, depthWrite: false })
      );
      halo.position.y = 0.78;
      g.add(halo);
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.044, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff2d4d, transparent: true, opacity: 0.5, depthWrite: false })
      );
      cap.position.y = 1.37;
      g.add(cap);
      return g;
    }

    // สายคาดเอว + ห่วงแขวน (เห็นเสมอเมื่อมีของ)
    const beltG = new THREE.Group();     // เข็มขัด = เสื้อผ้าประจำตัว
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.09, 0.42), lacquer);
    belt.position.y = 0.63;
    beltG.add(belt);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.05), toonMat(0x9aa3b8));
    clip.position.set(0.3, 0.63, 0.06);
    restG.add(clip);

    // พกไว้: ด้ามดาบห้อยเอว ยังไม่จุดไฟ
    const hiltStow = buildHilt();
    hiltStow.position.set(0.32, 0.52, 0.08);
    hiltStow.rotation.z = 0.22;
    stowG.add(hiltStow);

    // ถือ: ด้ามในมือ + ใบดาบพุ่งออก
    const hiltHold = buildHilt();
    hiltHold.position.set(0.02, 0.02, -0.06);
    hiltHold.rotation.set(-0.25, 0, -0.1);
    holdR.add(hiltHold);
    const blade = buildBlade();
    hiltHold.add(blade);

    weapons.darklord = {
      always: [beltG], rest: [restG], stow: [stowG], hold: [holdR],
      glow: blade, mounts: [beltG, restG, stowG],
    };
  }

  // กลุ่มที่แขวนกับลำตัว (ไม่ใช่กับแขน) ต้องเอาเข้า rig เอง
  for (const w of Object.values(weapons)) {
    for (const m of w.mounts) rig.add(m);
  }

  return { rig, armL, armR, legL, legR, torso, helmet, thrusters, mat, weapons };
}

export function createPlayer(scene) {
  const group = new THREE.Group();
  const a = buildAstronaut();
  group.add(a.rig);

  /* ── ลูกศรชี้ตัวเอง (โหมดแข่ง) ──
   * พอมีโกสต์เพื่อนวิ่งรอบตัวหลายร่าง ผู้เล่นจะเสียตัวเองจากสายตาช่วงชุลมุน
   * ลูกศร + ป้าย "คุณ" เหนือหัวคือคำตอบเดียวกับที่เกม MOBA/BR ทุกเกมใช้ */
  const marker = new THREE.Group();
  const markerCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.17, 0.3, 4),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan })
  );
  markerCone.rotation.x = Math.PI;      // ชี้ลงหาหัวตัวละคร
  markerCone.position.y = 2.18;
  marker.add(markerCone);

  const mkCanvas = document.createElement('canvas');
  mkCanvas.width = 128;
  mkCanvas.height = 52;
  const mkCtx = mkCanvas.getContext('2d');
  mkCtx.font = '700 30px "Noto Sans Thai", sans-serif';
  mkCtx.textAlign = 'center';
  mkCtx.textBaseline = 'middle';
  mkCtx.fillStyle = 'rgba(3,6,17,0.75)';
  mkCtx.fillRect(14, 4, 100, 44);
  mkCtx.fillStyle = '#7ee7f7';
  mkCtx.fillText('คุณ', 64, 27);
  const markerSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(mkCanvas), transparent: true, depthTest: false,
  }));
  markerSprite.scale.set(1.0, 0.42, 1);
  markerSprite.position.y = 2.62;
  marker.add(markerSprite);
  marker.visible = false;
  group.add(marker);

  /* ── เงาใต้เท้า: แผ่นทึบ + วงแหวน ────────────────────────────
   * ⚠️ เกมแนวนี้ไม่ควรเปิด shadow map จริง — แพงบนมือถือและได้เงาที่ "นุ่มเกินไป"
   * จนไม่ช่วยอะไร สิ่งที่ผู้เล่นต้องการจากเงามีข้อเดียว: บอกว่าตัวเองอยู่ตรงไหนบนพื้น
   * โดยเฉพาะตอนลอยกลางอากาศที่ตัวละครไม่ได้แตะพื้นแล้ว
   *
   * แผ่นทึบสีเข้ม (blob shadow) ทำหน้าที่นั้นได้ครบด้วยสามเหลี่ยมไม่กี่ชิ้น
   * และยังทำอีกอย่างที่เงาจริงทำไม่ได้: "ตรึง" ตัวละครไว้กับพื้น
   * ทำให้ตัวละครไม่ดูเหมือนสติกเกอร์ที่ลอยทับฉากอยู่
   */
  const shadowBlob = new THREE.Mesh(
    new THREE.CircleGeometry(0.44, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false })
  );
  shadowBlob.rotation.x = -Math.PI / 2;
  shadowBlob.position.y = 0.04;
  group.add(shadowBlob);

  // วงแหวนสีเลนซ้อนบนเงา ช่วยให้เห็นว่าตัวเองอยู่เลนไหนตอนลอยอยู่กลางอากาศ
  const shadowRing = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.56, 24),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.45, depthWrite: false })
  );
  shadowRing.rotation.x = -Math.PI / 2;
  shadowRing.position.y = 0.05;
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
    skin: 'astro',           // ตัวละครที่ใส่อยู่ (จากร้านค้า)
    showcase: false,         // ท่าโชว์ตัวในล็อบบี้ — หันหน้าเข้ากล้อง ยืนนิ่ง ๆ
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

    // ── ท่าโชว์ในล็อบบี้: หันหน้าเข้ากล้อง ยืนสง่า ๆ ส่ายตัวช้า ๆ ──
    if (state.showcase) {
      group.position.set(0, 0, CFG.world.playerZ);
      a.rig.rotation.y = THREE.MathUtils.lerp(a.rig.rotation.y, Math.PI, dt * 4)
        + Math.sin(state.runT * 0.7) * 0.003;
      a.rig.rotation.x = 0;
      a.rig.rotation.z = 0;
      for (const part of [a.legL, a.legR]) part.rotation.x = THREE.MathUtils.lerp(part.rotation.x, 0, dt * 8);
      a.armL.rotation.x = THREE.MathUtils.lerp(a.armL.rotation.x, -0.12, dt * 8);
      a.armR.rotation.x = THREE.MathUtils.lerp(a.armR.rotation.x, -0.12, dt * 8);
      a.torso.position.y = 0.96 + Math.sin(state.runT * 1.6) * 0.015;   // หายใจเบา ๆ
      a.helmet.rotation.y = Math.sin(state.runT * 0.9) * 0.16;
      for (const flame of a.thrusters) flame.visible = false;
      return;
    }
    // ออกจากท่าโชว์แล้ว หมุนกลับมาหันหน้าเข้าทางวิ่ง
    if (Math.abs(a.rig.rotation.y) > 0.01) {
      a.rig.rotation.y = THREE.MathUtils.lerp(a.rig.rotation.y, 0, dt * 6);
    }

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

    // เปลวไอพ่น: ตอนลอย = เปลวเต็ม (ทุกตัวละครใช้ไอพ่นบิน)
    // ส่วนสถานะ "ใส่เกราะ" ตอนวิ่ง: astro โชว์เปลวเลีย ๆ, ตัวอื่นโชว์อาวุธเรืองแสงแทน
    for (const flame of a.thrusters) {
      flame.visible = airborne || (state.armed && state.skin === 'astro');
      if (airborne) flame.scale.y = 0.7 + Math.random() * 0.6;        // เปลวไฟกระพริบ
      else if (flame.visible) flame.scale.y = 0.3 + Math.random() * 0.15;
    }

    // อาวุธประจำตัวละคร: เรืองแสงเต้นตุบ ๆ ตอนใส่เกราะ (ลอร์ดมืด = ใบดาบโผล่เฉพาะตอนใส่)
    const weapon = a.weapons[state.skin];
    if (weapon && state.armed) {
      // เต้นเป็นจังหวะตอนใส่เกราะ = "พร้อมใช้งาน" ที่มองเห็นได้จากหางตา
      weapon.glow.scale.setScalar(1 + Math.sin(state.runT * 10) * 0.14);
      if (weapon.spin) weapon.spin.rotation.z += dt * 9;   // ดาวกระจายหมุนตลอด
    }
    // ผ้าพันคอนินจาสะบัดตามจังหวะวิ่ง (เร็วขึ้นตามความเร็วขา)
    if (weapon?.scarf) {
      weapon.scarf.forEach((seg, i) => {
        seg.rotation.x = Math.sin(state.runT * 7 - i * 0.7) * 0.3;
        seg.position.y = 1.18 - i * 0.05 + Math.sin(state.runT * 7 - i * 0.7) * 0.04;
      });
    }

    // ลูกศร "คุณ" เด้งเบา ๆ ให้ตาจับได้ (เฉพาะโหมดแข่งที่มาร์กเกอร์ถูกเปิด)
    if (marker.visible) marker.position.y = Math.sin(state.runT * 4) * 0.09;

    // ยิ่งลอยสูง เงายิ่งจางและเล็กลง — นี่คือสิ่งเดียวที่บอกผู้เล่นว่า "ตอนนี้ลอยสูงแค่ไหน"
    // (มุมกล้องจากด้านหลังทำให้แยกความสูงจากตัวละครอย่างเดียวแทบไม่ได้เลย)
    const lift = Math.min(1, y / CFG.player.jumpHeight);
    shadowBlob.material.opacity = 0.38 * (1 - lift * 0.72);
    shadowBlob.scale.setScalar(1 - lift * 0.34);
    shadowRing.material.opacity = 0.45 * (1 - lift * 0.75);
    shadowRing.scale.setScalar(1 - lift * 0.3);

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
    state.stock = 0;
    refreshGear();               // เริ่มรอบใหม่ = มือเปล่าเสมอ
    state.wasAirborne = false;
    state.justMounted = false;
    state.showcase = false;
    marker.visible = false;
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

  /** สวมสกินตัวละครจากร้านค้า — เปลี่ยนสีชุด + สลับอาวุธที่ติดตัว */
  /**
   * ตัดสินว่าอาวุธชิ้นไหนควรโผล่ตอนนี้ — เรียกทุกครั้งที่ "สกิน / จำนวนเกราะ / ใส่หรือยัง" เปลี่ยน
   *
   * ⚠️ ต้องเป็นฟังก์ชันเดียวที่ตัดสินเรื่องนี้ทั้งหมด
   * ถ้าปล่อยให้ applySkin กับ setGear ต่างคนต่างสั่ง .visible ตามที่ตัวเองรู้
   * จะเกิดสถานะที่ขัดกันเอง (เปลี่ยนสกินตอนใส่เกราะอยู่ → ดาบเล่มเก่าค้างในมือ)
   * ซึ่งเป็นบั๊กประเภทที่หาไม่เจอ เพราะมันขึ้นกับ "ลำดับการเรียก" ไม่ใช่ค่าใด ๆ
   */
  function refreshGear() {
    for (const [key, w] of Object.entries(a.weapons)) {
      const mine = key === state.skin;
      const armed = mine && state.armed;
      const carrying = mine && (state.stock > 0 || state.armed);

      // ⚠️ "เสื้อผ้า" กับ "อาวุธ" ต้องแยกกัน
      // ผ้าพันคอนินจา/เข็มขัดลอร์ดมืดคือตัวตนของตัวละคร ไม่ใช่ของที่เก็บมาได้
      // ถ้าเอาไปผูกกับเกราะด้วย ผู้เล่นที่ยังไม่เก็บเกราะจะเห็นตัวละครที่ "ไม่ใช่ตัวที่ซื้อมา"
      for (const g of (w.always ?? [])) g.visible = mine;
      for (const g of w.rest) g.visible = carrying;
      for (const g of w.stow) g.visible = carrying && !state.armed;
      for (const g of w.hold) g.visible = armed;
    }
  }

  function applySkin(id) {
    const c = characterById(id);
    state.skin = c.id;
    a.mat.suit.color.setHex(c.suit);
    a.mat.suitDim.color.setHex(c.suitDim);
    a.mat.joint.color.setHex(c.joint);
    a.mat.amber.color.setHex(c.accent);   // เข็มขัด/แถบถัง = สี accent ประจำตัว
    refreshGear();
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
    applySkin,
    setShowcase(on) { state.showcase = on; },
    setSelfMarker(on) { marker.visible = on; },
    onPlatform() { return state.baseY > 0.4; },
    /**
     * บอกตัวละครว่าตอนนี้ "มีเกราะในคลังกี่ชิ้น" และ "ใส่อยู่หรือเปล่า"
     * @param {number} stock เกราะที่เก็บมาแล้วแต่ยังไม่ได้ใส่
     * @param {boolean} armed ใส่อยู่ไหม
     */
    setGear(stock, armed) {
      state.stock = Math.max(0, stock | 0);
      state.armed = !!armed;
      refreshGear();
    },
    setArmed(on) { state.armed = !!on; refreshGear(); },
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
