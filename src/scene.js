/**
 * scene.js — ทางเดินสถานีอวกาศที่ไม่มีที่สิ้นสุด
 *
 * เคล็ดลับของ endless runner: ผู้เล่น "ไม่ได้วิ่งไปไหนเลย"
 * ตัวละครอยู่ที่ z = 0 ตลอดเวลา แล้วเราเลื่อน "โลก" เข้าหากล้องแทน
 * ข้อดี: ตัวเลขพิกัดไม่มีวันบวมจนทศนิยมเพี้ยน (floating-point drift)
 * และการเช็คการชนก็ทำรอบ ๆ จุด 0 เสมอ
 *
 * ทางเดินใช้ท่อนเดิม 9 ท่อนหมุนเวียน (object pooling) พอท่อนไหนถึงกล้อง
 * ก็ย้ายมันไปต่อท้ายแถว — ผู้เล่นเห็นเป็นทางเดินยาวไม่มีที่สิ้นสุด
 *
 * ⚠️ ทุก geometry/material ถูกสร้าง "ครั้งเดียว" แล้วแชร์กันทุกท่อน
 * ถ้าสร้างใหม่ต่อท่อน จะกิน VRAM 9 เท่าโดยได้ภาพเหมือนเดิมเป๊ะ
 */

import * as THREE from 'three';
import { CFG } from './config.js';
import { themeById } from './themes.js';
import { createStarTexture, createNebulaTexture, createDotTexture } from './textures.js';

export const PALETTE = {
  bg: 0x04060f,
  hull: 0x2c3654,        // ผนังตัวยาน
  hullDark: 0x1a2138,    // ร่อง/ซี่โครงผนัง
  floor: 0x222a44,
  frame: 0x93a0bd,       // โครงเหล็กประตูกั้นห้อง
  cyan: 0x22d3ee,
  pink: 0xf472b6,
  lime: 0xa3e635,
  amber: 0xfb923c,
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));  // เกิน 2 คือเปลืองเปล่า ๆ
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  // หมอกทำสามอย่างพร้อมกัน: ซ่อนวัตถุที่โผล่มากลางอากาศ, เพิ่มความรู้สึกเร็ว,
  // และทำให้เราไม่ต้องเรนเดอร์ของไกล
  scene.fog = new THREE.Fog(PALETTE.bg, CFG.world.fogNear, CFG.world.fogFar);

  const camera = new THREE.PerspectiveCamera(
    CFG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 260
  );
  const camBase = new THREE.Vector3(0, CFG.camera.y, CFG.camera.z);
  camera.position.copy(camBase);

  // ค่ากล้องที่ "ขึ้นกับรูปทรงจอ" — resize() เป็นคนคำนวณ (ดู computeView ท้ายไฟล์)
  // ต้องมีค่าเริ่มต้นไว้ก่อน เพราะ update() อาจถูกเรียกก่อน resize รอบแรก
  let view = {
    fov: CFG.camera.fov, y: CFG.camera.y, z: CFG.camera.z,
    lookAtY: CFG.camera.lookAtY, lookAtZ: CFG.camera.lookAtZ, portrait: false,
  };

  // แสงในยาน: โทนเย็นจากเพดาน + ไฟส่องจากด้านหน้าให้เห็นรูปทรงชุดอวกาศ
  // (ตั้งชื่อไว้เพราะแต่ละธีมย้อมสีแสงต่างกัน — กลางแจ้งอุ่น/ในยานเย็น)
  const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x0d1424, 1.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(2.5, 8, 6);
  scene.add(key);
  // ไฟจากทางกล้อง — จำเป็นเพราะเราเห็น "ด้านหลัง" ของตัวละครตลอดเวลา
  // ถ้าไม่มี ชุดอวกาศสีขาวจะกลายเป็นเงาเทา ๆ อ่านรูปทรงไม่ออก
  const fill = new THREE.DirectionalLight(0xdcefff, 0.55);
  fill.position.set(0, 3.5, 12);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x38bdf8, 0.4);
  rim.position.set(-4, 3, -8);
  scene.add(rim);

  /* ── ทางเดินสถานีอวกาศ ──────────────────────────────────── */

  const segLen = CFG.world.segmentLength;
  const trackWidth = CFG.world.laneWidth * CFG.world.laneCount + 2.2;
  const halfW = trackWidth / 2;
  // เพดานสูงขึ้นเพื่อให้ไฟเพดาน/โครงประตูอยู่ห่างเลนส์ตอนผ่านหัวกล้อง
  // ไม่งั้นมันจะกวาดเป็นแถบสีขาวพาดจอทุกครั้งที่ผ่านหนึ่งท่อน
  const wallH = 8.2;

  const M = {
    floor: new THREE.MeshLambertMaterial({ color: PALETTE.floor }),
    hull: new THREE.MeshLambertMaterial({ color: PALETTE.hull }),
    hullDark: new THREE.MeshLambertMaterial({ color: PALETTE.hullDark }),
    frame: new THREE.MeshLambertMaterial({ color: PALETTE.frame }),
    lampWhite: new THREE.MeshBasicMaterial({ color: 0x8fc4dd }),
    neonCyan: new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
    neonPink: new THREE.MeshBasicMaterial({ color: PALETTE.pink }),
    amber: new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
    lane: new THREE.MeshBasicMaterial({ color: 0x3d4a78 }),
    space: new THREE.MeshBasicMaterial({ map: createStarTexture() }),
  };

  const G = {
    floor: new THREE.BoxGeometry(trackWidth, 0.4, segLen),
    ceiling: new THREE.BoxGeometry(trackWidth + 1.2, 0.4, segLen),
    wall: new THREE.BoxGeometry(0.5, wallH, segLen),
    rib: new THREE.BoxGeometry(0.3, wallH - 0.6, 0.55),
    window: new THREE.BoxGeometry(0.08, 1.5, 5.2),
    lampStrip: new THREE.BoxGeometry(0.55, 0.1, segLen * 0.72),
    laneLine: new THREE.BoxGeometry(0.08, 0.05, segLen * 0.94),
    stripe: new THREE.BoxGeometry(0.1, 0.22, segLen * 0.9),
    archTop: new THREE.BoxGeometry(trackWidth + 1.5, 0.36, 0.55),
    archPost: new THREE.BoxGeometry(0.36, wallH, 0.55),
    ductPipe: new THREE.BoxGeometry(0.22, 0.22, segLen * 0.85),
  };

  /* ══ ฉากประจำธีม — แต่ละธีมมี "โลก" ของตัวเองจริง ๆ ═══════════
   * ฐานร่วมทุกธีม = พื้น + เส้นเลน (กติกาเกมอยู่บนนี้) ส่วนของตกแต่ง
   * สร้างแยกเป็นชุดต่อธีมตั้งแต่บูต แล้วสลับด้วย visibility เท่านั้น
   * (สร้าง geometry กลางเกม = เฟรมกระตุก, visibility = ฟรี — three.js
   *  ข้ามการเรนเดอร์กรุ๊ปที่ซ่อนไว้ให้เองทั้งกิ่ง)
   */

  // วัสดุ/ทรงของธีมนอกยาน (แชร์กันทุกท่อน สร้างครั้งเดียว)
  const TA = {
    pirate: {
      wood: new THREE.MeshLambertMaterial({ color: 0x8a5a34 }),
      woodDark: new THREE.MeshLambertMaterial({ color: 0x59371c }),
      plank: new THREE.MeshBasicMaterial({ color: 0x452a14 }),
      sail: new THREE.MeshLambertMaterial({ color: 0xe8dcc0, side: THREE.DoubleSide }),
      flag: new THREE.MeshBasicMaterial({ color: 0x1c1c22, side: THREE.DoubleSide }),
      sea: new THREE.MeshLambertMaterial({ color: 0x0c2f42, emissive: 0x06202e }),
      moon: new THREE.MeshBasicMaterial({ color: 0xfff2c8 }),
      gPost: new THREE.BoxGeometry(0.16, 1.0, 0.16),
      gRail: new THREE.BoxGeometry(0.09, 0.1, segLen),
      gMast: new THREE.CylinderGeometry(0.16, 0.22, 7.5, 10),
      gBoom: new THREE.CylinderGeometry(0.07, 0.07, 3.4, 8),
      gSail: new THREE.PlaneGeometry(2.9, 3.0),
      gFlag: new THREE.PlaneGeometry(1.1, 0.55),
      gPlank: new THREE.BoxGeometry(trackWidth, 0.02, 0.07),
      gRidge: new THREE.BoxGeometry(trackWidth + 1.4, 0.2, 0.55),
      gBarrel: new THREE.CylinderGeometry(0.34, 0.3, 0.75, 10),
    },
    candy: {
      caneRed: new THREE.MeshLambertMaterial({ color: 0xd8404a }),
      caneWhite: new THREE.MeshLambertMaterial({ color: 0xf5ebe6 }),
      lolli: new THREE.MeshBasicMaterial({ color: 0xff8fd8 }),
      lolliIn: new THREE.MeshBasicMaterial({ color: 0xffe1f5 }),
      gumMats: [0xa3e635, 0xfb923c, 0xa78bfa, 0x38bdf8].map(c => new THREE.MeshLambertMaterial({ color: c })),
      gCane: new THREE.CylinderGeometry(0.14, 0.14, 2.6, 10),
      gRing: new THREE.TorusGeometry(0.15, 0.05, 8, 14),
      gStick: new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8),
      gDisc: new THREE.CylinderGeometry(0.85, 0.85, 0.16, 20),
      gDiscIn: new THREE.CylinderGeometry(0.5, 0.5, 0.17, 20),
      gGum: new THREE.SphereGeometry(0.55, 12, 10),
    },
    farm: {
      fence: new THREE.MeshLambertMaterial({ color: 0x9a7448 }),
      grass: new THREE.MeshLambertMaterial({ color: 0x4a7a2e }),
      hay: new THREE.MeshLambertMaterial({ color: 0xd9b45c }),
      barn: new THREE.MeshLambertMaterial({ color: 0xa8402e }),
      barnRoof: new THREE.MeshLambertMaterial({ color: 0x6b3a28 }),
      gFPost: new THREE.BoxGeometry(0.14, 0.9, 0.14),
      gFRail: new THREE.BoxGeometry(0.07, 0.09, segLen),
      gGrass: new THREE.BoxGeometry(2.4, 0.12, segLen),
      gHay: new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12),
      gBarn: new THREE.BoxGeometry(3.2, 2.6, 3.4),
      gRoof: new THREE.ConeGeometry(2.6, 1.5, 4),
    },
    desert: {
      sand: new THREE.MeshLambertMaterial({ color: 0xc09a5e }),
      cactus: new THREE.MeshLambertMaterial({ color: 0x3f7a3a }),
      rock: new THREE.MeshLambertMaterial({ color: 0x8a6a48 }),
      pyramid: new THREE.MeshLambertMaterial({ color: 0xa8834e, emissive: 0x2a1c08 }),
      gDune: new THREE.SphereGeometry(2.6, 12, 10),
      gCactus: new THREE.CylinderGeometry(0.22, 0.26, 1.7, 8),
      gArm: new THREE.CylinderGeometry(0.13, 0.13, 0.7, 8),
      gRock: new THREE.DodecahedronGeometry(0.55, 0),
      gPyr: new THREE.ConeGeometry(15, 11, 4),
    },
  };

  /* ── ของตกแต่งต่อท่อน แยกตามธีม ── */

  // 🚀 สถานีอวกาศ — ทางเดินในยานแบบเดิม (ผนัง เพดาน หน้าต่างดาว โครงประตู)
  function buildSpaceDecor(g, i) {
    const ceiling = new THREE.Mesh(G.ceiling, M.hullDark);
    ceiling.position.y = wallH - 0.2;
    g.add(ceiling);

    const lamp = new THREE.Mesh(G.lampStrip, M.lampWhite);
    lamp.position.set(0, wallH - 0.45, 0);
    g.add(lamp);

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(G.wall, M.hull);
      wall.position.set(side * (halfW + 0.25), wallH / 2 - 0.2, 0);
      g.add(wall);

      for (const zOff of [-segLen * 0.28, segLen * 0.28]) {
        const rib = new THREE.Mesh(G.rib, M.hullDark);
        rib.position.set(side * (halfW - 0.12), wallH / 2 - 0.2, zOff);
        g.add(rib);
      }

      const win = new THREE.Mesh(G.window, M.space);
      win.position.set(side * (halfW - 0.02), 2.7, 0);
      g.add(win);

      const pipe = new THREE.Mesh(G.ductPipe, M.hullDark);
      pipe.position.set(side * (halfW - 0.2), 4.6, 0);
      g.add(pipe);

      const stripe = new THREE.Mesh(G.stripe, i % 3 === 0 ? M.amber : (i % 2 ? M.neonPink : M.neonCyan));
      stripe.position.set(side * (halfW - 0.05), 0.34, 0);
      g.add(stripe);
    }

    const archTop = new THREE.Mesh(G.archTop, M.frame);
    archTop.position.set(0, wallH - 0.55, -segLen / 2);
    g.add(archTop);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(G.archPost, M.frame);
      post.position.set(side * (halfW + 0.05), wallH / 2 - 0.2, -segLen / 2);
      g.add(post);
    }
  }

  // 🏴‍☠️ โจรสลัด — ดาดฟ้าเรือไม้ "ต่อกันเป็นลำ ๆ" กลางทะเลเปิด ไม่มีผนัง
  function buildPirateDecor(g, i) {
    const A = TA.pirate;

    // รอยไม้กระดานพาดขวาง = พื้นกลายเป็นดาดฟ้าเรือทันทีที่ตาเห็นลาย
    for (let k = 0; k < 6; k++) {
      const plank = new THREE.Mesh(A.gPlank, A.plank);
      plank.position.set(0, 0.012, -segLen / 2 + (k + 0.5) * (segLen / 6));
      g.add(plank);
    }

    for (const side of [-1, 1]) {
      // ราวกันตกไม้ (เสาถี่ + ราวบน) แทนกำแพงยาน — เปิดวิวทะเล
      const rail = new THREE.Mesh(A.gRail, A.wood);
      rail.position.set(side * (halfW + 0.15), 0.95, 0);
      g.add(rail);
      for (let k = 0; k < 7; k++) {
        const post = new THREE.Mesh(A.gPost, A.woodDark);
        post.position.set(side * (halfW + 0.15), 0.45, -segLen / 2 + (k + 0.5) * (segLen / 7));
        g.add(post);
      }
    }

    // "รอยต่อเรือ" ทุกท่อน: สันไม้ยกพาดขวาง + เสามุมสูง — วิ่งข้ามคือกระโดดขึ้นเรือลำถัดไป
    const ridge = new THREE.Mesh(A.gRidge, A.woodDark);
    ridge.position.set(0, 0.1, -segLen / 2);
    g.add(ridge);
    for (const side of [-1, 1]) {
      const corner = new THREE.Mesh(A.gPost, A.wood);
      corner.scale.set(1.6, 2.2, 1.6);
      corner.position.set(side * (halfW + 0.15), 1.05, -segLen / 2);
      g.add(corner);
    }

    // เสากระโดง + ใบเรือ + ธงดำ — สลับข้างทีละลำ (อยู่พ้นเลนวิ่งเสมอ)
    if (i % 2 === 0) {
      const side = (i % 4 === 0) ? -1 : 1;
      const mast = new THREE.Mesh(A.gMast, A.woodDark);
      mast.position.set(side * (halfW + 1.15), 3.75, 0);
      g.add(mast);
      const boom = new THREE.Mesh(A.gBoom, A.woodDark);
      boom.rotation.z = Math.PI / 2;
      boom.position.set(side * (halfW + 1.15) - side * 1.2, 5.6, 0);
      g.add(boom);
      const sail = new THREE.Mesh(A.gSail, A.sail);
      sail.position.set(side * (halfW + 1.15) - side * 1.3, 4.0, 0.05);
      sail.rotation.y = side * 0.18;
      g.add(sail);
      const flag = new THREE.Mesh(A.gFlag, A.flag);
      flag.position.set(side * (halfW + 1.15) - side * 0.62, 7.25, 0);
      g.add(flag);
    }

    // ถังไม้เก็บเสบียงริมกราบ
    if (i % 3 !== 1) {
      const barrel = new THREE.Mesh(A.gBarrel, A.wood);
      const side = i % 2 ? -1 : 1;
      barrel.position.set(side * (halfW - 0.55), 0.38, -segLen * 0.22);
      g.add(barrel);
    }
  }

  // 🍭 เมืองขนมหวาน — เสาลูกกวาดลายปล้อง อมยิ้มยักษ์ กัมดรอปเรียงทาง
  function buildCandyDecor(g, i) {
    const A = TA.candy;
    for (const side of [-1, 1]) {
      // เสาลูกกวาด: แท่งแดง + วงแหวนขาวพันเป็นปล้อง
      const cane = new THREE.Mesh(A.gCane, A.caneRed);
      cane.position.set(side * (halfW + 0.35), 1.3, -segLen * 0.3);
      g.add(cane);
      for (let k = 0; k < 4; k++) {
        const ring = new THREE.Mesh(A.gRing, A.caneWhite);
        ring.position.set(side * (halfW + 0.35), 0.45 + k * 0.62, -segLen * 0.3);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
      }

      // อมยิ้มยักษ์ (จานกลมสองชั้นบนก้าน) สลับความสูง
      const stick = new THREE.Mesh(A.gStick, A.caneWhite);
      stick.position.set(side * (halfW + 0.9), 1.1, segLen * 0.28);
      g.add(stick);
      const disc = new THREE.Mesh(A.gDisc, A.lolli);
      disc.rotation.x = Math.PI / 2;
      disc.rotation.z = Math.PI / 2;
      disc.position.set(side * (halfW + 0.9), 2.55 + (i % 2) * 0.4, segLen * 0.28);
      g.add(disc);
      const discIn = new THREE.Mesh(A.gDiscIn, A.lolliIn);
      discIn.rotation.copy(disc.rotation);
      discIn.position.copy(disc.position);
      g.add(discIn);

      // กัมดรอปหยอดเรียงริมทาง
      const gum = new THREE.Mesh(A.gGum, A.gumMats[(i + (side + 1)) % A.gumMats.length]);
      gum.scale.y = 0.72;
      gum.position.set(side * (halfW + 0.5), 0.32, 0);
      g.add(gum);
    }
  }

  // 🐴 ฟาร์มสัตว์ — รั้วไม้สองฝั่ง ขอบหญ้า ฟ่อนฟาง ยุ้งฉางหลังคาแหลม
  function buildFarmDecor(g, i) {
    const A = TA.farm;
    for (const side of [-1, 1]) {
      const grass = new THREE.Mesh(A.gGrass, A.grass);
      grass.position.set(side * (halfW + 1.15), -0.02, 0);
      g.add(grass);

      for (const railY of [0.42, 0.78]) {
        const rail = new THREE.Mesh(A.gFRail, A.fence);
        rail.position.set(side * (halfW + 0.2), railY, 0);
        g.add(rail);
      }
      for (let k = 0; k < 5; k++) {
        const post = new THREE.Mesh(A.gFPost, A.fence);
        post.position.set(side * (halfW + 0.2), 0.42, -segLen / 2 + (k + 0.5) * (segLen / 5));
        g.add(post);
      }
    }

    if (i % 2 === 1) {
      const hay = new THREE.Mesh(A.gHay, A.hay);
      hay.rotation.z = Math.PI / 2;
      const side = i % 4 === 1 ? -1 : 1;
      hay.position.set(side * (halfW + 1.4), 0.55, -segLen * 0.1);
      g.add(hay);
    }

    // ยุ้งฉางแดงหลังคาแหลมไกลออกไปข้างทาง — landmark ที่วิ่งผ่านแล้วรู้ว่าคือฟาร์ม
    if (i % 3 === 2) {
      const side = i % 2 ? -1 : 1;
      const barn = new THREE.Mesh(A.gBarn, A.barn);
      barn.position.set(side * (halfW + 4.6), 1.3, 0);
      g.add(barn);
      const roof = new THREE.Mesh(A.gRoof, A.barnRoof);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(side * (halfW + 4.6), 3.35, 0);
      g.add(roof);
    }
  }

  // 🏜️ ทะเลทราย — เนินทราย กระบองเพชร โขดหิน
  function buildDesertDecor(g, i) {
    const A = TA.desert;
    for (const side of [-1, 1]) {
      const dune = new THREE.Mesh(A.gDune, A.sand);
      dune.scale.set(1.6, 0.5, 1.9);
      dune.position.set(side * (halfW + 2.6), -0.5, -segLen * 0.15 * side);
      g.add(dune);
    }

    const side = i % 2 ? -1 : 1;
    if (i % 3 !== 0) {
      const cactus = new THREE.Mesh(A.gCactus, A.cactus);
      cactus.position.set(side * (halfW + 0.8), 0.85, segLen * 0.2);
      g.add(cactus);
      for (const armSide of [-1, 1]) {
        const arm = new THREE.Mesh(A.gArm, A.cactus);
        arm.rotation.z = armSide * 0.9;
        arm.position.set(side * (halfW + 0.8) + armSide * 0.33, 1.05, segLen * 0.2);
        g.add(arm);
      }
    } else {
      const rock = new THREE.Mesh(A.gRock, A.rock);
      rock.scale.setScalar(1 + (i % 2) * 0.5);
      rock.position.set(side * (halfW + 0.7), 0.3, -segLen * 0.3);
      g.add(rock);
    }
  }

  const DECOR_BUILDERS = {
    space: buildSpaceDecor,
    pirate: buildPirateDecor,
    candy: buildCandyDecor,
    farm: buildFarmDecor,
    desert: buildDesertDecor,
  };

  const corridor = new THREE.Group();
  scene.add(corridor);

  const segments = [];
  const decoByTheme = { space: [], pirate: [], candy: [], farm: [], desert: [] };

  for (let i = 0; i < CFG.world.segmentCount; i++) {
    const g = new THREE.Group();

    // ── ฐานร่วมทุกธีม: พื้น + เส้นแบ่งเลน (กติกาเกมอยู่บนนี้ ห้ามธีมไหนแตะ) ──
    const floor = new THREE.Mesh(G.floor, M.floor);
    floor.position.y = -0.2;
    g.add(floor);

    for (const x of [-CFG.world.laneWidth / 2, CFG.world.laneWidth / 2]) {
      const line = new THREE.Mesh(G.laneLine, M.lane);
      line.position.set(x, 0.03, 0);
      g.add(line);
    }

    // ── ของตกแต่งทั้ง 5 ธีม (สร้างครบ ซ่อนไว้ก่อน — applyTheme เป็นคนเปิด) ──
    for (const [id, build] of Object.entries(DECOR_BUILDERS)) {
      const deco = new THREE.Group();
      build(deco, i);
      deco.visible = id === 'space';
      g.add(deco);
      decoByTheme[id].push(deco);
    }

    g.position.z = -i * segLen;
    corridor.add(g);
    segments.push(g);
  }

  const totalLength = segLen * CFG.world.segmentCount;

  /* ── ฉากหลังประจำธีม (ไม่เลื่อนตามทางเดิน แต่ซ่อน/โชว์พร้อมธีม) ──
   * อยู่ใน corridor group ด้วยเหตุผลเดียว: ตอนเข้าด่านโบนัส corridor ถูกซ่อน
   * ทั้งกิ่ง ฉากหลังพวกนี้ต้องหายไปพร้อมกันโดยไม่ต้องจัดการแยก */
  const backdrops = {};
  {
    // ทะเลยามค่ำ + ดวงจันทร์ (โจรสลัด)
    const sea = new THREE.Group();
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 520), TA.pirate.sea);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.55, -160);
    sea.add(water);
    const moon = new THREE.Mesh(new THREE.CircleGeometry(7, 24), TA.pirate.moon);
    moon.position.set(22, 30, -170);
    sea.add(moon);
    backdrops.pirate = sea;

    // พื้นครีมกว้าง (ขนมหวาน)
    const icing = new THREE.Group();
    const icingPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 520),
      new THREE.MeshLambertMaterial({ color: 0x8a4f78 })
    );
    icingPlane.rotation.x = -Math.PI / 2;
    icingPlane.position.set(0, -0.55, -160);
    icing.add(icingPlane);
    backdrops.candy = icing;

    // ทุ่งหญ้า (ฟาร์ม)
    const field = new THREE.Group();
    const fieldPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 520),
      new THREE.MeshLambertMaterial({ color: 0x35551f })
    );
    fieldPlane.rotation.x = -Math.PI / 2;
    fieldPlane.position.set(0, -0.55, -160);
    field.add(fieldPlane);
    backdrops.farm = field;

    // ทะเลทราย + พีระมิดคู่ที่ขอบฟ้า
    const dunesFar = new THREE.Group();
    const sandPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 520),
      new THREE.MeshLambertMaterial({ color: 0x8a6a3e })
    );
    sandPlane.rotation.x = -Math.PI / 2;
    sandPlane.position.set(0, -0.55, -160);
    dunesFar.add(sandPlane);
    for (const [px, pz, s] of [[-34, -150, 1], [30, -175, 1.4]]) {
      const pyr = new THREE.Mesh(TA.desert.gPyr, TA.desert.pyramid);
      pyr.rotation.y = Math.PI / 4;
      pyr.scale.setScalar(s);
      pyr.position.set(px, 4.5, pz);
      dunesFar.add(pyr);
    }
    backdrops.desert = dunesFar;

    for (const bd of Object.values(backdrops)) {
      bd.visible = false;
      corridor.add(bd);
    }
  }

  /* ══ ห้วงอวกาศสำหรับด่านโบนัส "ทางช้างเผือก" ═══════════════
   * สร้างทิ้งไว้ตั้งแต่ต้นเกมแล้วซ่อนไว้ ไม่ได้สร้างตอนเข้าด่านโบนัส
   * เพราะการสร้าง geometry/texture กลางเกมจะทำให้เฟรมกระตุกพอดี
   * ตอนที่ผู้เล่นกำลังตื่นเต้นที่สุด — ช่วงเวลาที่แย่ที่สุดที่จะกระตุก
   */
  const spaceGroup = new THREE.Group();
  spaceGroup.visible = false;
  scene.add(spaceGroup);

  // ⚠️ texture ขนาด 512×256 ถ้าแปะบนทรงกลมรัศมี 170 หน่วยตรง ๆ
  // ดาวแต่ละดวงจะถูกขยายเป็นสี่เหลี่ยมเบลอขนาดใหญ่ — ดูเหมือนภาพเสีย
  // ทางแก้คือสั่งให้ texture "ปูซ้ำ" หลายรอบ ดาวก็จะกลับมาเล็กคมเหมือนเดิม
  const skyTexture = createStarTexture();
  skyTexture.wrapS = THREE.RepeatWrapping;
  skyTexture.wrapT = THREE.RepeatWrapping;
  skyTexture.repeat.set(6, 3);

  const backdrop = new THREE.Mesh(
    new THREE.SphereGeometry(170, 28, 18),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, depthWrite: false })
  );
  spaceGroup.add(backdrop);

  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 96),
    new THREE.MeshBasicMaterial({
      map: createNebulaTexture(), transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  band.position.set(0, 22, -130);
  band.rotation.z = 0.26;
  spaceGroup.add(band);

  // ฝุ่นดาวที่ไหลผ่าน = ตัวบอกความเร็วในที่ที่ไม่มีผนังให้อ้างอิง
  const DUST = 900;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 34;
    dustPos[i * 3 + 1] = Math.random() * 18 - 3;
    dustPos[i * 3 + 2] = -Math.random() * 190;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xdcefff,
    size: 0.26,
    sizeAttenuation: true,
    map: createDotTexture(),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,          // ฝุ่นไม่ควรบังวัตถุจริงที่อยู่หลังมัน
    blending: THREE.AdditiveBlending,
  }));
  spaceGroup.add(dust);

  // ก้อนหินลอยไกล ๆ ให้มีระยะ
  const floaters = [];
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x3a4568, emissive: 0x10182e });
  for (let i = 0; i < 10; i++) {
    const rock = new THREE.Mesh(rockGeo, rockMat);
    rock.position.set(
      (Math.random() - 0.5) * 44,
      Math.random() * 16 - 4,
      -Math.random() * 190
    );
    rock.scale.setScalar(0.8 + Math.random() * 2.6);
    spaceGroup.add(rock);
    floaters.push(rock);
  }

  let environment = 'corridor';

  function setEnvironment(mode) {
    if (environment === mode) return;
    environment = mode;
    const inSpace = mode === 'space';
    corridor.visible = !inSpace;
    spaceGroup.visible = inSpace;
    // ในอวกาศต้องมองเห็นไกล ไม่งั้นหมอกจะกลืนทางช้างเผือกหายไปหมด
    scene.fog.near = inSpace ? 90 : CFG.world.fogNear;
    scene.fog.far = inSpace ? 320 : CFG.world.fogFar;
  }

  /* ══ ระบบธีม ═══════════════════════════════════════════════
   * เปลี่ยนธีม = "ทาสีใหม่" บน material ชุดเดิม ไม่สร้าง geometry ใหม่เลย
   * (material ถูกแชร์ทุกท่อนทางเดินอยู่แล้ว แก้ที่เดียวเปลี่ยนทั้งโลกทันที
   *  และไม่มีเฟรมกระตุกเพราะไม่มีการ allocate อะไรใหม่)
   */
  function applyTheme(themeId) {
    const t = themeById(themeId);
    const w = t.world;
    scene.background.setHex(w.bg);
    scene.fog.color.setHex(w.bg);
    M.floor.color.setHex(w.floor);
    M.hull.color.setHex(w.hull);
    M.hullDark.color.setHex(w.hullDark);
    M.frame.color.setHex(w.frame);
    M.lampWhite.color.setHex(w.lamp);
    M.neonCyan.color.setHex(w.neonA);
    M.neonPink.color.setHex(w.neonB);
    M.amber.color.setHex(w.accent);
    M.lane.color.setHex(w.laneLine ?? 0x3d4a78);

    // สลับ "โลก" จริง ๆ: ของตกแต่งประจำธีมทุกท่อน + ฉากหลัง (ทะเล/ทุ่ง/พีระมิด)
    for (const [id, list] of Object.entries(decoByTheme)) {
      const on = id === t.id;
      for (const d of list) d.visible = on;
    }
    for (const [id, bd] of Object.entries(backdrops)) bd.visible = id === t.id;

    // แสงบรรยากาศ: ในยานโทนเย็น / กลางแจ้งอุ่นตามท้องฟ้าของธีม
    hemi.color.setHex(w.sky ?? 0xbfe6ff);
    hemi.groundColor.setHex(w.ground ?? 0x0d1424);

    // ด่านโบนัสประจำธีม — ย้อมท้องฟ้า/เนบิวลา/ฝุ่น/ก้อนหินให้เข้าเรื่องราว
    const b = t.bonus;
    backdrop.material.color.setHex(b.sky);
    band.material.color.setHex(b.nebula);
    dust.material.color.setHex(b.dust);
    rockMat.color.setHex(b.rock);
  }

  /* ══ มุมกล้องล็อบบี้ (โชว์ตัวละครแบบ Fortnite) ══════════════
   * ไม่ตัดฉากทันที แต่ "เกลี่ย" ตำแหน่งกล้องระหว่างมุมวิ่งกับมุมโชว์ด้วย blend 0..1
   * → ตอนกดเริ่มเกม กล้องจะไหลจากหน้าตัวละครกลับไปมุมวิ่งอย่างนุ่มนวล ฟรี ๆ
   */
  // กล้องเยื้องซ้ายเล็กน้อย → ตัวละครไปโผล่กลาง-ขวาของจอ เปิดที่ว่างให้แผงเมนูฝั่งซ้าย
  // มุมโชว์ตัวละครในล็อบบี้ — เดสก์ท็อปเยื้องซ้ายเพื่อเปิดเวทีฝั่งขวา (สไตล์ Fortnite)
  // แต่บนมือถือแนวตั้ง แผงเมนูกินความกว้างทั้งจอ การเยื้องกล้องจะทำให้ตัวละคร
  // ไปหลบอยู่หลังแผงพอดี → resize() จะดึงกลับมากลางจอและถอยออกให้เห็นเต็มตัว
  const LOBBY_CAM = new THREE.Vector3(-1.5, 1.85, 4.6);   // resize() เขียนทับตามรูปทรงจอ
  const LOBBY_LOOK = new THREE.Vector3(0, 1.1, 0);
  let lobbyView = false;
  let lobbyBlend = 0;

  // แท่นโชว์ตัวละคร — วงแหวนเรืองแสง + ลำแสงจาง ๆ พุ่งขึ้น (เห็นเฉพาะตอนอยู่เมนู)
  const podium = new THREE.Group();
  const podiumDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.2, 0.16, 36),
    new THREE.MeshLambertMaterial({ color: 0x2c3654, emissive: 0x141b30 })
  );
  podiumDisc.position.y = 0.02;
  podium.add(podiumDisc);
  const podiumRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.08, 0.045, 10, 40),
    new THREE.MeshBasicMaterial({ color: PALETTE.cyan })
  );
  podiumRing.rotation.x = Math.PI / 2;
  podiumRing.position.y = 0.12;
  podium.add(podiumRing);
  const podiumBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.15, 4.2, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: PALETTE.cyan, transparent: true, opacity: 0.07,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  podiumBeam.position.y = 2.2;
  podium.add(podiumBeam);
  podium.visible = false;
  scene.add(podium);

  function setLobbyView(on) { lobbyView = on; }

  /* ── กล้อง: สั่นตอนชน + ไถลตามผู้เล่น ────────────────────── */
  let shakeAmount = 0;
  let focusX = 0;

  function shake(amount) {
    shakeAmount = Math.min(1.2, shakeAmount + amount);
  }

  let camLift = 0;      // ยกกล้องขึ้นตอนอยู่ในด่านโบนัส

  function update(dt, speed, playerX = 0) {
    if (environment === 'corridor') {
      for (const seg of segments) {
        seg.position.z += speed * dt;
        if (seg.position.z > CFG.world.despawnZ + segLen) {
          seg.position.z -= totalLength;   // ย้ายไปต่อท้ายแถว
        }
      }
    } else {
      const pos = dustGeo.attributes.position;
      for (let i = 0; i < DUST; i++) {
        // เก็บกลับก่อนถึงกล้อง (z = 9.5) ไม่งั้นเม็ดที่ผ่านหน้าเลนส์จะบานเต็มจอ
        let z = pos.array[i * 3 + 2] + speed * dt * 1.5;
        if (z > 5) z -= 195;
        pos.array[i * 3 + 2] = z;
      }
      pos.needsUpdate = true;

      for (const rock of floaters) {
        rock.position.z += speed * dt * 0.35;
        rock.rotation.x += dt * 0.4;
        rock.rotation.y += dt * 0.25;
        if (rock.position.z > 20) rock.position.z -= 200;
      }
      band.position.z += speed * dt * 0.05;
      if (band.position.z > -40) band.position.z = -180;
    }

    // ไถลตามแบบหน่วง ๆ (exponential smoothing) ไม่ใช่ snap ตาม
    // ถ้ากล้องกระตุกตามทันทีทุกเฟรม ภาพจะรู้สึก "แข็ง" และเวียนหัว
    focusX += (playerX - focusX) * Math.min(1, dt * 9);
    camBase.x = focusX * CFG.camera.followX;

    const liftTarget = environment === 'space' ? 1.5 : 0;
    camLift += (liftTarget - camLift) * Math.min(1, dt * 2.2);
    camBase.y = view.y + camLift;
    camBase.z = view.z;

    if (shakeAmount > 0.001) {
      shakeAmount = Math.max(0, shakeAmount - dt * CFG.camera.shakeDecay);
      camera.position.set(
        camBase.x + (Math.random() - 0.5) * shakeAmount,
        camBase.y + (Math.random() - 0.5) * shakeAmount,
        camBase.z + (Math.random() - 0.5) * shakeAmount * 0.5
      );
    } else {
      camera.position.copy(camBase);
    }

    // เกลี่ยเข้ามุมล็อบบี้ (โชว์ตัวละคร) — blend 0 = มุมวิ่งปกติเป๊ะ ไม่มีผลอะไรเลย
    lobbyBlend += ((lobbyView ? 1 : 0) - lobbyBlend) * Math.min(1, dt * 3);
    podium.visible = lobbyBlend > 0.03;
    if (podium.visible) podiumRing.rotation.z += dt * 0.7;

    if (lobbyBlend > 0.001) {
      camera.position.lerp(LOBBY_CAM, lobbyBlend);
      const look = new THREE.Vector3(
        focusX * CFG.camera.lookFollowX,
        view.lookAtY + camLift * 1.1,
        view.lookAtZ
      ).lerp(LOBBY_LOOK, lobbyBlend);
      camera.lookAt(look);
    } else {
      camera.lookAt(
        focusX * CFG.camera.lookFollowX,
        view.lookAtY + camLift * 1.1,
        view.lookAtZ
      );
    }
  }

  /**
   * ปรับ "มุมกล้อง" ตามรูปทรงของจอ — หัวใจของการรองรับมือถือ
   *
   * ⚠️ three.js ล็อก fov ไว้ที่แนวตั้ง มุมมองแนวนอนจึงเป็นผลพลอยได้ของอัตราส่วนจอ
   *    จอสูง (มือถือแนวตั้ง) = มุมมองแนวนอนแคบลงเอง → เลนซ้าย/ขวาหลุดขอบ
   *    บั๊กนี้ไม่มีวันเห็นตอนพัฒนาบนเดสก์ท็อป เพราะจอกว้างไปกลบมันไว้
   *
   * แก้ด้วยการ "ไล่เฉด" ระหว่างค่าเดสก์ท็อปกับค่าแนวตั้ง ตามอัตราส่วนจริง
   * ไม่ใช่สลับเป็นขั้น — เพราะแท็บเล็ต/มือถือแนวนอนอยู่ตรงกลาง และการสลับเป็นขั้น
   * จะทำให้ภาพ "กระตุก" ตอนหมุนเครื่องหรือเปิด/ปิดแถบเครื่องมือของ Safari
   */
  function computeView(aspect) {
    const c = CFG.camera;
    const p = c.portrait;
    // 0 = แนวตั้งเต็มตัว, 1 = เดสก์ท็อปเต็มตัว
    const t = Math.max(0, Math.min(1,
      (aspect - c.portraitAspect) / (c.landscapeAspect - c.portraitAspect)));
    const mix = (a, b) => b + (a - b) * t;   // t=1 → ค่าเดสก์ท็อป
    return {
      fov: mix(c.fov, p.fov),
      y: mix(c.y, p.y),
      z: mix(c.z, p.z),
      lookAtY: mix(c.lookAtY, p.lookAtY),
      lookAtZ: mix(c.lookAtZ, p.lookAtZ),
      portrait: t < 0.5,
    };
  }

  function resize() {
    // ⚠️ ใช้ขนาดของ canvas เอง ไม่ใช่ window.innerHeight
    // บน iOS Safari ทั้งสองค่าไม่เท่ากัน (#app ใช้ 100dvh ซึ่งหักแถบเครื่องมือออกแล้ว)
    // ถ้าอิง window เฟรมบัฟเฟอร์จะสูงกว่าพื้นที่จริง → ภาพถูกยืดและเลื่อนขึ้นเล็กน้อย
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / Math.max(1, h);

    view = computeView(aspect);
    camera.fov = view.fov;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    camBase.z = view.z;

    // มือถือแนวตั้ง: ดึงกล้องล็อบบี้กลับมากลางจอ แล้ว "มองต่ำลง"
    // การมองต่ำลงดันตัวละครขึ้นไปอยู่ครึ่งบนของเฟรม — ซึ่งเป็นครึ่งที่แผงเมนูไม่ได้ทับ
    // (แผงเมนูบนมือถือถูกดันลงไปชิดล่างด้วย CSS อีกทาง ทั้งสองอย่างต้องทำคู่กัน)
    const lob = view.portrait ? CFG.camera.lobbyPortrait : CFG.camera.lobby;
    LOBBY_CAM.fromArray(lob.cam);
    LOBBY_LOOK.fromArray(lob.look);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  // Safari บนมือถือย่อ/ขยายพื้นที่มองเห็นตอนซ่อนแถบเครื่องมือ โดยไม่ยิง resize ของ window
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  return {
    scene, camera, renderer, update, shake, resize, setEnvironment,
    applyTheme, setLobbyView,
    isPortrait: () => view.portrait,
    render: () => renderer.render(scene, camera),
  };
}
