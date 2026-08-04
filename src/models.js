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

/**
 * ชื่อคลิปอนิเมชันต่างเจ้าต่างตั้ง — จับด้วยรูปแบบคำ ไม่ใช่ชื่อเป๊ะ ๆ
 *
 * ⚠️ ต้องเป็น "รายการตามลำดับความชอบ" ไม่ใช่รูปแบบเดียว
 * ชุดโมเดลจริงมีคลิปเป็นสิบเป็นร้อย และคำว่า jump ก็โผล่ในหลายคลิปพร้อมกัน
 * (Jump_Start / Jump_Idle / Jump_Land / Jump_Full_Long)
 * ถ้าจับรูปแบบเดียวแล้วเอา "อันแรกที่เจอ" เราจะได้คลิปที่บังเอิญเรียงมาก่อน
 * ซึ่งมักเป็นคลิปผิด — ท่าลอยกลางอากาศต้องใช้ Jump_Idle (วนได้)
 * ไม่ใช่ Jump_Full_Long (มีทั้งออกตัวและลงพื้นอยู่ในคลิปเดียว → กระตุกทุกครั้งที่วน)
 *
 * ไล่จากเฉพาะเจาะจงที่สุดไปกว้างที่สุด ตัวแรกที่เจอชนะ
 */
const CLIP_PATTERNS = {
  run: [/^run(ning)?[_ ]?a$/i, /^run(ning)?$/i, /run|sprint|jog/i],
  idle: [/^idle$/i, /unarmed[_ ]?idle/i, /idle|stand|breath/i],
  jump: [/jump[_ ]?idle/i, /jump[_ ]?full/i, /jump|leap|air/i],
  slide: [/slide|slid/i, /dodge[_ ]?forward/i, /roll|crouch|duck/i],
  // ท่าหลบซ้าย/ขวา — ใช้ตอนเปลี่ยนเลน ถ้าไฟล์ไม่มีก็ตกไปใช้ท่าวิ่งตามปกติ
  dodgeL: [/dodge[_ ]?left/i, /strafe[_ ]?left/i, /left/i],
  dodgeR: [/dodge[_ ]?right/i, /strafe[_ ]?right/i, /right/i],
};

/**
 * ── ของที่ "เสียบไว้ในมือ" ต้องถูกซ่อนก่อนเสมอ ─────────────────
 *
 * ชุดโมเดลสำเร็จรูปมักแถมอาวุธมาให้หลายชิ้นในไฟล์เดียว โดยเสียบไว้ที่จุดต่อมือ
 * และ **เปิดแสดงไว้ทั้งหมด** เพราะไฟล์ถูกทำมาให้ดูตอนพรีวิว ไม่ใช่ตอนเล่นจริง
 * ถ้าเอามาใช้ตรง ๆ ตัวละครจะถือมีด + หน้าไม้ 2 อัน + ระเบิด พร้อมกันทั้งหมด
 *
 * ⚠️ และมันพังมากกว่าแค่เรื่องความสวย: ของพวกนี้ยื่นออกไปไกลจากตัว
 * ทำให้ "กล่องครอบ" ที่เราใช้วัดความสูงเพื่อย่อขยาย กว้าง 2.94 แทนที่จะเป็น 0.9
 * → ต้องซ่อนให้หมด **ก่อน** วัดกล่อง ไม่ใช่หลัง
 *
 * จับว่าอันไหนเป็น "ของเสียบ" จากชื่อกระดูกที่มันแขวนอยู่ (slot/socket/attach)
 * ซึ่งเป็นธรรมเนียมร่วมของชุดโมเดลเกือบทุกเจ้า
 * ถ้าไฟล์ไหนไม่ใช้ธรรมเนียมนี้ ก็จะไม่มีอะไรถูกซ่อน = ปลอดภัยอยู่ดี
 */
const SLOT_RE = /slot|socket|attach/i;

function collectProps(root) {
  const props = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    for (let n = o.parent; n; n = n.parent) {
      if (SLOT_RE.test(n.name || '')) {
        o.visible = false;
        props.set(o.name, o);
        break;
      }
    }
  });
  return props;
}

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

/** จับคู่คลิปอนิเมชันในไฟล์เข้ากับท่าที่เกมต้องใช้ (ไล่ตามลำดับความชอบ) */
function mapClips(clips) {
  const out = {};
  for (const [key, patterns] of Object.entries(CLIP_PATTERNS)) {
    out[key] = null;
    for (const p of patterns) {
      const hit = clips.find(c => p.test(c.name));
      if (hit) { out[key] = hit; break; }
    }
  }
  // ไม่มีคลิปวิ่งเลย → ใช้คลิปแรกที่มีดีกว่าไม่ขยับเลย
  if (!out.run && clips.length) out.run = clips[0];
  return out;
}

/**
 * ── ย้อมสีชุดใหม่ โดยไม่แตะผิวหนัง/หนัง/โลหะ ──────────────────
 *
 * ปัญหาจริง: ชุดโมเดลฟรีมักไม่มีตัวละครตรงกับที่เราต้องการเป๊ะ ๆ
 * (KayKit ไม่มีนินจา มีแต่ "โจรใส่ฮู้ดสีเขียว" ซึ่งทรงใช่แต่สีไม่ใช่)
 *
 * ทางที่ผิด: คูณสีทั้งวัสดุ (`material.color`) — มันคูณทุกพิกเซลรวมทั้งใบหน้า
 * ได้นินจาหน้าเขียว ซึ่งแย่กว่าเดิม
 *
 * ทางที่ถูก: **เลือกย้อมเฉพาะช่วงสี (hue) ที่เป็นเนื้อผ้า**
 * ทั้งตัวใช้เทกซ์เจอร์แผ่นเดียว แต่ของแต่ละอย่างอยู่คนละช่วงสีชัดเจนอยู่แล้ว
 *   ผิวหนัง ~24° · หนัง ~15° · ผ้าเขียว ~148° · เกราะเหล็กของ KayKit ~195° (อมฟ้า)
 * จึงคัดเฉพาะช่วงที่ต้องการมาแทนที่ แล้ว **คูณด้วยความสว่างเดิม** เพื่อเก็บเงากับไฮไลต์ไว้
 * (ถ้าทาสีทับตรง ๆ จะได้เงาแบนหมด เสียมิติที่ศิลปินปั้นมาให้ฟรี ๆ)
 *
 * ⚠️ อย่าเดาว่า "เกราะเหล็ก = สีเทา" — พอวัดจริงพบว่า KayKit ทำเกราะเป็น *สีอมฟ้า*
 * ซึ่งโชคดีมาก เพราะแยกออกจากผิวหนังได้ด้วย hue ล้วน ๆ
 * ถ้าเดาแล้วเขียนกฎ "จับสีเทา" ไว้ ผลลัพธ์คือ "ย้อมแล้วไม่มีอะไรเปลี่ยน" โดยไม่มี error ให้เห็น
 * **วัดสีจริงจากไฟล์ก่อนเสมอ** (สคริปต์นับสีอยู่ท้าย assets/models/README.md)
 *
 * ⚠️ CanvasTexture ตั้ง flipY = true มาเป็นค่าเริ่มต้น แต่เทกซ์เจอร์จาก glTF เป็น false
 * ถ้าไม่คัดลอกค่ามา ลายทั้งตัวจะกลับหัว — ซึ่งบน atlas แบบไล่เฉดจะไม่เห็นเป็น "กลับหัว"
 * แต่เห็นเป็น "สีเพี้ยนทั้งตัว" แทน แล้วหาสาเหตุยากมาก
 */
function recolorMap(map, rules) {
  const img = map.image;
  if (!img?.width) return map;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, cv.width, cv.height);
  const px = data.data;

  /* แปลงกฎเป็นรูปแบบเดียวไว้ก่อน — จะได้ไม่ต้องแตกเงื่อนไขในลูปที่วนล้านรอบ
   * grey:true = จับพิกเซลที่ "แทบไม่มีสี" แทนการจับช่วงสี
   *             (โลหะบางชุดเป็นเทาจริง ๆ ไม่ได้อมสีเหมือน KayKit)
   * light:[..] = ประตูเพิ่มด้วยความสว่าง ใช้แยกของที่ *สีเดียวกันแต่คนละความสว่าง*
   *             เช่นขนสัตว์สีน้ำตาลเข้ม กับผิวหนังสีน้ำตาลอ่อน ซึ่งแยกด้วย hue ไม่ได้เลย */
  const list = (Array.isArray(rules) ? rules : [rules]).map(r => ({
    grey: !!r.grey,
    h0: r.hue?.[0] ?? 0,
    h1: r.hue?.[1] ?? 360,
    l0: r.light?.[0] ?? 0,
    l1: r.light?.[1] ?? 1,
    tr: (((r.to ?? 0x1a1d24) >> 16) & 255) / 255,
    tg: (((r.to ?? 0x1a1d24) >> 8) & 255) / 255,
    tb: ((r.to ?? 0x1a1d24) & 255) / 255,
    gain: r.gain ?? 0.9,
    lift: r.lift ?? 0.35,
  }));

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    const light = (max + min) / 2;

    let hue = -1;
    if (delta >= 0.06) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
    }

    for (const rule of list) {
      if (rule.grey ? hue >= 0 : (hue < rule.h0 || hue > rule.h1)) continue;
      if (light < rule.l0 || light > rule.l1) continue;
      const k = rule.lift + light * rule.gain;     // เก็บเงา/ไฮไลต์เดิมไว้
      px[i] = Math.min(255, rule.tr * 255 * k);
      px[i + 1] = Math.min(255, rule.tg * 255 * k);
      px[i + 2] = Math.min(255, rule.tb * 255 * k);
      break;                                        // กฎแรกที่ตรงชนะ ไม่ย้อมซ้อน
    }
  }

  cx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = map.flipY;                           // ⚠️ ดูหมายเหตุด้านบน
  tex.colorSpace = map.colorSpace;
  tex.wrapS = map.wrapS;
  tex.wrapT = map.wrapT;
  tex.needsUpdate = true;
  return tex;
}

/** ย้อมทุกวัสดุในโมเดล (ใช้เทกซ์เจอร์ร่วมกัน จึงย้อมครั้งเดียวแล้วแจกต่อ) */
function applyRecolor(root, rule) {
  const done = new Map();
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      if (!m.map) continue;
      if (!done.has(m.map)) done.set(m.map, recolorMap(m.map, rule));
      m.map = done.get(m.map);
      m.needsUpdate = true;
    }
  });
}

/**
 * ── แก้วัสดุตรง ๆ ตามชื่อ ──────────────────────────────────────
 *
 * ⚠️ ไม่ใช่ทุกสีในโมเดลจะมาจากเทกซ์เจอร์
 * ตาเรืองแสงของโครงกระดูก KayKit ใช้วัสดุชื่อ "Glow" ที่ **ไม่มีเทกซ์เจอร์เลย**
 * สีมาจากช่อง emissive ล้วน ๆ → ต่อให้ย้อมเทกซ์เจอร์เก่งแค่ไหนก็ไม่มีทางแตะถึง
 *
 * บทเรียน: ก่อนจะไล่แก้ pipeline ให้เช็กก่อนว่า "สีที่เห็นมาจากช่องไหน"
 * (map / color / emissive) — ผมเสียเวลาย้อมเทกซ์เจอร์ไปหนึ่งรอบเต็มเพราะข้ามขั้นนี้
 */
function applyMaterialOverrides(root, overrides) {
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      const patch = overrides[m.name];
      if (!patch) continue;
      if (patch.color !== undefined) m.color.setHex(patch.color);
      if (patch.emissive !== undefined && m.emissive) m.emissive.setHex(patch.emissive);
      m.needsUpdate = true;
    }
  });
}

/**
 * โหลดตัวละคร 1 ตัว
 * @returns {Promise<null | {group, mixer, play, clips}>} null = ใช้ตัวสำรองที่ปั้นด้วยโค้ด
 */
export async function loadCharacter(id, cfg = {}) {
  const loader = await getLoader();
  if (!loader) return null;

  /* ⚠️ ต้องอ้างอิงจาก "ตำแหน่งของโมดูลนี้" ไม่ใช่ "ตำแหน่งของหน้าเว็บ"
   * `./assets/...` เฉย ๆ จะถูกแปลงเทียบกับ URL ของหน้าที่กำลังเปิดอยู่
   * ตอนเปิด /index.html ก็ถูก แต่พอเปิดหน้าในโฟลเดอร์ย่อย (เช่น /dev/character-sheet.html)
   * มันจะไปหา /dev/assets/models/... ซึ่งไม่มี → ตัวละครเงียบ ๆ กลับไปใช้ตัวปั้นเอง
   * โดยไม่มีอะไรบอกว่าสาเหตุคือเส้นทาง ไม่ใช่ไฟล์หาย
   *
   * import.meta.url คือที่อยู่ของไฟล์ .js นี้เอง → ผูกกับโครงโปรเจกต์จริง
   * ใช้ได้ทุกหน้า ทุก base path ไม่ว่าจะ deploy ไว้ใต้โฟลเดอร์อะไร */
  const url = new URL(`../assets/models/${id}.glb`, import.meta.url).href;
  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch {
    console.info(`[models] ไม่มี ${url} — ตัวละคร "${id}" จะใช้แบบปั้นด้วยโค้ด`);
    return null;
  }

  // ⚠️ ซ่อนของที่เสียบมือ *ก่อน* normalize เสมอ — normalize วัดกล่องครอบเพื่อคิดสเกล
  // ถ้าปล่อยให้หน้าไม้ยื่นออกไปตอนวัด ตัวละครจะถูกย่อผิดขนาดทั้งตัว
  const props = collectProps(gltf.scene);
  /* ⚠️ ชิ้นที่ต้องปิดถาวร — ไม่ใช่ทุกอย่างในไฟล์จะเหมาะกับมุมกล้องของเรา
   * เกมนี้มองตัวละครจากด้านหลังตลอดเวลา ผ้าคลุมหลังผืนใหญ่จึงบังการเคลื่อนไหวของแขนขา
   * ทั้งหมด เหลือแค่แผ่นดำเรียบ ๆ ลอยอยู่ — ดีในล็อบบี้ แต่แย่ตอนเล่นจริง */
  if (cfg.hide?.length) {
    const drop = new Set(cfg.hide);
    gltf.scene.traverse(o => { if (drop.has(o.name)) o.visible = false; });
  }
  if (cfg.recolor) applyRecolor(gltf.scene, cfg.recolor);
  if (cfg.materials) applyMaterialOverrides(gltf.scene, cfg.materials);

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

  /**
   * เปิดเฉพาะอาวุธที่ระบุ ปิดที่เหลือ — นี่คือวิธีที่ระบบ "3 สถานะ" ยังทำงานได้กับโมเดลสำเร็จรูป
   * @param {string[]} names ชื่อ mesh ในไฟล์ (ดูได้จากสคริปต์ dump ใน assets/models/README.md)
   */
  function setProps(names = []) {
    const want = new Set(names);
    for (const [name, mesh] of props) mesh.visible = want.has(name);
  }
  setProps([]);

  play('idle', 0);
  return {
    group, mixer, play, clips, setProps,
    propNames: [...props.keys()],
    update: (dt) => mixer.update(dt),
  };
}
