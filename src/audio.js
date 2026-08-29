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

import { CFG, speechGraceMs, speechWatchdogDecision, voiceModeById } from './config.js';

let ctx = null;
let master = null;       // สำหรับ SFX
let musicBus = null;     // สำหรับเสียงบรรยากาศระหว่างวิ่ง
let musicDelay = null;   // ดีเลย์ป้อนกลับ — ใช้เป็น "send" ให้เมโลดี้กับแพด
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

    /* ── สายสัญญาณของเพลง ─────────────────────────────────────
     * musicBus → เร่งฮาร์มอนิก → คอมเพรสเซอร์ → ลำโพง
     *
     * เดิมต่อ musicBus เข้าลำโพงตรง ๆ ซึ่งเป็นเหตุผลหนึ่งที่เสียง "บาง":
     * คลื่นสังเคราะห์ล้วนมีฮาร์มอนิกน้อยกว่าเครื่องดนตรีจริงมาก หูเลยอ่านว่าแบน
     *
     * waveshaper โค้ง ๆ = ซอฟต์คลิป เพิ่มฮาร์มอนิกคู่/คี่ที่หูตีความว่า "อุ่น" และ "ดัง"
     * โดยไม่ต้องเพิ่มวอลุ่มจริง ส่วนคอมเพรสเซอร์รวบทุกชิ้นให้เป็นก้อนเดียว
     * แทนที่จะเป็นเสียงหลายเสียงวางซ้อนกันเฉย ๆ */
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;   // ค่อย ๆ ดันขึ้นตอนเริ่มวิ่ง

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 1.9) / Math.tanh(1.9);   // นุ่ม ไม่ถึงกับแตก
    }
    shaper.curve = curve;
    shaper.oversample = '2x';                            // กัน aliasing จากฮาร์มอนิกใหม่

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.ratio.value = 3.5;
    glue.attack.value = 0.006;                           // ปล่อยหัวกระเดื่องผ่านก่อนบีบ
    glue.release.value = 0.18;

    musicBus.connect(shaper).connect(glue).connect(ctx.destination);

    /* ดีเลย์ป้อนกลับ — "ที่ว่าง" รอบตัวโน้ต ซึ่งเป็นอีกครึ่งของความรู้สึกว่าเสียงแน่น
     * เสียงแห้งสนิทฟังเหมือนเครื่องสังเคราะห์เสมอ ไม่ว่าจะซ้อนกี่ชั้น */
    musicDelay = ctx.createDelay(1.0);
    const fb = ctx.createGain();
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;   // ตัดปลายแหลมของเสียงสะท้อน ไม่ให้ฟุ้งทับเมโลดี้
    fb.gain.value = 0.34;
    musicDelay.connect(damp).connect(fb).connect(musicDelay);
    musicDelay.connect(musicBus);
  }
  if (ctx.state === 'suspended') ctx.resume();
  pickVoice();
}

export function setSfxEnabled(on) {
  sfxEnabled = on;
  if (!on) {
    stopAmbience();
    setMagnetActive(false);
  }
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

/** ตัวละครที่ใส่อยู่ตอนนี้ — ตัดสินว่าจะทับชั้นเสียงไหนลงบนเสียงพื้นฐาน */
let style = 'astro';

/** เรียกทุกครั้งที่เปลี่ยนตัวละคร (จาก main.js) */
export function setSfxStyle(id) {
  style = id;
}

const STYLE_LAYERS = {
  ninja: {
    // ผ้าดำสะบัด + คมเหล็กเสียดสั้น ๆ ตอนสะบัดตัวข้ามเลน
    lane() {
      noise({ duration: 0.09, gain: 0.24, filterFrom: 5600, filterTo: 1500, type: 'bandpass', delay: 0.02 });
      tone({ freq: 2700, endFreq: 3500, duration: 0.07, type: 'triangle', gain: 0.075, delay: 0.04 });
      tone({ freq: 3950, duration: 0.05, type: 'sine', gain: 0.05, delay: 0.055 });
    },
    // ถีบตัวขึ้นแบบไร้เสียง แล้วมีลมกรีดสูงตามมา
    jump() {
      noise({ duration: 0.26, gain: 0.2, filterFrom: 2400, filterTo: 7200, type: 'bandpass', delay: 0.03 });
      tone({ freq: 1850, endFreq: 2700, duration: 0.09, type: 'triangle', gain: 0.055, delay: 0.05 });
    },
    // ลอดต่ำ — เสียดสีย่านสูงบาง ๆ เหมือนผ้าครูดพื้น ไม่ใช่รองเท้าบู๊ต
    slide() {
      noise({ duration: 0.2, gain: 0.15, filterFrom: 6200, filterTo: 2400, type: 'bandpass', delay: 0.04 });
    },
  },
  spartan: {
    // เกราะโลหะกระทบ — ต่ำและสั้น ตรงข้ามกับนินจาทุกทาง
    lane() { tone({ freq: 340, endFreq: 260, duration: 0.09, type: 'square', gain: 0.06, delay: 0.03 }); },
    jump() { tone({ freq: 210, endFreq: 150, duration: 0.13, type: 'square', gain: 0.07 }); },
  },
  samurai: {
    // ดาบในฝักขยับ — โน้ตเดียวสั้น ๆ ไม่ต้องเยอะ ซามูไรคือความนิ่ง
    lane() { tone({ freq: 2100, endFreq: 2600, duration: 0.06, type: 'sine', gain: 0.06, delay: 0.04 }); },
  },
  darklord: {
    // ลมหายใจในหน้ากาก — คลื่นต่ำยาวใต้เสียงพื้นฐาน
    lane() { noise({ duration: 0.2, gain: 0.1, filterFrom: 320, filterTo: 140, type: 'bandpass', delay: 0.02 }); },
    jump() { tone({ freq: 70, endFreq: 45, duration: 0.3, type: 'sine', gain: 0.12 }); },
  },
  skeleton: {
    /* กระดูกกระทบกัน — เสียงสั้นมากและแห้ง ตรงข้ามกับลมหายใจยาวของลอร์ดมืด
     * ใช้ noise ย่านสูงแบบ highpass สองจังหวะติดกัน = "แคร่ก-แคร่ก" ไม่ใช่เสียงเดียวยาว ๆ */
    lane() {
      noise({ duration: 0.05, gain: 0.2, filterFrom: 3200, filterTo: 5200, type: 'highpass', delay: 0.02 });
      noise({ duration: 0.05, gain: 0.14, filterFrom: 2600, filterTo: 4400, type: 'highpass', delay: 0.08 });
    },
    jump() { noise({ duration: 0.12, gain: 0.16, filterFrom: 2200, filterTo: 5600, type: 'highpass' }); },
  },
};

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

  /** Black Panther ปลดปล่อยพลังจลน์ — ทุ้มกระแทกก่อน แล้วคลื่นแหลมกวาดออกไป */
  pantherBurst() {
    tone({ freq: 78, endFreq: 42, duration: 0.48, type: 'sawtooth', gain: 0.3 });
    tone({ freq: 260, endFreq: 1240, duration: 0.72, type: 'triangle', gain: 0.19, delay: 0.04 });
    tone({ freq: 520, endFreq: 2100, duration: 0.55, type: 'sine', gain: 0.12, delay: 0.11 });
    noise({ duration: 0.82, gain: 0.22, filterFrom: 650, filterTo: 5600 });
  },

  /** เก็บเหรียญ — ไล่เสียงสูงขึ้นตามจำนวนที่เก็บติดกัน (ให้รู้สึกว่า "กำลังต่อเนื่อง") */
  coin(streak = 0) {
    const g = CFG.audio.coinGain ?? 1;
    const base = 880 * Math.pow(2, Math.min(streak, 8) / 12);
    tone({ freq: base, duration: 0.08, type: 'square', gain: 0.12 * g });
    tone({ freq: base * 2, duration: 0.12, type: 'sine', gain: 0.1 * g, delay: 0.03 });
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

  /** เก็บไอเทมจับเวลา (แม่เหล็ก/×2) — ประกายสั้นสดใส สั้นกว่าเสียง "ของหายาก" ของไอพ่น
   *  เพราะของพวกนี้ออกบ่อยกว่า เสียงยาวจะรกหูเร็วมาก */
  boostPickup() {
    tone({ freq: 700, endFreq: 1400, duration: 0.14, type: 'square', gain: 0.15 });
    tone({ freq: 1050, endFreq: 2100, duration: 0.2, type: 'sine', gain: 0.12, delay: 0.04 });
  },

  /** ผลไอเทมหมดเวลา — โน้ตตกเบา ๆ บอกว่า "กลับสู่ปกติแล้ว" ไม่ใช่เสียงลงโทษ
   *  (HUD นับถอยหลังเป็นของใบ EZL-70 — เสียงนี้คือสัญญาณเดียวที่ใบนี้ให้) */
  boostEnd() {
    tone({ freq: 880, endFreq: 520, duration: 0.2, type: 'triangle', gain: 0.12 });
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

  /* ══ ชั้นเสียงประจำตัวละคร ═══════════════════════════════════
   *
   * ⚠️ ออกแบบเป็น "ชั้นที่ทับลงไป" ไม่ใช่ "เสียงชุดใหม่ที่มาแทน"
   * ถ้าให้แต่ละตัวละครมีเสียงของตัวเองทั้งชุด เราจะต้องจูนสมดุลใหม่ 5 รอบ
   * และเสียงบางตัวจะเบา/ดังไม่เท่ากันโดยไม่มีใครรู้จนกว่าจะมีคนบ่น
   * ชั้นเสริมบาง ๆ ทับบนฐานเดียวกัน = จูนที่เดียว ได้บุคลิกครบทุกตัว
   *
   * ── ทำไมนินจาถึงใช้ "เสียงแหลมสั้น" ไม่ใช่ "เสียงหนัก" ──
   * บุคลิกของเสียงมาจาก *ย่านความถี่* กับ *ความยาว* มากกว่าตัวโน้ต
   *   นินจา = แหลม สั้น คม (ผ้าสะบัด + คมเหล็ก) → ว่องไว เงียบ อันตราย
   *   สปาตัน = ต่ำ หนัก ยาว (โลหะกระทบ) → หนักแน่น ผลักไม่ล้ม
   * และ 2 โน้ตสูงที่ห่างกันนิดเดียวจะ "เสียดกัน" เกิดเสียงชิ้งแบบโลหะ
   * ซึ่งเป็นสิ่งที่โน้ตเดี่ยวทำไม่ได้เลยไม่ว่าจะสูงแค่ไหน
   */
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
    STYLE_LAYERS[style]?.lane?.();
  },

  /** กระโดด — ถีบพื้น (พัฟต่ำ) + ลมหวิวกวาดขึ้นยาว ๆ */
  jump()  {
    noise({ duration: 0.1, gain: 0.3, filterFrom: 1200, filterTo: 300 });
    noise({ duration: 0.42, gain: 0.45, filterFrom: 500, filterTo: 5200, type: 'bandpass' });
    tone({ freq: 260, endFreq: 540, duration: 0.16, type: 'sine', gain: 0.1 });
    STYLE_LAYERS[style]?.jump?.();
  },

  /** สไลด์ — ตุบทิ้งตัว + ครูดพื้นยาว (สองชั้น: เสียดสีสูง + ลมต่ำ) */
  slide() {
    tone({ freq: 170, endFreq: 90, duration: 0.12, type: 'sine', gain: 0.24 });
    noise({ duration: 0.44, gain: 0.42, filterFrom: 3800, filterTo: 350 });
    noise({ duration: 0.3, gain: 0.2, filterFrom: 900, filterTo: 480, type: 'bandpass', delay: 0.06 });
    STYLE_LAYERS[style]?.slide?.();
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
  { root: 55.00, name: 'Am', tones: [0, 3, 7, 12] },   // A1 · ไมเนอร์
  { root: 43.65, name: 'F',  tones: [0, 4, 7, 12] },   // F1 · เมเจอร์
  { root: 65.41, name: 'C',  tones: [0, 4, 7, 12] },   // C2 · เมเจอร์
  { root: 49.00, name: 'G',  tones: [0, 4, 7, 12] },   // G1 · เมเจอร์
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
let magnetLoop = null;
let speechDuck = false;
let magnetDuck = false;

/* ── เครื่องดนตรีแต่ละชิ้น (เล่น ณ เวลา when ของ AudioContext) ── */

/** กระเดื่อง: sine กวาดความถี่ลงเร็ว ๆ 150→48Hz = "ตุบ" ที่รู้สึกได้ที่อก */
function playKick(when) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, when);
  osc.frequency.exponentialRampToValueAtTime(48, when + 0.1);
  g.gain.setValueAtTime(0.55, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
  osc.connect(g).connect(musicBus);
  osc.start(when);
  osc.stop(when + 0.22);

  /* หัวกระเดื่อง — noise สั้นจิ๋ว 8ms
   * ย่านต่ำอย่างเดียวจะ "ตุบ" แต่ไม่ "ชัด" โดยเฉพาะบนลำโพงมือถือที่เล่นเบสไม่ออกเลย
   * เสียงคลิกสั้น ๆ ทำให้รู้ว่ากลองตกตรงไหนแม้ลำโพงจะไม่มีย่านเบสให้ฟัง */
  const frames = Math.floor(ctx.sampleRate * 0.008);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const click = ctx.createBufferSource();
  click.buffer = buf;
  const cf = ctx.createBiquadFilter();
  cf.type = 'bandpass';
  cf.frequency.value = 2200;
  const cg = ctx.createGain();
  cg.gain.value = 0.14;
  click.connect(cf).connect(cg).connect(musicBus);
  click.start(when);
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

/**
 * เบส: saw สองตัวเพี้ยนกันเล็กน้อย + sine ต่ำอีกอ็อกเทฟ
 *
 * ── ทำไม saw ตัวเดียวถึงบาง ──
 * คลื่นจากออสซิลเลเตอร์ตัวเดียวนิ่งสนิท ไม่มีการแกว่ง หูจึงอ่านว่า "เครื่องสังเคราะห์"
 * ทันที เครื่องดนตรีจริงไม่มีชิ้นไหนที่ความถี่นิ่ง 100%
 * ซ้อนสองตัวห่างกัน ~10 เซนต์ จะเกิดการตีกัน (beating) ช้า ๆ ซึ่งหูอ่านว่า "หนา"
 * นี่คือหลักเดียวกับ supersaw และเป็นวิธีที่ได้ผลที่สุดต่อบรรทัดโค้ดที่เขียน
 *
 * ส่วน sine ล่างคือ "ตัวเนื้อ" — ย่าน 40–80Hz ที่ saw ผ่าน lowpass ให้ไม่พอ
 * ลำโพงมือถือเล่นย่านนี้ไม่ออกก็จริง แต่หูฟังกับลำโพงคอมได้ยินชัด
 */
function playBass(when, freq, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.19, when + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1100, when);          // เปิดกว้างตอนหัวโน้ต = มีจังหวะ "ป๊ะ"
  f.frequency.exponentialRampToValueAtTime(480, when + Math.min(0.12, dur));
  f.Q.value = 6;                                   // เรโซแนนซ์นิดหน่อยให้มีคาแรกเตอร์
  f.connect(g).connect(musicBus);

  for (const cents of [-9, +9]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, when);
    osc.detune.setValueAtTime(cents, when);
    osc.connect(f);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  const sub = ctx.createOscillator();
  const subG = ctx.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(freq / 2, when);
  subG.gain.setValueAtTime(0.0001, when);
  subG.gain.exponentialRampToValueAtTime(0.16, when + 0.02);
  subG.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  sub.connect(subG).connect(musicBus);
  sub.start(when);
  sub.stop(when + dur + 0.02);
}

/**
 * แพดคอร์ด — ชิ้นที่หายไปทั้งเพลง
 *
 * ⚠️ นี่คือสาเหตุหลักที่เพลงฟังบาง: คอร์ด Am–F–C–G ถูกประกาศไว้ในข้อมูล
 * แต่ไม่เคยมีเครื่องดนตรีชิ้นไหนเล่นมันเลย เบสเล่นแค่ "โน้ตราก" ตัวเดียว
 * เพลงจึงมีแค่เส้นล่างกับเส้นบน ไม่มีอะไรอยู่ตรงกลาง — ซึ่งคือที่ที่หูฟังหา "เนื้อ"
 *
 * เล่นยาวทั้งบาร์ เบา ๆ ไม่ต้องเด่น หน้าที่ของมันคือเป็นพื้น ไม่ใช่เป็นตัวเอก
 * แต่ละโน้ตในคอร์ดกระจายซ้าย-ขวาไม่เท่ากัน เพื่อให้เกิดความกว้างแบบสเตอริโอ
 */
function playPad(when, chord, dur) {
  const send = ctx.createGain();
  send.gain.value = 0.22;
  send.connect(musicDelay);

  chord.tones.forEach((semi, i) => {
    const freq = chord.root * 4 * Math.pow(2, semi / 12);   // ยกขึ้น 2 อ็อกเทฟจากรากเบส
    const pan = ctx.createStereoPanner();
    pan.pan.value = (i / (chord.tones.length - 1)) * 1.3 - 0.65;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(0.05, when + dur * 0.25);   // เข้าช้า ๆ ไม่ให้ชนกระเดื่อง
    g.gain.linearRampToValueAtTime(0.0001, when + dur);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2100;      // ตัดความแหลมทิ้ง แพดต้องอยู่ "ข้างหลัง" เมโลดี้
    f.connect(g);
    g.connect(pan).connect(musicBus);
    g.connect(send);

    for (const cents of [-7, +7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, when);
      osc.detune.setValueAtTime(cents, when);
      osc.connect(f);
      osc.start(when);
      osc.stop(when + dur + 0.05);
    }
  });
}

/**
 * เมโลดี้: ยูนิซัน 3 เสียงเพี้ยนกัน + ดีเลย์จริง
 *
 * ของเดิมเป็น square ตัวเดียวแล้ว "ปลอมเสียงสะท้อน" ด้วยการเล่นโน้ตซ้ำเบา ๆ ตามหลัง
 * ซึ่งได้แค่โน้ตซ้ำ ไม่ได้หางเสียงที่ค่อย ๆ จางแบบเสียงสะท้อนจริง
 * ตอนนี้ส่งเข้าดีเลย์ป้อนกลับของจริงแทน — ได้หางหลายชั้นที่จางลงเองตามธรรมชาติ
 */
function playLead(when, freq, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.075, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 3800;     // square ดิบ ๆ บาดหูที่ย่าน 5–8k — เกลาปลายทิ้ง
  f.connect(g).connect(musicBus);

  const send = ctx.createGain();
  send.gain.value = 0.3;
  g.connect(send).connect(musicDelay);

  // ตัวกลางดัง ตัวข้างเบากว่าและกางออกซ้าย-ขวา = กว้างแต่ยังรู้ว่าโน้ตอยู่ตรงกลาง
  for (const [cents, panVal, vol] of [[0, 0, 1], [-11, -0.5, 0.6], [+11, 0.5, 0.6]]) {
    const osc = ctx.createOscillator();
    const vg = ctx.createGain();
    const pan = ctx.createStereoPanner();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, when);
    osc.detune.setValueAtTime(cents, when);
    vg.gain.value = vol;
    pan.pan.value = panVal;
    osc.connect(vg).connect(pan).connect(f);
    osc.start(when);
    osc.stop(when + dur + 0.02);
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

  // ⚠️ delayTime ค่าเริ่มต้นเป็น 0 — ปล่อยไว้จะได้ลูปป้อนกลับความยาวศูนย์ ต้องตั้งเสมอ
  // 3 ช่อง = เขบ็ตประจุด ซึ่งเป็นค่าที่ทำให้เสียงสะท้อนตกคร่อมจังหวะแทนที่จะทับโน้ตตัวถัดไป
  musicDelay.delayTime.setValueAtTime(ambience.stepDur * 3, ctx.currentTime);

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

  // แพดวางทีเดียวต้นบาร์ ยาวคลุมทั้งบาร์ — ไม่ต้องยิงทุกช่อง
  if (inBar === 0) playPad(when, chord, stepDur * 16);

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
  // ดีเลย์ต้องขยับตาม BPM ด้วย ไม่งั้นพอเพลงเร่งขึ้น เสียงสะท้อนจะหลุดจังหวะ
  // ค่อย ๆ เลื่อนแทนการกระโดด — เปลี่ยนความยาวดีเลย์ทันทีจะได้เสียงวี้ดแบบเทปยืด
  musicDelay.delayTime.linearRampToValueAtTime(ambience.stepDur * 3, ctx.currentTime + 0.4);
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
  setMagnetActive(false);
}

/* ══ เสียงดูดแม่เหล็ก — ลูปต่อเนื่องระหว่าง boost ทำงาน ═══════════════
 *
 * ไม่ใช่ one-shot ตอนเก็บไอเทม แต่เป็น "พื้นหลัง" ที่บอกว่ากำลังดูดอยู่
 * ใช้ noise วนผ่าน bandpass ที่สั่นความถี่ + เสียงต่ำสั่นเล็กน้อย = ความรู้สึกสูญญากาศดูด */

function startMagnetLoop() {
  if (!ctx || !sfxEnabled || magnetLoop) return;

  const loopSec = 1.8;
  const frames = Math.floor(ctx.sampleRate * loopSec);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 2.4;
  filter.frequency.value = 920;

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 3.2;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 520;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);

  const hum = ctx.createOscillator();
  hum.type = 'sine';
  hum.frequency.value = 62;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.0001;

  const gain = ctx.createGain();
  gain.gain.value = 0.0001;

  src.connect(filter).connect(gain).connect(master);
  hum.connect(humGain).connect(gain);

  const t = ctx.currentTime;
  const peak = CFG.audio.magnetLoopGain ?? 0.17;
  gain.gain.linearRampToValueAtTime(peak, t + 0.18);
  humGain.gain.linearRampToValueAtTime(peak * 0.35, t + 0.18);

  src.start(t);
  lfo.start(t);
  hum.start(t);

  magnetLoop = { src, lfo, hum, gain, humGain };
}

function stopMagnetLoop() {
  if (!magnetLoop || !ctx) return;
  const { src, lfo, hum, gain, humGain } = magnetLoop;
  magnetLoop = null;

  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0.0001, t + 0.22);
  humGain.gain.cancelScheduledValues(t);
  humGain.gain.setValueAtTime(humGain.gain.value, t);
  humGain.gain.linearRampToValueAtTime(0.0001, t + 0.22);

  const stopAt = t + 0.25;
  src.stop(stopAt);
  lfo.stop(stopAt);
  hum.stop(stopAt);
}

/** เปิด/ปิดเสียงดูดแม่เหล็ก + หรี่เพลงวิ่งลงให้ได้ยินชัด */
export function setMagnetActive(on) {
  magnetDuck = on;
  if (on) startMagnetLoop();
  else stopMagnetLoop();
  refreshMusicDuck();
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
let speechRun = 0;             // ลำดับของ speak() — ใช้ชี้ว่า watchdog ที่ตั้งอยู่เป็นของรอบไหน
let thaiVoice = null;          // เสียงไทยสำหรับโจทย์ deck วิชา (อาจไม่มีในเครื่องนั้น)
let voicesScanned = false;

/**
 * เลือกเสียงของทั้งสองภาษา
 *
 * ⚠️ เดิมฟังก์ชันนี้ออกทันทีเมื่อได้เสียงอังกฤษแล้ว (`if (englishVoice) return`)
 * ถ้าเพิ่มเสียงไทยเข้าไปโดยไม่แก้เงื่อนไขนี้ เครื่องที่หาเสียงอังกฤษเจอก่อน
 * จะไม่มีวันสแกนหาเสียงไทยเลย — และมันจะพังแบบ "เงียบสนิท" คือโจทย์วิชา
 * ไม่มีเสียงโดยไม่มี error ให้เห็น จึงต้องเปลี่ยนเป็นธง `voicesScanned`
 * ที่ล้างพร้อมกันตอน onvoiceschanged
 */
function pickVoice() {
  if (voicesScanned || !window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;   // บางเบราว์เซอร์โหลด voice แบบ async
  voicesScanned = true;

  const en = voices.filter(v => /^en/i.test(v.lang));
  const local = en.filter(v => v.localService !== false && !NOVELTY_VOICES.has(v.name));

  englishVoice =
    local.find(v => PREFERRED_VOICES.includes(v.name)) ||
    local.find(v => /^en-US/i.test(v.lang)) ||
    local[0] ||
    en.find(v => !NOVELTY_VOICES.has(v.name)) ||
    null;

  /* เสียงไทย: ต้องกรองด้วย lang เท่านั้น ห้ามเดาจากชื่อ
   * ชื่อเสียงไทยต่างกันทุกแพลตฟอร์ม (macOS "Kanya", Windows "Pattara"/"Premwadee",
   * Android "th-th-x-…") — บัญชีรายชื่อจะล้าสมัยทันทีที่ OS ออกรุ่นใหม่
   * ส่วน NOVELTY_VOICES ไม่ต้องใช้ตรงนี้ เพราะเสียงล้อเล่นของ macOS เป็น en-US ทั้งหมด */
  const th = voices.filter(v => /^th/i.test(v.lang));
  thaiVoice = th.find(v => v.localService !== false) || th[0] || null;
}

if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => {
    voicesScanned = false;
    englishVoice = null;
    thaiVoice = null;
    pickVoice();
  };
}

/** ใช้ตัดสินว่าจะสุ่ม "โหมดฟัง" ให้เป็นโจทย์ได้ไหม */
export function isSpeechUsable() {
  return speechEnabled && speechHealthy && !!window.speechSynthesis && !document.hidden;
}

/**
 * เครื่องนี้มีเสียงภาษาไทยไหม
 *
 * ⚠️ อย่าใช้ตัวนี้เป็น "ด่านหน้า" ก่อนเรียก speak() — speak() รู้เงื่อนไข
 * ที่ทำให้พูดไม่ได้ครบกว่านี้ (สวิตช์เสียง/แท็บถูกซ่อน/เครื่องยนต์ค้าง)
 * และแจ้งกลับทาง onFail อยู่แล้ว การมีเงื่อนไขสองชุดคือที่มาของบั๊ก
 * "บางข้อเงียบ บางข้อดัง" ตัวนี้มีไว้สำหรับ *แสดงสถานะ* ให้ผู้ใช้เห็นเท่านั้น
 */
export function hasThaiVoice() {
  pickVoice();
  return !!thaiVoice;
}

/**
 * ตอนนี้เครื่องยนต์กำลังพูดอยู่ไหม (รวมของที่ต่อคิวรออยู่)
 * ใช้ตัดสินว่า "ควรอ่านซ้ำ" ไหม — ถ้ายังพูดอยู่ ผู้เล่นก็กำลังได้ยินอยู่แล้ว
 */
export function isSpeaking() {
  const ss = window.speechSynthesis;
  return !!ss && (ss.speaking || ss.pending);
}

/** หรี่เสียงเพลงลง — อ่านคำมีลำดับสูงสุด แม่เหล็กรองลงมา */
function refreshMusicDuck() {
  if (!ctx || !musicBus) return;
  const base = ambience ? CFG.audio.musicVolume : 0.0001;
  let target = base;
  if (speechDuck) target = base * 0.22;
  else if (magnetDuck) target = base * (CFG.audio.magnetMusicDuck ?? 0.45);
  musicBus.gain.setTargetAtTime(Math.max(0.0001, target), ctx.currentTime, 0.08);
}

/* ── โหมดเสียงโค้ช ─────────────────────────────────────────
 * เก็บเป็น id ไม่ใช่ object เพื่อให้ค่าที่จูนใน config.js เป็นแหล่งความจริงเดียว
 * (ถ้าเก็บ object ไว้ตรงนี้ การแก้ config ตอนรันไทม์จะไม่มีผล — และเราจะงงมาก) */
let voiceModeId = CFG.voice.defaultMode;

export function setVoiceMode(id) {
  voiceModeId = CFG.voice.modes[id] ? id : CFG.voice.defaultMode;
}

/** หยิบประโยคของโหมดปัจจุบันแบบผลัดกัน — ไม่ให้ซ้ำจนกลายเป็นเสียงพื้นหลังที่สมองตัดทิ้ง */
function pickLine(lines, nth) {
  return lines[Math.abs(Math.trunc(nth)) % lines.length];
}

/** ประโยคขึ้นต้นตอนอ่านเฉลยบนจอตาย */
export function coachLine(nth = 0) {
  return pickLine(voiceModeById(voiceModeId).deathLines, nth);
}

/** ประโยคแซวตอนตอบผิดแล้วเกราะแตก (ระหว่างวิ่ง — ต้องสั้น) */
export function tauntLine(nth = 0) {
  return pickLine(voiceModeById(voiceModeId).taunts, nth);
}

/** ตัวอย่างภาษาอังกฤษของโหมดปัจจุบัน — ใช้ตอนเครื่องไม่มีเสียงไทย */
export function sampleLineEn() {
  return voiceModeById(voiceModeId).sampleEn;
}

/**
 * สรุปสถานะเครื่องอ่านออกเสียงเป็นข้อความสั้น ๆ สำหรับโชว์บนหน้าจอ
 *
 * ทำไมต้องมี: อาการของ speechSynthesis คือ "เงียบ" ซึ่งเป็นอาการเดียวกัน
 * ของสาเหตุที่ต่างกันสิ้นเชิงอย่างน้อย 5 อย่าง (ปิดสวิตช์ / ไม่มี voice ภาษานั้น /
 * แท็บถูกซ่อน / เครื่องยนต์ค้าง / เบราว์เซอร์ไม่รองรับ) และไม่มีอันไหนโยน error เลย
 * ผู้ใช้ที่เจอปัญหาจึงบอกได้แค่ "ไม่มีเสียง" ซึ่งไม่พอให้ใครแก้ได้
 * → ให้เครื่องบอกสถานะของตัวเองออกมาเป็นตัวหนังสือ แล้วผู้ใช้แค่ส่งบรรทัดนี้มา
 */
export function voiceReport() {
  if (!window.speechSynthesis) return 'เบราว์เซอร์นี้ไม่มี speechSynthesis';
  pickVoice();
  const total = window.speechSynthesis.getVoices().length;
  return [
    `เสียงทั้งหมด ${total}`,
    `ไทย: ${thaiVoice ? thaiVoice.name : '— ไม่พบ —'}`,
    `อังกฤษ: ${englishVoice ? englishVoice.name : '— ไม่พบ —'}`,
    `สวิตช์: ${speechEnabled ? 'เปิด' : 'ปิด'}`,
    `หน้าเว็บ: ${document.hidden ? 'ถูกซ่อน' : 'อยู่ด้านหน้า'}`,
    `เครื่องยนต์: ${speechHealthy ? 'ปกติ' : 'เคยพลาด'}`,
  ].join(' · ');
}

function duckMusic(on) {
  speechDuck = on;
  refreshMusicDuck();
}

function makeUtterance(text, rate, lang) {
  const utter = new SpeechSynthesisUtterance(text);
  const thai = lang === 'th';
  const mode = voiceModeById(voiceModeId);
  utter.lang = thai ? CFG.audio.speechLangTh : CFG.audio.speechLang;
  /* โหมดเสียงเป็น "ตัวคูณ" บนความเร็วเดิมเสมอ ไม่ใช่ค่าทับ
   * ผู้เรียกแต่ละที่ตั้ง rate มาตามบริบทของตัวเอง (โจทย์วิชาช้ากว่าคำศัพท์อยู่แล้ว)
   * ถ้าโหมดเสียงเขียนทับด้วยค่าตายตัว โจทย์วิชาจะเร็วจนฟังไม่ทันทันที */
  const base = rate ?? (thai ? CFG.audio.speechRateTh : CFG.audio.speechRate);
  utter.rate = Math.min(2, Math.max(0.5, base * mode.rateScale));
  utter.pitch = mode.pitch;
  const voice = thai ? thaiVoice : englishVoice;
  if (voice) utter.voice = voice;
  return utter;
}

/**
 * @param {string} text ข้อความที่จะอ่าน
 * @param {{rate?:number, lang?:'en'|'th', onStart?:Function, onFail?:Function,
 *          onDone?:Function}} opts
 *   onDone — ยิง "ครั้งเดียวเสมอ" เมื่อจบเรื่อง ไม่ว่าจะพูดจบ พูดไม่ได้ หรือถูกตัดคิว
 *            จุดประสงค์คือให้ UI ที่ "รอฟังให้จบ" ปลดล็อกได้โดยไม่ต้องเดาเอง
 *            ⚠️ ห้ามให้ผู้เรียกไปรอ onend ของ utterance เอง เพราะเส้นทางที่พูด
 *            ไม่ได้เลย (ปิดสวิตช์ / ไม่มีเสียงไทย / แท็บถูกซ่อน) ไม่มี utterance
 *            ให้รอตั้งแต่แรก — จอที่รออยู่จะค้างตลอดกาล
 */
export function speak(text, { rate, lang = 'en', onStart, onFail, onDone } = {}) {
  // onDone ต้องยิงครั้งเดียวจริง ๆ — ทุกทางออกด้านล่างเรียกผ่านตัวนี้เท่านั้น
  let done = false;
  const finish = () => { if (done) return; done = true; onDone?.(); };
  const fail = () => { onFail?.(); finish(); };

  if (!text) { finish(); return; }
  // ทุกทางที่ "พูดไม่ได้" ต้องแจ้ง onFail เสมอ ไม่ใช่เงียบหายไป
  // ไม่งั้นโจทย์โหมดฟังจะค้างเป็นโจทย์ที่ไม่มีทางตอบได้
  if (!speechEnabled || !window.speechSynthesis) { fail(); return; }
  if (document.hidden) { fail(); return; }   // เบราว์เซอร์พักเครื่องยนต์อยู่

  const ss = window.speechSynthesis;
  pickVoice();

  /* ไม่มีเสียงไทยในเครื่อง = ไม่ต้องลองด้วยซ้ำ
   * ⚠️ ห้ามปล่อยให้ตกไปพูดด้วยเสียงอังกฤษ: บางเครื่องจะอ่านตัวอักษรไทยเป็น
   * เสียงประหลาดหรือสะกดทีละตัว ซึ่งแย่กว่าเงียบมาก (เด็กจะสับสนว่าโจทย์ผิด)
   * และห้ามตั้ง speechHealthy = false ด้วย — เครื่องยนต์ยังดีอยู่ แค่ไม่มีเสียงภาษานี้
   * ถ้าตั้งไป โหมดฟังของ deck คำศัพท์จะถูกปิดตามไปทั้งเซสชันโดยไม่มีเหตุผล */
  if (lang === 'th' && !thaiVoice) { fail(); return; }

  // cancel เฉพาะตอนที่มีอะไรค้างอยู่จริง — การ cancel รัว ๆ คือสาเหตุอันดับหนึ่ง
  // ที่ทำให้เครื่องยนต์ของ Chrome/WebKit ค้างจนเงียบไปทั้งเซสชัน
  const didCancel = ss.speaking || ss.pending;
  if (didCancel) ss.cancel();
  ss.resume();

  /* ⚠️ ห้ามสั่ง speak() ติดกับ cancel() ในทิกเดียวกัน
   * cancel() ของ Chrome/WebKit ไม่ได้จบทันทีที่คืนค่า — เครื่องยนต์ยังรื้อ
   * utterance เก่าอยู่ ของใหม่ที่ยัดเข้าไปตอนนั้นจะถูกกลืนหายเงียบ ๆ
   * (ไม่มี error ไม่มี onend — เหมือนไม่เคยสั่งพูด) นี่คือสาเหตุของอาการ
   * "โจทย์บางข้อไม่อ่าน" ที่โผล่เฉพาะตอนมีเสียงก่อนหน้าค้างอยู่
   * ถ้าไม่ได้ cancel อะไรเลย ก็ไม่ต้องหน่วง — ยิงได้ทันทีตามเดิม */
  const kickoff = didCancel ? CFG.audio.speakAfterCancelMs : 0;

  let started = false;
  let retried = false;
  clearTimeout(speechWatchdog);

  /* speechWatchdog เป็นตัวแปรระดับโมดูล (มี watchdog ได้ทีละตัวเท่านั้น)
   * จึงต้องรู้ว่า "ตัวที่ตั้งอยู่ตอนนี้เป็นของใคร" ก่อนจะไปล้างมันทิ้ง
   * ⚠️ ไม่มีตัวนับนี้ utterance ของรอบเก่าที่เริ่มพูดช้า ๆ จะไปล้าง watchdog
   * ของรอบใหม่ทิ้ง = รอบใหม่กลายเป็นรอบที่ไม่มีใครเฝ้าเลย */
  const myRun = ++speechRun;

  const attach = (utter) => {
    utter.onstart = () => {
      started = true;
      speechHealthy = true;
      // เริ่มพูดแล้ว = ไม่มีอะไรให้ watchdog เฝ้าอีก (เฉพาะ watchdog ของรอบเราเอง)
      if (speechRun === myRun) clearTimeout(speechWatchdog);
      duckMusic(true);
      onStart?.();
    };
    utter.onend = () => { duckMusic(false); finish(); };
    utter.onerror = (e) => {
      duckMusic(false);
      // ถูกตัดคิวเพราะคำถัดไปมาแทน = เรื่องปกติ ไม่ใช่ความผิดพลาด
      // แต่ยัง "จบเรื่อง" สำหรับผู้เรียกที่รออยู่ — ไม่งั้นจอที่รอฟังจะค้าง
      if (e.error === 'canceled' || e.error === 'interrupted') { finish(); return; }
      speechHealthy = false;
      fail();
    };
    return utter;
  };

  const first = attach(makeUtterance(text, rate, lang));
  setTimeout(() => ss.speak(first), kickoff);

  /* ── watchdog ───────────────────────────────────────────────
   * ⚠️ เดิมตรงนี้เป็น "ไม่เริ่มพูดใน 450ms = ค้าง → cancel แล้วลองใหม่"
   * ซึ่งทำให้ประโยคไทยยาว ๆ ของ deck วิชาถูกตัดทิ้งแทบทุกข้อ
   * (เหตุผลเต็มอยู่ที่ speechGraceMs ใน config.js — อ่านก่อนแก้ตัวเลขพวกนี้)
   *
   * ตอนนี้แยกสองอาการออกจากกันด้วยสถานะของเครื่องยนต์เอง:
   *   idle (ไม่ speaking ไม่ pending) = งานหายไปเงียบ ๆ → นั่นคือของจริง ลองใหม่เลย
   *   busy = รับงานไปแล้วแต่ยังตั้งท่าไม่เสร็จ → รอจนหมดงบตามความยาวข้อความ
   * งบเวลาจึงยืดตามความยาว แต่ "การตรวจจับของหาย" ยังเร็วเท่าเดิม */
  const graceMs = speechGraceMs(text);

  /**
   * เฝ้าเป็นช่วง ๆ ทีละ speechIdleProbeMs จนกว่าจะครบ deadline
   * @param deadline งบเวลาทั้งหมดของความพยายามรอบนี้ (ms)
   * @param elapsed  รอมาแล้วกี่ ms ในรอบนี้
   * @param extra    เวลาที่ต้องบวกให้ทิกแรกเท่านั้น — ตอนหน่วงหลัง cancel
   *                 ถ้าไม่บวก watchdog จะเริ่มนับก่อน ss.speak() ถูกเรียกด้วยซ้ำ
   */
  const watch = (deadline, elapsed = 0, extra = 0) => {
    const step = Math.min(CFG.audio.speechIdleProbeMs, Math.max(1, deadline - elapsed));
    speechWatchdog = setTimeout(() => {
      const spent = elapsed + step;
      const move = speechWatchdogDecision({
        started,
        engineBusy: !!(ss.speaking || ss.pending),
        retried,
        expired: spent >= deadline,
      });
      if (move === 'ok') return;
      if (move === 'wait') { watch(deadline, spent); return; }

      if (move === 'retry') {
        retried = true;
        ss.cancel();
        ss.resume();
        const again = attach(makeUtterance(text, rate, lang));
        // ลองใหม่ต้องหน่วงเสมอ — รอบนี้เพิ่ง cancel() ไปหมาด ๆ ถ้ายิงติดกันอีก
        // ก็จะโดนกลืนด้วยเหตุผลเดิม แล้ว "การลองใหม่" จะไม่มีความหมายเลย
        setTimeout(() => ss.speak(again), CFG.audio.speakAfterCancelMs);
        watch(graceMs + CFG.audio.speechRetryGraceMs, 0, CFG.audio.speakAfterCancelMs);
        return;
      }

      speechHealthy = false;     // ยอมแพ้ — เกมจะเลิกสุ่มโหมดฟังตั้งแต่นี้ไป
      duckMusic(false);
      fail();
    }, step + extra);
  };
  watch(graceMs, 0, kickoff);
}

export function stopSpeaking() {
  clearTimeout(speechWatchdog);
  duckMusic(false);
  window.speechSynthesis?.cancel();
}
