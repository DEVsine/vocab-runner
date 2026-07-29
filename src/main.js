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
import { createTrainPool, TRAIN } from './trains.js';
import { createPickupPool, PICKUP } from './pickups.js';
import { planBonus } from './bonus.js';
import { createHUD } from './hud.js';
import { createUI } from './ui.js';
import { createInput, ACTIONS } from './input.js';
import { createNet } from './net.js';
import { createGhosts } from './ghosts.js';
import { themeById } from './themes.js';
import { wallet } from './wallet.js';
import { characterById } from './characters.js';
import { pickPracticeWords, buildPracticeQueue } from './practice.js';
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
const trains = createTrainPool(world.scene);
const pickups = createPickupPool(world.scene);
const ghosts = createGhosts(world.scene);
const hud = createHUD();

/** boot | menu | lobby | countdown | running | dying | dead | paused | stats */
let state = 'boot';
let deck = null;
let run = null;
let deathInfo = null;
let dyingTimer = 0;
let pendingRetryWord = null;   // คำที่ทำให้ตายรอบก่อน → เป็นด่านแรกของรอบถัดไป
let jokes = [];                // มุกกวนสำหรับด่านโบนัส

/* ── สถานะโหมดแข่งหลายคน ─────────────────────────────────── */
const net = createNet();
let mpActive = false;          // อยู่ในรอบแข่งที่มีห้อง (ต้อง broadcast + โชว์ leaderboard)
let mpRoster = [];             // roster ล่าสุดจาก host
let mpFinished = false;        // รอบนี้เราจบ (ตาย) แล้วหรือยัง
let mpRoundOver = false;       // มีผู้ชนะแล้ว — หยุดรับผลใหม่ รอกลับห้อง
let mpBroadcastAt = 0;         // เวลาล่าสุดที่ส่งสถานะ (throttle)
let countdownTimer = null;
let winnerTimer = null;

/* ── หน้าจอ/เมนู ─────────────────────────────────────────── */

const ui = createUI({
  onStart: () => retry(),                 // เมนู=เล่นเดี่ยว, จอตายในโหมดแข่ง=กลับห้อง
  onMenu: () => leaveToMenu(),
  onResume: () => resumeGame(),
  onDeckChange: (file) => selectDeck(file),
  onThemeChange: (id) => applyTheme(id),
  onCharacterChange: (id) => player.applySkin(id),
  onSpeakWord: (w) => { unlockAudio(); if (w) speak(w.en, { rate: 0.9 }); },
  onPracticeRun: (words) => startPracticeRun(words),
  onPracticeAgain: () => openPracticeTeach(),
  onOpenMultiplayer: () => openMultiplayer(),
  onMPCreate: (name) => mpCreate(name),
  onMPJoin: (name, code) => mpJoin(name, code),
  onMPStart: () => mpStart(),
  onMPLeave: () => leaveToMenu(),
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
      if (action === ACTIONS.CONFIRM) retry();
      else if (action === ACTIONS.BACK) leaveToMenu();
      break;
    case 'stats':
      if (action === ACTIONS.BACK || action === ACTIONS.CONFIRM) toMenu();
      break;
    case 'teach':
    case 'practiceDone':
      if (action === ACTIONS.BACK) toMenu();
      break;
    case 'spectate':
      if (action === ACTIONS.BACK) toLobby();
      break;
    case 'paused':
      if (action === ACTIONS.BACK || action === ACTIONS.CONFIRM) resumeGame();
      break;
    case 'running':
      if (action === ACTIONS.BACK) pauseGame();
      else if (action === ACTIONS.CONFIRM) equipJet();   // Space/Enter/แตะจอ = ใส่ไอพ่น
      else player.handle(action, sfx);
      break;
    default:
      break;
  }
});

/* ── การเปลี่ยนสถานะ ─────────────────────────────────────── */

/** ทาธีมทั้งโลก: ฉาก + สิ่งกีดขวาง + ป้ายด่านโบนัสประจำธีม */
function applyTheme(id) {
  const t = themeById(id);
  world.applyTheme(id);
  obstacles.applyTheme(t);
  hud.setBonusFlavor(t.bonus.title, t.bonus.sub);
}

function toMenu() {
  stopSpeaking();
  stopAmbience();
  state = 'menu';
  hud.hide();
  hud.showSpectate(false);
  // ล็อบบี้โชว์ตัวละคร (สไตล์ Fortnite): กล้องหันเข้าหน้าตัวละครบนแท่นเรืองแสง
  player.reset();
  player.applySkin(wallet.selected());
  player.setShowcase(true);
  player.group.visible = true;
  world.setLobbyView(true);
  world.setEnvironment('corridor');
  ui.refreshIdentity();
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
  trains.reset();
  pickups.reset();
  if (!mpActive) ghosts.reset();   // เล่นเดี่ยวต้องไม่มีโกสต์ค้างจากรอบแข่ง
  player.reset();
  player.applySkin(wallet.selected());
  player.group.visible = true;
  player.setSelfMarker(mpActive);  // โหมดแข่ง: ลูกศร "คุณ" เหนือหัว แยกตัวเองจากโกสต์
  world.setLobbyView(false);
  hud.showSpectate(false);

  run = {
    practice: null,                // โหมดฝึก: { queue, words } — ตั้งค่าโดย startPracticeRun
    time: 0,
    speed: CFG.speed.start,
    score: 0,
    gates: 0,
    combo: 1,
    coins: 0,
    jets: 0,
    jetArmed: false,       // ไอพ่นต้อง "กดใส่" เองถึงจะกันตาย (Space/แตะจอ)
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
  hud.setJets(0, false);
  hud.setStars(0, CFG.stars.needed);
  hud.setBonusTimer(null);
  hud.hideBonusBanner();
  hud.setBest(srs.getBest(deck.id).score);
  hud.clearQuestion();
  hud.setQuestionVisible(true);    // เผื่อรอบก่อนจบตอนอยู่ในโบนัส (ยังซ่อน UI ค้างอยู่)
  hud.setActiveLane(1);
  state = 'running';
  startAmbience();
}

/* ══ โหมดฝึก: สอน 10 คำ → วิ่งกับคำชุดนั้น → สอนชุดถัดไป ═══════ */

function openPracticeTeach() {
  if (!deck) return;
  stopSpeaking();
  stopAmbience();
  hud.hide();
  state = 'teach';
  ui.showPracticeTeach(pickPracticeWords(deck));
}

function startPracticeRun(words) {
  startRun();
  const queue = buildPracticeQueue(words, { speechOk: isSpeechUsable() });
  run.practice = { words, queue, remaining: queue.length };
  hud.toast('โหมดฝึก — ตอบผิดไม่ตาย คำจะวนกลับมาให้ลองใหม่', 2600);
}

function practiceDone() {
  const words = run.practice.words;
  const coins = run.coins;
  wallet.deposit(coins);
  pendingRetryWord = null;
  stopSpeaking();
  stopAmbience();
  hud.hide();
  state = 'practiceDone';
  sfx.bonusStart();
  ui.showPracticeDone(words, coins);
}

/* ══ โหมดแข่งหลายคน (P2P) ═══════════════════════════════════
 * ปรัชญา: "โลกใครโลกมัน" — แต่ละเครื่องรันเกมของตัวเอง เราแค่ส่ง "สถานะสรุป"
 * (คะแนน/ด่าน/รอด-ตาย) ให้กันสด ๆ ผ่าน net.js แล้วเอามาวาดเป็นตารางคะแนน
 * ข้อดีคือไม่ต้องรื้อ engine ให้ deterministic — ดูเหตุผลเต็มใน net.js
 */

function setupNet() {
  net.on('roster', (players) => {
    mpRoster = players;
    if (state === 'lobby') ui.mpRenderPlayers(players, net.selfId());
    hud.setLeaderboard(players, net.selfId());
    // อัปเดตโกสต์ของเพื่อนทันทีที่ได้ตำแหน่งใหม่ (รวมตอนเป็นผู้ชมหลังตกรอบด้วย)
    if (mpActive && (state === 'running' || state === 'dying' || state === 'dead' || state === 'spectate')) {
      ghosts.sync(players, net.selfId());
    }
  });
  net.on('start', (startMsg) => beginRace(startMsg));
  net.on('winner', (w) => onRoundWinner(w));
  net.on('attack', (from) => onAttacked(from));
  net.on('status', (msg) => ui.mpSetStatus(msg));
  net.on('error', (msg) => ui.mpSetStatus(msg, 'fail'));
  net.on('closed', () => {
    mpActive = false;
    mpFinished = false;
    mpRoundOver = false;
    clearInterval(countdownTimer);
    clearTimeout(winnerTimer);
    hud.countdown(null);
    hud.showWinner(null);
    hud.showLeaderboard(false);
    ghosts.reset();
    hud.hide();
    ui.mpResetLobby();
    ui.show('multiplayer');
    state = 'lobby';
    ui.mpSetStatus('หัวห้องปิดห้อง หรือหลุดการเชื่อมต่อ', 'fail');
  });
}

/**
 * โดนอาวุธ "ปลดเกราะ" จากคู่แข่ง (host เป็นคนเล็งเป้าให้ — เราแค่รับผล)
 * มีเกราะใส่อยู่ → เกราะหลุด | ไม่มีเกราะ → ม่านพลังงานโผล่ขวางเลนปัจจุบัน
 */
function onAttacked(from) {
  if (state !== 'running' || !run || run.bonus || mpFinished) return;
  if (run.jetArmed) {
    run.jetArmed = false;
    player.setArmed(false);
    hud.setJets(run.jets, false);
    sfx.laser();
    hud.toast(`⚔️ โดน ${from} ปลดเกราะ!`, 2000);
  } else {
    run.events.push({
      kind: 'obstacle', time: run.time + 1.6, type: 'barrier',
      lane: player.nearestLane(), lead: 1.3,
    });
    sfx.horn();
    hud.toast(`⚠️ ${from} ส่งม่านพลังงานมาขวางทาง!`, 2000);
  }
}

/**
 * Battle Royale จบรอบ: host ประกาศผู้รอดคนสุดท้าย → ทุกเครื่องโชว์ป้ายผู้ชนะ
 * ค้างไว้ 3.2 วิ แล้วพากลับห้องอัตโนมัติ (host กดเริ่มรอบใหม่ได้เลย)
 */
function onRoundWinner(w) {
  if (!mpActive || mpRoundOver) return;
  mpRoundOver = true;

  stopSpeaking();
  if (state === 'running' || state === 'spectate') {
    // รอบจบขณะยังวิ่ง/ดูอยู่ — พักโลกไว้เฉย ๆ (สถานะ countdown ไม่มีการชน/ตัดสินใด ๆ)
    stopAmbience();
    hud.showSpectate(false);
    state = 'countdown';
  }

  let text;
  if (w.team != null || Array.isArray(w.winnerIds)) {
    // โหมดทีม: ชนะทั้งทีม (สมาชิกที่ตายก่อนก็ร่วมฉลองด้วย)
    const mine = w.winnerIds?.includes(net.selfId());
    const names = (w.names || []).join(' + ');
    text = w.winnerIds?.length
      ? (mine ? `🏆 ทีมคุณชนะ! (${names})` : `🏆 ทีม ${(w.team ?? 0) + 1} ชนะ! (${names})`)
      : 'รอบนี้ไม่มีทีมรอด — เสมอกัน!';
  } else {
    const isMe = w.id && w.id === net.selfId();
    text = isMe
      ? '🏆 คุณคือผู้รอดคนสุดท้าย!'
      : (w.id ? `🏆 ${w.name} คือผู้รอดคนสุดท้าย!` : 'รอบนี้ไม่มีผู้รอด — เสมอกัน!');
  }
  hud.showWinner(text);
  sfx.bonusStart();   // แตรฉลองที่มีอยู่แล้ว ใช้ซ้ำได้พอดี

  clearTimeout(winnerTimer);
  winnerTimer = setTimeout(() => {
    hud.showWinner(null);
    toLobby();
  }, 3200);
}

function openMultiplayer() {
  stopSpeaking();
  stopAmbience();
  hud.hide();
  hud.showLeaderboard(false);
  ui.mpResetLobby();
  ui.show('multiplayer');
  state = 'lobby';
  if (!net.supported()) {
    ui.mpSetStatus('เบราว์เซอร์นี้ต่อ P2P ไม่ได้ (โหลดไลบรารีเชื่อมต่อไม่สำเร็จ)', 'fail');
  }
}

function mpCreate(name) {
  ui.mpSetStatus('กำลังสร้างห้อง…');
  net.host(name, (code) => ui.mpEnterRoom(code, true));
}

function mpJoin(name, code) {
  ui.mpSetStatus('กำลังเข้าห้อง…');
  net.join(code, name, (code2) => ui.mpEnterRoom(code2, false));
}

/** หัวห้องกดเริ่ม → กระจาย deck + โหมด (เดี่ยว/ดูโอ้/สควอด) ให้ทุกคนเริ่มพร้อมกัน */
function mpStart() {
  net.startRace(ui.selectedDeckFile(), ui.mpMode());
}

const MODE_LABEL = { solo: '👤 เดี่ยว — ตัวใครตัวมัน', duo: '👥 ดูโอ้ — ทีมละ 2', squad: '👨‍👩‍👧‍👦 สควอด — ทีมละ 4' };

/** เริ่มรอบแข่ง: โหลด deck ของหัวห้อง → นับถอยหลัง → ออกตัวพร้อมกัน */
async function beginRace(startMsg) {
  clearInterval(countdownTimer);
  clearTimeout(winnerTimer);
  hud.showWinner(null);
  mpActive = true;
  mpFinished = false;
  mpRoundOver = false;
  pendingRetryWord = null;      // เริ่มแข่งใหม่ต้องสะอาด ไม่เอาคำที่พลาดจากรอบเดี่ยวมาปน
  try {
    if (startMsg?.deck) deck = await loadDeck(startMsg.deck);
  } catch (err) {
    console.warn('[mp] โหลด deck ของหัวห้องไม่ได้ — ใช้ deck เดิมแทน', err);
  }
  ui.hideAll();
  hud.showLeaderboard(true);
  hud.setLeaderboard(mpRoster, net.selfId());
  state = 'countdown';
  runCountdown(() => {
    startRun();
    const label = MODE_LABEL[startMsg?.mode] || MODE_LABEL.solo;
    hud.toast(`${label} — ผู้รอด(ทีม)สุดท้ายชนะ!`, 2400);
  });
}

function runCountdown(done) {
  let n = 3;
  hud.countdown(n);
  sfx.select();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) { hud.countdown(n); sfx.select(); }
    else { clearInterval(countdownTimer); hud.countdown(null); done(); }
  }, 850);
}

/** กลับเข้าล็อบบี้หลังจบรอบ (ยังอยู่ในห้อง) — หัวห้องกดเริ่มรอบใหม่ได้ */
function toLobby() {
  stopSpeaking();
  stopAmbience();
  clearInterval(countdownTimer);
  clearTimeout(winnerTimer);
  hud.countdown(null);
  hud.showWinner(null);
  hud.hide();
  hud.showSpectate(false);
  hud.showLeaderboard(false);
  ghosts.reset();
  mpFinished = false;
  mpRoundOver = false;
  net.sendState({ score: 0, gates: 0, coins: 0, alive: false, finished: false });  // ล้างคะแนนเก่าใน roster
  ui.mpEnterRoom(net.code(), net.amHost());
  ui.mpRenderPlayers(mpRoster, net.selfId());
  ui.show('multiplayer');
  state = 'lobby';
}

/** ปุ่ม "เล่นอีกครั้ง": โหมดแข่ง=กลับห้อง, เล่นเดี่ยว=เริ่มรอบใหม่ทันที */
function retry() {
  if (mpActive) toLobby();
  else startRun();
}

/** ออกจากทุกอย่างกลับเมนู — ถ้าอยู่ในห้องต้องตัดการเชื่อมต่อก่อน */
function leaveToMenu() {
  if (net.isConnected()) net.leave();
  mpActive = false;
  mpFinished = false;
  mpRoundOver = false;
  clearInterval(countdownTimer);
  clearTimeout(winnerTimer);
  hud.countdown(null);
  hud.showWinner(null);
  hud.showLeaderboard(false);
  ghosts.reset();
  toMenu();
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
  let question;
  if (run.practice) {
    // โหมดฝึก: หยิบข้อจากคิว "ตอน spawn" แล้วผูกไว้กับโจทย์เลย
    // (ห้ามอ่าน queue[0] เฉย ๆ — director อาจ spawn ด่านถัดไปก่อนด่านแรกถูกตัดสิน
    //  ถ้าสองด่านชี้ entry เดียวกัน การนับจบชุดจะเพี้ยนทันที)
    const entry = run.practice.queue.shift();
    question = buildQuestion(deck, entry.word, { speechEnabled: isSpeechUsable() });
    question.mode = entry.mode;
    question.practiceEntry = entry;
  } else {
    const word = run.forcedWord || pickWord(deck, run.recent);
    run.forcedWord = null;
    question = buildQuestion(deck, word, { speechEnabled: isSpeechUsable() });
  }
  const word = question.word;
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
  const practice = !!run.practice;
  const rule = obstacleRuleFor(practice ? 0 : run.gates);
  const start = gateArrival + CFG.pacing.obstacleEdgeMargin;
  const end = gateArrival + CFG.pacing.breatherSeconds - CFG.pacing.obstacleEdgeMargin;
  if (end <= start) return;

  // ── ยานลำเลียง (RIDE) ตัดสินใจ "ก่อน" ของทุกอย่าง ──
  // เพราะยานยาวกินทั้งช่วงพัก เลนของมันต้องสงวนไว้: ห้ามมีสิ่งกีดขวาง/เหรียญพื้น/ดาว
  // (ของพวกนั้นจะไปอยู่ใต้ท้องยาน มองไม่เห็นและเก็บไม่ได้ = ดูเหมือนเกมพัง)
  let trainLane = -1;
  if (!practice && run.gates >= CFG.trains.rideAfterGates && Math.random() < CFG.trains.rideChance) {
    trainLane = Math.floor(Math.random() * CFG.world.laneCount);
    run.events.push({ kind: 'train', time: gateArrival + 0.55, lane: trainLane, lead: 1.7 });
  }

  const groundLanes = [0, 1, 2].filter(l => l !== trainLane);

  const waves = rule.waves[0] +
    Math.floor(Math.random() * (rule.waves[1] - rule.waves[0] + 1));

  for (let w = 0; w < waves; w++) {
    const slot = waves === 1 ? 0.5 : (w + 0.5) / waves;
    const time = start + (end - start) * slot;

    // ⚠️ กฎความปลอดภัย: ห้ามบล็อกครบทุกเลนพื้นในเวลาเดียวกันเด็ดขาด
    // และช่วงมียาน (เหลือเลนพื้นแค่ 2) จำกัดสิ่งกีดขวางไว้ 1 ชิ้น
    // → เส้นทางรอดมีเสมอ: เลนพื้นที่ว่าง หรือกระโดดขึ้นหลังคายาน
    const cap = trainLane >= 0 ? 1 : CFG.world.laneCount - 1;
    const simultaneous = Math.min(rule.simultaneous, cap, groundLanes.length - 1 || 1);
    const lanes = groundLanes.slice().sort(() => Math.random() - 0.5).slice(0, simultaneous);

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

  /** เลนนี้ว่างจากอันตรายในช่วงเวลานั้นไหม (เผื่อขอบไว้ ±0.5 วิ) */
  const laneFreeAt = (lane, time) => !run.events.some(
    e => e.kind === 'obstacle' && e.lane === lane && Math.abs(e.time - time) < 0.5
  );

  // ── ยานวิ่งสวน (ONCOMING) — ความตื่นเต้นหลังผู้เล่นเริ่มอยู่ตัว ──
  if (!practice && run.gates >= CFG.trains.oncomingAfterGates
      && Math.random() < CFG.trains.oncomingChance) {
    const time = gateArrival + CFG.pacing.breatherSeconds * 0.55;
    const cand = groundLanes.filter(l => laneFreeAt(l, time));
    if (cand.length) {
      run.events.push({
        kind: 'oncoming',
        time,
        lane: cand[Math.floor(Math.random() * cand.length)],
        lead: CFG.trains.hornLeadSeconds,
      });
    }
  }

  if (Math.random() > CFG.coins.chancePerBreather) return;

  /** วางเหรียญ 1 แถวในเลนที่กำหนด — คืนเวลาของเหรียญเม็ดสุดท้าย */
  const pushCoinRow = (lane, t0, n) => {
    let last = t0;
    for (let i = 0; i < n; i++) {
      const time = t0 + i * CFG.coins.gapSeconds;
      // เว้นช่องตรงที่มีอันตราย → แถวเหรียญขาดเป็นช่วงตรงจุดที่ต้องหลบพอดี
      // กลายเป็นการ "สอนจังหวะ" โดยไม่ต้องมีข้อความบอก
      if (!laneFreeAt(lane, time)) continue;
      run.events.push({ kind: 'coin', time, lane, lead: CFG.coins.lead });
      last = time;
    }
    return last;
  };

  const n = CFG.coins.runMin + Math.floor(Math.random() * (CFG.coins.runMax - CFG.coins.runMin + 1));
  const t0 = gateArrival + 0.45;
  const lane = groundLanes[Math.floor(Math.random() * groundLanes.length)];
  const lastCoinTime = pushCoinRow(lane, t0, n);

  // แถวที่สองอีกเลน (เหลื่อมเวลานิดหน่อยให้ตาไล่ทัน) — "เก็บเงินเพลิน" ต้องมีให้เลือกทาง
  if (Math.random() < CFG.coins.doubleLaneChance && groundLanes.length > 1) {
    const others = groundLanes.filter(l => l !== lane);
    pushCoinRow(others[Math.floor(Math.random() * others.length)], t0 + 0.3, Math.max(3, n - 2));
  }

  // ไอพ่นสำรองวางไว้ท้ายแถวเหรียญ = รางวัลของคนที่เก็บจนจบแถว
  // (โหมดฝึกไม่มีของตาย จึงไม่ต้องมีเกราะ/ดาวสะสมมากวนสมาธิ)
  if (!practice && Math.random() < CFG.powerup.chancePerBreather && laneFreeAt(lane, lastCoinTime + 0.3)) {
    run.events.push({ kind: 'jet', time: lastCoinTime + 0.3, lane, lead: CFG.powerup.lead });
  }

  // ดาวสะสม — วางเฉพาะเลนพื้นที่ว่างจริง ๆ (ใต้ท้องยานคือจุดบอด)
  if (!practice && run.stars < CFG.stars.needed && Math.random() < CFG.stars.chancePerBreather) {
    const starTime = gateArrival + CFG.pacing.breatherSeconds * 0.62;
    const free = groundLanes.filter(l => laneFreeAt(l, starTime));
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
  // โหมดฝึก: เวลาคิดกว้างสุดตลอด (ระดับความยากของเกมจริงไม่เกี่ยวกับการสอนคำใหม่)
  const windowSeconds = answerWindowFor(run.practice ? 0 : run.gates);

  // โหมดฝึก: คิวหมดชั่วคราว (ทุกข้อกำลังรอตัดสิน/รอวนกลับ) → เว้นการ spawn ด่านไว้ก่อน
  const gateReady = !run.gateSpawned && run.time >= run.nextGateArrival - windowSeconds
    && !(run.practice && !run.practice.queue.length);

  if (gateReady) {
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
    else if (ev.kind === 'train') {
      trains.spawn(TRAIN.RIDE, ev.lane, z);
      // แถวเหรียญบนหลังคา — วาง "เชิงเรขาคณิต" ตามความยาวยาน (ไม่ใช่ตามเวลา)
      // เพราะเหรียญกับยานเคลื่อนด้วยความเร็วเดียวกัน ระยะบนหลังคาจึงคงที่ตลอด
      const L = CFG.trains.length;
      const nCoins = CFG.trains.roofCoins;
      for (let k = 0; k < nCoins; k++) {
        const zi = z - 1.6 - k * ((L - 3.2) / (nCoins - 1));
        pickups.spawnCoin(ev.lane, zi, CFG.trains.roofY + 0.95);
      }
    } else if (ev.kind === 'oncoming') {
      // ยานสวนวิ่งเร็วกว่าโลก: ระยะเกิด = ระยะโลกเลื่อน + ระยะที่ยานวิ่งเอง
      trains.spawn(TRAIN.ONCOMING, ev.lane,
        -(distanceOver(ev.lead) + CFG.trains.oncomingExtraSpeed * ev.lead));
      sfx.horn();              // หวูดเตือนพร้อมไฟหน้า — ผู้เล่นมีเวลาหลบ ~1.5 วิ
    } else pickups.spawnJet(ev.lane, z);

    run.events.splice(i, 1);
  }
}

/* ══ ด่านโบนัส "ทางช้างเผือก" ═══════════════════════════════ */

function enterBonus() {
  // ล้างทุกอย่างของโหมดปกติทิ้ง — ห้ามมีอันตรายค้างข้ามเข้ามาในด่านโบนัสเด็ดขาด
  run.events = [];
  gates.reset();
  obstacles.reset();
  trains.reset();
  player.setPlatform(0);   // ถ้ากำลังยืนบนหลังคาอยู่ ให้ฐานกลับพื้นก่อนทะยานขึ้น
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
  hud.setQuestionVisible(false);   // โบนัสไม่มีคำถาม → ซ่อนกล่องโจทย์+ธงให้จอโล่ง
  hud.showBonusBanner();
  hud.toast('← → กวาดเก็บเหรียญให้ครบ — ที่นี่ไม่มีอะไรทำอันตรายคุณได้', 3200);
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
      // บินระดับเดียว: เหรียญทุกใบต้องอยู่ที่ระดับกลางลำตัวของชั้นบินล่างเสมอ
      // (ไม่สนใจ ev.high อีกต่อไป) — เพราะปิดปุ่มขึ้น/ลงแล้ว ถ้าวางเหรียญไว้ชั้นบน
      // ผู้เล่นจะไม่มีทางขึ้นไปเก็บได้ กลายเป็นเหรียญหลอกที่น่าหงุดหงิด
      const y = CFG.bonus.singleLevel
        ? CFG.bonus.flyLowY + 0.8
        : (ev.high ? CFG.bonus.flyHighY : CFG.bonus.flyLowY) + 0.8;
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
  hud.setQuestionVisible(true);    // กลับเข้าโหมดปกติ → โชว์กล่องโจทย์+ธงอีกครั้ง
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

/**
 * กด "ใส่" ไอพ่นจากคลัง (Space/Enter/แตะจอ ระหว่างวิ่ง)
 * ใส่แล้วมีเปลวที่หลังตลอด และกันตายได้ 1 ครั้ง — ทุกสาเหตุ (ตอบผิด/ชนของ/ชนยาน)
 * ⚠️ เก็บมาเฉย ๆ โดยไม่ใส่ = ไม่กันอะไรเลย ชนแล้วตายปกติ (นี่คือการตัดสินใจของผู้เล่น)
 */
function equipJet() {
  if (!run || run.bonus) return;
  if (run.jetArmed) { hud.toast('ไอพ่นใส่อยู่แล้ว', 900); return; }
  if (run.jets <= 0) return;
  run.jets -= 1;
  run.jetArmed = true;
  player.setArmed(true);
  sfx.jetEquip();
  hud.setJets(run.jets, true);
  hud.toast(`${armorEmoji()} ใส่${armorName()}แล้ว — กันตายได้ 1 ครั้ง`, 1600);
}

/** ไอพ่นที่ใส่อยู่ช่วยชีวิตจากการ "ชน" (สิ่งกีดขวาง/ยาน) — พุ่งข้ามแล้วเปลวดับ */
function rescueWithJet(message) {
  run.jetArmed = false;
  player.setArmed(false);
  run.combo = 1;
  run.invuln = CFG.powerup.invulnMs / 1000;
  player.boost();
  sfx.jetUse();
  hud.setJets(run.jets, false);
  hud.setScore(run.score, run.gates, run.combo);
  hud.toast(message, 2000);
}

/** ตอบผิดแต่ "ใส่ไอพ่นไว้" → พุ่งข้ามลำแสง แต่ยังนับว่าตอบผิดอยู่ */
function saveWithJet(gate) {
  const q = gate.question;
  run.jetArmed = false;
  player.setArmed(false);
  run.combo = 1;
  run.invuln = CFG.powerup.invulnMs / 1000;

  srs.record(deck.id, q.word.en, false);   // เชิงเกมรอด แต่เชิงการเรียนรู้ไม่รอด
  pendingRetryWord = q.word;

  player.boost();
  sfx.jetUse();
  speak(q.word.en);

  hud.setJets(run.jets, false);
  hud.setScore(run.score, run.gates, run.combo);
  hud.toast(`${armorEmoji()} ${armorName()}ช่วยไว้! คำที่ถูกคือ "${q.word.en}" = ${q.word.th}`, 2200);
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
  wallet.deposit(run.coins);        // เหรียญที่เก็บได้เข้ากระเป๋าถาวรเสมอ — ตายก็ไม่สูญเปล่า

  deathInfo = {
    cause,
    word,
    chosen,
    score: run.score,
    gates: run.gates,
    coins: run.coins,
    best: srs.getBest(deck.id).score,
  };

  // โหมดแข่ง: ส่งคะแนนสุดท้าย + สถานะ "ตายแล้ว" (ล็อกอันดับในตารางคะแนน)
  if (mpActive && !mpFinished) {
    mpFinished = true;
    net.sendState({ score: run.score, gates: run.gates, coins: run.coins, alive: false, finished: true });
  }

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
    hud.revealMeanings(q.options);   // เผยคำแปลไทยใต้ทุกธง — ปิดวงจร "เห็นคำ↔รู้ความหมาย"
    hud.setTimer(0);
    sfx.laser();

    // ── โหมดฝึก: ไม่มีการตาย — ผิดแล้วคำวนกลับมาให้ลองใหม่จนกว่าจะได้ ──
    if (run.practice) {
      if (correct) {
        passGate(gate);
        run.practice.remaining -= 1;
        if (run.practice.remaining <= 0) { practiceDone(); return; }
      } else {
        srs.record(deck.id, q.word.en, false);
        run.combo = 1;
        run.invuln = 1.2;
        run.practice.queue.push(q.practiceEntry);   // วนกลับไปท้ายคิว (remaining คงเดิม)
        speak(q.word.en);
        hud.toast(`ยังไม่ใช่ — "${q.word.en}" = ${q.word.th} (เดี๋ยวเจอกันอีกรอบ)`, 2400);
        hud.setScore(run.score, run.gates, run.combo);
      }
      continue;
    }

    if (correct) {
      passGate(gate);
      // ⚔️ อาวุธปลดเกราะ (โหมดแข่ง): คอมโบ ≥3 ยิงใส่ "ผู้นำคะแนน" ฝั่งตรงข้าม
      if (mpActive && !mpFinished && run.combo >= 3
          && performance.now() - (run.lastAttackAt || 0) > 7000) {
        run.lastAttackAt = performance.now();
        net.sendAttack();
        hud.toast('⚔️ คอมโบแรง! ส่งโจมตีปลดเกราะไปหาผู้นำ', 1500);
      }
    } else if (run.jetArmed) {
      saveWithJet(gate);      // ต้อง "ใส่" ไว้ก่อนเท่านั้น — มีในคลังเฉย ๆ ไม่ช่วย
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
    // โหมดฝึก: ชนแล้วสะดุ้งแต่ไม่ตาย — ที่นี่มีไว้เรียนคำ ไม่ใช่วัดฝีมือหลบ
    if (run.practice) {
      world.shake(0.7);
      sfx.crash();
      run.invuln = 1.4;
      run.combo = 1;
      hud.toast('ชน! ไม่เป็นไร ฝึกต่อ', 1200);
      return;
    }
    if (run.jetArmed) { rescueWithJet(`${armorEmoji()} ${armorName()}ช่วยไว้! รอดจากการชน`); return; }
    const pending = gates.pending();
    die('obstacle', pending?.question.word ?? null, null);
  }
}

/** ชื่อ/อีโมจิของ "เกราะกันตาย" ตามตัวละครที่ใส่ (astro=ไอพ่น, ตัวอื่น=อาวุธประจำตัว) */
function armorName() { return characterById(wallet.selected()).weapon; }
function armorEmoji() { return characterById(wallet.selected()).weaponEmoji; }

/**
 * ยานลำเลียง: ตัดสิน 3 อย่างต่อเฟรม — ขึ้นหลังคา / ชนตัวยาน / โดนยานสวน
 *
 * เกณฑ์ขึ้นหลังคา: ตัวอยู่สูงถึง (roofY − 0.55) ตอนที่ช่วงตัวยานคร่อมเรา = เหยียบได้
 * ต่ำกว่านั้น = พุ่งเข้าข้างตัวยาน — มี grace ช่วงหัวยานเพิ่งถึง (กำลังกระโดดขาขึ้นพอดี)
 */
function checkTrains() {
  if (run.bonus) return;
  const px = player.x();

  const surf = trains.rideSurface(px);
  if (surf) {
    const py = player.group.position.y;
    if (py >= CFG.trains.roofY - 0.55) {
      if (!player.onPlatform()) sfx.mount();     // จังหวะเท้าแตะหลังคาครั้งแรก
      player.setPlatform(surf.roofY);
    } else if (surf.enteredBy > CFG.trains.mountGrace
               && run.invuln <= 0 && !player.isBoosting()) {
      if (run.practice) { world.shake(0.7); run.invuln = 1.4; return; }
      if (run.jetArmed) { rescueWithJet(`${armorEmoji()} ${armorName()}ช่วยไว้! พุ่งข้ามยานลำเลียง`); return; }
      const pending = gates.pending();
      die('obstacle', pending?.question.word ?? null, null);
      return;
    }
  } else {
    player.setPlatform(0);
  }

  if (run.invuln > 0 || player.isBoosting()) return;
  if (trains.oncomingHit(px)) {
    if (run.jetArmed) { rescueWithJet(`${armorEmoji()} ${armorName()}ช่วยไว้! เฉียดยานสวนนิดเดียว`); return; }
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
      hud.toast(`ได้${armorName()}! กด Space หรือแตะจอเพื่อ "ใส่" — ใส่แล้วถึงจะกันตาย`, 2400);
    }
  }

  hud.setCoins(run.coins);
  hud.setJets(run.jets, run.jetArmed);
  hud.setScore(run.score, run.gates, run.combo);

  // เข้าด่านโบนัสหลังประมวลผลของที่เก็บได้ทั้งหมดในเฟรมนี้เสร็จก่อน
  // (enterBonus ล้าง pool ทิ้ง ถ้าเรียกกลางลูปจะทำให้ของที่เหลือหายไปเฉย ๆ)
  if (enteredBonus) enterBonus();
}

/* ── วงจรหลัก ────────────────────────────────────────────── */

function update(dt) {
  ghosts.update(dt);   // โกสต์เพื่อนขยับทุกสถานะ — ตายแล้วก็ยังดูเพื่อนแข่งต่อได้ (spectate)

  if (state === 'running') {
    run.time += dt;
    run.speed = Math.min(CFG.speed.max, CFG.speed.start + CFG.speed.accel * run.time);
    if (run.practice) run.speed = Math.min(run.speed, 16);   // โหมดฝึกไม่เร่งจนอ่านไม่ทัน
    run.invuln = Math.max(0, run.invuln - dt);

    if (run.bonus) bonusDirector(dt);
    else runDirector();

    player.update(dt, sfx);
    gates.update(dt, run.speed);
    obstacles.update(dt, run.speed);
    trains.update(dt, run.speed);
    pickups.update(dt, run.speed);
    world.update(dt, run.speed, player.x());
    updateAmbience(run.speed);

    collectPickups();
    checkGates();
    if (state !== 'running') return;    // ตายไปแล้วในเฟรมนี้
    checkTrains();
    if (state !== 'running') return;
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

    // โหมดแข่ง: ส่งสถานะสรุปให้เพื่อน ~6–7 ครั้ง/วินาที (ถี่พอให้ลื่น เบาพอไม่ท่วมเน็ต)
    // lane/py = ตำแหน่งสำหรับวาดโกสต์ของเราในจอเพื่อน (โกสต์ฝั่งเราลื่นด้วย lerp ของเขา)
    if (mpActive && !mpFinished) {
      const now = performance.now();
      if (now - mpBroadcastAt > 150) {
        mpBroadcastAt = now;
        net.sendState({
          score: run.score, gates: run.gates, coins: run.coins,
          alive: true, finished: false,
          lane: player.nearestLane(), py: +player.group.position.y.toFixed(2),
        });
      }
    }
    return;
  }

  if (state === 'dying') {
    dyingTimer += dt;
    run.speed *= Math.max(0, 1 - dt * 3.5);      // โลกค่อย ๆ หยุด ให้ตารับรู้ว่าเกิดอะไรขึ้น
    player.update(dt, null);
    gates.update(dt, run.speed);
    obstacles.update(dt, run.speed);
    trains.update(dt, run.speed);
    pickups.update(dt, run.speed);
    world.update(dt, run.speed, player.x());

    if (dyingTimer > 0.6) {
      // โหมดแข่งที่รอบยังไม่จบ: ไม่ขึ้นจอตายบังวิว แต่เข้า "โหมดผู้ชม" —
      // ตกรอบแล้วยังนั่งดูโกสต์เพื่อนที่เหลือ + ตารางคะแนนสด จนกว่าจะมีผู้ชนะ
      if (mpActive && !mpRoundOver) {
        state = 'spectate';
        player.group.visible = false;    // ร่างเราออกจากสนามไปแล้ว
        hud.clearQuestion();
        hud.setQuestionVisible(false);
        hud.showSpectate(true);
        startAmbience();
      } else {
        state = 'dead';
        hud.hide();
        ui.showDeath(deathInfo);
      }
    }
    return;
  }

  if (state === 'spectate') {
    // โลกไหลต่อเบา ๆ ให้ของที่ค้างอยู่วิ่งพ้นจอไป (ไม่มีการชน/ไม่มีของเกิดใหม่)
    run.speed += (11 - run.speed) * Math.min(1, dt * 2);
    gates.update(dt, run.speed);
    obstacles.update(dt, run.speed);
    trains.update(dt, run.speed);
    pickups.update(dt, run.speed);
    world.update(dt, run.speed, 0);
    updateAmbience(run.speed);
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
  setupNet();
  loadJokes();

  window.__bootOk?.();   // บูตถึงจุดนี้ = โมดูลครบทุกไฟล์ → ล้างธง auto-reload ของตาข่ายกันแคชปน
  applyTheme(ui.selectedTheme());

  try {
    const index = await loadDeckIndex();
    const file = ui.fillDeckList(index);
    await selectDeck(file);
    toMenu();            // เข้าเมนูพร้อมฉากโชว์ตัวละคร
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
    getTrains: () => trains,
    equipJet,
    TRAIN,
    sfx,
    wallet,
    applyTheme,
    openPracticeTeach,
    startPracticeRun,
    pickPracticeWords: () => pickPracticeWords(deck),
    /** กระโดดเข้าด่านโบนัสทันที (ไม่ต้องไล่เก็บดาว 5 ดวง) */
    forceBonus: () => { if (state === 'running' && !run.bonus) enterBonus(); },
    // ── โหมดแข่ง (ใช้ทดสอบ 2 แท็บ) ──
    net,
    openMultiplayer, mpCreate, mpJoin, mpStart,
    getMpRoster: () => mpRoster,
    isMpActive: () => mpActive,
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
