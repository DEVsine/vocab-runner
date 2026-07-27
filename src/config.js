/**
 * config.js — ค่าปรับแต่งทั้งหมดของเกมอยู่ที่นี่ที่เดียว
 *
 * ทำไมต้องรวมไว้ไฟล์เดียว?
 * การจูนเกมคือการ "ลองแล้วรู้สึก" คุณจะแก้ตัวเลขพวกนี้เป็นร้อยครั้ง
 * ถ้ามันกระจายอยู่ในโค้ด คุณจะขี้เกียจจูนแล้วยอมรับเกมที่รู้สึกไม่ดี
 *
 * หน่วยระยะทาง = 1 หน่วย ≈ 1 เมตร, หน่วยเวลา = วินาที
 */

export const CFG = {
  world: {
    laneWidth: 3.0,
    laneCount: 3,
    playerZ: 0,            // ผู้เล่นอยู่กับที่เสมอ "โลก" ต่างหากที่วิ่งเข้าหาเรา
    // เก็บวัตถุกลับเข้า pool ทันทีที่มันผ่านตัวละครไปแล้วเล็กน้อย
    // (ไม่ใช่รอจนถึงกล้องที่ z = 9.5) เพราะช่วงระหว่างตัวละครกับกล้อง
    // วัตถุจะอยู่ใกล้เลนส์มากจนบานเต็มจอ กลายเป็นแผ่นสีทึบบังทุกอย่าง
    despawnZ: 4.5,
    fogNear: 44,
    fogFar: 150,
    bgColor: 0x05060f,
    segmentLength: 20,     // ความยาวของทางเดิน 1 ท่อน
    segmentCount: 9,       // จำนวนท่อนที่หมุนเวียนใช้ (9 × 20 = 180 หน่วย)
    // สีประจำเลน — ใช้ทั้งบนพื้น 3D และบนธงคำตอบบนจอ
    // นี่คือสิ่งเดียวที่บอกผู้เล่นว่า "ธงใบไหน = เลนไหน" ต้องตรงกันเป๊ะเสมอ
    laneColors: [0x22d3ee, 0xfbbf24, 0xf472b6],
    laneColorsCss: ['#22d3ee', '#fbbf24', '#f472b6'],
  },

  camera: {
    fov: 55,
    y: 3.4,
    z: 9.5,
    lookAtY: 1.5,
    lookAtZ: -18,
    // กล้องไถลตามผู้เล่นแค่ "บางส่วน" (ไม่ใช่ตามติด 100%)
    // ถ้าตามเต็ม ผู้เล่นจะนิ่งกลางจอตลอดจนไม่รู้สึกว่าตัวเองเปลี่ยนเลน
    followX: 0.5,
    lookFollowX: 0.3,
    shakeDecay: 6,
  },

  // ── ความเร็ว ───────────────────────────────────────────────
  speed: {
    start: 11,
    accel: 0.28,
    max: 26,
  },

  // ── หน้าต่างเวลาตอบ (answer window) ────────────────────────
  // นี่คือ "ระดับความยากทางสมอง" ที่แยกจากความเร็วโดยสิ้นเชิง
  // ระยะที่ด่านเกิดจะถูกคำนวณจากค่านี้เสมอ ไม่ใช่ค่าคงที่
  // → เกมเร็วขึ้นเรื่อย ๆ แต่เวลาคิดไม่ได้หดตามโดยบังเอิญ
  answer: {
    steps: [
      { afterGates: 0, seconds: 3.2 },
      { afterGates: 6, seconds: 2.9 },
      { afterGates: 12, seconds: 2.6 },
      { afterGates: 20, seconds: 2.3 },
      { afterGates: 30, seconds: 2.0 },
    ],
    // พื้นที่ต่ำกว่านี้ไม่ใช่ "ยาก" แต่คือ "เป็นไปไม่ได้"
    floor: 1.9,
  },

  // ── รูปแบบโจทย์ (สลับไปมาเพื่อไม่ให้จำแบบท่องจำรูปแบบเดียว) ──
  question: {
    weights: { text: 0.5, audio: 0.25, image: 0.25 },
    audioReplayAt: 0.5,    // เล่นเสียงซ้ำเมื่อเวลาเหลือครึ่ง
  },

  // ── จังหวะการปล่อยของ ──────────────────────────────────────
  pacing: {
    breatherSeconds: 2.8,  // ช่วงว่างหลังด่านผ่าน ก่อนเริ่มนับ window ของด่านถัดไป
    obstacleEdgeMargin: 0.5,

    // ⭐ ความยากของสิ่งกีดขวางมาจาก 3 แกน และต้องขยับ "ทีละแกน" ไม่ใช่พร้อมกัน
    //    1) จำนวนต่อช่วงพัก (waves)  2) จำนวนที่มาพร้อมกัน (simultaneous)
    //    3) เวลาที่มีให้ตอบสนอง (lead) ← แกนนี้โหดที่สุด ต้องลดช้าที่สุด
    obstacleRamp: [
      { afterGates: 0,  waves: [0, 1], simultaneous: 1, lead: 1.6 },
      { afterGates: 4,  waves: [1, 1], simultaneous: 1, lead: 1.5 },
      { afterGates: 9,  waves: [1, 2], simultaneous: 1, lead: 1.35 },
      { afterGates: 15, waves: [2, 2], simultaneous: 2, lead: 1.2 },
      { afterGates: 22, waves: [2, 3], simultaneous: 2, lead: 1.05 },
      { afterGates: 30, waves: [3, 3], simultaneous: 2, lead: 0.95 },
    ],
    // พื้นของเวลาตอบสนอง — ต่ำกว่านี้มนุษย์กดไม่ทันจริง ๆ
    // (เห็น ~0.25 + ตัดสินใจ ~0.2 + เลื่อนเลน/กระโดด ~0.3 + เผื่อ ~0.2)
    obstacleLeadFloor: 0.95,
  },

  player: {
    radius: 0.42,
    height: 1.65,
    laneChangeMs: 140,     // ต่ำกว่านี้จะรู้สึกวาร์ป สูงกว่านี้จะรู้สึกลากกระสอบ
    jumpMs: 620,
    jumpHeight: 2.15,
    slideMs: 520,
    slideHeight: 0.75,
    color: 0x22d3ee,
    stepEveryHalfCycle: true,   // เสียงฝีเท้าตามจังหวะขา
  },

  input: {
    bufferMs: 240,
    swipeMinPx: 26,
  },

  // ── ด่านสแกน (แทนกำแพงคำศัพท์เดิม) ────────────────────────
  // คำตอบไม่ได้อยู่บนป้ายในโลก 3D อีกแล้ว แต่ขึ้นเป็น "ธง" บนจอ
  // เหตุผล: ความกว้างเลนเคยเป็นเพดานของขนาดตัวอักษร พอย้ายมาเป็น DOM
  // ข้อจำกัดนั้นหายไป อ่านได้เต็มที่ทุกระยะ
  gate: {
    poolSize: 4,
    padLength: 3.0,        // แผ่นพื้นเรืองแสงใต้แต่ละเลน = ตัวบอกว่าเลนไหนคือธงใบไหน
    archY: 5.4,
    turretY: 4.6,
    laserRadius: 0.42,
    laserHeight: 6.0,
    laserDurationMs: 480,
    resolveFlashMs: 260,
  },

  obstacles: {
    poolSize: 14,
    lowHeight: 0.85,       // อุกกาบาต — ต้องกระโดดข้าม
    highY: 1.55,           // ขยะอวกาศห้อยลงมา — ต้องสไลด์ลอด (ต่ำกว่าตัวละคร 1.65)
    width: 2.3,
    depth: 0.7,
    barrierHeight: 3.2,    // ม่านพลังงาน — กระโดด/สไลด์ไม่รอด ต้องเปลี่ยนเลนอย่างเดียว
    // น้ำหนักการสุ่มชนิด — ม่านพลังงานโผล่หลังผ่านด่านที่ 7 เป็นต้นไป
    typeWeights: { meteor: 0.4, junk: 0.35, barrier: 0.25 },
    barrierAfterGates: 7,
  },

  // ── ดาวสะสม → ปลดล็อกด่านโบนัส "ทางช้างเผือก" ──────────────
  stars: {
    poolSize: 4,
    needed: 5,
    chancePerBreather: 0.4,
    // ดาวเป็น "ไอเทมปลดล็อก" ไม่ใช่ไอเทมทำคะแนน — ต้องเก็บง่ายเหมือนเหรียญ
    // (เดิมตั้งไว้ 1.9 = สูงกว่าตัวละคร ต้องกระโดด แต่ยอดกระโดดกลับสูงเกินดาว
    //  เลยพลาดเป็นบางครั้ง → หงุดหงิดโดยไม่ได้อะไรกลับมา)
    y: 1.2,                // ระดับอกตอนวิ่ง — อยู่ในทางเดินของตัวละครพอดี
    lead: 1.7,
    pickRadius: 1.3,
    pickY: 1.35,           // ช่วงรับแนวตั้ง (ใจกว้างเท่าเหรียญ วิ่งผ่านก็โดน)
  },

  // ── ด่านโบนัส "ทางช้างเผือก" ───────────────────────────────
  bonus: {
    durationSeconds: 14,
    liftSeconds: 1.4,      // ช่วงลอยขึ้นพ้นทางเดินสถานี
    landSeconds: 1.2,      // ช่วงร่อนกลับลงมา
    coinValueMultiplier: 2,
    flyLowY: 1.0,
    flyHighY: 2.7,         // ↑/↓ สลับระดับการบิน เพื่อกวาดเหรียญคนละแถว
    flyLevelMs: 260,
    coinGapSeconds: 0.16,
    // มุกกวน ๆ แทรกระหว่างทาง — ตอบผิดไม่มีบทลงโทษใด ๆ
    // ตั้งเป็น false = ด่านโบนัสจะเป็นการกวาดเหรียญล้วน ๆ (Option A)
    jokeGates: true,
    jokeGateCount: 2,
    jokeRewardCoins: 15,
  },

  // ── เหรียญ ────────────────────────────────────────────────
  coins: {
    poolSize: 48,
    value: 5,
    y: 0.95,
    chancePerBreather: 0.9,
    runMin: 3,             // จำนวนเหรียญต่อแถว
    runMax: 6,
    gapSeconds: 0.17,      // ระยะห่างระหว่างเหรียญ (คิดเป็นเวลา ไม่ใช่ระยะ → เร็วแค่ไหนก็เก็บทันเท่ากัน)
    lead: 1.6,
    pickRadius: 1.05,
  },

  // ── ไอพ่นสำรอง (ตอบผิดแล้วยังไม่ตาย) ──────────────────────
  powerup: {
    poolSize: 3,
    chancePerBreather: 0.22,
    maxCharges: 2,
    lead: 1.6,
    y: 1.25,
    pickRadius: 1.15,
    boostMs: 1300,         // เวลาที่ลอยอยู่กลางอากาศตอนใช้ไอพ่น
    boostHeight: 3.6,
    invulnMs: 1500,        // ช่วงอมตะหลังใช้ (กันโดนสิ่งกีดขวางซ้ำทันที)
  },

  // ── ระบบจำคำ (Leitner 3 กล่อง) ─────────────────────────────
  srs: {
    boxCount: 3,
    boxWeights: { 1: 6, 2: 3, 3: 1 },
    unseenWeight: 5,
    recentBlock: 8,
  },

  distractor: {
    similarMinRatio: 0.45,
    similarMaxRatio: 0.85,
    minCandidatePool: 8,
  },

  score: {
    perGate: 10,
    comboMax: 5,
  },

  audio: {
    sfxVolume: 0.32,
    musicVolume: 0.5,      // เสียงบรรยากาศ/จังหวะระหว่างวิ่ง
    speechRate: 0.95,
    speechLang: 'en-US',
  },

  storageKey: 'vocab-runner:v1',
};

/** หา answer window ปัจจุบันจากจำนวนด่านที่ผ่านมาแล้ว */
export function answerWindowFor(gatesPassed) {
  let seconds = CFG.answer.steps[0].seconds;
  for (const step of CFG.answer.steps) {
    if (gatesPassed >= step.afterGates) seconds = step.seconds;
  }
  return Math.max(CFG.answer.floor, seconds);
}

/** กติกาความยากของสิ่งกีดขวาง ณ จำนวนด่านที่ผ่านมาแล้ว */
export function obstacleRuleFor(gatesPassed) {
  let rule = CFG.pacing.obstacleRamp[0];
  for (const r of CFG.pacing.obstacleRamp) {
    if (gatesPassed >= r.afterGates) rule = r;
  }
  return { ...rule, lead: Math.max(CFG.pacing.obstacleLeadFloor, rule.lead) };
}
