/**
 * main.js — วงจรหลักของเกม และ "ผู้กำกับ" ที่ตัดสินใจว่าจะปล่อยอะไรเมื่อไหร่
 *
 * ── หัวใจของไฟล์นี้: การคิดเป็น "เวลามาถึง" ไม่ใช่ "ระยะทาง" ──
 * เราไม่ได้วางด่านไว้ทุก ๆ 30 หน่วย แต่กำหนดว่า "ด่านถัดไปจะถึงตัวผู้เล่น
 * ที่วินาทีที่ T" แล้วค่อยคำนวณย้อนกลับว่าต้องไปเกิดที่ระยะเท่าไร
 *
 * ทำไมถึงสำคัญ? เพราะเกมเร่งความเร็วขึ้นเรื่อย ๆ ถ้าวางด่านด้วยระยะคงที่
 * เวลาที่ผู้เล่นมีให้คิดจะหดลงเองโดยที่เราไม่ได้ตั้งใจ — เล่นไปสัก 60 วินาที
 * เกมฝึกศัพท์จะกลายเป็นเกมเดาสุ่มโดยไม่มีใครรู้ตัว
 * การคิดเป็นเวลาทำให้ "ความเร็ว" กับ "เวลาคิด" เป็นสองปุ่มที่หมุนแยกกันได้จริง
 *
 * หลักเดียวกันนี้ใช้กับเหรียญด้วย: ระยะห่างของเหรียญคิดเป็นวินาที
 * ความรู้สึกตอนไล่เก็บจึงเหมือนเดิมตลอดเกม ไม่ว่าจะวิ่งเร็วแค่ไหน
 */

import { CFG, answerWindowFor, obstacleRuleFor } from './config.js';
import { createScene } from './scene.js';
import { createPlayer } from './player.js';
import { createGatePool } from './gates.js';
import { createObstaclePool, pickObstacleType } from './obstacles.js';
import { createPickupPool, PICKUP } from './pickups.js';
import { planBonus } from './bonus.js';
import { createHUD } from './hud.js';
import { createUI } from './ui.js';
import { createInput, ACTIONS } from './input.js';
import { loadDeckIndex, loadDeck, pickWord, buildQuestion } from './deck.js';
import * as srs from './srs.js';
import {
  unlockAudio, sfx, speak, stopSpeaking, setSfxEnabled, setSpeechEnabled,
  isSpeechUsable, startAmbience, updateAmbience, stopAmbience,
} from './audio.js';

/* ── ตั้งฉาก ─────────────────────────────────────────────── */

const canvas = document.getElementById('game-canvas');
const world = createScene(canvas);
const player = createPlayer(world.scene);
const gates = createGatePool(world.scene);
const obstacles = createObstaclePool(world.scene);
const pickups = createPickupPool(world.scene);
const hud = createHUD();

/** boot | menu | running | dying | dead | paused | stats */
let state = 'boot';
let deck = null;
let run = null;
let deathInfo = null;
let dyingTimer = 0;
let pendingRetryWord = null;   // คำที่ทำให้ตายรอบก่อน → เป็นด่านแรกของรอบถัดไป
let jokes = [];                // มุกกวนสำหรับด่านโบนัส

/* ── หน้าจอ/เมนู ─────────────────────────────────────────── */

const ui = createUI({
  onStart: () => startRun(),
  onMenu: () => toMenu(),
  onResume: () => resumeGame(),
  onDeckChange: (file) => selectDeck(file),
  onOpenStats: () => {
    stopAmbience();
    ui.renderStats(deck);
    ui.show('stats');
    state = 'stats';
  },
  onStatsChanged: () => {
    ui.renderStats(deck);
    ui.setDeckInfo(deck);
    hud.setBest(srs.getBest(deck.id).score);
  },
  onResetDeck: () => {
    srs.resetDeck(deck.id);
    pendingRetryWord = null;
    ui.renderStats(deck);
    ui.setDeckInfo(deck);
    hud.setBest(0);
  },
  onAudioPrefs: (sfxOn, speechOn) => {
    setSfxEnabled(sfxOn);
    setSpeechEnabled(speechOn);
  },
  onTestSpeech: () => testSpeech(),
});

/**
 * ตรวจว่าเครื่องอ่านออกเสียงของเบราว์เซอร์ทำงานจริงไหม
 * จำเป็นต้องมี เพราะ speechSynthesis พังแบบ "เงียบสนิทไม่มี error" ได้หลายทาง
 * ถ้าไม่มีปุ่มนี้ ผู้เล่นจะแยกไม่ออกว่า "ลำโพงปิด" หรือ "เกมพัง"
 */
let speechTestTimer = null;

function testSpeech() {
  unlockAudio();

  if (!ui.audioPrefs().speech) {
    ui.setSpeechStatus('เปิดสวิตช์ "อ่านออกเสียงคำ" ก่อน แล้วกดทดสอบอีกครั้ง', 'fail');
    return;
  }
  if (document.hidden) {
    ui.setSpeechStatus('หน้าเว็บไม่ได้อยู่ด้านหน้า — เบราว์เซอร์พักเครื่องอ่านไว้', 'fail');
    return;
  }

  ui.setSpeechStatus('กำลังทดสอบ… ควรได้ยินคำว่า "opportunity"');
  clearTimeout(speechTestTimer);

  // เผื่อกรณีที่เครื่องยนต์ไม่ยิง callback กลับมาเลย (พังแบบเงียบที่สุด)
  speechTestTimer = setTimeout(() => {
    ui.setSpeechStatus('✗ ไม่ตอบสนอง — เกมจะข้ามโหมดฟังให้อัตโนมัติ', 'fail');
  }, 3000);

  speak('opportunity', {
    rate: 0.9,
    onStart: () => {
      clearTimeout(speechTestTimer);
      ui.setSpeechStatus('✓ ใช้งานได้ — ถ้ายังไม่ได้ยิน ให้เช็กระดับเสียงของเครื่อง', 'ok');
    },
    onFail: () => {
      clearTimeout(speechTestTimer);
      ui.setSpeechStatus('✗ เบราว์เซอร์นี้อ่านออกเสียงไม่ได้ — เกมจะข้ามโหมดฟังให้อัตโนมัติ', 'fail');
    },
  });
}

/* ── การรับปุ่ม ──────────────────────────────────────────── */

/**
 * ⚠️ ปลดล็อกเสียงจาก "การกดใด ๆ ในหน้า" ไม่ใช่เฉพาะปุ่มควบคุมเกม
 *
 * เบราว์เซอร์ยอมให้สร้าง/เปิด AudioContext ได้เฉพาะภายใน event ที่มาจากผู้ใช้จริง
 * ถ้าดักแค่ปุ่มลูกศร/Space ผู้เล่นที่ "คลิกปุ่มเริ่มเล่นด้วยเมาส์" จะไม่เคยปลดล็อก
 * → เกมจะเงียบสนิททั้งเซสชันโดยไม่มี error ให้เห็น และเราจะหาสาเหตุไม่เจอ
 * เพราะตอนเทสต์เองเรากด Space ตลอด
 */
window.addEventListener('pointerdown', unlockAudio);

createInput(canvas, (action) => {
  unlockAudio();

  switch (state) {
    case 'menu':
      if (action === ACTIONS.CONFIRM) startRun();
      break;
    case 'dead':
      if (action === ACTIONS.CONFIRM) startRun();
      else if (action === ACTIONS.BACK) toMenu();
      break;
    case 'stats':
      if (action === ACTIONS.BACK || action === ACTIONS.CONFIRM) toMenu();
      break;
    case 'paused':
      if (action === ACTIONS.BACK || action === ACTIONS.CONFIRM) resumeGame();
      break;
    case 'running':
      if (action === ACTIONS.BACK) pauseGame();
      else player.handle(action, sfx);
      break;
    default:
      break;
  }
});

/* ── การเปลี่ยนสถานะ ─────────────────────────────────────── */

function toMenu() {
  stopSpeaking();
  stopAmbience();
  state = 'menu';
  hud.hide();
  ui.setDeckInfo(deck);
  ui.show('menu');
}

function pauseGame() {
  if (state !== 'running') return;
  state = 'paused';
  stopSpeaking();
  stopAmbience();
  ui.show('pause');
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'running';
  ui.hideAll();
  startAmbience();
}

function startRun() {
  if (!deck) return;
  stopSpeaking();
  gates.reset();
  obstacles.reset();
  pickups.reset();
  player.reset();

  run = {
    time: 0,
    speed: CFG.speed.start,
    score: 0,
    gates: 0,
    combo: 1,
    coins: 0,
    jets: 0,
    stars: 0,
    bonus: null,
    recent: [],
    events: [],
    nextGateArrival: answerWindowFor(0) + 0.9,   // เว้นจังหวะตั้งตัวก่อนด่านแรก
    gateSpawned: false,
    forcedWord: pendingRetryWord,                 // คำที่พลาดรอบก่อน มาเป็นด่านแรก
    invuln: 0,
    coinStreak: 0,
    lastCoinAt: -10,
    activeQuestion: null,
    audioReplayed: false,
  };
  pendingRetryWord = null;

  world.setEnvironment('corridor');
  player.setFlying(false);

  ui.hideAll();
  hud.show();
  hud.setScore(0, 0, 1);
  hud.setCoins(0);
  hud.setJets(0);
  hud.setStars(0, CFG.stars.needed);
  hud.setBonusTimer(null);
  hud.hideBonusBanner();
  hud.setBest(srs.getBest(deck.id).score);
  hud.clearQuestion();
  hud.setActiveLane(1);
  state = 'running';
  startAmbience();
}

/* ── ผู้กำกับ: คำนวณระยะจากเวลา ──────────────────────────── */

/**
 * ระยะทางที่โลกจะวิ่งผ่านไปในอีก T วินาทีข้างหน้า
 * ต้องรวมผลของความเร่งด้วย ไม่ใช่แค่ speed × T
 */
function distanceOver(seconds) {
  const v = run.speed;
  const a = v >= CFG.speed.max ? 0 : CFG.speed.accel;
  const timeToMax = a > 0 ? (CFG.speed.max - v) / a : 0;

  if (seconds <= timeToMax) return v * seconds + 0.5 * a * seconds * seconds;

  const dAccel = v * timeToMax + 0.5 * a * timeToMax * timeToMax;
  return dAccel + CFG.speed.max * (seconds - timeToMax);
}

function spawnGate(windowSeconds) {
  const word = run.forcedWord || pickWord(deck, run.recent);
  run.forcedWord = null;

  const question = buildQuestion(deck, word, { speechEnabled: isSpeechUsable() });
  gates.spawn(question, -distanceOver(windowSeconds));

  run.recent.push(word.en);
  if (run.recent.length > CFG.srs.recentBlock) run.recent.shift();

  run.activeQuestion = question;
  run.audioReplayed = false;
  hud.setQuestion(question);

  // โหมดฟัง: อ่านช้ากว่าปกติเล็กน้อยเพราะผู้เล่นต้องจับคำให้ได้ในครั้งเดียว
  if (question.mode === 'audio') {
    speak(word.en, {
      rate: 0.85,
      // ถ้าเครื่องอ่านออกเสียงไม่ทำงาน โจทย์เสียงจะกลายเป็นโจทย์ที่ตอบไม่ได้เลย
      // → สลับเป็นโจทย์ตัวหนังสือทันที ผู้เล่นต้องไม่ตายเพราะเบราว์เซอร์มีปัญหา
      onFail: () => {
        if (!run || run.activeQuestion !== question) return;
        question.mode = 'text';
        hud.setQuestion(question);
        hud.toast('เครื่องอ่านออกเสียงไม่ทำงาน — เปลี่ยนเป็นโจทย์ตัวหนังสือให้แล้ว', 2600);
      },
    });
  }
}

/**
 * วางของในช่วงพัก — ห้ามล้ำเข้าไปในช่วงอ่านโจทย์เด็ดขาด
 * และเหรียญจะถูกวางใน "เลนที่ไม่มีสิ่งกีดขวาง" เสมอ
 * → แถวเหรียญกลายเป็นตัวชี้ทางปลอดภัยโดยไม่ต้องมี UI บอก
 */
function scheduleBreather(gateArrival) {
  const rule = obstacleRuleFor(run.gates);
  const start = gateArrival + CFG.pacing.obstacleEdgeMargin;
  const end = gateArrival + CFG.pacing.breatherSeconds - CFG.pacing.obstacleEdgeMargin;
  if (end <= start) return;

  const waves = rule.waves[0] +
    Math.floor(Math.random() * (rule.waves[1] - rule.waves[0] + 1));

  for (let w = 0; w < waves; w++) {
    const slot = waves === 1 ? 0.5 : (w + 0.5) / waves;
    const time = start + (end - start) * slot;

    // ⚠️ กฎความปลอดภัย: ห้ามบล็อกครบทั้ง 3 เลนในเวลาเดียวกันเด็ดขาด
    // ไม่งั้นผู้เล่นตายโดยไม่มีทางเลือก ซึ่งไม่ใช่ "ยาก" แต่คือ "ไม่ยุติธรรม"
    const simultaneous = Math.min(rule.simultaneous, CFG.world.laneCount - 1);
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, simultaneous);

    for (const lane of lanes) {
      run.events.push({
        kind: 'obstacle',
        time,
        type: pickObstacleType(run.gates),
        lane,
        lead: rule.lead,
      });
    }
  }

  if (Math.random() > CFG.coins.chancePerBreather) return;

  /** เลนนี้ว่างจากอันตรายในช่วงเวลานั้นไหม (เผื่อขอบไว้ ±0.5 วิ) */
  const laneFreeAt = (lane, time) => !run.events.some(
    e => e.kind === 'obstacle' && e.lane === lane && Math.abs(e.time - time) < 0.5
  );

  const lane = Math.floor(Math.random() * CFG.world.laneCount);
  const n = CFG.coins.runMin + Math.floor(Math.random() * (CFG.coins.runMax - CFG.coins.runMin + 1));
  const t0 = gateArrival + 0.45;
  let lastCoinTime = t0;

  for (let i = 0; i < n; i++) {
    const time = t0 + i * CFG.coins.gapSeconds;
    // เว้นช่องตรงที่มีอันตราย → แถวเหรียญจะขาดเป็นช่วง ๆ ตรงจุดที่ต้องหลบพอดี
    // กลายเป็นการ "สอนจังหวะ" โดยไม่ต้องมีข้อความบอก
    if (!laneFreeAt(lane, time)) continue;
    run.events.push({ kind: 'coin', time, lane, lead: CFG.coins.lead });
    lastCoinTime = time;
  }

  // ไอพ่นสำรองวางไว้ท้ายแถวเหรียญ = รางวัลของคนที่เก็บจนจบแถว
  if (Math.random() < CFG.powerup.chancePerBreather && laneFreeAt(lane, lastCoinTime + 0.3)) {
    run.events.push({ kind: 'jet', time: lastCoinTime + 0.3, lane, lead: CFG.powerup.lead });
  }

  // ดาวสะสม — ลอยสูง ต้องกระโดดเก็บ จึงวางในเลนที่ว่างจริง ๆ เท่านั้น
  if (run.stars < CFG.stars.needed && Math.random() < CFG.stars.chancePerBreather) {
    const starTime = gateArrival + CFG.pacing.breatherSeconds * 0.62;
    const free = [0, 1, 2].filter(l => laneFreeAt(l, starTime));
    if (free.length) {
      run.events.push({
        kind: 'star',
        time: starTime,
        lane: free[Math.floor(Math.random() * free.length)],
        lead: CFG.stars.lead,
      });
    }
  }
}

function runDirector() {
  const windowSeconds = answerWindowFor(run.gates);

  if (!run.gateSpawned && run.time >= run.nextGateArrival - windowSeconds) {
    const arrival = run.nextGateArrival;
    spawnGate(windowSeconds);
    scheduleBreather(arrival);

    // จองคิวด่านถัดไป: [เวลามาถึงของด่านนี้] + [ช่วงพัก] + [เวลาคิดของด่านหน้า]
    run.nextGateArrival = arrival + CFG.pacing.breatherSeconds + answerWindowFor(run.gates + 1);
    run.gateSpawned = false;
  }

  for (let i = run.events.length - 1; i >= 0; i--) {
    const ev = run.events[i];
    if (run.time < ev.time - ev.lead) continue;
    const z = -distanceOver(ev.lead);
    if (ev.kind === 'obstacle') obstacles.spawn(ev.type, ev.lane, z);
    else if (ev.kind === 'coin') pickups.spawnCoin(ev.lane, z);
    else if (ev.kind === 'star') pickups.spawnStar(ev.lane, z);
    else pickups.spawnJet(ev.lane, z);
    run.events.splice(i, 1);
  }
}

/* ══ ด่านโบนัส "ทางช้างเผือก" ═══════════════════════════════ */

function enterBonus() {
  // ล้างทุกอย่างของโหมดปกติทิ้ง — ห้ามมีอันตรายค้างข้ามเข้ามาในด่านโบนัสเด็ดขาด
  run.events = [];
  gates.reset();
  obstacles.reset();
  pickups.reset();

  run.stars = 0;
  run.bonus = {
    t: 0,
    plan: planBonus(jokes.length ? CFG.bonus.jokeGateCount : 0),
  };
  run.bonus.events = run.bonus.plan.events.slice();

  world.setEnvironment('space');
  player.setFlying(true);

  hud.setStars(0, CFG.stars.needed);
  hud.clearQuestion();
  hud.showBonusBanner();
  hud.toast('↑ ↓ สลับระดับการบินเพื่อกวาดเหรียญคนละแถว', 3200);
  sfx.bonusStart();
}

function spawnJokeGate(lead) {
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  const question = {
    word: joke,
    options: joke.options.map(text => ({ en: text })),
    correctIndex: joke.answer,
    mode: 'joke',
  };
  gates.spawn(question, -distanceOver(lead), true);   // harmless = ไม่มีเลเซอร์
  run.activeQuestion = question;
  hud.setQuestion(question);
}

const JOKE_LEAD = 2.4;   // มุกยาวกว่าคำศัพท์ ต้องให้เวลาอ่านมากกว่า

function bonusDirector(dt) {
  const b = run.bonus;
  b.t += dt;

  for (let i = b.events.length - 1; i >= 0; i--) {
    const ev = b.events[i];
    const lead = ev.kind === 'joke' ? JOKE_LEAD : CFG.coins.lead;
    if (b.t < ev.time - lead) continue;

    if (ev.kind === 'coin') {
      // วางเหรียญที่ "ระดับกลางลำตัว" ของแต่ละชั้นการบิน
      // เพื่อให้ชั้นบน/ล่างเก็บข้ามกันไม่ได้ → การกดขึ้น/ลงถึงจะมีความหมาย
      const y = (ev.high ? CFG.bonus.flyHighY : CFG.bonus.flyLowY) + 0.8;
      pickups.spawnCoin(ev.lane, -distanceOver(lead), y);
    } else {
      spawnJokeGate(lead);
    }
    b.events.splice(i, 1);
  }

  hud.setBonusTimer(1 - b.t / b.plan.duration);
  if (b.t >= b.plan.duration) exitBonus();
}

function exitBonus() {
  run.bonus = null;
  player.setFlying(false);
  world.setEnvironment('corridor');
  gates.reset();
  pickups.reset();

  hud.setBonusTimer(null);
  hud.hideBonusBanner();
  hud.clearQuestion();
  sfx.bonusEnd();

  // เว้นเวลาให้ร่อนลงถึงพื้นก่อน แล้วค่อยเริ่มด่านคำศัพท์ถัดไป
  run.events = [];
  run.nextGateArrival = run.time + CFG.bonus.landSeconds + answerWindowFor(run.gates) + 0.7;
  run.gateSpawned = false;
}

/* ── ผลของการตอบ ─────────────────────────────────────────── */

function passGate(gate) {
  const q = gate.question;
  srs.record(deck.id, q.word.en, true);

  run.gates += 1;
  run.score += CFG.score.perGate * run.combo;
  run.combo = Math.min(CFG.score.comboMax, run.combo + 1);

  sfx.correct(run.combo);
  speak(q.word.en);            // dual coding: เห็น/ได้ยินคำเดียวกันซ้ำอีกครั้ง

  hud.setScore(run.score, run.gates, run.combo);
}

/** ตอบผิดแต่มีไอพ่นสำรอง → พุ่งข้ามลำแสง แต่ยังนับว่าตอบผิดอยู่ */
function saveWithJet(gate) {
  const q = gate.question;
  run.jets -= 1;
  run.combo = 1;
  run.invuln = CFG.powerup.invulnMs / 1000;

  srs.record(deck.id, q.word.en, false);   // เชิงเกมรอด แต่เชิงการเรียนรู้ไม่รอด
  pendingRetryWord = q.word;

  player.boost();
  sfx.jetUse();
  speak(q.word.en);

  hud.setJets(run.jets);
  hud.setScore(run.score, run.gates, run.combo);
  hud.toast(`รอดด้วยไอพ่น! คำที่ถูกคือ "${q.word.en}" = ${q.word.th}`, 2200);
}

function die(cause, word, chosen) {
  state = 'dying';
  dyingTimer = 0;

  world.shake(1.1);
  stopAmbience();
  if (cause === 'obstacle') sfx.crash();

  // ชนสิ่งกีดขวางไม่ใช่ความผิดเรื่องคำศัพท์ → ไม่นับว่าตอบผิด
  if (cause === 'lane' && word) srs.record(deck.id, word.en, false);

  pendingRetryWord = word || null;
  srs.submitScore(deck.id, run.score, run.gates);

  deathInfo = {
    cause,
    word,
    chosen,
    score: run.score,
    gates: run.gates,
    coins: run.coins,
    best: srs.getBest(deck.id).score,
  };

  // ให้เสียงระเบิดดังจบก่อน แล้วค่อยอ่านคำที่ถูกต้อง (ไม่งั้นทับกันจนฟังไม่รู้เรื่อง)
  if (word) setTimeout(() => speak(word.en), 430);
}

function resolveJokeGate(gate, lane) {
  const q = gate.question;
  const correct = lane === q.correctIndex;
  gate.resolve(q.correctIndex);
  hud.markResult(q.correctIndex);
  hud.setTimer(0);

  if (correct) {
    run.coins += CFG.bonus.jokeRewardCoins;
    run.score += CFG.bonus.jokeRewardCoins * CFG.coins.value;
    sfx.jokeRight();
    hud.toast(`ถูกต้อง! ${q.word.punch} (+${CFG.bonus.jokeRewardCoins} เหรียญ)`, 2600);
  } else {
    sfx.jokeWrong();
    hud.toast(`เฉลย: ${q.options[q.correctIndex].en} — ${q.word.punch}`, 2600);
  }

  hud.setCoins(run.coins);
  hud.setScore(run.score, run.gates, run.combo);
}

function checkGates() {
  for (const gate of gates.gates) {
    if (!gate.active || gate.resolved) continue;
    // ตัดสินตอน "แตะระนาบด่าน" ไม่ใช่ตอนด่านเข้าระยะ
    // เพื่อให้การสไลด์วินาทีสุดท้ายยังทัน = ความรู้สึก "เกือบตายแต่รอด"
    if (gate.z() < CFG.world.playerZ - 0.25) continue;

    const q = gate.question;
    const lane = player.nearestLane();

    // ด่านมุกกวนในโบนัส: ไม่มีเลเซอร์ ไม่มีใครตาย ตอบผิดแค่โดนแซว
    if (gate.harmless) {
      resolveJokeGate(gate, lane);
      continue;
    }

    const correct = lane === q.correctIndex;

    // เลเซอร์ยิงทุกเลนที่เป็นคำตอบผิดเสมอ ไม่ว่าผู้เล่นจะอยู่เลนไหน
    gate.resolve(q.correctIndex);
    hud.markResult(q.correctIndex);
    hud.setTimer(0);
    sfx.laser();

    if (correct) {
      passGate(gate);
    } else if (run.jets > 0) {
      saveWithJet(gate);
    } else {
      die('lane', q.word, q.options[lane]);
      return;
    }
  }
}

function checkHazards() {
  // ในด่านโบนัสไม่มีอะไรทำอันตรายได้เลย — นั่นคือทั้งหมดของความหมายของมัน
  if (run.bonus || run.invuln > 0 || player.isBoosting()) return;
  const hit = obstacles.checkHit(player);
  if (hit) {
    const pending = gates.pending();
    die('obstacle', pending?.question.word ?? null, null);
  }
}

function collectPickups() {
  const got = pickups.collect(player);
  if (!got.length) return;

  let enteredBonus = false;

  for (const kind of got) {
    if (kind === PICKUP.COIN) {
      // เก็บติดกันภายใน 0.55 วิ = ต่อ streak → เสียงไล่สูงขึ้นเรื่อย ๆ
      run.coinStreak = (run.time - run.lastCoinAt < 0.55) ? run.coinStreak + 1 : 0;
      run.lastCoinAt = run.time;
      run.coins += 1;
      run.score += CFG.coins.value * (run.bonus ? CFG.bonus.coinValueMultiplier : 1);
      sfx.coin(run.coinStreak);

    } else if (kind === PICKUP.STAR) {
      run.stars += 1;
      sfx.star(run.stars, CFG.stars.needed);
      hud.setStars(run.stars, CFG.stars.needed);
      if (!run.bonus && !enteredBonus && run.stars >= CFG.stars.needed) enteredBonus = true;

    } else {
      run.jets = Math.min(CFG.powerup.maxCharges, run.jets + 1);
      sfx.jetPickup();
      hud.toast('ได้ไอพ่นสำรอง — ตอบผิดครั้งหน้าจะไม่ตาย', 1800);
    }
  }

  hud.setCoins(run.coins);
  hud.setJets(run.jets);
  hud.setScore(run.score, run.gates, run.combo);

  // เข้าด่านโบนัสหลังประมวลผลของที่เก็บได้ทั้งหมดในเฟรมนี้เสร็จก่อน
  // (enterBonus ล้าง pool ทิ้ง ถ้าเรียกกลางลูปจะทำให้ของที่เหลือหายไปเฉย ๆ)
  if (enteredBonus) enterBonus();
}

/* ── วงจรหลัก ────────────────────────────────────────────── */

function update(dt) {
  if (state === 'running') {
    run.time += dt;
    run.speed = Math.min(CFG.speed.max, CFG.speed.start + CFG.speed.accel * run.time);
    run.invuln = Math.max(0, run.invuln - dt);

    if (run.bonus) bonusDirector(dt);
    else runDirector();

    player.update(dt, sfx);
    gates.update(dt, run.speed);
    obstacles.update(dt, run.speed);
    pickups.update(dt, run.speed);
    world.update(dt, run.speed, player.x());
    updateAmbience(run.speed);

    collectPickups();
    checkGates();
    if (state !== 'running') return;    // ตายไปแล้วในเฟรมนี้
    checkHazards();

    hud.setActiveLane(player.nearestLane());

    const pending = gates.pending();
    const ratio = pending && pending.spawnZ ? pending.z() / pending.spawnZ : 0;
    hud.setTimer(ratio);

    // โหมดฟัง: เล่นซ้ำอีกครั้งตอนเวลาเหลือครึ่ง — ครั้งเดียวไม่พอสำหรับคำที่ไม่คุ้น
    if (pending && !run.audioReplayed && pending.question.mode === 'audio'
        && ratio < CFG.question.audioReplayAt) {
      run.audioReplayed = true;
      speak(pending.question.word.en, { rate: 0.8 });
    }
    return;
  }

  if (state === 'dying') {
    dyingTimer += dt;
    run.speed *= Math.max(0, 1 - dt * 3.5);      // โลกค่อย ๆ หยุด ให้ตารับรู้ว่าเกิดอะไรขึ้น
    player.update(dt, null);
    gates.update(dt, run.speed);
    obstacles.update(dt, run.speed);
    pickups.update(dt, run.speed);
    world.update(dt, run.speed, player.x());

    if (dyingTimer > 0.6) {
      state = 'dead';
      hud.hide();
      ui.showDeath(deathInfo);
    }
    return;
  }

  // เมนู/สถิติ/พัก: ให้ทางเดินไหลช้า ๆ เป็นฉากหลังที่มีชีวิต
  const idleSpeed = state === 'paused' ? 0 : 6;
  world.update(dt, idleSpeed, player.x());
  if (state !== 'paused') player.update(dt, null);
}

let lastFrame = performance.now();

function frame(now) {
  requestAnimationFrame(frame);

  // ⚠️ ต้อง clamp dt เสมอ: ถ้าสลับแท็บไปนานแล้วกลับมา dt จะพุ่งเป็นหลายวินาที
  // วัตถุจะกระโดดข้ามระนาบด่านไปเลยโดยไม่มีการตรวจการชน (tunneling)
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  update(dt);
  world.render();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'running') pauseGame();
  lastFrame = performance.now();
});

/* ── เริ่มระบบ ───────────────────────────────────────────── */

async function selectDeck(file) {
  deck = await loadDeck(file);
  pendingRetryWord = null;
  ui.setDeckInfo(deck);
  hud.setBest(srs.getBest(deck.id).score);
}

async function loadJokes() {
  try {
    const res = await fetch('./decks/jokes-th.json', { cache: 'no-store' });
    if (!res.ok) return;
    jokes = (await res.json()).jokes ?? [];
  } catch (err) {
    // ไม่มีมุกก็เล่นได้ ด่านโบนัสจะกลายเป็นการกวาดเหรียญล้วน ๆ
    console.warn('[bonus] โหลดมุกกวนไม่ได้ — ด่านโบนัสจะไม่มีคำถาม:', err);
  }
}

async function boot() {
  const prefs = ui.audioPrefs();
  setSfxEnabled(prefs.sfx);
  setSpeechEnabled(prefs.speech);
  loadJokes();

  try {
    const index = await loadDeckIndex();
    const file = ui.fillDeckList(index);
    await selectDeck(file);
    state = 'menu';
    ui.show('menu');
  } catch (err) {
    console.error(err);
    // สาเหตุที่พบบ่อยที่สุดคือเปิดไฟล์ด้วยการดับเบิลคลิก (protocol file://)
    // ซึ่งเบราว์เซอร์จะบล็อก fetch ทุกอย่างด้วยเหตุผลด้านความปลอดภัย (CORS)
    document.getElementById('deck-info').innerHTML =
      `<span style="color:var(--danger)">โหลดชุดคำไม่ได้: ${err.message}</span><br>` +
      `ถ้าเปิดไฟล์ด้วยการดับเบิลคลิก (file://) จะโหลดไม่ได้ — ต้องรัน ` +
      `<code>python3 -m http.server 8080</code> ในโฟลเดอร์นี้ แล้วเปิด ` +
      `<code>http://localhost:8080</code>`;
    state = 'menu';
    ui.show('menu');
  }
}

/* ── ช่องทางดีบัก (มีเฉพาะตอนรันบน localhost) ─────────────────
 * requestAnimationFrame จะ "หยุดสนิท" เมื่อแท็บถูกซ่อน ซึ่งเป็นพฤติกรรมที่ถูกต้อง
 * แต่ทำให้ทดสอบยากตอนอยากรู้ว่าอีก 10 วินาทีข้างหน้าเกมจะเป็นยังไง
 * ตัวช่วยนี้ให้ "เดินเกมทีละเฟรมด้วยมือ" ได้ เช่น
 *     vocabRunner.startRun(); vocabRunner.step(600)   // เดินไป 10 วินาที
 */
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.vocabRunner = {
    startRun,
    getState: () => state,
    getRun: () => run,
    getPlayer: () => player,
    getPickups: () => pickups,
    /** กระโดดเข้าด่านโบนัสทันที (ไม่ต้องไล่เก็บดาว 5 ดวง) */
    forceBonus: () => { if (state === 'running' && !run.bonus) enterBonus(); },
    step(frames = 1, dt = 1 / 60) {
      for (let i = 0; i < frames; i++) update(dt);
      world.render();
      return {
        state,
        time: run ? Number(run.time.toFixed(2)) : null,
        gates: run?.gates, score: run?.score, coins: run?.coins, jets: run?.jets,
      };
    },
  };
}

boot();
requestAnimationFrame(frame);
