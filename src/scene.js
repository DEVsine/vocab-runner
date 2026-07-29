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

  // แสงในยาน: โทนเย็นจากเพดาน + ไฟส่องจากด้านหน้าให้เห็นรูปทรงชุดอวกาศ
  scene.add(new THREE.HemisphereLight(0xbfe6ff, 0x0d1424, 1.5));
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

  const segments = [];
  for (let i = 0; i < CFG.world.segmentCount; i++) {
    const g = new THREE.Group();

    const floor = new THREE.Mesh(G.floor, M.floor);
    floor.position.y = -0.2;
    g.add(floor);

    const ceiling = new THREE.Mesh(G.ceiling, M.hullDark);
    ceiling.position.y = wallH - 0.2;
    g.add(ceiling);

    // ไฟเส้นบนเพดาน — ตัวบอกความเร็วที่ชัดที่สุด และให้ฟีล "ทางเดินในยาน"
    const lamp = new THREE.Mesh(G.lampStrip, M.lampWhite);
    lamp.position.set(0, wallH - 0.45, 0);
    g.add(lamp);

    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(G.wall, M.hull);
      wall.position.set(side * (halfW + 0.25), wallH / 2 - 0.2, 0);
      g.add(wall);

      // ซี่โครงผนัง 2 ซี่ต่อท่อน = ลายที่ทำให้ตาจับความเร็วได้
      for (const zOff of [-segLen * 0.28, segLen * 0.28]) {
        const rib = new THREE.Mesh(G.rib, M.hullDark);
        rib.position.set(side * (halfW - 0.12), wallH / 2 - 0.2, zOff);
        g.add(rib);
      }

      // หน้าต่างมองเห็นห้วงอวกาศ (texture ดาวสร้างด้วยโค้ด)
      const win = new THREE.Mesh(G.window, M.space);
      win.position.set(side * (halfW - 0.02), 2.7, 0);
      g.add(win);

      // ท่อเดินสายบนผนัง + แถบเรืองแสงระดับพื้น
      const pipe = new THREE.Mesh(G.ductPipe, M.hullDark);
      pipe.position.set(side * (halfW - 0.2), 4.6, 0);
      g.add(pipe);

      const stripe = new THREE.Mesh(G.stripe, i % 3 === 0 ? M.amber : (i % 2 ? M.neonPink : M.neonCyan));
      stripe.position.set(side * (halfW - 0.05), 0.34, 0);
      g.add(stripe);
    }

    // เส้นแบ่งเลนบนพื้น — ช่วยให้รู้ว่าตัวเองอยู่เลนไหนโดยไม่ต้องคิด
    for (const x of [-CFG.world.laneWidth / 2, CFG.world.laneWidth / 2]) {
      const line = new THREE.Mesh(G.laneLine, M.lane);
      line.position.set(x, 0.03, 0);
      g.add(line);
    }

    // โครงประตูกั้นห้อง (bulkhead) ทุกท่อน — ให้ความรู้สึกว่ากำลังผ่านห้องไปเรื่อย ๆ
    const archTop = new THREE.Mesh(G.archTop, M.frame);
    archTop.position.set(0, wallH - 0.55, -segLen / 2);
    g.add(archTop);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(G.archPost, M.frame);
      post.position.set(side * (halfW + 0.05), wallH / 2 - 0.2, -segLen / 2);
      g.add(post);
    }

    g.position.z = -i * segLen;
    scene.add(g);
    segments.push(g);
  }

  const totalLength = segLen * CFG.world.segmentCount;

  const corridor = new THREE.Group();
  for (const seg of segments) corridor.add(seg);
  scene.add(corridor);

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
  const LOBBY_CAM = new THREE.Vector3(-1.5, 1.85, 4.6);
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
    camBase.y = CFG.camera.y + camLift;

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
        CFG.camera.lookAtY + camLift * 1.1,
        CFG.camera.lookAtZ
      ).lerp(LOBBY_LOOK, lobbyBlend);
      camera.lookAt(look);
    } else {
      camera.lookAt(
        focusX * CFG.camera.lookFollowX,
        CFG.camera.lookAtY + camLift * 1.1,
        CFG.camera.lookAtZ
      );
    }
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
  }

  window.addEventListener('resize', resize);

  return {
    scene, camera, renderer, update, shake, resize, setEnvironment,
    applyTheme, setLobbyView,
    render: () => renderer.render(scene, camera),
  };
}
