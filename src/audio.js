/**
 * audio.js — เสียงทั้งหมดสร้างเองด้วย WebAudio + ออกเสียงคำด้วย speechSynthesis
 * ไม่มีไฟล์เสียงสักไฟล์ในโปรเจกต์นี้
 *
 * กับดัก 2 ข้อที่ต้องรู้:
 *
 * 1) Autoplay policy — เบราว์เซอร์ห้ามเล่นเสียงก่อนผู้ใช้จะกดอะไรสักอย่าง
 *    AudioContext ที่สร้างตอนโหลดหน้าจะเกิดในสถานะ 'suspended'
 *    แล้วเกมจะเงียบสนิท "โดยไม่มี error ให้เห็น" → ต้อง resume() ตอนกดปุ่มแรก
 *
 * 2) speechSynthesis ต่อคิวสะสม — speak() ไม่ตัดของเก่า แต่ "ต่อคิว"
 *    เล่นไปสัก 20 ด่านเสียงจะตามหลังภาพอยู่ 10 คำ → ต้อง cancel() ก่อนทุกครั้ง
 */

import { CFG } from './config.js';

let ctx = null;
let master = null;       // สำหรับ SFX
let musicBus = null;     // สำหรับเสียงบรรยากาศระหว่างวิ่ง
let sfxEnabled = true;
let speechEnabled = true;
let englishVoice = null;

/** เรียกจาก event ที่เกิดจากการกดของผู้ใช้เท่านั้น (คลิก/กดปุ่ม/แตะจอ) */
export function unlockAudio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx = new AudioCtx();

    master = ctx.createGain();
    master.gain.value = CFG.audio.sfxVolume;
    master.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0;   // ค่อย ๆ ดันขึ้นตอนเริ่มวิ่ง
    musicBus.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  pickVoice();
}

export function setSfxEnabled(on) {
  sfxEnabled = on;
  if (!on) stopAmbience();
}

export function setSpeechEnabled(on) {
  speechEnabled = on;
  if (on) speechHealthy = true;   // ผู้เล่นเปิดเอง = ให้โอกาสเครื่องยนต์ใหม่อีกครั้ง
  else stopSpeaking();
}

/* ── เครื่องมือสังเคราะห์เสียงพื้นฐาน ───────────────────────── */

function tone({ freq, endFreq, duration, type = 'sine', gain = 0.3, delay = 0, bus = null }) {
  if (!ctx || !sfxEnabled) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + duration);

  // envelope: ขึ้นเร็ว ลงนุ่ม — เสียงที่ตัดห้วนจะได้ยินเป็น "ป๊อก" รบกวนหู
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(g).connect(bus || master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise({ duration, gain = 0.3, filterFrom = 5000, filterTo = 400, delay = 0, type = 'lowpass' }) {
  if (!ctx || !sfxEnabled) return;
  const t0 = ctx.currentTime + delay;
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(filterFrom, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, filterTo), t0 + duration);

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

/* ── เสียงเหตุการณ์ ─────────────────────────────────────────── */

export const sfx = {
  /** ผ่านด่านถูก — อาร์เพจจิโอเมเจอร์ไล่ขึ้น + ประกายด้านบน = ความรู้สึก "ตอบถูก!"
   *  ไล่คีย์สูงขึ้นตาม combo เพื่อให้ยิ่งต่อเนื่องยิ่งฟังฮึกเหิม (เสียงบอกสถานะเกม
   *  โดยไม่ต้องมองตัวเลข) — จูนให้ gain ไม่ดังเกิน เพราะดังทุกด่านทุกไม่กี่วินาที */
  correct(comboLevel = 1) {
    const c = Math.min(comboLevel, CFG.score.comboMax);
    const base = 523.25 * Math.pow(2, (c - 1) / 12);   // C5 แล้วไต่ขึ้นทีละครึ่งเสียงตาม combo
    [0, 4, 7, 12].forEach((semi, i) => {
      tone({ freq: base * Math.pow(2, semi / 12), duration: 0.2, type: 'triangle', gain: 0.17, delay: i * 0.045 });
    });
    // ประกายใสด้านบน — เติมความ "ฉลอง" ให้ต่างจากเสียงเก็บเหรียญธรรมดา
    tone({ freq: base * 4, duration: 0.16, type: 'sine', gain: 0.09, delay: 0.13 });
    noise({ duration: 0.28, gain: 0.11, filterFrom: 7500, filterTo: 1600 });
  },

  /** โดนเลเซอร์ — เสียงเปรี้ยงกวาดลง */
  laser() {
    tone({ freq: 1400, endFreq: 120, duration: 0.34, type: 'sawtooth', gain: 0.3 });
    noise({ duration: 0.4, gain: 0.26, filterFrom: 7000, filterTo: 300 });
  },

  /** ชนสิ่งกีดขวาง — ทุ้ม หนัก จบเร็ว */
  crash() {
    tone({ freq: 160, endFreq: 46, duration: 0.55, type: 'sawtooth', gain: 0.32 });
    noise({ duration: 0.5, gain: 0.34, filterFrom: 2200, filterTo: 120 });
  },

  /** เก็บเหรียญ — ไล่เสียงสูงขึ้นตามจำนวนที่เก็บติดกัน (ให้รู้สึกว่า "กำลังต่อเนื่อง") */
  coin(streak = 0) {
    const base = 880 * Math.pow(2, Math.min(streak, 8) / 12);
    tone({ freq: base, duration: 0.08, type: 'square', gain: 0.12 });
    tone({ freq: base * 2, duration: 0.12, type: 'sine', gain: 0.1, delay: 0.03 });
  },

  /** เก็บดาว — เสียงใสสูงขึ้นตามจำนวนที่สะสมได้ ให้รู้สึกว่า "ใกล้แล้ว" */
  star(collected = 1, needed = 5) {
    const step = Math.min(collected, needed) / needed;
    const base = 700 + step * 500;
    tone({ freq: base, duration: 0.14, type: 'triangle', gain: 0.2 });
    tone({ freq: base * 1.5, duration: 0.2, type: 'sine', gain: 0.15, delay: 0.06 });
    tone({ freq: base * 2, duration: 0.26, type: 'sine', gain: 0.1, delay: 0.12 });
  },

  /** เข้าด่านโบนัส — อาร์เพจจิโอไล่ขึ้นให้รู้สึกว่ากำลังทะยาน */
  bonusStart() {
    [0, 4, 7, 12, 16, 19].forEach((semi, i) => {
      tone({ freq: 330 * Math.pow(2, semi / 12), duration: 0.45, type: 'triangle', gain: 0.16, delay: i * 0.075 });
    });
    noise({ duration: 1.1, gain: 0.2, filterFrom: 400, filterTo: 5200 });
  },

  /** ออกจากด่านโบนัส — ไล่ลงนุ่ม ๆ บอกว่า "กลับเข้าโหมดจริงแล้วนะ" */
  bonusEnd() {
    [12, 7, 4, 0].forEach((semi, i) => {
      tone({ freq: 330 * Math.pow(2, semi / 12), duration: 0.3, type: 'sine', gain: 0.13, delay: i * 0.08 });
    });
  },

  /** ตอบมุกถูก */
  jokeRight() {
    [0, 4, 7].forEach((semi, i) => {
      tone({ freq: 520 * Math.pow(2, semi / 12), duration: 0.22, type: 'square', gain: 0.13, delay: i * 0.05 });
    });
  },

  /** ตอบมุกผิด — เสียง "เอ๊ะ" ขำ ๆ ไม่ใช่เสียงลงโทษ */
  jokeWrong() {
    tone({ freq: 300, endFreq: 190, duration: 0.28, type: 'triangle', gain: 0.14 });
  },

  jetPickup() {
    tone({ freq: 300, endFreq: 900, duration: 0.28, type: 'triangle', gain: 0.24 });
    tone({ freq: 600, endFreq: 1800, duration: 0.32, type: 'sine', gain: 0.14, delay: 0.05 });
  },

  /** กด "ใส่" ไอพ่น — คลิกกลไก + เสียงระบบติดเครื่อง = รู้สึกว่าเพิ่งติดอาวุธ */
  jetEquip() {
    noise({ duration: 0.06, gain: 0.22, filterFrom: 4000, filterTo: 2000 });
    tone({ freq: 180, endFreq: 420, duration: 0.34, type: 'sawtooth', gain: 0.16, delay: 0.05 });
    tone({ freq: 740, duration: 0.16, type: 'sine', gain: 0.14, delay: 0.22 });
  },

  jetUse() {
    tone({ freq: 90, endFreq: 260, duration: 0.7, type: 'sawtooth', gain: 0.26 });
    noise({ duration: 0.85, gain: 0.3, filterFrom: 900, filterTo: 4500 });
  },

  /** หวูดยานสวน — คลัสเตอร์เสียงต่ำ 2 โน้ตติดกัน (เสียดสีจงใจ = สัญญาณอันตราย) */
  horn() {
    tone({ freq: 165, duration: 0.55, type: 'sawtooth', gain: 0.24 });
    tone({ freq: 185, duration: 0.55, type: 'sawtooth', gain: 0.2 });
    tone({ freq: 165, duration: 0.4, type: 'sawtooth', gain: 0.18, delay: 0.65 });
    tone({ freq: 185, duration: 0.4, type: 'sawtooth', gain: 0.15, delay: 0.65 });
  },

  /** เท้าแตะหลังคายาน — ตุบโลหะ + กังวานสั้น บอกว่า "ขึ้นมาแล้ว" */
  mount() {
    tone({ freq: 120, endFreq: 70, duration: 0.18, type: 'sine', gain: 0.3 });
    tone({ freq: 620, duration: 0.22, type: 'triangle', gain: 0.12, delay: 0.03 });
    noise({ duration: 0.12, gain: 0.14, filterFrom: 2400, filterTo: 500 });
  },

  /* ── เสียงท่าทาง: "พึบพับ" แบบ Subway จริง ๆ ──
   *
   * บทเรียนจากรอบแรกที่เสียงจมหาย: เสียงชั้นเดียว gain ต่ำ ๆ สู้เพลงที่มี kick
   * ทุก beat ไม่ได้ วิธีของเกม endless runner คือเสียงแอ็กชันต้อง "หลายชั้น"
   * โดยแต่ละชั้นอยู่คนละย่านความถี่ (ลมย่านกลาง + สะบัดย่านสูง + กระแทกย่านต่ำ)
   * → ต่อให้เพลงดัง หูก็ยังแยกเสียงแอ็กชันออกเพราะไม่มีย่านไหนโดนกลบหมด
   *
   * ทิศทางการกวาดความถี่ (sweep) เล่าเรื่องได้เอง:
   *   กระโดด → กวาดขึ้น (ลมวูบขึ้นข้างหู), สไลด์ → กวาดลง (ทิ้งตัวต่ำ + ครูดพื้น),
   *   เปลี่ยนเลน → "พึบ-พับ" สองจังหวะ (ลมตีเสื้อตอนสะบัดตัว) */

  /** เปลี่ยนเลน — พึบ! (ลมตี) พับ! (ผ้าสะบัดกลับ) ปิดท้ายด้วยตุบเบา ๆ ว่า "ถึงเลนแล้ว" */
  lane()  {
    noise({ duration: 0.16, gain: 0.5, filterFrom: 900, filterTo: 4200, type: 'bandpass' });
    noise({ duration: 0.13, gain: 0.32, filterFrom: 3400, filterTo: 700, type: 'bandpass', delay: 0.055 });
    tone({ freq: 200, endFreq: 120, duration: 0.09, type: 'sine', gain: 0.13, delay: 0.09 });
  },

  /** กระโดด — ถีบพื้น (พัฟต่ำ) + ลมหวิวกวาดขึ้นยาว ๆ */
  jump()  {
    noise({ duration: 0.1, gain: 0.3, filterFrom: 1200, filterTo: 300 });
    noise({ duration: 0.42, gain: 0.45, filterFrom: 500, filterTo: 5200, type: 'bandpass' });
    tone({ freq: 260, endFreq: 540, duration: 0.16, type: 'sine', gain: 0.1 });
  },

  /** สไลด์ — ตุบทิ้งตัว + ครูดพื้นยาว (สองชั้น: เสียดสีสูง + ลมต่ำ) */
  slide() {
    tone({ freq: 170, endFreq: 90, duration: 0.12, type: 'sine', gain: 0.24 });
    noise({ duration: 0.44, gain: 0.42, filterFrom: 3800, filterTo: 350 });
    noise({ duration: 0.3, gain: 0.2, filterFrom: 900, filterTo: 480, type: 'bandpass', delay: 0.06 });
  },

  /** ลงพื้นหลังลอย — ตุบ + ฝุ่นฟุ้ง
   *  เสียงนี้คือ "ครึ่งหลัง" ของการกระโดดที่เกมส่วนใหญ่ลืม — พอมีครบทั้ง
   *  ถีบตัว→ลมหวิว→ตุบ สมองถึงจะรู้สึกว่าการกระโดดมีน้ำหนักจริง */
  land() {
    tone({ freq: 150, endFreq: 60, duration: 0.13, type: 'sine', gain: 0.3 });
    noise({ duration: 0.15, gain: 0.24, filterFrom: 1600, filterTo: 250 });
  },
  select(){ tone({ freq: 560, endFreq: 780, duration: 0.09, type: 'sine', gain: 0.14 }); },

  /** ฝีเท้า — เบามาก แต่เป็นสิ่งที่ทำให้ "รู้สึกว่ากำลังวิ่ง" จริง ๆ */
  step() { noise({ duration: 0.07, gain: 0.075, filterFrom: 900, filterTo: 180 }); },
};

/* ══ เพลงระหว่างวิ่ง — วงเต็ม สไตล์เกม endless runner ═══════════
 *
 * ── ทำไมเพลง Subway Surfers ถึง "สนุก" (แล้วเราเลียนแบบยังไง) ──
 * ความสนุกไม่ได้มาจากโน้ตเยอะ แต่มาจาก 3 อย่าง:
 *   1) กลองที่ตรง beat ตลอด (kick ทุกจังหวะ = เท้าอยากขยับตาม)
 *   2) เมโลดี้สั้น ๆ วนซ้ำจนติดหู (hook) — สมองชอบของที่เดาได้แต่ไม่น่าเบื่อ
 *   3) เพลงเร่งตามเกม — BPM ไต่ 108→160 ตามความเร็ววิ่ง ความตื่นเต้นเลยรู้สึก "มาจากเพลง"
 *
 * โครงสร้าง: step sequencer 16 ช่องต่อบาร์ (เขบ็ตสองชั้น) เดินวน 4 บาร์
 * คอร์ดวน Am → F → C → G (i–VI–III–VII ยอดฮิตของเพลงเกม/ป๊อป — ทั้งฮึกเหิมทั้งติดหู)
 * เครื่องดนตรีทุกชิ้นสังเคราะห์สด: kick/snare/hihat จาก noise+sine, เบส saw, เมโลดี้ square
 *
 * ⚠️ ตัวโน้ตต้องจองล่วงหน้า (lookahead scheduling) ไม่ใช่เล่นทันทีใน setInterval
 * เพราะ setInterval ของ JS คลาดเคลื่อนได้หลายสิบมิลลิวินาที จังหวะจะเพี้ยนจนฟังออก
 * setInterval ทำหน้าที่แค่ "ตื่นมาดู" แล้วสั่งเล่นด้วยนาฬิกาของ AudioContext
 * ซึ่งแม่นระดับตัวอย่างเสียง (sample-accurate)
 */

// คอร์ด 4 ตัว (root ของเบส + โน้ตประกอบ) — ความถี่ตรง equal temperament
const CHORDS = [
  { root: 55.00, name: 'Am' },   // A1
  { root: 43.65, name: 'F'  },   // F1
  { root: 65.41, name: 'C'  },   // C2
  { root: 49.00, name: 'G'  },   // G1
];

// แพตเทิร์นกลอง 16 ช่อง (1 = ตี) — four-on-the-floor + snare ตกจังหวะ 2,4
const DRUM = {
  kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],   // ตัวท้ายเป็น ghost note เล็ก ๆ ให้มีลูกส่ง
  hat:   [1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0],
};

// เบส: ครึ่งเสียง (semitone) จาก root ของคอร์ดบาร์นั้น (-1 = เงียบ) — วิ่ง octave สนุก ๆ
const BASS_PAT = [0,-1,0,12, 0,-1,7,-1, 0,-1,0,12, 7,-1,5,-1];

// เมโลดี้ hook 2 บาร์ (32 ช่อง) บน A minor pentatonic — เขียนเป็นครึ่งเสียงจาก A4
// วนซ้ำทุก 2 บาร์ ให้ติดหูแบบ "เพลงเกม" (null = เงียบ ปล่อยให้กลองหายใจ)
const HOOK = [
  0, null, 3, null, 7, null, 5, 3,   null, null, 3, 5, 7, null, 10, null,
  12, null, 10, 7, null, null, 5, 7, 3, null, 0, null, null, null, null, null,
];

let ambience = null;

/* ── เครื่องดนตรีแต่ละชิ้น (เล่น ณ เวลา when ของ AudioContext) ── */

/** กระเดื่อง: sine กวาดความถี่ลงเร็ว ๆ 150→48Hz = "ตุบ" ที่รู้สึกได้ที่อก */
function playKick(when) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, when);
  osc.frequency.exponentialRampToValueAtTime(48, when + 0.1);
  g.gain.setValueAtTime(0.5, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
  osc.connect(g).connect(musicBus);
  osc.start(when);
  osc.stop(when + 0.18);
}

/** สแนร์: noise ผ่าน bandpass + โทนสั้น — ghost note เบากว่าตัวจริงครึ่งหนึ่ง */
function playSnare(when, ghost = false) {
  const dur = 0.16;
  const frames = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1900;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(ghost ? 0.10 : 0.24, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f).connect(g).connect(musicBus);
  src.start(when);
}

/** ไฮแฮต: noise สั้นมากผ่าน highpass — accent เปิดยาวขึ้นนิดเดียว */
function playHat(when, open = false) {
  const dur = open ? 0.09 : 0.035;
  const frames = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(open ? 0.09 : 0.06, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(f).connect(g).connect(musicBus);
  src.start(when);
}

/** เบส: sawtooth ผ่าน lowpass — ตัวเชื่อมกลองกับเมโลดี้ */
function playBass(when, freq, dur) {
  const osc = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, when);
  f.type = 'lowpass';
  f.frequency.value = 520;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.2, when + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(f).connect(g).connect(musicBus);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

/** เมโลดี้: square บาง ๆ + echo หลอก ๆ ด้วยโน้ตซ้ำเบา ๆ ตามหลัง */
function playLead(when, freq, dur) {
  for (const [delay, vol] of [[0, 0.085], [dur * 0.9, 0.03]]) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, when + delay);
    g.gain.setValueAtTime(0.0001, when + delay);
    g.gain.exponentialRampToValueAtTime(vol, when + delay + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + delay + dur);
    osc.connect(g).connect(musicBus);
    osc.start(when + delay);
    osc.stop(when + delay + dur + 0.02);
  }
}

export function startAmbience() {
  if (!ctx || !sfxEnabled || ambience) return;

  ambience = {
    step: 0,                              // ช่องที่ 0..∞ (mod 16 = ช่องในบาร์, /16 = บาร์)
    nextNoteTime: ctx.currentTime + 0.08,
    stepDur: 60 / 118 / 4,                // ความยาว 1 ช่อง (เขบ็ตสองชั้น) — อัปเดตตามความเร็ว
    timer: null,
  };

  // เฟดเข้าแทนการเปิดโครม ๆ
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
  musicBus.gain.linearRampToValueAtTime(CFG.audio.musicVolume, ctx.currentTime + 1.0);

  ambience.timer = setInterval(() => {
    if (!ambience) return;
    // จองล่วงหน้า 0.25 วินาที
    while (ambience.nextNoteTime < ctx.currentTime + 0.25) {
      scheduleStep(ambience.step, ambience.nextNoteTime, ambience.stepDur);
      ambience.step += 1;
      ambience.nextNoteTime += ambience.stepDur;
    }
  }, 40);
}

/** เล่นทุกเครื่องดนตรีของ "ช่องที่ step" ณ เวลา when */
function scheduleStep(step, when, stepDur) {
  const inBar = step % 16;
  const bar = Math.floor(step / 16) % CHORDS.length;
  const chord = CHORDS[bar];

  if (DRUM.kick[inBar]) playKick(when);
  if (DRUM.snare[inBar]) playSnare(when, inBar === 15);
  if (DRUM.hat[inBar]) playHat(when, inBar % 4 === 2);

  const bassSemi = BASS_PAT[inBar];
  if (bassSemi >= 0) playBass(when, chord.root * 2 * Math.pow(2, bassSemi / 12), stepDur * 1.8);

  const hookSemi = HOOK[step % HOOK.length];
  if (hookSemi !== null) playLead(when, 440 * Math.pow(2, hookSemi / 12), stepDur * 2.6);
}

/** เรียกทุกเฟรม — BPM ไต่ตามความเร็ววิ่ง: 108 (ออกตัว) → 160 (ท็อปสปีด) */
export function updateAmbience(speed) {
  if (!ambience || !ctx) return;
  const ratio = Math.min(1, (speed - CFG.speed.start) / Math.max(1, CFG.speed.max - CFG.speed.start));
  const bpm = 108 + ratio * 52;
  ambience.stepDur = 60 / bpm / 4;
}

export function stopAmbience() {
  if (!ambience || !ctx) return;
  clearInterval(ambience.timer);
  ambience = null;

  const t = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(musicBus.gain.value, t);
  musicBus.gain.linearRampToValueAtTime(0.0001, t + 0.35);
  // โน้ตที่จองไว้แล้วจะดังต่ออีก ≤0.25 วิ แต่ musicBus เฟดปิดทันก่อนเสมอ จึงไม่ได้ยิน
}

/* ══ ออกเสียงคำอังกฤษ (dual coding: เห็นรูปคำ + ได้ยินเสียง) ═════
 *
 * speechSynthesis เป็น API ที่ "งอแง" ที่สุดตัวหนึ่งในเว็บ และพังเงียบ ๆ
 * ได้หลายทางโดยไม่มี error ให้เห็น ไฟล์นี้กันไว้ทุกทางที่รู้จัก:
 *
 *  1) เสียงแบบเครือข่าย (network voice) เช่น "Google US English"
 *     ถ้าเน็ตมีปัญหาจะเงียบสนิทโดยไม่แจ้งอะไรเลย → เลือกเฉพาะเสียงในเครื่อง
 *  2) เสียงล้อเล่นของ macOS (Bad News, Boing, Bells…) ก็เป็น en-US เหมือนกัน
 *     ถ้าเผลอเลือกมา ผู้เล่นจะได้ยินเสียงประหลาดแทนคำศัพท์ → มีบัญชีกันไว้
 *  3) speak() ที่เรียกทันทีหลัง cancel() ในทาสก์เดียวกัน มักถูกทิ้ง
 *     → เลื่อนไปทาสก์ถัดไปด้วย setTimeout(…, 0)
 *  4) เครื่องยนต์ค้างในสถานะ paused/speaking โดยไม่มีใครบอก
 *     → resume() ก่อนเสมอ + มี watchdog คอยจับว่า "ไม่เริ่มพูดใน 450ms"
 *  5) แท็บถูกซ่อน เบราว์เซอร์จะพักเครื่องยนต์ไว้ → ไม่ต้องพยายามพูด
 *
 * และที่สำคัญที่สุด: ถ้าสุดท้ายมันพูดไม่ได้จริง ๆ ต้อง "บอกคนเรียก"
 * เพื่อให้เกมเปลี่ยนโจทย์เสียงเป็นโจทย์ตัวหนังสือแทน — ไม่งั้นผู้เล่นจะเจอ
 * โจทย์ที่ตอบไม่ได้เลย ซึ่งแย่กว่าการไม่มีโหมดเสียงตั้งแต่แรก
 */

// เสียงล้อเล่นที่ติดมากับ macOS — เป็น en-US แต่ใช้อ่านคำศัพท์ไม่ได้
const NOVELTY_VOICES = new Set([
  'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Deranged',
  'Good News', 'Hysterical', 'Jester', 'Organ', 'Superstar', 'Trinoids',
  'Whisper', 'Wobble', 'Zarvox', 'Junior', 'Ralph', 'Fred', 'Grandma', 'Grandpa',
  'Rocko', 'Sandy', 'Shelley', 'Eddy', 'Flo', 'Reed',
]);

const PREFERRED_VOICES = ['Samantha', 'Alex', 'Ava', 'Allison', 'Karen', 'Daniel', 'Serena'];

let speechHealthy = true;      // false เมื่อพิสูจน์แล้วว่าเครื่องยนต์พูดไม่ได้
let speechWatchdog = null;

function pickVoice() {
  if (englishVoice || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;   // บางเบราว์เซอร์โหลด voice แบบ async

  const en = voices.filter(v => /^en/i.test(v.lang));
  const local = en.filter(v => v.localService !== false && !NOVELTY_VOICES.has(v.name));

  englishVoice =
    local.find(v => PREFERRED_VOICES.includes(v.name)) ||
    local.find(v => /^en-US/i.test(v.lang)) ||
    local[0] ||
    en.find(v => !NOVELTY_VOICES.has(v.name)) ||
    null;
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { englishVoice = null; pickVoice(); };
}

/** ใช้ตัดสินว่าจะสุ่ม "โหมดฟัง" ให้เป็นโจทย์ได้ไหม */
export function isSpeechUsable() {
  return speechEnabled && speechHealthy && !!window.speechSynthesis && !document.hidden;
}

/** หรี่เสียงเพลงลงระหว่างอ่านคำ ไม่งั้นคำจะจมหายไปในเสียงเครื่องยนต์ */
function duckMusic(on) {
  if (!ctx || !musicBus) return;
  const target = on ? CFG.audio.musicVolume * 0.22 : (ambience ? CFG.audio.musicVolume : 0.0001);
  musicBus.gain.setTargetAtTime(Math.max(0.0001, target), ctx.currentTime, 0.08);
}

function makeUtterance(text, rate) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = CFG.audio.speechLang;
  utter.rate = rate ?? CFG.audio.speechRate;
  if (englishVoice) utter.voice = englishVoice;
  return utter;
}

/**
 * @param {string} text คำที่จะอ่าน
 * @param {{rate?:number, onStart?:Function, onFail?:Function}} opts
 */
export function speak(text, { rate, onStart, onFail } = {}) {
  if (!text) return;
  // ทุกทางที่ "พูดไม่ได้" ต้องแจ้ง onFail เสมอ ไม่ใช่เงียบหายไป
  // ไม่งั้นโจทย์โหมดฟังจะค้างเป็นโจทย์ที่ไม่มีทางตอบได้
  if (!speechEnabled || !window.speechSynthesis) { onFail?.(); return; }
  if (document.hidden) { onFail?.(); return; }   // เบราว์เซอร์พักเครื่องยนต์อยู่

  const ss = window.speechSynthesis;
  pickVoice();

  // cancel เฉพาะตอนที่มีอะไรค้างอยู่จริง — การ cancel รัว ๆ คือสาเหตุอันดับหนึ่ง
  // ที่ทำให้เครื่องยนต์ของ Chrome/WebKit ค้างจนเงียบไปทั้งเซสชัน
  if (ss.speaking || ss.pending) ss.cancel();
  ss.resume();

  let started = false;
  clearTimeout(speechWatchdog);

  const attach = (utter) => {
    utter.onstart = () => {
      started = true;
      speechHealthy = true;
      duckMusic(true);
      onStart?.();
    };
    utter.onend = () => duckMusic(false);
    utter.onerror = (e) => {
      duckMusic(false);
      // ถูกตัดคิวเพราะคำถัดไปมาแทน = เรื่องปกติ ไม่ใช่ความผิดพลาด
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      speechHealthy = false;
      onFail?.();
    };
    return utter;
  };

  const first = attach(makeUtterance(text, rate));
  setTimeout(() => ss.speak(first), 0);

  // watchdog: ไม่เริ่มพูดใน 450ms = เครื่องยนต์ค้าง → กู้แล้วลองใหม่ครั้งเดียว
  speechWatchdog = setTimeout(() => {
    if (started) return;
    ss.cancel();
    ss.resume();
    const retry = attach(makeUtterance(text, rate));
    setTimeout(() => ss.speak(retry), 0);

    speechWatchdog = setTimeout(() => {
      if (started) return;
      speechHealthy = false;     // ยอมแพ้ — เกมจะเลิกสุ่มโหมดฟังตั้งแต่นี้ไป
      duckMusic(false);
      onFail?.();
    }, 700);
  }, 450);
}

export function stopSpeaking() {
  clearTimeout(speechWatchdog);
  duckMusic(false);
  window.speechSynthesis?.cancel();
}
