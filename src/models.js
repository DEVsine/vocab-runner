/**
 * models.js — โหลดตัวละคร glTF (.glb) มาแทนตัวละครที่ปั้นด้วยโค้ด
 *
 * ── กฎข้อเดียวที่สำคัญที่สุดของไฟล์นี้: ห้ามพังเกม ──
 * ถ้าไฟล์โมเดลไม่มี / โหลดไม่สำเร็จ / GLTFLoader ยังไม่ได้วาง →
 * ต้อง "เงียบ ๆ แล้วถอยกลับไปใช้ตัวละครที่ปั้นด้วยโค้ด" เสมอ
 *
 * เหตุผล: โมเดลเป็นไฟล์หลักล้าน ๆ ไบต์ที่มาจากเน็ต บนมือถือสัญญาณอ่อนมันจะโหลดไม่สำเร็จ
 * เป็นเรื่องปกติ ไม่ใช่เรื่องผิดปกติ — เกมที่กลายเป็นจอขาวเพราะโหลดโมเดลไม่ทัน
 * แย่กว่าเกมที่ตัวละครหน้าตาเรียบกว่าที่ตั้งใจไว้ อย่างเทียบกันไม่ได้
 *
 * ── สิ่งที่ไฟล์นี้ "ปรับให้อัตโนมัติ" เพื่อให้โมเดลจากที่ไหนก็ใช้ได้ ──
 * โมเดลฟรีแต่ละเจ้าตั้งค่าไม่เหมือนกันเลย บางตัวสูง 1 หน่วย บางตัวสูง 180 หน่วย
 * บางตัวหันหน้าไป +Z บางตัว −Z บางตัวจุดหมุนอยู่กลางตัวไม่ใช่ที่เท้า
 * ถ้าให้คนมานั่งแก้เองทีละตัวจะพลาดแน่ และแก้ผิดทีนึงคือตัวละครจมพื้น/ลอย/หันหลังกลับ
 * เราจึงวัดกล่องครอบ (bounding box) แล้วปรับสเกลกับตำแหน่งให้เองทั้งหมด
 */

import * as THREE from 'three';
import { CFG } from './config.js';

/** ชื่อคลิปอนิเมชันต่างเจ้าต่างตั้ง — จับด้วยรูปแบบคำ ไม่ใช่ชื่อเป๊ะ ๆ */
const CLIP_PATTERNS = {
  run: /run|sprint|jog/i,
  idle: /idle|stand|breath/i,
  jump: /jump|leap|air/i,
  slide: /slide|roll|crouch|duck|slid/i,
};

let loaderPromise = null;

/* ⚠️ GLTFLoader ไม่ได้มาไฟล์เดียว — มันอิมพอร์ตต่อไปยัง
 *    `../utils/BufferGeometryUtils.js` ด้วย (ตั้งแต่ three r150 เป็นต้นมา)
 *
 * เส้นทางนั้นเป็น **เส้นทางสัมพัทธ์กับตัวไฟล์ GLTFLoader เอง** ไม่ใช่กับเกมของเรา
 * แปลว่าถ้าเอา GLTFLoader.js ไปวางโดด ๆ ที่ vendor/ มันจะไปหา
 * `<โฟลเดอร์เกม>/utils/BufferGeometryUtils.js` ซึ่งไม่มี → พังทันทีที่โหลดตัวละครตัวแรก
 *
 * ทางแก้ที่ถูก: **เก็บโครงโฟลเดอร์เดิมของ three ไว้** แล้วชี้เข้าไปในโครงนั้น
 *   vendor/jsm/loaders/GLTFLoader.js
 *   vendor/jsm/utils/BufferGeometryUtils.js
 * เส้นทาง `../utils/...` ที่อยู่ในไฟล์จะชี้ถูกเองโดยไม่ต้องแก้ไฟล์ที่ดาวน์โหลดมาเลย
 *
 * บทเรียนทั่วไป: ไลบรารีที่อิมพอร์ตกันเองด้วยเส้นทางสัมพัทธ์ ห้ามหยิบมาแค่ไฟล์เดียว
 * ต้องยกโครงโฟลเดอร์มาทั้งชุด ไม่งั้นจะเจอ error ที่ชี้ไปยังไฟล์ที่เราไม่เคยเห็น
 */
const LOADER_PATHS = [
  '../vendor/jsm/loaders/GLTFLoader.js',   // แนะนำ — โครงเดิมของ three ครบ
  '../vendor/GLTFLoader.js',               // สำรอง — เผื่อวางแบบไฟล์เดียวไว้แล้ว
];

/**
 * โหลด GLTFLoader แบบ "ขอไปที" — เรียกครั้งแรกเมื่อจะใช้จริงเท่านั้น
 * ถ้าไฟล์ยังไม่ได้วางใน vendor/ จะคืน null แทนการโยน error
 */
function getLoader() {
  if (loaderPromise) return loaderPromise;
  loaderPromise = (async () => {
    for (const path of LOADER_PATHS) {
      try {
        const m = await import(path);
        return new m.GLTFLoader();
      } catch { /* ลองเส้นทางถัดไป */ }
    }
    console.info('[models] ยังไม่มี vendor/jsm/loaders/GLTFLoader.js — ใช้ตัวละครที่ปั้นด้วยโค้ดต่อไป');
    return null;
  })();
  return loaderPromise;
}

/**
 * จัดท่าโมเดลให้เข้ากับโลกของเรา
 *
 * @param {THREE.Object3D} root โมเดลดิบจากไฟล์
 * @param {object} cfg ค่าปรับจูนต่อตัวละคร (faceZ / scale / yOffset) — ใส่ก็ได้ ไม่ใส่ก็ได้
 */
function normalize(root, cfg = {}) {
  const holder = new THREE.Group();

  // หันหน้า: เราวิ่งไปทาง −Z และกล้องอยู่หลังตัว
  // โมเดลส่วนใหญ่ถูกทำมาให้หันหน้าไป +Z (หันเข้าหาคนดูตอนพรีวิว) → ต้องหมุนกลับ 180°
  root.rotation.y = cfg.faceZ === -1 ? 0 : Math.PI;
  holder.add(root);

  // วัดขนาดจริงแล้วย่อ/ขยายให้สูงเท่าที่ hitbox ของเกมคาดไว้
  // ⚠️ ต้องวัด "หลังหมุนแล้ว" เสมอ ไม่งั้นได้กว้าง-ลึกสลับกัน
  const box = new THREE.Box3().setFromObject(holder);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0.0001) {
    const scale = (cfg.scale ?? 1) * (CFG.player.height / size.y);
    holder.scale.setScalar(scale);
  }

  // ดันให้ "ฝ่าเท้าอยู่ที่ y = 0" พอดี — โมเดลหลายตัวมีจุดหมุนอยู่กลางลำตัว
  // ถ้าไม่จัดตรงนี้ ตัวละครจะจมพื้นหรือลอยเหนือพื้นโดยที่โค้ดกระโดดไม่ได้ผิดอะไรเลย
  const box2 = new THREE.Box3().setFromObject(holder);
  holder.position.y = -box2.min.y + (cfg.yOffset ?? 0);

  return holder;
}

/** จับคู่คลิปอนิเมชันในไฟล์เข้ากับท่าที่เกมต้องใช้ */
function mapClips(clips) {
  const out = {};
  for (const [key, pattern] of Object.entries(CLIP_PATTERNS)) {
    out[key] = clips.find(c => pattern.test(c.name)) || null;
  }
  // ไม่มีคลิปวิ่งเลย → ใช้คลิปแรกที่มีดีกว่าไม่ขยับเลย
  if (!out.run && clips.length) out.run = clips[0];
  return out;
}

/**
 * โหลดตัวละคร 1 ตัว
 * @returns {Promise<null | {group, mixer, play, clips}>} null = ใช้ตัวสำรองที่ปั้นด้วยโค้ด
 */
export async function loadCharacter(id, cfg = {}) {
  const loader = await getLoader();
  if (!loader) return null;

  const url = `./assets/models/${id}.glb`;
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch {
    console.info(`[models] ไม่มี ${url} — ตัวละคร "${id}" จะใช้แบบปั้นด้วยโค้ด`);
    return null;
  }

  const group = normalize(gltf.scene, cfg);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clips = mapClips(gltf.animations || []);
  const actions = {};
  for (const [key, clip] of Object.entries(clips)) {
    if (clip) actions[key] = mixer.clipAction(clip);
  }

  let current = null;
  /**
   * สลับท่า — เกลี่ยข้ามท่าเสมอ (crossFade) ไม่ใช่ตัดสลับทันที
   * การตัดสลับทำให้ตัวละคร "กระตุก" ทุกครั้งที่กระโดด ซึ่งเป็นสิ่งที่ตาจับได้ง่ายมาก
   */
  function play(name, fade = 0.16) {
    const next = actions[name] || actions.run;
    if (!next || next === current) return;
    next.reset().play();
    if (current) current.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
    current = next;
  }

  play('idle', 0);
  return { group, mixer, play, clips, update: (dt) => mixer.update(dt) };
}
