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
  /** ผ่านด่านถูก — คอร์ดขึ้น ให้ความรู้สึก "ทะลุผ่านไปได้" */
  correct(comboLevel = 1) {
    const base = 420 + Math.min(comboLevel, CFG.score.comboMax) * 55;
    tone({ freq: base, duration: 0.16, type: 'triangle', gain: 0.26 });
    tone({ freq: base * 1.5, duration: 0.22, type: 'sine', gain: 0.18, delay: 0.05 });
    noise({ duration: 0.3, gain: 0.14, filterFrom: 6000, filterTo: 900 });
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

  jetUse() {
    tone({ freq: 90, endFreq: 260, duration: 0.7, type: 'sawtooth', gain: 0.26 });
    noise({ duration: 0.85, gain: 0.3, filterFrom: 900, filterTo: 4500 });
  },

  jump()  { tone({ freq: 330, endFreq: 620, duration: 0.14, type: 'square', gain: 0.13 }); },
  slide() { noise({ duration: 0.22, gain: 0.16, filterFrom: 3200, filterTo: 700 }); },
  lane()  { tone({ freq: 720, duration: 0.05, type: 'sine', gain: 0.07 }); },
  select(){ tone({ freq: 560, endFreq: 780, duration: 0.09, type: 'sine', gain: 0.14 }); },

  /** ฝีเท้า — เบามาก แต่เป็นสิ่งที่ทำให้ "รู้สึกว่ากำลังวิ่ง" จริง ๆ */
  step() { noise({ duration: 0.07, gain: 0.075, filterFrom: 900, filterTo: 180 }); },
};

/* ══ เสียงบรรยากาศระหว่างวิ่ง ═══════════════════════════════════
 * ประกอบด้วย 3 ชั้น:
 *   1) เสียงเครื่องยนต์ (drone) — ความถี่ขยับตามความเร็ว = รู้สึกว่าเร่ง
 *   2) เสียงลม (noise ลูปยาว) — ดังขึ้นตามความเร็ว
 *   3) ไลน์เบสเพนทาโทนิก — จังหวะเร็วขึ้นตามความเร็ว = ความตื่นเต้นไต่ขึ้น
 *
 * ⚠️ ตัวโน้ตต้องจองล่วงหน้า (lookahead scheduling) ไม่ใช่เล่นทันทีใน setInterval
 * เพราะ setInterval ของ JS คลาดเคลื่อนได้หลายสิบมิลลิวินาที จังหวะจะเพี้ยนจนฟังออก
 * วิธีที่ถูกคือใช้ setInterval แค่ "ตื่นมาดู" แล้วสั่งเล่นด้วยเวลาของ AudioContext
 * ซึ่งแม่นระดับตัวอย่างเสียง (sample-accurate)
 */

const SCALE = [110.00, 130.81, 146.83, 164.81, 196.00, 220.00];  // A minor pentatonic
const PATTERN = [0, 2, 4, 3, 5, 4, 2, 1];

let ambience = null;

export function startAmbience() {
  if (!ctx || !sfxEnabled || ambience) return;

  // 1) เครื่องยนต์
  const drone = ctx.createOscillator();
  drone.type = 'sawtooth';
  drone.frequency.value = 52;
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 220;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.16;
  drone.connect(droneFilter).connect(droneGain).connect(musicBus);
  drone.start();

  // 2) ลม — ใช้บัฟเฟอร์ยาว 2 วินาทีวนลูป ประหยัดกว่าสร้าง noise ใหม่ตลอดเวลา
  const frames = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const wind = ctx.createBufferSource();
  wind.buffer = buf;
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 700;
  windFilter.Q.value = 0.7;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.05;
  wind.connect(windFilter).connect(windGain).connect(musicBus);
  wind.start();

  ambience = {
    drone, droneFilter, droneGain,
    wind, windFilter, windGain,
    step: 0,
    nextNoteTime: ctx.currentTime + 0.1,
    interval: 0.28,
    timer: null,
  };

  // เฟดเข้าแทนการเปิดโครม ๆ
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
  musicBus.gain.linearRampToValueAtTime(CFG.audio.musicVolume, ctx.currentTime + 1.2);

  ambience.timer = setInterval(() => {
    if (!ambience) return;
    // จองโน้ตล่วงหน้า 0.2 วินาที
    while (ambience.nextNoteTime < ctx.currentTime + 0.2) {
      const note = SCALE[PATTERN[ambience.step % PATTERN.length]];
      const accent = ambience.step % 4 === 0;
      playNote(note, ambience.nextNoteTime, accent);
      ambience.step += 1;
      ambience.nextNoteTime += ambience.interval;
    }
  }, 40);
}

function playNote(freq, when, accent) {
  if (!ctx || !musicBus) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = accent ? 'square' : 'triangle';
  osc.frequency.setValueAtTime(freq, when);

  const peak = accent ? 0.12 : 0.075;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);

  osc.connect(g).connect(musicBus);
  osc.start(when);
  osc.stop(when + 0.26);
}

/** เรียกทุกเฟรม — ผูกเสียงเข้ากับความเร็วปัจจุบัน */
export function updateAmbience(speed) {
  if (!ambience || !ctx) return;
  const t = ctx.currentTime;
  const ratio = Math.min(1, (speed - CFG.speed.start) / Math.max(1, CFG.speed.max - CFG.speed.start));

  ambience.drone.frequency.setTargetAtTime(48 + ratio * 26, t, 0.4);
  ambience.droneFilter.frequency.setTargetAtTime(200 + ratio * 420, t, 0.4);
  ambience.windGain.gain.setTargetAtTime(0.04 + ratio * 0.09, t, 0.4);
  ambience.windFilter.frequency.setTargetAtTime(650 + ratio * 900, t, 0.4);

  // จังหวะเร็วขึ้นตามความเร็ว: 96 → 148 BPM (นับเป็นเขบ็ต)
  const bpm = 96 + ratio * 52;
  ambience.interval = 60 / bpm / 2;
}

export function stopAmbience() {
  if (!ambience || !ctx) return;
  clearInterval(ambience.timer);

  const t = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(musicBus.gain.value, t);
  musicBus.gain.linearRampToValueAtTime(0.0001, t + 0.35);

  const dying = ambience;
  ambience = null;
  // ปล่อยให้เฟดจบก่อนค่อยหยุด oscillator ไม่งั้นจะได้ยินเสียง "ป๊อก"
  setTimeout(() => {
    try { dying.drone.stop(); dying.wind.stop(); } catch { /* หยุดไปแล้ว */ }
  }, 500);
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
