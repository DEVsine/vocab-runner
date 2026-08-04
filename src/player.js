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
import { loadCharacter } from './models.js';

/* ══ โครงกระดูก — ตัวเลขชุดเดียวที่ทุกชิ้นส่วนอ้างอิง ═══════════
 *
 * ⚠️ ห้ามพิมพ์ตัวเลขความสูงซ้ำในที่อื่นเด็ดขาด
 * เคยแยกความสูงลำตัวเป็น 0.87 (ตอนสร้าง) กับ 0.96 (ตอนอนิเมต) → ลำตัวกระโดดขึ้น
 * 9 ซม. ในเฟรมแรกของทุกรอบ เป็นบั๊กที่หายากมากเพราะมันถูก "ทุกที่ยกเว้นตอนต่อกัน"
 *
 * ── สัดส่วน 2.6 หัว (chibi) ไม่ใช่ 3.3 หัว ──
 * ฟิกเกอร์ของเล่นที่เราอ้างอิงสูงราว 2.2–2.9 หัว — หัวโตจนเป็นตัวเอกของเส้นรอบรูป
 * ส่วนของเดิมอยู่ที่ 3.3 หัว ซึ่งเป็นสัดส่วน "การ์ตูนผู้ใหญ่" ไม่ใช่ "ตุ๊กตา"
 * ความต่างแค่นี้คือเหตุผลหลักที่ตัวเดิมดูเป็นหุ่นเรขาคณิต ไม่ใช่ของเล่นน่าเก็บ
 *
 * ความสูงรวมยังต้องเท่าเดิม (1.65 = CFG.player.height ที่ใช้คิด hitbox)
 * เพราะฉะนั้นหัวโตขึ้นได้ทางเดียว: **ตัวสั้นลง** ไม่ใช่ตัวสูงขึ้น
 */
const HIP_Y = 0.60;
const SHOULDER_Y = 0.96;
const TORSO_Y = 0.80;
const NECK_Y = 1.05;
const HEAD_Y = 1.34;          // 1.34 + 0.31 = 1.65 พอดี
const HEAD_R = 0.31;          // 1.65 / 0.62 = 2.66 หัว ✔

/** easeOutQuad — ออกตัวเร็วแล้วผ่อนเข้าที่ ให้ความรู้สึก "กระฉับกระเฉง" */
const easeOutQuad = t => 1 - (1 - t) * (1 - t);

/**
 * ── เปลือกไฮไลต์: วิธีทำ "พลาสติกฉีดเงา ๆ" บนวัสดุที่ไม่มีความเงา ────
 *
 * ปัญหา: MeshToonMaterial ไม่มีช่อง specular เลย มันคำนวณแค่ N·L แล้วปัดเป็นแถบ
 * ผลคือทุกพื้นผิวเป็น "สีทึบแบน" — ซึ่งเป็นสิ่งที่แยกภาพเรนเดอร์ของเราออกจาก
 * รูปฟิกเกอร์อ้างอิงชัดที่สุด ของเล่นจริงมีจุดขาว ๆ วิ่งไปตามส่วนโค้งเสมอ
 * และสมองใช้ "จุดขาวที่เลื่อนตามส่วนโค้ง" เป็นตัวบอกว่าของชิ้นนี้มีปริมาตรจริง
 *
 * ทางแก้: ซ้อนอีกชั้นที่ *มีแต่ specular* ทับลงไป
 *   สีพื้น = ดำสนิท → ไม่เพิ่มสีอะไรเลย
 *   AdditiveBlending → มีแต่ไฮไลต์ที่บวกขึ้นมา ส่วนที่เหลือบวกศูนย์ = มองไม่เห็น
 *   depthWrite:false → ไม่ไปบังของที่อยู่ข้างหลังมัน
 *   fog:false ⚠️ สำคัญ — ถ้าเปิดหมอกไว้ พอวัตถุอยู่ไกล เชเดอร์จะเกลี่ยสีเข้าหา
 *              สีหมอก แล้ว "สีหมอก" จะถูก *บวก* เข้าไป = ตัวละครเรืองแสงตอนอยู่ไกล
 *
 * ราคา: 1 draw call ต่อชิ้น และใช้ geometry ร่วมกับตัวจริง (ไม่กินหน่วยความจำเพิ่ม)
 */
function glossShell(mesh, shininess = 60) {
  const shell = new THREE.Mesh(mesh.geometry, new THREE.MeshPhongMaterial({
    color: 0x000000,
    specular: 0x808080,
    shininess,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  }));
  shell.scale.setScalar(1.006);      // ลอยพ้นผิวนิดเดียว กัน z-fighting
  mesh.add(shell);
  return shell;
}

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
    tone: toonMat(0xefb182),        // สีผิวบนใบหน้า — เปลี่ยนตามตัวละคร
    brow: toonMat(0x1c1210),        // คิ้ว/ปาก
    visor: new THREE.MeshBasicMaterial({ color: 0x0a1526 }),
    cyan: new THREE.MeshBasicMaterial({ color: PALETTE.cyan }),
    amber: new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
  };

  const gloss = [];              // เปลือกไฮไลต์ทุกชิ้น — applySkin ปรับความมันพร้อมกันทีเดียว

  /* ── ลำตัว: ทรงเหลี่ยมสอบ ไม่ใช่กล่อง ──────────────────────
   * กล่องสี่เหลี่ยมมี 4 ด้านที่กว้างเท่ากันตลอดความสูง → ตาอ่านว่า "กล่อง" ทันที
   * ร่างคนมีบ่ากว้างแล้วสอบลงที่เอว — แค่ใส่ความสอบเข้าไปอย่างเดียว
   * ทรงเดียวกันก็เลิกเป็นกล่องแล้ว
   *
   * ใช้ Cylinder 8 เหลี่ยมแล้วบีบแกน Z ให้แบน: ได้ทรงสอบที่ยังมีเหลี่ยมคม
   * (เหลี่ยมสำคัญ — ทรงกลมเรียบจะสะท้อนแสงต่อเนื่องจนไม่มีขอบให้ toon ตัดแถบ)
   */
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.235, 0.5, 8), mat.suit);
  torso.scale.set(1, 1, 0.66);
  torso.rotation.y = Math.PI / 8;          // หมุนให้เหลี่ยมหันเข้าหากล้อง ไม่ใช่มุมแหลม
  torso.position.y = TORSO_Y;
  rig.add(torso);
  const torsoGloss = glossShell(torso, 42);
  gloss.push(torsoGloss.material);

  /* แผ่นอกเฉียง — ทำให้ด้านหน้าลำตัวไม่ใช่ระนาบเดียวเรียบ ๆ
   * ⚠️ ต้องใช้สีเดียวกับลำตัว (mat.suit) ไม่ใช่ suitDim
   * ตัวละครบางตัวตั้ง suit เป็นดำและ suitDim เป็นเทาอ่อน (นินจา) — ใช้ suitDim ตรงนี้
   * จะได้ "แผ่นเทาแปะกลางอกดำ" ซึ่งอ่านเป็นคราบสี ไม่ใช่รูปทรง
   * รูปทรงต้องถูกอ่านจากเงาและขอบ ไม่ใช่จากการเปลี่ยนสี */
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.3, 0.16, 8), mat.suit);
  chest.scale.set(1, 1, 0.68);
  chest.rotation.y = Math.PI / 8;
  chest.position.y = SHOULDER_Y;
  rig.add(chest);

  // แถบสะท้อนแสงรอบตัว (แถบส้มบนชุด NASA) — ช่วยให้ตาแยกตัวละครออกจากพื้นหลังเข้ม
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.09, 0.39), mat.amber);
  belt.position.y = HIP_Y + 0.03;
  rig.add(belt);

  /* ── ถังออกซิเจนด้านหลัง — เฉพาะนักบินอวกาศเท่านั้น ──────────
   *
   * ⚠️ นี่คือสาเหตุที่แท้จริงที่ตัวละครทุกตัว "ดูเหมือนกันหมด"
   * ถังถูกแปะไว้กับโครงร่างกลาง ไม่ใช่กับชุดนักบินอวกาศ — ผลคือนินจาแบกถังออกซิเจน
   * ซามูไรแบกถังออกซิเจน ลอร์ดมืดก็แบกถังออกซิเจน
   * และเพราะเราเห็นตัวละคร "จากด้านหลัง" ตลอดเวลา ถังสีเทากล่องนี้จึงกลายเป็น
   * สิ่งที่ครองเส้นรอบรูปของทุกตัว จนของประจำตัวจริง ๆ ถูกกลบหมด
   *
   * บทเรียน: ของที่เป็นของ "ตัวละครหนึ่งตัว" ห้ามอยู่ในโครงร่างกลางเด็ดขาด
   * ไม่ว่ามันจะดูเข้ากันดีแค่ไหนตอนที่ยังมีตัวละครเดียว
   */
  const astroKit = new THREE.Group();
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.26), mat.pack);
  pack.position.set(0, 0.85, 0.3);
  astroKit.add(pack);

  for (const x of [-0.13, 0.13]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), mat.cyan);
    light.position.set(x, 0.98, 0.44);
    astroKit.add(light);
  }
  const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.07, 0.28), mat.amber);
  packStripe.position.set(0, 0.7, 0.3);
  astroKit.add(packStripe);
  rig.add(astroKit);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.135, 0.08, 12), mat.joint);
  neck.position.y = NECK_Y;
  rig.add(neck);

  /* ══ หัว: ทุกอย่างที่ติดหัวต้องอยู่ในกลุ่มเดียวกัน ══════════════
   *
   * ⚠️ นี่คือโครงสร้างที่ต้องแก้ก่อนจะใส่ "หน้า" ได้เลย
   * ของเดิมหมุนเฉพาะ mesh หัว (helmet.rotation.y) ส่วนฮู้ด/หมวก/เขา ถูกแขวนไว้กับลำตัว
   * ตอนหัวเป็นทรงกลมเปล่า ๆ ไม่มีใครสังเกต เพราะทรงกลมหมุนแล้วเหมือนเดิม
   * แต่พอใส่ตาลงไป หัวจะ "ส่ายออกมาจากใต้หมวกที่อยู่นิ่ง" ทันที
   *
   * บทเรียนทั่วไป: ถ้าชิ้นส่วนสองชิ้นต้องขยับพร้อมกันเสมอ มันต้องอยู่ใน
   * ลำดับชั้นเดียวกัน — ห้ามแก้ด้วยการเขียนโค้ดอนิเมตให้ตรงกันสองที่
   * เพราะวันที่มันหลุดจากกัน จะไม่มีอะไรฟ้องเลย มีแต่ "รู้สึกว่าดูแปลก ๆ"
   */
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  rig.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 40, 30), mat.suit);
  head.add(helmet);
  gloss.push(glossShell(helmet, 70).material);

  /* ── หมวกนักบินอวกาศ: อยู่ในกลุ่มหัวเพื่อให้ส่ายตามหัว แต่ซ่อน/แสดงคู่กับ astroKit ──
   * ⚠️ "อยู่ในลำดับชั้นไหน" กับ "ถูกเปิดปิดพร้อมกับใคร" เป็นคนละเรื่องกัน
   * ของเดิมเอาสองเรื่องนี้มามัดรวมกัน (ครีบต้องอยู่ใน astroKit ถึงจะถูกซ่อน)
   * ทำให้ครีบส่ายตามหัวไม่ได้ เพราะ astroKit แขวนอยู่กับลำตัว
   * แยกกันด้วย astroParts: ลำดับชั้นว่าไปตามการเคลื่อนไหว การซ่อนว่าไปตามตัวละคร */
  /* ⚠️ กระจกต้อง "โผล่พ้น" ผิวหัว ไม่ใช่แค่เล็กกว่าหัวแล้ววางไว้ค่อนไปข้างหน้า
   * ของเดิมรัศมี 0.225 บนหัวรัศมี 0.25 เยื้องหน้าแค่ 0.1 → จมอยู่ในหัวทั้งใบ
   * นักบินอวกาศจึงเป็น "ลูกบอลขาวไม่มีหน้า" มาตลอดโดยไม่มีใครสังเกต
   * เพราะเวลาเล่นเราเห็นแต่ท้ายทอย — ข้อผิดพลาดจะโผล่เฉพาะตอนหันหน้าเข้ากล้อง
   * บทเรียน: ของที่ "ไม่เคยอยู่ในเฟรม" จะไม่มีใครเห็นว่ามันพัง จนกว่าจะเปลี่ยนมุมกล้อง */
  /* ⚠️ ทรงกลมสองใบที่ "เฉือนกัน" จะได้เส้นตัดหยักเป็นฟันปลา ถ้าจำนวนเหลี่ยมน้อย
   * เพราะเส้นตัดจริงเป็นเส้นโค้ง แต่ผิวที่มีอยู่เป็นแผ่นสามเหลี่ยมแบน ๆ
   * ขอบที่ได้จึงเดินตามขอบสามเหลี่ยม ไม่ได้เดินตามเส้นโค้ง
   * ทางแก้ไม่ใช่การไล่ขยับตำแหน่งให้ "พอดี" (ซึ่งพังทันทีที่หัวถูก scale)
   * แต่คือเพิ่มความละเอียดของทั้งสองใบ — ค่าใช้จ่ายแทบไม่มีเพราะมีชิ้นเดียว */
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.3, 40, 30), mat.visor);
  visor.scale.set(0.8, 0.72, 0.62);
  visor.position.set(0, 0.02, -0.15);
  head.add(visor);

  /* จุดสะท้อนบนกระจก — ของเล่นพลาสติกทุกตัวในภาพอ้างอิงมีจุดขาววาวบนส่วนโค้ง
   * และตาใช้จุดนี้ตัดสินว่าวัสดุคืออะไร ผิวดำด้านกับผิวดำเงาต่างกันแค่จุดนี้จุดเดียว */
  const visorGlint = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.7 })
  );
  visorGlint.scale.set(0.95, 0.6, 0.16);
  visorGlint.position.set(-0.085, 0.075, -0.317);
  visorGlint.rotation.z = 0.52;
  head.add(visorGlint);

  // ครีบบนหมวก — ของที่ "ยื่นออกจากทรงกลม" ทำให้เงาทึบไม่ใช่แค่ลูกบอลบนกล่อง
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.34), mat.amber);
  fin.position.set(0, 0.28, 0.02);
  head.add(fin);

  /* ตะเข็บหมวกเรืองแสง — ทำให้มองเห็นหัวชัดจากข้างหลังในทางเดินมืด ๆ
   * ⚠️ ครึ่งวงเท่านั้น และต้องเป็น "ครึ่งหลัง"
   * ของเดิมเป็นวงเต็มพาดข้ามกบาลจากหน้าไปหลัง ตอนกระจกยังเล็กก็ไม่เป็นไร
   * พอกระจกใหญ่ขึ้นเท่าที่ควรจะเป็น วงนั้นกลายเป็นเส้นฟ้าผ่ากลางหน้าพอดี
   * เอาไว้เฉพาะฝั่งที่กล้องเกมมองเห็น (ท้ายทอย) แล้วมันจะทำหน้าที่เดิมได้โดยไม่กวนหน้า */
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(HEAD_R + 0.008, 0.024, 8, 24, Math.PI), mat.cyan
  );
  seam.rotation.x = Math.PI / 2;      // แกนวงตั้งขึ้น → เป็นแถบคาดรอบหัวครึ่งหลัง
  head.add(seam);

  const astroParts = [astroKit, visor, visorGlint, fin, seam];

  /* ── ใบหน้า ─────────────────────────────────────────────────
   * ในเกมเราเห็นตัวละครจากด้านหลังตลอด หน้าจึงไม่มีผลต่อการเล่นเลย
   * แต่ในล็อบบี้/ร้านค้า/แท่นรับรางวัล ตัวละครหันหน้าเข้ากล้อง — และตรงนั้น
   * "ไม่มีหน้า" คือสิ่งที่ทำให้มันดูเป็นหุ่นพลาสติกแทนที่จะเป็นตัวละคร
   *
   * ⚠️ หันไป −Z (ด้านหน้าตัวละคร) — ทิศเดียวกับที่วิ่งไป ไม่ใช่ทิศที่กล้องอยู่
   *
   * ── ทำไมต้องมี "แผ่นหน้า" ไม่ใช่แค่แปะตาลงบนหัว ──
   * นินจา/ลอร์ดมืดมีหัวสีดำ ถ้าแปะตาขาวลงไปตรง ๆ จะได้ "ลูกบอลดำมีตา"
   * ฟิกเกอร์จริงมีระนาบใบหน้าที่ *นูนออกมาจากกะโหลก* และมีสีผิวของตัวเอง
   * ระนาบนั้นคือสิ่งที่ทำให้หมวก/ฮู้ดมีอะไรให้ "ครอบ" — ไม่มีมัน หมวกก็แค่ลูกบอลซ้อนลูกบอล
   */
  const face = new THREE.Group();
  head.add(face);

  /* ⚠️ แผ่นหน้าต้อง "โผล่พ้น" กะโหลกอย่างชัดเจน ห้ามแค่เสมอกัน
   * ตอนแรกวางไว้ที่ z −0.185 ซึ่งผิวหน้ากับผิวกะโหลกเกือบแนบกันพอดี
   * ผลคือกลางหน้าผากมีเส้นหยักขาว ๆ เป็นน้ำแข็งย้อย — เพราะสองผิวสลับกันอยู่ข้างหน้า
   * ทีละสามเหลี่ยม ตรงบริเวณที่มันเกือบสัมผัสกัน
   *
   * กฎที่ใช้ได้ทั่วไป: ผิวสองชิ้นต้อง "ตัดกันชัด ๆ" หรือ "ห่างกันชัด ๆ" อย่างใดอย่างหนึ่ง
   * โซนตรงกลางที่เกือบแนบกันคือโซนที่ทุกอย่างดูพัง */
  const facePlate = new THREE.Mesh(new THREE.SphereGeometry(0.235, 32, 26), mat.tone);
  facePlate.scale.set(0.98, 1.04, 0.55);
  facePlate.position.set(0, -0.015, -0.21);
  face.add(facePlate);
  gloss.push(glossShell(facePlate, 26).material);

  const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xfbfdff });
  const eyeDark = new THREE.MeshBasicMaterial({ color: 0x120f14 });
  const brows = [];
  for (const side of [-1, 1]) {
    /* ตาทรงรี ไม่ใช่กล่อง — กล่องอ่านเป็น "พิกเซล" ส่วนทรงรีอ่านเป็น "ตา"
     * และตาต้องใหญ่เกินจริงมาก ฟิกเกอร์อ้างอิงมีตากว้างราว 14% ของความกว้างหัว */
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 12), eyeWhite);
    eye.scale.set(0.92, 1.24, 0.36);
    eye.position.set(side * 0.098, -0.012, -0.333);
    face.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.033, 12, 10), eyeDark);
    pupil.scale.set(0.94, 1.2, 0.36);
    pupil.position.set(side * 0.1, -0.02, -0.345);
    face.add(pupil);

    // คิ้วหนาเอียงเข้าหากัน = หน้าดุ — ในภาพอ้างอิงคิ้วหนากว่าตาเกือบทุกตัว
    // มันคือสิ่งที่ทำให้ฟิกเกอร์ "มีอารมณ์" ทั้งที่หน้าแทบไม่มีรายละเอียดอื่นเลย
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.042, 0.045), mat.brow);
    brow.position.set(side * 0.104, 0.078, -0.322);
    brow.rotation.z = side * 0.38;
    face.add(brow);
    brows.push(brow);
  }
  // ปากเบ้เล็ก ๆ — เส้นเดียวแต่เปลี่ยนหน้าจาก "ว่างเปล่า" เป็น "ไม่พอใจ"
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.019, 0.04), mat.brow);
  mouth.position.set(0, -0.128, -0.325);
  face.add(mouth);

  /* ── แขน: มีข้อศอกจริง ──────────────────────────────────────
   * แคปซูลท่อนเดียวจากไหล่ถึงมือคือ "ไม้" ไม่ใช่แขน — มันงอไม่ได้
   * และท่าวิ่งของคนคือท่าที่ **ศอกงอค้างไว้ตลอด** แล้วเหวี่ยงจากไหล่
   * ไม่มีข้อศอก = ไม่มีทางทำท่าวิ่งให้ดูเป็นคนได้เลยไม่ว่าจะจูนมุมยังไง
   *
   * โครง: ไหล่(pivot) → ต้นแขน → ศอก(elbow) → ปลายแขน → มือ
   * ท่อนสอบลง (radiusTop > radiusBottom) ทำให้แขนไม่ใช่ท่อขนาดเดียวตลอด
   */
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.31, SHOULDER_Y, 0);

    // บ่านูน — หัวไหล่ต้องไม่ใช่หน้าตัดท่อที่ตัดตรง
    const pauldron = new THREE.Mesh(
      new THREE.SphereGeometry(0.155, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), mat.suit
    );
    pauldron.position.y = 0.01;
    pivot.add(pauldron);
    gloss.push(glossShell(pauldron, 52).material);

    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.092, 0.24, 7), mat.suit);
    upper.position.y = -0.135;
    pivot.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    pivot.add(elbow);

    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.082, 0.21, 7), mat.suitDim);
    fore.position.y = -0.11;
    elbow.add(fore);

    /* ── มือแบบถุงมือ ไม่ใช่กล่อง ──────────────────────────────
     * ฟิกเกอร์อ้างอิงทุกตัวมีมือทรงถุงมือกลม ๆ ที่มีนิ้วโป้งแยกออกมาก้อนเดียว
     * นิ้วโป้งก้อนนั้นสำคัญกว่าที่คิด: มันคือสิ่งเดียวที่บอกว่ามือ "หันด้านไหน"
     * มือกลมล้วนจะดูเหมือนลูกบอลติดปลายแขน ไม่ว่าจะใหญ่แค่ไหน
     *
     * และมือต้องใหญ่เกินจริง — ปลายแขนคือจุดที่แกว่งไกลที่สุดตอนวิ่ง
     * ถ้ามือเล็ก ตาจะจับจังหวะแขนขาไม่ได้เลยที่ระยะ 150px
     */
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 12), mat.joint);
    glove.scale.set(1, 1.12, 0.92);
    glove.position.y = -0.245;
    elbow.add(glove);
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.046, 10, 8), mat.joint);
    thumb.scale.set(0.9, 1.15, 0.9);
    thumb.position.set(side * -0.082, -0.215, -0.03);
    thumb.rotation.z = side * 0.5;
    elbow.add(thumb);

    rig.add(pivot);
    pivot.userData.elbow = elbow;
    return pivot;
  }

  // ── ขา: มีหัวเข่า ท่อนสอบ รองเท้าใหญ่ ──
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.145, HIP_Y, 0);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.115, 0.27, 7), mat.suitDim);
    thigh.position.y = -0.135;
    pivot.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.27;
    pivot.add(knee);

    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.092, 0.24, 7), mat.suitDim);
    shin.position.y = -0.12;
    knee.add(shin);

    // รองเท้าหนา + ปลายเท้ามน — ส้นเหลี่ยมรับน้ำหนัก ปลายมนบอกทิศทางที่หันไป
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.155, 0.3), mat.joint);
    boot.position.set(0, -0.245, -0.03);
    knee.add(boot);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), mat.joint);
    toe.scale.set(1, 0.62, 0.9);
    toe.position.set(0, -0.245, -0.15);
    knee.add(toe);
    gloss.push(glossShell(toe, 40).material);

    rig.add(pivot);
    pivot.userData.knee = knee;
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
    flame.position.set(x, 0.66, 0.28);
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

  /** จุดแขวนของที่ "ถืออยู่ในมือ" — ต้องอยู่ใต้ *ข้อศอก* ไม่ใช่ใต้ไหล่
   *  ไม่งั้นดาบจะไม่งอตามศอก แล้วมันจะทะลุออกจากปลายแขนตอนวิ่ง */
  function handMount(pivot) {
    const g = new THREE.Group();
    g.position.y = -0.245;         // ระดับถุงมือ (วัดจากข้อศอก)
    pivot.userData.elbow.add(g);
    return g;
  }

  /**
   * โดมหมวกที่ "เปิดช่องหน้า" ไว้ — ชิ้นส่วนหลักของสปาตันกับซามูไร
   *
   * ⚠️ อย่าใช้ครึ่งทรงกลมครอบหัวแล้วปล่อยด้านล่างโล่ง
   * ครึ่งทรงกลมได้ "หมวกกันน็อกจักรยาน" ไม่ใช่หมวกรบ เพราะหมวกรบโบราณ
   * ห่อหัวเกือบทั้งใบแล้วเว้นแค่ช่องหน้า — และ *ช่องนั้นเอง* คือรูปทรงที่จำได้
   *
   * เทคนิค: ทรงกลมที่ตัดลิ่มด้านหน้าออก (phiLength < 2π) แล้วเปิด DoubleSide
   * เพื่อให้เห็นผิวในของหมวก ไม่ใช่ทะลุเป็นรูโล่ง
   * ⚠️ ใน three.js ด้านหน้า (−Z) อยู่ที่ phi = −π/2 ไม่ใช่ 0
   */
  function domeHelm(radius, material, gapHalf = 0.52) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(
        radius, 26, 20,
        -Math.PI / 2 + gapHalf, Math.PI * 2 - gapHalf * 2
      ),
      material
    );
  }

  /* ── สปาตัน: โล่กลม + หอก + หงอนหมวก ─────────────────────── */
  {
    const restG = new THREE.Group();   // สายรัดหลัง — เห็นเมื่อ "มีของ"
    const stowG = new THREE.Group();   // โล่+หอกพาดหลัง
    const holdL = handMount(armL);
    const holdR = handMount(armR);
    const helmG = new THREE.Group();   // หมวกโครินเธียน — เอกลักษณ์ของสปาตันในเงาทึบ

    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.08), leather);
    strap.position.set(0, 0.93, 0.44);
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
    shieldStow.g.position.set(0, 0.9, 0.5);
    shieldStow.glow.visible = false;
    stowG.add(shieldStow.g);
    const spearStow = buildSpear();
    spearStow.position.set(0.26, 1.0, 0.34);
    spearStow.rotation.z = 0.3;
    stowG.add(spearStow);

    // ── ถือ: โล่ที่แขนซ้าย หันหน้าออก / หอกในมือขวาชี้เฉียงขึ้น ──
    /* ⚠️ โล่ตอนถือต้องหันหน้าโล่ "ออกไปข้างหน้า" ไม่ใช่ออกด้านข้าง
     * buildShield วางจานให้แกนอยู่ตามแนว X ไว้แล้ว (หน้าโล่หันซ้าย-ขวา)
     * ของเดิมหมุน y แค่ 0.18 → จากด้านหน้าเห็นโล่เป็นขีดบาง ๆ เส้นเดียว
     * ของชิ้นใหญ่ที่สุดของสปาตันจึงหายไปทั้งชิ้นในมุมที่ผู้เล่นใช้เลือกซื้อ */
    const shieldHold = buildShield();
    shieldHold.g.position.set(-0.14, -0.04, -0.08);
    shieldHold.g.rotation.y = Math.PI / 2 + 0.22;
    holdL.add(shieldHold.g);

    const spearHold = buildSpear();
    spearHold.position.set(0.04, 0.28, 0.02);
    spearHold.rotation.set(-0.22, 0, -0.14);
    holdR.add(spearHold);

    /* ── หมวกโครินเธียน ────────────────────────────────────────
     * โดมทองเหลืองห่อหัวเกือบทั้งใบ เว้นลิ่มด้านหน้าให้เห็นใบหน้า
     * แล้วปิดหน้าผากด้วยคาดขวาง + แก้มสองข้าง → ได้ช่องหน้าทรง "T" ที่จำได้ทันที
     * ⚠️ ต้องเปิด DoubleSide ไม่งั้นเวลามองเฉียง ๆ จะทะลุเข้าไปเห็นข้างในหมวกเป็นรูโล่ง
     */
    const bronzeIn = toonMat(0xc9a24e, { side: THREE.DoubleSide });
    const bowl = domeHelm(HEAD_R + 0.035, bronzeIn, 0.5);
    bowl.position.y = 0.015;
    helmG.add(bowl);
    gloss.push(glossShell(bowl, 78).material);

    const browBand = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.16), weaponMat);
    browBand.position.set(0, 0.185, -0.255);
    browBand.rotation.x = -0.22;
    helmG.add(browBand);

    // แก้มเกราะสองข้าง — บีบช่องหน้าให้แคบลง ทำให้หน้าดู "ถูกหุ้มอยู่" ไม่ใช่โล่ง
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.26, 0.14), weaponMat);
      cheek.position.set(side * 0.2, -0.075, -0.235);
      cheek.rotation.z = side * -0.12;
      helmG.add(cheek);
    }

    // หงอนหมวก: 8 แผ่นเรียงเป็นสัน สูงกลาง เตี้ยปลาย
    // ⚠️ หงอนต้อง "หนา" ไม่ใช่แค่ "สูง"
    // เรามองตัวละครจากด้านหลังตรง ๆ ตลอด แผ่นบางจะหันสันเข้าหาเราพอดี
    // แล้วหงอนที่ตั้งใจให้เป็นเอกลักษณ์จะกลายเป็น "เส้นขีดเดียว" เหนือหัว
    // ⚠️ หงอนต้องพาดมาถึง "หน้าผาก" ด้วย ไม่ใช่เริ่มที่กลางกบาลแล้วลาดไปท้ายทอย
    // ในภาพอ้างอิงหงอนเป็นแผ่นแดงก้อนใหญ่ที่เห็นชัดจากด้านหน้า
    // ถ้าเริ่มที่กลางหัว ตอนมองตรง ๆ จะเหลือแค่ปลายแหลมโผล่หลังหมวก
    const plume = toonMat(0xd6453f);
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const h = 0.14 + Math.sin(t * Math.PI) * 0.22;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.145, h, 0.09), plume);
      seg.position.set(0, 0.29 + h / 2, 0.26 - t * 0.66);
      helmG.add(seg);
    }
    // ฐานหงอน — ทำให้หงอนดู "ติดอยู่กับหมวก" ไม่ใช่ลอยอยู่เหนือหัว
    const crestBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.7), weaponMat);
    crestBase.position.set(0, 0.275, -0.04);
    helmG.add(crestBase);

    weapons.spartan = {
      // หมวกอยู่ในกลุ่ม always — มันคือ "หัวของสปาตัน" ไม่ใช่ของที่เก็บมาได้
      // เส้นรอบรูปของตัวละครต้องบอกว่าเป็นใครตั้งแต่ก่อนเก็บของชิ้นแรก
      always: [helmG], rest: [restG], stow: [stowG], hold: [holdL, holdR],
      glow: shieldHold.glow, mounts: [restG, stowG], headMounts: [helmG],
    };
  }

  /* ── ซามูไร: คาตานะ + ฝักดาบ ─────────────────────────────── */
  {
    const helmG = new THREE.Group();     // หมวกคาบูโตะ = ตัวตน ไม่ใช่ของที่เก็บมา
    const restG = new THREE.Group();
    const stowG = new THREE.Group();
    const holdR = handMount(armR);

    // โดมหมวกแล็กเกอร์แดง เปิดช่องหน้ากว้างกว่าสปาตัน (ซามูไรเปิดหน้าทั้งใบ)
    const kabutoMat = toonMat(0xb2372e, { side: THREE.DoubleSide });
    const bowl = domeHelm(HEAD_R + 0.04, kabutoMat, 0.66);
    bowl.position.y = 0.025;
    helmG.add(bowl);
    gloss.push(glossShell(bowl, 86).material);

    /* เขาหมวกรูปตัว V (มาเอดาเตะ) — ทรงเหลี่ยมแหลมอ่านว่า "ก้าวร้าว" ทันที
     * ⚠️ ต้องใหญ่กว่าที่รู้สึกว่าพอดี ในภาพอ้างอิงเขาสูงเกือบเท่าครึ่งหัว
     * ของประดับที่ "พอดี" จะหายไปทันทีเมื่อย่อเหลือ 150px — ต้องเวอร์ถึงจะรอด */
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.42, 4), weaponMat);
      horn.position.set(side * 0.135, 0.3, -0.12);
      horn.rotation.set(0.3, Math.PI / 4, side * 0.52);
      helmG.add(horn);
    }
    // จานทองกลางหน้าผาก (มง) — จุดวาวจุดเดียวที่ดึงตาไปที่ใบหน้า
    const mon = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 16), weaponMat);
    mon.rotation.x = Math.PI / 2;
    mon.position.set(0, 0.185, -0.29);
    helmG.add(mon);

    // แผ่นบังข้างหมวก (ฟุกิงาเอชิ) — บานออกด้านข้าง ทำให้เงาทึบกว้างขึ้นระดับหัว
    for (const side of [-1, 1]) {
      const flare = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.17, 0.13), kabutoMat);
      flare.position.set(side * 0.32, 0.02, -0.1);
      flare.rotation.z = side * 0.35;
      helmG.add(flare);
    }

    // ชายเกราะคอบานออก (ชิโกโระ) — เพิ่มมวลให้บ่าและตัดเส้นคอที่เรียวเกินไป
    const neckGuard = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.4, 0.17, 8), lacquer);
    neckGuard.position.set(0, -0.2, 0.04);
    helmG.add(neckGuard);

    // มวยผมด้านหลัง — ชิ้นเล็กที่บอกว่าใต้หมวกมีคนอยู่ ไม่ใช่หมวกเปล่า
    const topknot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), toonMat(0x1b1512));
    topknot.scale.set(1, 1.5, 1);
    topknot.position.set(0, 0.12, 0.33);
    helmG.add(topknot);

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
    saya.position.set(-0.16, 0.92, 0.42);
    saya.rotation.z = -0.46;
    restG.add(saya);
    for (const t of [-0.3, 0.1]) {
      const cord = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.045, 0.128), weaponMat);
      cord.position.set(-0.16 + t * 0.46 * Math.sin(-0.46), 0.92 + t, 0.42);
      cord.rotation.z = -0.46;
      restG.add(cord);
    }

    const katanaStow = buildKatana();
    katanaStow.g.position.set(-0.16, 0.92, 0.42);
    katanaStow.g.rotation.z = -0.46;
    katanaStow.g.scale.set(1, 0.98, 1);
    stowG.add(katanaStow.g);

    // ⚠️ เอียงออกนอกตัว 0.62 ไม่ใช่ 0.22 — ที่มุมเดิมใบดาบพาดผ่านหน้าตัวเองพอดี
    // อาวุธห้ามบังใบหน้าในมุมโชว์ตัว ต่อให้ท่าจะ "ถูก" แค่ไหนก็ตาม
    const katanaHold = buildKatana();
    katanaHold.g.position.set(0.06, 0.4, -0.06);
    katanaHold.g.rotation.set(-0.3, 0, -0.62);
    holdR.add(katanaHold.g);

    weapons.samurai = {
      always: [helmG], rest: [restG], stow: [stowG], hold: [holdR],
      glow: katanaHold.edge, mounts: [restG, stowG], headMounts: [helmG],
    };
  }

  /* ── นินจา: ดาวกระจาย + ผ้าพันคอ ─────────────────────────── */
  {
    const alwaysG = new THREE.Group();   // ผ้าพันคอ/สายคาด = เสื้อผ้าประจำตัว ไม่ใช่ของที่เก็บมา
    const hoodG = new THREE.Group();     // ผ้าพันหัว — อยู่ในกลุ่มหัว จะได้ส่ายไปพร้อมหน้า

    /* ── ผ้าพันหัวนินจา: ห่อทั้งใบ เหลือแค่ "แถบตา" ────────────
     *
     * ของเดิมใช้ครึ่งทรงกลมครอบท้ายทอยแล้วเปิดหน้าโล่งทั้งหน้า ซึ่งได้ "คนใส่หมวกไหมพรม"
     * ภาพอ้างอิงคือผ้าพันรอบหัวจนเหลือช่องแนวนอนแคบ ๆ ที่ตา — และช่องแคบนั้นเอง
     * คือสิ่งที่ทำให้มันอ่านว่า "นินจา" ไม่ใช่ "คนใส่ชุดดำ"
     *
     * วิธีทำที่ถูกที่สุด: ทรงกลมดำเต็มใบ แล้ว *ดันแผ่นหน้าออกมาข้างหน้า*
     * ให้มันโผล่พ้นผิวทรงกลมเป็นแถบเดียว (ดู face.mode === 'slit' ใน applySkin)
     * — ไม่ต้องเจาะรูบนทรงกลมเลย ซึ่งเป็นงานที่แพงและพังง่ายกว่ามาก
     */
    const hoodMat = toonMat(0x14181f);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 0.03, 22, 18), hoodMat);
    hoodG.add(hood);

    // รอยพับผ้าคาดหน้าผาก — เส้นเดียวที่บอกว่านี่คือ "ผ้าพัน" ไม่ใช่ "หมวกกันน็อก"
    const wrapFold = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.032, 8, 24), toonMat(0x1d222c));
    wrapFold.rotation.x = Math.PI / 2 - 0.24;
    wrapFold.position.set(0, 0.13, 0.02);
    hoodG.add(wrapFold);

    // ชายผ้าสองเส้นห้อยท้ายทอย — สะบัดตามจังหวะวิ่ง ทำให้หัวไม่ใช่ก้อนนิ่ง
    const hoodTails = [];
    for (const side of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.34, 0.05), hoodMat);
      tail.position.set(side * 0.085, -0.16, 0.3);
      tail.rotation.x = -0.3;
      hoodG.add(tail);
      hoodTails.push(tail);
    }
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
      seg.position.set(0, 1.06 - i * 0.05, 0.42 + i * 0.26);
      alwaysG.add(seg);
      scarfSegs.push(seg);
    }
    // ปมผ้าที่คอ — จุดเริ่มของผ้า ทำให้มันดูผูกอยู่จริงไม่ใช่ลอยตามหลัง
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.3), scarfMat);
    knot.position.set(0, 1.07, 0.2);
    alwaysG.add(knot);
    // ผ้าคาดเอวหนา ๆ (โอบิ) — ในภาพอ้างอิงนี่คือสีน้ำตาลก้อนเดียวที่ตัดกับชุดดำทั้งตัว
    const obi = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.36), toonMat(0x6b4a2e));
    obi.position.set(0, 0.64, 0);
    alwaysG.add(obi);
    // สายคาดอกใส่ดาว
    const sash = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.4), wrapMat);
    sash.position.set(0, 0.9, 0.16);
    sash.rotation.z = -0.42;
    alwaysG.add(sash);

    // พกไว้: ดาวเล็ก 2 ดวงเสียบที่สายคาด
    for (const x of [-0.2, 0.2]) {
      const s = buildShuriken(0.52);
      s.g.position.set(x, 0.9 - x * 0.42, 0.4);
      s.glow.visible = false;
      stowG.add(s.g);
    }

    // ถือ: ดาวใหญ่ในมือขวา หมุนตลอดเวลา (ตั้งค่าใน update)
    const spin = buildShuriken(1.35);
    spin.g.position.set(0.06, -0.02, -0.14);
    holdR.add(spin.g);

    weapons.ninja = {
      always: [alwaysG, hoodG], rest: [restG], stow: [stowG], hold: [holdR],
      glow: spin.glow, spin: spin.g, scarf: scarfSegs, tails: hoodTails,
      mounts: [alwaysG, restG, stowG], headMounts: [hoodG],
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

    /* ผ้าคลุมหลัง: 4 แผ่นสอบลง ไล่จากบ่าถึงน่อง
     * เคปคือวิธีที่ถูกที่สุดในการทำให้เส้นรอบรูป "ใหญ่และมีน้ำหนัก" โดยไม่ต้องเพิ่มโพลี
     * และเพราะเรามองจากด้านหลังตลอด มันจึงเป็นสิ่งแรกที่ตาเห็นเสมอ */
    const capeMat = toonMat(0x14161d);
    const capeSegs = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.56 - t * 0.16, 0.28, 0.05), capeMat);
      seg.position.set(0, 1.0 - i * 0.26, 0.3 + t * 0.1);
      beltG.add(seg);
      capeSegs.push(seg);
    }
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.3), capeMat);
    collar.position.set(0, 1.08, 0.2);
    beltG.add(collar);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.09, 0.42), lacquer);
    belt.position.y = 0.6;
    beltG.add(belt);

    /* ── แผงควบคุมกลางอก ────────────────────────────────────────
     * ในภาพอ้างอิง นี่คือสิ่งเดียวที่มีสีบนตัวละครที่ดำล้วนทั้งตัว
     * ตัวละครสีดำสนิทมีปัญหาเฉพาะตัว: ไม่มีอะไรให้ตาเกาะเลย
     * จุดสีเล็ก ๆ จุดเดียวแก้ปัญหานี้ได้ทั้งหมด และมันคือของที่มีอยู่ในต้นแบบอยู่แล้ว */
    const ctrlBox = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.1), toonMat(0x1e222c));
    ctrlBox.position.set(0, 0.86, -0.22);
    beltG.add(ctrlBox);
    for (const [x, color] of [[-0.06, 0xff3355], [0.0, 0x33e08a], [0.06, 0x3f9dff]]) {
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.05, 0.03),
        new THREE.MeshBasicMaterial({ color })
      );
      led.position.set(x, 0.87, -0.27);
      beltG.add(led);
    }

    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.05), toonMat(0x9aa3b8));
    clip.position.set(0.3, 0.6, 0.06);
    restG.add(clip);

    /* ══ หน้ากากลอร์ดมืด ═══════════════════════════════════════
     * ตัวละครนี้ไม่มี "หน้า" — มันมี *รูปทรงที่ตำแหน่งของหน้า* ซึ่งน่ากลัวกว่า
     * และเพราะทุกชิ้นเป็นสีดำเกือบเหมือนกันหมด สิ่งเดียวที่แยกรูปทรงออกจากกันได้
     * คือเงากับไฮไลต์ → นี่คือตัวละครที่ค่า gloss สูงสุดในเกม (0.95) และต้องสูง
     * ไม่งั้นทั้งหัวจะยุบเป็นเงาทึบก้อนเดียวไม่มีรายละเอียดเลย
     */
    const maskG = new THREE.Group();
    /* ⚠️ ตัวละครสีดำล้วนต้องการ "ช่วงสีดำ" ไม่ใช่ "สีดำ"
     * ถ้าทุกชิ้นใช้ดำเฉดเดียวกัน รูปทรงทั้งหมดจะยุบรวมเป็นเงาก้อนเดียว
     * ต่างกันแค่ 2 เฉดก็พอ แต่ต้องต่างจริง — 0x101219 กับ 0x1c202b ยังใกล้เกินไป */
    const shellMat = toonMat(0x0d0f15);
    const trimMat = toonMat(0x2b3243);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R + 0.045, 24, 20), shellMat);
    dome.scale.set(1, 1.04, 1);
    dome.position.y = 0.03;
    maskG.add(dome);
    // ⚠️ ยิ่งค่า shininess สูง จุดไฮไลต์ยิ่ง "เล็กและคม" ไม่ใช่ "สว่างขึ้น"
    // ที่ 110 จุดไฮไลต์กว้างจนกินพื้นที่กลางหน้ากาก แล้วอ่านเป็น "จมูกมันเงา"
    // 240 ได้จุดวาวเล็ก ๆ แบบพลาสติกเคลือบเงาจริง โดยไม่ไปทับรูปทรงของหน้ากาก
    gloss.push(glossShell(dome, 240).material);

    // ชายหมวกบานออก — เส้นรอบรูปที่จำได้ของต้นแบบอยู่ตรงนี้ ไม่ใช่ที่โดม
    const flare = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.44, 0.26, 20, 1, true),
      toonMat(0x0c0e14, { side: THREE.DoubleSide })
    );
    flare.position.y = -0.24;
    maskG.add(flare);

    /* ⚠️ ทุกชิ้นของหน้ากากต้องวางลึกเทียบกับ *ผิวโดม* ไม่ใช่เทียบกับรัศมีหัวเดิม
     * โดมกว้าง 0.355 แต่ชิ้นส่วนถูกวางไว้ที่ z ≈ −0.28 ตามขนาดหัวเดิม (0.31)
     * ทั้งจมูก ทั้งซี่ช่องหายใจจึงจมอยู่ในโดมทั้งหมด แล้วสิ่งที่เห็นตรงกลางหน้ากาก
     * กลายเป็น "จุดไฮไลต์ของโดม" เฉย ๆ — ดูเหมือนจมูกโครเมียมมากกว่าหน้ากาก
     * ทางที่ถูกคือดันทุกชิ้นออกมาให้พ้นผิวโดมชัด ๆ (ราว 0.05 ขึ้นไป) */
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.085, 0.14), trimMat);
    ridge.position.set(0, 0.125, -0.325);
    ridge.rotation.x = -0.26;
    maskG.add(ridge);

    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(
        new THREE.BoxGeometry(0.125, 0.095, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x14060a })
      );
      lens.position.set(side * 0.115, 0.005, -0.36);
      lens.rotation.z = side * 0.36;
      maskG.add(lens);

      // แก้มยาวลงมาถึงกราม — ชิ้นที่ทำให้หน้ากากดู "ยาว" แทนที่จะเป็นลูกบอล
      const tusk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.1), trimMat);
      tusk.position.set(side * 0.175, -0.1, -0.315);
      tusk.rotation.z = side * 0.16;
      maskG.add(tusk);
    }

    // สันจมูกสามเหลี่ยม
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 3), trimMat);
    nose.rotation.set(Math.PI, 0, 0);
    nose.position.set(0, 0.025, -0.375);
    maskG.add(nose);

    // ช่องหายใจ: บล็อกสี่เหลี่ยมคางหมู + ซี่โลหะ 4 ซี่
    const grille = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.16, 4), trimMat);
    grille.rotation.y = Math.PI / 4;
    grille.position.set(0, -0.15, -0.31);
    maskG.add(grille);
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.13, 0.04), toonMat(0x8b93a6));
      rib.position.set(-0.048 + i * 0.032, -0.15, -0.395);
      maskG.add(rib);
    }

    // พกไว้: ด้ามดาบห้อยเอว ยังไม่จุดไฟ
    const hiltStow = buildHilt();
    hiltStow.position.set(0.32, 0.5, 0.08);
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
      always: [beltG, maskG], rest: [restG], stow: [stowG], hold: [holdR],
      glow: blade, cape: capeSegs, mounts: [beltG, restG, stowG], headMounts: [maskG],
    };
  }

  /* ── แขวนกลุ่มเข้าที่ ────────────────────────────────────────
   * mounts     → ลำตัว (ผ้าคลุม เข็มขัด ฝักดาบ)
   * headMounts → กลุ่มหัว (หมวก ฮู้ด หน้ากาก) เพื่อให้ส่ายไปพร้อมใบหน้า
   * ทั้งสองอย่างถูกซ่อน/แสดงด้วย refreshGear เหมือนกัน — ต่างกันแค่ "ขยับตามอะไร"
   */
  for (const w of Object.values(weapons)) {
    for (const m of w.mounts) rig.add(m);
    for (const m of (w.headMounts ?? [])) head.add(m);
  }

  return {
    rig, armL, armR, legL, legR, torso, chest, head, helmet,
    face, facePlate, brows, mouth, thrusters, mat, weapons, astroParts, gloss, torsoGloss,
  };
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
      a.torso.position.y = TORSO_Y + Math.sin(state.runT * 1.6) * 0.015;   // หายใจเบา ๆ
      a.head.rotation.y = Math.sin(state.runT * 0.9) * 0.16;
      a.head.rotation.x = 0;
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

    /* ── ท่าทาง ───────────────────────────────────────────────
     * ── ท่าวิ่งของคนจริง vs ท่าที่โค้ดง่าย ๆ ให้มา ──
     * โค้ดง่าย ๆ คือ "แกว่งแขนขาสลับข้างรอบจุดกึ่งกลาง" ซึ่งได้ท่า *เดิน* ไม่ใช่ *วิ่ง*
     * ท่าวิ่งจริงต่างกันที่ 3 อย่าง และต้องมีครบทั้งสามถึงจะอ่านออกว่าวิ่ง:
     *   1) ตัวเอนไปข้างหน้า — คนวิ่งคือคนที่กำลังจะล้มแล้วเอาขาไปรับทัน
     *   2) แขนอยู่ "หลังลำตัว" เป็นหลัก แล้วเหวี่ยงกลับ ไม่ใช่แกว่งหน้า-หลังเท่ากัน
     *   3) ศอกงอค้างไว้ตลอด ไม่เคยเหยียดตรง
     * ข้อ 2 กับ 3 คือที่มาของคำว่า "เอนมือไปข้างหลัง" — และทั้งคู่ทำไม่ได้เลย
     * ถ้าแขนเป็นท่อนเดียวไม่มีข้อศอก
     */
    const cadence = state.runT * 12;
    const swing = Math.sin(cadence);
    const elbowL = a.armL.userData.elbow;
    const elbowR = a.armR.userData.elbow;
    const kneeL = a.legL.userData.knee;
    const kneeR = a.legR.userData.knee;

    let leanTarget = 0;

    if (airborne) {
      // ลอยอยู่: เก็บขา ศอกงอ แขนกางไปข้างหลัง
      a.legL.rotation.x = THREE.MathUtils.lerp(a.legL.rotation.x, 0.9, dt * 14);
      a.legR.rotation.x = THREE.MathUtils.lerp(a.legR.rotation.x, 0.3, dt * 14);
      kneeL.rotation.x = THREE.MathUtils.lerp(kneeL.rotation.x, 1.15, dt * 14);
      kneeR.rotation.x = THREE.MathUtils.lerp(kneeR.rotation.x, 0.4, dt * 14);
      a.armL.rotation.x = THREE.MathUtils.lerp(a.armL.rotation.x, -1.05, dt * 14);
      a.armR.rotation.x = THREE.MathUtils.lerp(a.armR.rotation.x, -1.05, dt * 14);
      elbowL.rotation.x = THREE.MathUtils.lerp(elbowL.rotation.x, 0.7, dt * 14);
      elbowR.rotation.x = THREE.MathUtils.lerp(elbowR.rotation.x, 0.7, dt * 14);
      leanTarget = -0.1;
    } else if (slideK > 0.05) {
      // สไลด์: ขาเหยียดไปข้างหน้า แขนแนบตัว
      a.legL.rotation.x = THREE.MathUtils.lerp(a.legL.rotation.x, 1.15, dt * 16);
      a.legR.rotation.x = THREE.MathUtils.lerp(a.legR.rotation.x, 0.95, dt * 16);
      kneeL.rotation.x = THREE.MathUtils.lerp(kneeL.rotation.x, 0.15, dt * 16);
      kneeR.rotation.x = THREE.MathUtils.lerp(kneeR.rotation.x, 0.35, dt * 16);
      a.armL.rotation.x = THREE.MathUtils.lerp(a.armL.rotation.x, 0.35, dt * 16);
      a.armR.rotation.x = THREE.MathUtils.lerp(a.armR.rotation.x, 0.35, dt * 16);
      elbowL.rotation.x = THREE.MathUtils.lerp(elbowL.rotation.x, 0.5, dt * 16);
      elbowR.rotation.x = THREE.MathUtils.lerp(elbowR.rotation.x, 0.5, dt * 16);
    } else {
      // ── สปรินต์ ──
      const ARM_BACK = 0.5;      // ออฟเซ็ตลบ = แขนค้างอยู่หลังลำตัว แล้วค่อยเหวี่ยง
      const ELBOW = 1.0;         // ศอกงอค้าง ไม่เคยเหยียดตรง

      a.legL.rotation.x = swing * 0.95;
      a.legR.rotation.x = -swing * 0.95;
      // งอเข่าเฉพาะ "ขาที่กำลังยกกลับ" — ขาที่ยันพื้นต้องเหยียด ไม่งั้นดูย่อตัวตลอดเวลา
      kneeL.rotation.x = Math.max(0, -swing) * 1.25;
      kneeR.rotation.x = Math.max(0, swing) * 1.25;

      a.armL.rotation.x = -swing * 0.5 - ARM_BACK;
      a.armR.rotation.x = swing * 0.5 - ARM_BACK;
      elbowL.rotation.x = ELBOW + swing * 0.35;
      elbowR.rotation.x = ELBOW - swing * 0.35;

      leanTarget = -0.17;

      // เสียงฝีเท้าตรงจังหวะที่ขาแตะพื้นจริง ๆ (ทุกครึ่งรอบของ sin)
      // เสียงที่ไม่ตรงกับภาพจะรู้สึก "ผิด" ทันทีแม้อธิบายไม่ถูกว่าผิดตรงไหน
      const halfCycle = Math.floor(cadence / Math.PI);
      if (halfCycle !== state.lastHalfCycle) {
        state.lastHalfCycle = halfCycle;
        sfx?.step();
      }
    }

    // เอนหลังตอนสไลด์ (หมุนบวก = หัวไปทาง +z คือเอนเข้าหากล้อง)
    // รวมกับ "เอนไปข้างหน้าตอนวิ่ง" (ค่าลบ) — ค่อย ๆ เกลี่ยเข้าหากันไม่ให้กระตุก
    state.lean = THREE.MathUtils.lerp(state.lean ?? 0, leanTarget, dt * 8);
    a.rig.rotation.x = slideK * 1.0 + state.lean;
    a.rig.position.y = -slideK * 0.06;

    // เอียงตัวตามทิศที่เลื่อนเลน + เด้งขึ้นลงตอนวิ่ง = ดูมีชีวิต
    const laneVel = state.laneT < 1 ? (state.laneTo - state.laneFrom) : 0;
    a.rig.rotation.z = THREE.MathUtils.lerp(a.rig.rotation.z, -laneVel * 0.09, dt * 12);
    const grounded = !airborne && slideK <= 0.05;

    // โมเดล glTF: เดินอนิเมชันของมันเอง แล้วเลือกท่าจากสถานะเดียวกับที่ตัวปั้นเองใช้
    // (ท่าทางด้านล่างยังคำนวณต่อไปแม้ตอนใช้โมเดล — เปลืองน้อยมาก และทำให้สลับกลับได้ทันที)
    if (activeModel) {
      activeModel.update(dt);
      activeModel.play(airborne ? 'jump' : slideK > 0.05 ? 'slide' : 'run');
    }
    a.torso.position.y = TORSO_Y + (grounded ? Math.abs(Math.cos(cadence)) * 0.04 : 0);
    // ไหล่บิดสวนสะโพก — รายละเอียดเล็กที่ทำให้ท่าวิ่งเลิกดูเหมือนหุ่นชักใย
    a.torso.rotation.y = Math.PI / 8 + (grounded ? swing * 0.11 : 0);
    // หัวส่ายทั้งกลุ่ม — หมวก ฮู้ด หน้ากาก และใบหน้าไปด้วยกันเสมอ (ดูเหตุผลตอนสร้าง head)
    a.head.rotation.y = Math.sin(state.runT * 2.2) * 0.12;
    a.head.rotation.x = grounded ? -0.06 + Math.abs(swing) * 0.05 : 0;   // ก้มหน้าเล็กน้อยตอนวิ่ง

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
    // ผ้าคลุมหลังของลอร์ดมืด — สะบัดช้ากว่าผ้าพันคอเพราะหนักกว่า
    if (weapon?.cape) {
      weapon.cape.forEach((seg, i) => {
        seg.rotation.x = 0.12 + Math.sin(state.runT * 4.5 - i * 0.5) * 0.11;
      });
    }
    // ผ้าพันคอนินจาสะบัดตามจังหวะวิ่ง (เร็วขึ้นตามความเร็วขา)
    if (weapon?.scarf) {
      weapon.scarf.forEach((seg, i) => {
        seg.rotation.x = Math.sin(state.runT * 7 - i * 0.7) * 0.3;
        seg.position.y = 1.06 - i * 0.05 + Math.sin(state.runT * 7 - i * 0.7) * 0.04;
      });
    }
    // ชายผ้าท้ายทอย — สะบัดสวนเฟสกัน (ซ้ายกับขวาไม่พร้อมกัน) ไม่งั้นดูเหมือนแผ่นเดียวแข็ง ๆ
    if (weapon?.tails) {
      weapon.tails.forEach((t, i) => {
        t.rotation.x = -0.3 + Math.sin(state.runT * 6.5 - i * 1.4) * 0.22;
        t.rotation.z = Math.sin(state.runT * 5 - i * 1.9) * 0.14;
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

  /* ══ โหมดโมเดล glTF ═════════════════════════════════════════
   * ถ้ามีไฟล์ assets/models/<id>.glb → ใช้โมเดลนั้นแทนตัวที่ปั้นด้วยโค้ด
   * ถ้าไม่มี → ทุกอย่างทำงานเหมือนเดิมทุกประการ (ดูเหตุผลใน models.js)
   *
   * ⚠️ โหลดแบบ async แต่ผู้เล่นเปลี่ยนสกินได้ทันที → ต้องเช็กว่า "ตอนโหลดเสร็จ
   * ยังเป็นสกินเดิมอยู่ไหม" ก่อนเอาเข้าฉาก ไม่งั้นกดสลับตัวเร็ว ๆ จะได้ตัวละครซ้อนกันสองตัว
   */
  const modelHolder = new THREE.Group();
  group.add(modelHolder);
  const modelCache = new Map();
  let activeModel = null;

  function useModel(id) {
    const c = characterById(id);
    if (!c.model) { setModel(null); return; }

    if (modelCache.has(id)) { setModel(modelCache.get(id)); return; }
    modelCache.set(id, null);            // กันโหลดซ้ำระหว่างที่ยังโหลดไม่เสร็จ
    loadCharacter(id, c.model).then((m) => {
      modelCache.set(id, m);
      if (state.skin === id) setModel(m);
    });
  }

  function setModel(m) {
    if (activeModel?.group) activeModel.group.visible = false;
    activeModel = m || null;
    if (activeModel) {
      if (activeModel.group.parent !== modelHolder) modelHolder.add(activeModel.group);
      activeModel.group.visible = true;
    }
    // โมเดลจริงมาแล้วก็ซ่อนตัวที่ปั้นด้วยโค้ดทั้งชุด (รวมอาวุธที่วางตำแหน่งไว้สำหรับโครงเดิม)
    a.rig.visible = !activeModel;
  }

  /**
   * ปั้นสัดส่วนร่างกายใหม่ตาม "ภาษาของรูปทรง" ของตัวละครนั้น (ดู characters.js)
   *
   * ⚠️ ความสอบของลำตัวเปลี่ยนด้วย scale ไม่ได้ — scale ย่อทั้งท่อนเท่ากันหมด
   * แต่ทรงสามเหลี่ยมเกิดจาก "บนกว้าง ล่างแคบ" ซึ่งเป็นค่าคนละตัวในเรขาคณิต
   * จึงต้องสร้าง geometry ใหม่ (ถูกมาก เพราะเกิดตอนสลับตัวละครเท่านั้น ไม่ใช่ทุกเฟรม)
   * และต้อง dispose ของเก่าทุกครั้ง ไม่งั้นหน่วยความจำ GPU รั่วทีละนิดทุกครั้งที่สลับตัว
   */
  function applyBuild(b = {}) {
    const h = b.h ?? 1;
    const sh = b.shoulder ?? 1;
    const limb = b.limb ?? 1;
    const [tt, tb] = b.torso ?? [1, 1];
    const [hx, hy, hz] = b.head ?? [1, 1, 1];

    a.rig.scale.setScalar(h);

    /* ⚠️ เปลือกไฮไลต์ใช้ geometry *ก้อนเดียวกัน* กับลำตัว (ตั้งใจ — ไม่เปลืองหน่วยความจำ)
     * เพราะฉะนั้นตอน dispose ของเก่าแล้วสร้างใหม่ ต้องชี้ทั้งสองตัวไปที่ก้อนใหม่พร้อมกัน
     * ถ้าลืมบรรทัดล่าง เปลือกจะถือ geometry ที่ถูกลบไปแล้ว → WebGL ฟ้อง error ทันที
     * ที่สลับตัวละครครั้งแรก และเป็นบั๊กที่ "ไม่เกิดตอนโหลด เกิดตอนกดปุ่ม" เท่านั้น */
    a.torso.geometry.dispose();
    a.torso.geometry = new THREE.CylinderGeometry(0.3 * tt, 0.235 * tb, 0.5, 8);
    a.torsoGloss.geometry = a.torso.geometry;
    a.chest.geometry.dispose();
    a.chest.geometry = new THREE.CylinderGeometry(0.285 * tt, 0.3 * tt, 0.16, 8);

    a.armL.position.x = -0.31 * sh;
    a.armR.position.x = 0.31 * sh;
    a.armL.scale.set(limb, 1, limb);
    a.armR.scale.set(limb, 1, limb);
    a.legL.scale.set(limb, 1, limb);
    a.legR.scale.set(limb, 1, limb);

    a.helmet.scale.set(hx, hy, hz);
  }

  /**
   * ── ใบหน้า 3 แบบ จากชิ้นส่วนชุดเดียว ──────────────────────
   *
   * แทนที่จะปั้นหัวแยกกัน 5 ใบ (ซึ่งต้องดูแล 5 ที่ทุกครั้งที่แก้อะไรสักอย่าง)
   * เราปั้นใบหน้าชุดเดียวแล้ว *ขยับ/ย่อ* มันให้เข้ากับเครื่องสวมหัวของแต่ละตัว
   *
   *   plate  หน้าเต็ม — แผ่นหน้านูนพ้นกะโหลก ให้หมวกโครินเธียน/คาบูโตะครอบรอบ ๆ
   *   slit   แถบตา   — บีบแผ่นหน้าให้แบนแล้วดันออกไปข้างหน้าจนโผล่พ้นผ้าคลุมหัว
   *                    (ไม่ต้องเจาะรูบนทรงกลม — ดันของข้างในออกมาแทน ถูกกว่ามาก)
   *   none   ไม่มีหน้า — นักบินอวกาศใช้กระจก ลอร์ดมืดใช้หน้ากาก
   */
  function applyFace(f = {}) {
    const mode = f.mode ?? 'plate';
    a.face.visible = mode !== 'none';
    if (mode === 'none') return;

    a.mat.tone.color.setHex(f.tone ?? 0xefb182);
    a.mat.brow.color.setHex(f.brow ?? 0x1c1210);

    const slit = mode === 'slit';
    a.face.position.z = slit ? -0.02 : 0;
    a.facePlate.scale.set(slit ? 0.92 : 0.98, slit ? 0.56 : 1.04, 0.55);
    a.facePlate.position.y = slit ? -0.012 : -0.015;
    a.mouth.visible = !slit;                 // ผ้าปิดปากอยู่ ปากจะโผล่ทะลุออกมาไม่ได้
    for (const b of a.brows) b.position.y = slit ? 0.072 : 0.078;
  }

  function applySkin(id) {
    const c = characterById(id);
    state.skin = c.id;
    useModel(c.id);
    a.mat.suit.color.setHex(c.suit);
    a.mat.suitDim.color.setHex(c.suitDim);
    a.mat.joint.color.setHex(c.joint);
    a.mat.amber.color.setHex(c.accent);   // เข็มขัด/แถบถัง = สี accent ประจำตัว
    // ถังออกซิเจน/กระจกหน้ากาก/ครีบ/ตะเข็บ = ชุดของนักบินอวกาศคนเดียว
    for (const p of a.astroParts) p.visible = c.id === 'astro';
    applyFace(c.face);

    /* ความมันของวัสดุ — ค่าเดียวคุมทุกเปลือกไฮไลต์พร้อมกัน
     * ⚠️ ตั้งค่าทุกชิ้นเสมอแม้ชิ้นนั้นจะถูกซ่อนอยู่ ไม่ต้องเลือกเฉพาะของตัวที่ใส่
     * เพราะของที่ซ่อนอยู่ไม่ได้ถูกวาด ค่ามันจึงไม่มีผล — แต่ถ้าเลือกเฉพาะบางชิ้น
     * เราจะได้ตรรกะ "ใครเป็นเจ้าของเปลือกไหน" มาดูแลเพิ่มอีกชุดโดยไม่ได้อะไรเลย */
    const g = c.gloss ?? 0.5;
    for (const m of a.gloss) m.specular.setScalar(g);

    applyBuild(c.build);
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
