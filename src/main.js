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
import { cheats } from './cheats.js';
import { characterById } from './characters.js';
import { pickPracticeWords, buildPracticeQueue } from './practice.js';
import { loadDeckIndex, loadDeck, pickWord, pickWordSeeded, buildQuestion, zoneDeck } from './deck.js';
import { stormLevel, stormPhase, drainOver } from './storm.js';
import { AMMO, AMMO_ORDER, ammoById } from './weapons.js';
import { addMissed, clearWords, pending as inboxPending, pendingCount } from './inbox.js';
import { mulberry32 } from './rng.js';
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
// ปุ่ม/แถวที่กดได้ทั้งหมดอยู่ใน HUD — ผูก handler ตรงนี้ที่เดียว
// (ฟังก์ชันด้านล่างเป็น function declaration จึงถูก hoist มาถึงตรงนี้แล้ว)
const hud = createHUD({
  onEquip: () => equipJet(),
  onFire: () => fireWeapon(),
  onCycleAmmo: () => cycleAmmo(),
  onSelectTarget: (id) => selectTarget(id),
  onContestPick: (i) => contestPick(i),
  onFlagPick: (i) => spectateGuess(i),
  onPause: () => pauseGame(),
  onLeaveSpectate: () => toLobby(),
  onForceBonus: () => forceBonusNow(),
});

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
let mpTarget = null;           // id ของคู่แข่งที่เราเล็งไว้ (แตะชื่อในตารางคะแนน)
let mpWatch = null;            // id ของคนที่เรากำลัง "สิง" อยู่ (เฉพาะตอนเป็นผู้ชม)
let mpLastSentQuestion = null; // โจทย์ล่าสุดที่ส่งให้ผู้ชมแล้ว (กันส่งซ้ำทุกเฟรม)
let watchQuestion = null;      // โจทย์ที่รับมาจากคนที่เราสิงอยู่

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
  onCheatsChanged: () => hud.setCheatVisible(cheats.enabled()),
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
      // ── ระหว่างศึกชิงคำ ปุ่มทุกปุ่มเปลี่ยนความหมาย ──
      // ซ้าย/ขวาเลือกคำตอบ, ยืนยันคือล็อกคำตอบ — ใช้ปุ่มเดิมที่นิ้วอยู่แล้ว
      // (การโผล่ปุ่มชุดใหม่กลางเกมวิ่งคือวิธีที่แน่นอนที่สุดที่จะทำให้คนกดผิด)
      if (run?.contest) {
        const c = run.contest;
        if (c.sent) break;
        if (action === ACTIONS.LEFT) hud.moveContestCursor(-1);
        else if (action === ACTIONS.RIGHT) hud.moveContestCursor(1);
        else if (action === ACTIONS.CONFIRM) contestPick(hud.contestCursor());
        break;
      }
      if (action === ACTIONS.BACK) pauseGame();
      else if (action === ACTIONS.CONFIRM) equipJet();   // Space/Enter/แตะจอ = ใส่ไอพ่น
      else if (action === ACTIONS.FIRE) fireWeapon();
      else if (action === ACTIONS.SWITCH) cycleAmmo();
      else player.handle(action, sfx);
      break;
    default:
      break;
  }
});

/* ── การเปลี่ยนสถานะ ─────────────────────────────────────── */

/**
 * 🧪 โหมดทดลอง: กระโดดเข้าด่านโบนัสประจำธีมทันที โดยไม่ต้องเก็บดาวครบ 5 ดวง
 *
 * ⚠️ ล็อกไว้ไม่ให้ใช้ในรอบชิงของ Battle Royale
 * เพราะรอบชิงคือ "แทร็กเดียวกันทุกคน" — คนที่หายไปลอยเก็บเหรียญ 14 วินาที
 * จะกลับมาอยู่คนละจุดของแทร็ก และภาพโกสต์ของทุกคนจะเพี้ยนตามไปด้วย
 */
function forceBonusNow() {
  if (!cheats.enabled()) return;
  if (state !== 'running' || !run || run.bonus || run.contest) return;
  if (run.finalRound) { hud.toast('รอบชิงใช้ปุ่มนี้ไม่ได้ — ทุกคนต้องอยู่บนแทร็กเดียวกัน', 2200); return; }
  run.stars = CFG.stars.needed;
  hud.setStars(run.stars, CFG.stars.needed);
  enterBonus();
}

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
  if (deck) {
    ui.setDeckInfo(deck);
    ui.setPracticeBadge(pendingCount(deck.id));
  }
  ui.show('menu');
}

/**
 * ⚠️ ในรอบแข่ง "หยุดเวลา" ไม่ได้ — ไม่ใช่เพราะกฎ แต่เพราะมันพังเชิงระบบ
 *
 * ตอน state === 'paused' วงจรหลักไม่เดิน → พายุไม่ไหลลง, ไม่ส่งสถานะให้เพื่อน,
 * และ host จะไม่มีวันเห็นเราตาย → คนที่กดพักกลายเป็นคนที่ "ฆ่าไม่ได้"
 * และรอบนั้นจะไม่มีวันประกาศผู้ชนะ = ทุกคนในห้องค้างรอคนคนเดียว
 *
 * กดพักในรอบแข่งจึงหมายถึง "ออกจากรอบ" (ตกรอบทันที) — ตรงไปตรงมาและยุติธรรมกับทุกคน
 */
function inLiveRace() {
  return mpActive && !mpFinished && !mpRoundOver && (state === 'running' || state === 'countdown');
}

function pauseGame() {
  if (state !== 'running') return;
  if (inLiveRace()) { quitRace(); return; }
  state = 'paused';
  stopSpeaking();
  stopAmbience();
  ui.show('pause');
}

/** ออกจากรอบแข่งกลางคัน = ยอมตกรอบ (ไม่นับเป็นตอบผิด ไม่แตะสถิติคำ) */
function quitRace() {
  if (!run || mpFinished) return;
  hud.toast('ออกจากรอบแล้ว — โหมดแข่งหยุดเวลาไม่ได้', 2200);
  die('quit', null, null);
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'running';
  ui.hideAll();
  startAmbience();
}

function startRun() {
  // ⚠️ ห้าม return เฉย ๆ: beginRace ตั้ง state='countdown' ไว้แล้วและรอ callback นี้พาไป
  // 'running' ถ้าเราเงียบหายไป ผู้เล่นจะค้างอยู่ในสถานะที่ไม่มีปุ่มไหนใช้ได้เลย
  if (!deck) {
    console.error('[run] ไม่มีชุดคำ — กลับเมนูแทนการค้างอยู่ในสถานะนับถอยหลัง');
    leaveToMenu();
    return;
  }
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

  const zone = CFG.br.zones.find(z => z.id === ui.selectedZone()) || CFG.br.zones[1];

  run = {
    practice: null,                // โหมดฝึก: { queue, words } — ตั้งค่าโดย startPracticeRun
    time: 0,
    speed: CFG.speed.start,
    speedBase: CFG.speed.start,
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

    // ── Battle Royale ─────────────────────────────────────
    // rng: ปกติคือ Math.random — จะถูกสลับเป็นตัวสุ่มจากเมล็ดร่วมตอนเข้ารอบชิง
    rng: Math.random,
    br: mpActive,                  // เปิดพายุ/อาวุธ/ศึกชิงคำเฉพาะในห้องแข่ง
    zone: mpActive ? zone : CFG.br.zones[1],
    deck: mpActive ? zoneDeck(deck, zone.levels) : deck,
    oxy: 1,
    stormSec: 0,
    stormLvl: 1,
    ammo: 0,
    ammoCharge: 0,
    selectedAmmo: AMMO_ORDER[0],
    lastFireAt: 0,
    fogT: 0,
    fogSpan: CFG.br.weapon.fogSeconds,
    surgeT: 0,
    surgeBlend: 0,                 // ตัวไล่ค่าของกระสุนเร่งความเร็ว (0..1)
    slowBlend: 0,                  // ตัวไล่ค่าของสโลว์โมชันตอนศึกชิงคำ (0..1)
    swapPending: false,            // โดนกระสุน "สลับธง" — รอจังหวะสลับกลางคัน
    contest: null,
    finalRound: false,
  };
  pendingRetryWord = null;

  world.setEnvironment('corridor');
  player.setFlying(false);

  ui.hideAll();
  hud.show();
  hud.setScore(0, 0, 1);
  hud.setCoins(0);
  syncGear();
  hud.setStars(0, CFG.stars.needed);
  hud.setBonusTimer(null);
  hud.hideBonusBanner();
  hud.setBest(srs.getBest(deck.id).score);
  hud.clearQuestion();
  hud.setQuestionVisible(true);    // เผื่อรอบก่อนจบตอนอยู่ในโบนัส (ยังซ่อน UI ค้างอยู่)
  hud.setFog(0);
  hud.setActiveLane(1);
  hud.showContest(null);
  // โหมดฝึกไม่มีของสะสมเลย — ซ่อนทั้งแถบ ไม่ใช่แค่ตั้งเป็น 0
  // (ตัวเลขที่ค้างอยู่ที่ 0 ยังเป็นสิ่งเร้าที่ชวนให้มองอยู่ดี)
  hud.setCollectiblesVisible(!run.practice);
  hud.setBattleVisible(run.br);
  hud.setArmorLabel(armorEmoji(), armorName());
  hud.setCheatVisible(cheats.enabled());
  hud.setOxygen(1, 1);
  hud.setWeapon(0, 0, run.selectedAmmo, null);
  state = 'running';
  startAmbience();
}

/* ══ โหมดฝึก: สอน 10 คำ → วิ่งกับคำชุดนั้น → สอนชุดถัดไป ═══════ */

function openPracticeTeach() {
  if (!deck) return;
  // เข้าห้องซ้อมได้จากจอตายในโหมดแข่งด้วย — ต้องถอนตัวออกจากห้องให้เรียบร้อยก่อน
  // ไม่งั้นเราจะยัง broadcast สถานะเข้าห้องอยู่ทั้งที่ไปนั่งเรียนคำศัพท์แล้ว
  exitMultiplayer();
  stopSpeaking();
  stopAmbience();
  hud.hide();
  hud.showLeaderboard(false);
  state = 'teach';
  // ชุดฝึกถูกเลือกจาก "คำที่คุณเพิ่งพลาด" ก่อนเสมอ — ติดป้ายให้เห็นว่าอันไหนมาจากตรงนั้น
  ui.showPracticeTeach(pickPracticeWords(deck), new Set(inboxPending(deck.id)));
}

function startPracticeRun(words) {
  if (!words?.length) { hud.toast('ไม่มีคำให้ฝึกในชุดนี้', 2000); toMenu(); return; }
  startRun();
  if (state !== 'running') return;   // startRun ถอยกลับเมนู (ไม่มี deck) — อย่าเดินต่อ
  const queue = buildPracticeQueue(words, { speechOk: isSpeechUsable(), deckId: deck.id });
  run.practice = { words, queue, remaining: queue.length, total: queue.length };
  // ห้องซ้อมต้องไม่มีของสะสมเลย — startRun() ตั้งค่าตอนที่ยังไม่รู้ว่าเป็นโหมดฝึก
  // และต้องปิด br ให้ชัดเจนด้วย ไม่ใช่พึ่งว่า mpActive บังเอิญเป็น false อยู่แล้ว
  // ("ไม่มีพายุในห้องซ้อม" ต้องเป็นกติกาที่บังคับใช้ ไม่ใช่ผลข้างเคียงที่เผอิญถูก)
  run.br = false;
  run.oxy = 1;
  hud.setCollectiblesVisible(false);
  hud.setBattleVisible(false);
  hud.setPracticeProgress(0, queue.length);
  hud.toast(`โหมดฝึก ${words.length} คำ — ตอบผิดไม่ตาย คำจะวนกลับมาให้ลองใหม่`, 2600);
}

function practiceDone() {
  const words = run.practice.words;
  pendingRetryWord = null;
  stopSpeaking();
  stopAmbience();
  hud.hide();
  state = 'practiceDone';
  sfx.bonusStart();
  ui.showPracticeDone(words);
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
    // เป้าที่เล็งไว้ตายไปแล้ว/ออกจากห้องแล้ว → ปลดเป้าเอง ไม่ให้ค้างชี้ไปที่ผี
    if (mpTarget && !players.some(p => p.id === mpTarget && !p.finished)) mpTarget = null;
    if (mpWatch && !players.some(p => p.id === mpWatch && !p.finished)) {
      mpWatch = null; watchQuestion = null; net.watch(null);
      hud.setSpectateTarget(null); hud.setQuestionVisible(false);
    }
    hud.setLeaderboard(players, net.selfId(), mpTarget, mpWatch);
    // อัปเดตโกสต์ของเพื่อนทันทีที่ได้ตำแหน่งใหม่ (รวมตอนเป็นผู้ชมหลังตกรอบด้วย)
    if (mpActive && (state === 'running' || state === 'dying' || state === 'dead' || state === 'spectate')) {
      ghosts.sync(players, net.selfId());
    }
  });
  net.on('start', (startMsg) => beginRace(startMsg));
  net.on('winner', (w) => onRoundWinner(w));
  net.on('attack', (from, ammo) => onAttacked(from, ammo));
  net.on('attackAck', (ack) => onAttackAck(ack));
  net.on('storm', (msg) => onStorm(msg));
  net.on('contest', (msg) => onContestStart(msg));
  net.on('contestResult', (msg) => onContestResult(msg));
  net.on('final', (msg) => enterFinalRound(msg));
  net.on('watchQ', (msg) => onWatchQuestion(msg));
  net.on('status', (msg) => ui.mpSetStatus(msg));
  net.on('error', (msg) => ui.mpSetStatus(msg, 'fail'));

  // host เป็นคนปั้นโจทย์ "ศึกชิงคำ" ให้ทุกคน — ต้องส่งตัวเลือกไปด้วย ไม่ใช่ส่งแค่คำ
  // เพราะตัวลวงถูกปั้นจากสถิติของแต่ละเครื่อง ถ้าให้แต่ละคนปั้นเอง โจทย์จะไม่ใช่ข้อเดียวกัน
  net.setQuestionSource(() => {
    if (!deck) return null;
    const word = pickWord(deck, []);
    const q = buildQuestion(deck, word, { speechEnabled: false });
    return {
      th: word.th,
      en: word.en,
      options: q.options.map(o => ({ en: o.en, th: o.th })),
      correctIndex: q.correctIndex,
    };
  });

  net.on('closed', () => {
    mpActive = false;
    mpFinished = false;
    mpRoundOver = false;
    clearInterval(countdownTimer);
    clearTimeout(winnerTimer);
    hud.countdown(null);
    hud.showWinner(null);
    hud.showPodium(null);
    hud.showLeaderboard(false);
    hud.setFinalBanner(false);
    hud.showContest(null);
    ghosts.reset();
    hud.hide();
    ui.mpResetLobby();
    ui.show('multiplayer');
    state = 'lobby';
    ui.mpSetStatus('หัวห้องปิดห้อง หรือหลุดการเชื่อมต่อ', 'fail');
  });
}

/* ══ พายุ: หลอดออกซิเจนที่เติมได้ทางเดียวคือตอบถูก ═══════════ */

/** host กระจาย "วินาทีของแมตช์" มา — ทุกเครื่องแปลงเป็นระดับพายุด้วยสูตรเดียวกัน */
function onStorm(msg) {
  if (!run || !run.br) return;
  run.stormSec = msg.sec ?? run.stormSec;
  // รอบชิงตรึงพายุไว้ระดับเดียว — ถึงตรงนั้นแล้วต้องตัดสินกันที่ฝีมือ ไม่ใช่ที่นาฬิกา
  run.stormLvl = run.finalRound ? CFG.br.final.stormLevel : (msg.level ?? stormLevel(run.stormSec));
}

/** เติมออกซิเจน (บวก) หรือให้พายุกิน (ลบ) — คืนค่าว่าหลอดหมดหรือยัง */
function addOxygen(amount, reason) {
  if (!run?.br) return false;
  run.oxy = Math.max(0, Math.min(1, run.oxy + amount));
  hud.setOxygen(run.oxy, run.stormLvl);
  if (amount > 0 && reason) hud.pulseOxygen();
  return run.oxy <= 0;
}

function updateStorm(dt) {
  if (!run.br || run.bonus || run.contest) return;   // โบนัส/ศึกชิงคำ = ตอบไม่ได้ → ห้ามให้พายุกิน
  run.stormSec += dt;
  if (!run.finalRound) run.stormLvl = stormLevel(run.stormSec);

  const before = run.oxy;
  run.oxy = Math.max(0, run.oxy - drainOver(dt, run.stormLvl));
  hud.setOxygen(run.oxy, run.stormLvl);

  const warn = CFG.br.storm.warnAt;
  if (before >= warn && run.oxy < warn) {
    sfx.horn();
    hud.toast('🌪️ พลังใกล้หมด — ตอบให้ถูกเพื่อเติม!', 2000);
  }
  if (run.oxy <= 0) {
    const pending = gates.pending();
    die('storm', pending?.question.word ?? null, null);
  }
}

/* ══ อาวุธ: สะสมจากการตอบถูก แล้วเลือกเวลายิง + เลือกเป้าเอง ══ */

function chargeWeapon() {
  if (!run.br || run.ammo >= CFG.br.weapon.maxAmmo) return;
  run.ammoCharge += 1;
  if (run.ammoCharge >= CFG.br.weapon.correctPerAmmo) {
    run.ammoCharge = 0;
    run.ammo += 1;
    sfx.star(1, 1);
    hud.toast(`${ammoById(run.selectedAmmo).emoji} อาวุธพร้อมยิง! แตะชื่อคู่แข่งเพื่อเล็ง`, 2000);
  }
  hud.setWeapon(run.ammo, run.ammoCharge / CFG.br.weapon.correctPerAmmo, run.selectedAmmo, mpTarget);
}

function cycleAmmo() {
  if (!run?.br) return;
  const i = AMMO_ORDER.indexOf(run.selectedAmmo);
  run.selectedAmmo = AMMO_ORDER[(i + 1) % AMMO_ORDER.length];
  sfx.select();
  const a = ammoById(run.selectedAmmo);
  hud.setWeapon(run.ammo, run.ammoCharge / CFG.br.weapon.correctPerAmmo, run.selectedAmmo, mpTarget);
  hud.toast(`${a.emoji} ${a.name} — ${a.desc}`, 2200);
}

function fireWeapon() {
  if (!run?.br || state !== 'running' || mpFinished) return;
  if (run.ammo <= 0) { hud.toast('ยังไม่มีกระสุน — ตอบถูกให้ครบเพื่อชาร์จ', 1400); return; }
  const now = performance.now();
  if (now - run.lastFireAt < CFG.br.weapon.cooldownMs) return;

  run.lastFireAt = now;
  run.ammo -= 1;
  net.sendAttack(mpTarget, run.selectedAmmo);
  sfx.laser();
  hud.setWeapon(run.ammo, run.ammoCharge / CFG.br.weapon.correctPerAmmo, run.selectedAmmo, mpTarget);
}

/** host ตอบกลับว่าเรายิงโดนใคร — ตรงนี้คือที่จ่าย "ค่าหัวผู้นำ" */
function onAttackAck(ack) {
  if (!run?.br) return;
  const a = ammoById(run.selectedAmmo);
  if (ack.leader) {
    addOxygen(CFG.br.storm.bountyOnLeaderHit, 'bounty');
    hud.toast(`${a.emoji} ยิงโดน 👑 ${ack.targetName} (ผู้นำ) — ได้พลังคืน!`, 2200);
  } else {
    hud.toast(`${a.emoji} ยิงโดน ${ack.targetName}`, 1600);
  }
}

/**
 * แตะชื่อในตารางคะแนน — ความหมายเปลี่ยนตามสถานะ
 *   ยังวิ่งอยู่  → เล็งเป้าอาวุธ
 *   เป็นผู้ชม   → "สิง" คนนั้น (ดูโจทย์เดียวกับเขา)
 */
function selectTarget(id) {
  if (!mpActive || id === net.selfId()) return;

  if (state === 'spectate') { watchPlayer(id); return; }

  mpTarget = mpTarget === id ? null : id;
  sfx.select();
  hud.setLeaderboard(mpRoster, net.selfId(), mpTarget, mpWatch);
  if (run?.br) hud.setWeapon(run.ammo, run.ammoCharge / CFG.br.weapon.correctPerAmmo, run.selectedAmmo, mpTarget);
}

/* ══ โหมดสิง: ตกรอบแล้วยังเรียนต่อได้ ═══════════════════════
 * ⚠️ นี่ไม่ใช่ฟีเจอร์ "ดูเพลิน ๆ" แต่เป็นการแก้กับดักเดียวกับกล่องคำที่พลาด:
 * คนที่ตกรอบเร็วที่สุดคือคนที่รู้ศัพท์น้อยที่สุด ถ้าปล่อยให้เขานั่งดูเฉย ๆ
 * เขาจะได้ฝึกน้อยที่สุดทั้งที่ต้องการมากที่สุด
 * การเห็น "โจทย์เดียวกับที่คนเก่งกำลังตอบ" ทำให้เวลาที่เหลือของแมตช์
 * กลายเป็นเวลาเรียน ไม่ใช่เวลารอ
 */
function watchPlayer(id) {
  const p = mpRoster.find(x => x.id === id);
  if (!p || p.finished) return;

  mpWatch = mpWatch === id ? null : id;
  watchQuestion = null;
  net.watch(mpWatch);
  sfx.select();

  hud.setLeaderboard(mpRoster, net.selfId(), null, mpWatch);
  if (mpWatch) {
    hud.setQuestionVisible(true);
    hud.clearQuestion();
    hud.setSpectateTarget(p.name);
    hud.toast(`👁️ กำลังสิง ${p.name} — ลองตอบตามดูสิ`, 2600);
  } else {
    hud.setQuestionVisible(false);
    hud.setSpectateTarget(null);
  }
}

/** โจทย์ของคนที่เราสิงอยู่มาถึง — วาดให้เหมือนที่เขาเห็นเป๊ะ */
function onWatchQuestion(msg) {
  if (state !== 'spectate' || !mpWatch || msg.from !== mpWatch) return;
  const q = msg.q;
  if (!q) return;

  watchQuestion = q;
  hud.setQuestion({
    mode: q.mode,
    word: { th: q.th, en: q.en, emoji: q.emoji },
    options: q.opts.map((en, i) => ({ en, th: q.trans?.[i] || '' })),
    correctIndex: q.correctIndex,
  });
  hud.setSpectateGuess(null);
}

/**
 * ผู้ชมลองตอบเอง — ไม่มีผลต่อแมตช์เลย แต่ได้รู้ทันทีว่าถูกหรือผิด
 * (และคำที่ตอบผิดถูกหย่อนลงกล่องฝึกเหมือนตอนเล่นจริง)
 */
function spectateGuess(index) {
  if (state !== 'spectate' || !watchQuestion) return;
  const correct = index === watchQuestion.correctIndex;
  hud.setSpectateGuess({ picked: index, correct: watchQuestion.correctIndex });
  if (correct) {
    sfx.correct(1);
  } else {
    sfx.laser();
    srs.record(deck.id, watchQuestion.en, false);
    addMissed(deck.id, [watchQuestion.en]);
  }
  speak(watchQuestion.en);
  watchQuestion = null;      // ตอบได้ครั้งเดียวต่อข้อ
}

/**
 * โดนอาวุธจากคู่แข่ง
 *
 * ⚠️ กฎเหล็ก: ทุกกระสุนต้องทำให้ "ยากขึ้น" ห้ามทำให้ "ตอบไม่ได้"
 *    ข้อมูลที่ต้องใช้ตอบยังอยู่ครบทุกกรณี — เปลี่ยนแค่ว่าต้องใช้แรงกว่าเดิม
 */
function onAttacked(from, ammo = 'break') {
  if (state !== 'running' || !run || run.bonus || run.contest || mpFinished) return;
  const a = ammoById(ammo);

  if (ammo === 'swap') {
    // ธงจะสลับที่ตอนเวลาตอบเหลือประมาณครึ่ง — ยังมีเวลาให้อ่านใหม่ทัน
    // ถ้าตอนนี้เลยจังหวะนั้นไปแล้ว ธงจะไปสลับที่ "ด่านถัดไป" แทน (ดูใน update)
    run.swapPending = true;
    sfx.select();
  } else if (ammo === 'fog') {
    // ⚠️ หมอกต้องจางก่อนหมดเวลาตอบ "เสมอ" — ไม่ใช่ตั้งเวลาคงที่แล้วหวังว่าจะทัน
    // ถ้ากระสุนมาถึงตอนเหลือเวลา 1.0 วิ แต่หมอกอยู่ 1.6 วิ = โจทย์ถูกบังจนวินาทีสุดท้าย
    // นั่นคือ "ตอบไม่ได้" ไม่ใช่ "ยากขึ้น" — ผิดกฎเหล็กเต็ม ๆ
    const left = remainingAnswerSeconds();
    run.fogSpan = Math.max(0.5, Math.min(CFG.br.weapon.fogSeconds, left * 0.55));
    run.fogT = run.fogSpan;
    sfx.laser();
  } else if (ammo === 'surge') {
    run.surgeT = CFG.br.weapon.surgeSeconds;
    sfx.horn();
  } else if (run.jetArmed) {
    run.jetArmed = false;
    syncGear();
    sfx.laser();
  } else {
    spawnAttackBarrier();
    sfx.horn();
  }
  hud.toast(`${a.emoji} ${from}: ${a.hitText}`, 2000);
}

/** เวลาที่เหลือให้ตอบด่านที่ค้างอยู่ (วินาที) — 0 ถ้าไม่มีด่านค้าง */
function remainingAnswerSeconds() {
  const pending = gates.pending();
  if (!pending || !pending.spawnZ) return 0;
  const ratio = Math.max(0, Math.min(1, pending.z() / pending.spawnZ));
  return ratio * answerWindowFor(pace());
}

/**
 * ม่านพลังงานจากกระสุน "ปลดเกราะ"
 *
 * ⚠️ ต้องเคารพกฎความปลอดภัยเดียวกับ scheduleBreather: ห้ามบล็อกครบทุกเลนพร้อมกัน
 * ของที่ยัดเข้า run.events ตรง ๆ จะข้ามการตรวจนั้นไปทั้งหมด — และถ้าบังเอิญไปตรงกับ
 * คลื่นสิ่งกีดขวางที่ผู้กำกับวางไว้แล้ว ผู้เล่นจะเจอ "กำแพงตัน" ที่หลบไม่ได้เลย
 * ซึ่งไม่ใช่การโดนโจมตี แต่คือการโดนตัดสินให้ตายโดยไม่มีทางเลือก
 */
function spawnAttackBarrier() {
  const time = run.time + 1.6;
  const busy = new Set(
    run.events.filter(e => e.kind === 'obstacle' && Math.abs(e.time - time) < 0.6).map(e => e.lane)
  );
  const lane = player.nearestLane();
  busy.add(lane);
  // ต้องเหลือทางรอดอย่างน้อย 1 เลนหลังวางม่านนี้
  if (busy.size >= CFG.world.laneCount) {
    hud.toast('⚠️ ม่านพลังงานสลายไปกลางทาง — เส้นทางตันเกินกว่าจะปล่อยได้', 1800);
    return;
  }
  run.events.push({ kind: 'obstacle', time, type: 'barrier', lane, lead: 1.3 });
}

/* ══ ศึกชิงคำ — จุดเดียวที่ทุกคน "ปะทะกันตรง ๆ" ได้ ═══════════
 * โลกของแต่ละคนคนละใบ (ตั้งใจ) จึงแข่งความเร็วในโลกกันไม่ได้
 * แต่ "คำถาม" แชร์กันได้โดยไม่ต้องแชร์โลก — นี่คือจุดที่เกมฝึกศัพท์
 * กับ Battle Royale กลายเป็นสิ่งเดียวกัน แทนที่จะเป็นสองเกมซ้อนกัน
 *
 * ⚠️ ต้องหยุดโลกไว้ก่อน ไม่งั้นเรากำลังวัด "การแบ่งสมาธิระหว่างหลบกับตอบ"
 *    ซึ่งไม่ใช่สิ่งที่เกมนี้อยากวัด (และคนที่บังเอิญเจอสิ่งกีดขวางพอดีจะเสียเปรียบฟรี ๆ)
 */
function onContestStart(msg) {
  if (!run || !run.br || state !== 'running' || run.bonus || mpFinished) return;
  // รอบชิงไม่มีศึกชิงคำ — การหยุดโลกกลางการดวลตัวต่อตัวจะทำให้แทร็กร่วมของทั้งสองคน
  // เหลื่อมเวลากัน (แต่ละคนกลับมาวิ่งคนละจังหวะ) ทั้งที่เนื้อหาด่านยังเหมือนกัน
  if (run.finalRound) return;
  // ศึกรอบเก่ายังค้างอยู่ (ข้อความผลหาย/มาช้า) → ปิดของเก่าทิ้งแล้วรับรอบใหม่
  // ห้าม return เฉย ๆ เพราะจะทำให้เครื่องนี้ "ตกขบวน" ทุกรอบต่อจากนี้ไปตลอดกาล
  if (run.contest) {
    if (run.contest.id >= msg.id) return;
    endContest();
  }

  // เคลียร์ของในสนามก่อน — ห้ามมีด่านค้างที่จะไปตัดสินตอนผู้เล่นกำลังก้มดูโจทย์ดวล
  run.events = [];
  gates.reset();
  obstacles.reset();
  trains.reset();
  player.setPlatform(0);

  run.contest = {
    id: msg.id,
    options: msg.options || [],
    correctIndex: msg.correctIndex,
    th: msg.th,
    en: msg.en,
    t: CFG.br.contest.answerSeconds,
    picked: null,
    sent: false,
  };
  run.invuln = Math.max(run.invuln, CFG.br.contest.answerSeconds + 1.5);

  hud.clearQuestion();
  hud.setQuestionVisible(false);
  hud.showContest(run.contest);
  sfx.bonusStart();
}

function contestPick(index) {
  const c = run?.contest;
  if (!c || c.sent) return;
  c.picked = index;
  c.sent = true;
  net.sendContestAnswer(c.id, index);
  hud.markContestPick(index);
  sfx.select();
}

function endContest() {
  if (!run?.contest) return;
  run.contest = null;
  hud.showContest(null);
  hud.setQuestionVisible(true);
  hud.clearQuestion();
  // ให้โลกเร่งกลับแล้วค่อยส่งด่านถัดไป — ไม่งั้นด่านจะโผล่มาตอนภาพยังนิ่งอยู่
  run.events = [];
  run.nextGateArrival = run.time + answerWindowFor(pace()) + 1.2;
  run.gateSpawned = false;
}

function onContestResult(msg) {
  const c = run?.contest;
  if (!c || c.id !== msg.id) return;

  const me = net.selfId();
  const correct = c.picked === msg.correctIndex;
  const iWon = msg.winnerId && msg.winnerId === me;
  const answer = c.options[msg.correctIndex];

  hud.revealContest(msg.correctIndex, c.picked, msg.winnerName || null, iWon);

  if (iWon) {
    addOxygen(CFG.br.storm.refillOnContestWin, 'contest');
    run.score += CFG.br.contest.scoreBonus;
    run.ammo = Math.min(CFG.br.weapon.maxAmmo, run.ammo + 1);
    srs.record(deck.id, c.en, true);
    clearWords(deck.id, [c.en]);     // ตอบถูกที่ไหนก็ปลดออกจากคิวทวนเหมือนกัน
    sfx.correct(5);
  } else if (correct) {
    addOxygen(CFG.br.storm.refillOnContestCorrect, 'contest');
    run.score += Math.round(CFG.br.contest.scoreBonus / 3);
    srs.record(deck.id, c.en, true);
    clearWords(deck.id, [c.en]);
    sfx.correct(2);
  } else {
    // ตอบผิด/ตอบไม่ทัน → พายุกินพลัง และคำนี้ถูกส่งเข้าคิวฝึกทันที
    addOxygen(-CFG.br.storm.penaltyOnContestMiss, null);
    srs.record(deck.id, c.en, false);
    addMissed(deck.id, [c.en]);
    sfx.laser();
  }

  hud.setScore(run.score, run.gates, run.combo);
  hud.setWeapon(run.ammo, run.ammoCharge / CFG.br.weapon.correctPerAmmo, run.selectedAmmo, mpTarget);
  speak(c.en);

  // ค้างเฉลยไว้ให้อ่านก่อน แล้วค่อยกลับไปวิ่ง (นี่คือช่วงที่คนแพ้ได้เรียนคำใหม่)
  setTimeout(() => {
    if (run?.contest?.id === msg.id) endContest();
  }, 1900);

  if (run.oxy <= 0 && state === 'running') {
    setTimeout(() => {
      if (state === 'running' && run?.oxy <= 0) die('storm', { en: c.en, th: c.th }, null);
    }, 1950);
  }
  void answer;
}

/* ══ รอบชิง: ทุกคนย้ายไปวิ่งบนแทร็กเดียวกันจริง ๆ ═══════════ */

function enterFinalRound(msg) {
  if (!run || !run.br || run.finalRound || mpFinished) return;
  if (state !== 'running') return;

  run.finalRound = true;
  run.rng = mulberry32(msg.seed >>> 0);
  run.deck = deck;                 // รอบชิงใช้ deck เต็ม — โซนลงจอดของแต่ละคนต่างกันไม่ได้แล้ว
  // ⚠️ ต้องล้าง "ตัวคูณรางวัลของโซน" ไปพร้อมกับ deck ด้วย
  // โซนคือการเดิมพัน: คำยากกว่า แลกกับรางวัลมากกว่า พอรอบชิงคืน deck เต็มให้ทุกคน
  // "ต้นทุน" ของโซนหายไปแต่ "รางวัล" ยังอยู่ → คนเลือกโซนโหดได้ออกซิเจนต่อคำมากกว่า
  // บนแทร็กที่เหมือนกันเป๊ะ ซึ่งทำลายทั้งความยุติธรรมและความหมายของรอบชิง
  run.zone = CFG.br.zones[0];
  run.recent = [];
  run.events = [];
  // เอฟเฟกต์อาวุธที่ค้างจากช่วงก่อนต้องหมดฤทธิ์ด้วย — ไม่งั้นความเร็วของแต่ละคนจะไม่เท่ากัน
  // ตั้งแต่วินาทีแรกของแทร็กร่วม (และตำแหน่งที่ของถูกวางก็จะเลื่อนตามไปด้วย)
  run.surgeT = 0;
  run.surgeBlend = 0;
  run.fogT = 0;
  run.swapPending = false;

  // ⚠️ ถ้ากำลังลอยอยู่ในด่านโบนัสตอนรอบชิงเริ่ม ต้องดึงกลับลงพื้นก่อน
  // ไม่งั้นจะได้ผู้เล่นที่ "บินอยู่ในอวกาศ" บนแทร็กภาคพื้นดินที่คนอื่นวิ่งกันอยู่
  // (และ bonusDirector จะยังทำงานต่อ = ผู้กำกับสองตัวแย่งกันคุมโลกเดียวกัน)
  if (run.bonus) {
    run.bonus = null;
    player.setFlying(false);
    world.setEnvironment('corridor');
    hud.setBonusTimer(null);
    hud.hideBonusBanner();
    hud.setQuestionVisible(true);
  }
  run.time = 0;
  run.speedBase = CFG.br.final.speed;
  run.speed = CFG.br.final.speed;
  run.stormLvl = CFG.br.final.stormLevel;
  run.oxy = Math.max(run.oxy, CFG.br.final.oxygenFloor);
  run.stars = 0;
  run.nextGateArrival = answerWindowFor(CFG.br.final.pace) + 1.4;
  run.gateSpawned = false;

  gates.reset();
  obstacles.reset();
  trains.reset();
  pickups.reset();
  player.setPlatform(0);

  hud.setOxygen(run.oxy, run.stormLvl);
  hud.setStars(0, CFG.stars.needed);
  hud.setFinalBanner(true);
  hud.toast(`🏁 รอบชิง! เหลือ ${msg.alive} คน — จากนี้ทุกคนวิ่งบนแทร็กเดียวกัน`, 3400);
  sfx.bonusStart();
}

/**
 * Battle Royale จบรอบ: host ประกาศผู้รอดคนสุดท้าย → ทุกเครื่องโชว์ป้ายผู้ชนะ
 * ค้างไว้ 3.2 วิ แล้วพากลับห้องอัตโนมัติ (host กดเริ่มรอบใหม่ได้เลย)
 */
function onRoundWinner(w) {
  if (!mpActive || mpRoundOver) return;
  mpRoundOver = true;

  stopSpeaking();
  // นับถอยหลังอาจยังเดินอยู่ (ผู้ชนะประกาศมาระหว่าง beginRace ของรอบถัดไป)
  // ถ้าไม่หยุด callback ของมันจะสั่ง startRun() ทับป้ายผู้ชนะที่เพิ่งขึ้น
  clearInterval(countdownTimer);
  hud.countdown(null);
  hud.showContest(null);
  if (run) run.contest = null;
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

  /* ── แท่นรับรางวัล 3 อันดับ ────────────────────────────────
   * ⚠️ จัดอันดับจาก "คะแนน" ไม่ใช่ "ใครตายทีหลัง"
   * เพราะคะแนนมาจากการตอบถูก ส่วนการรอดนานมาจากการหลบเก่ง
   * เกมนี้วัดคำศัพท์ อันดับจึงต้องสะท้อนคำศัพท์
   * (ผู้ชนะรอบยังเป็นผู้รอดคนสุดท้ายเหมือนเดิม — นี่คือคนละเรื่องกัน) */
  const ranking = [...mpRoster]
    .sort((a, b) => (b.score - a.score) || (b.gates - a.gates))
    .slice(0, 3);
  hud.showPodium(ranking);
  sfx.bonusStart();   // แตรฉลองที่มีอยู่แล้ว ใช้ซ้ำได้พอดี

  clearTimeout(winnerTimer);
  winnerTimer = setTimeout(() => {
    hud.showWinner(null);
    hud.showPodium(null);
    toLobby();
  }, 5200);   // นานขึ้นจาก 3.2 วิ — ต้องมีเวลาให้อ่านแท่นรับรางวัลจริง ๆ
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

/** รอผลตัดสินศึกชิงคำได้นานสุดกี่วินาทีหลังหมดเวลาตอบ ก่อนจะปลดตัวเองออกจากสถานะดวล */
const CONTEST_GRACE = 4;

/** เริ่มรอบแข่ง: โหลด deck ของหัวห้อง → นับถอยหลัง → ออกตัวพร้อมกัน */
async function beginRace(startMsg) {
  clearInterval(countdownTimer);
  clearTimeout(winnerTimer);
  hud.showWinner(null);
  mpActive = true;
  mpFinished = false;
  mpRoundOver = false;
  mpTarget = null;
  pendingRetryWord = null;      // เริ่มแข่งใหม่ต้องสะอาด ไม่เอาคำที่พลาดจากรอบเดี่ยวมาปน
  hud.setFinalBanner(false);
  hud.showContest(null);
  try {
    if (startMsg?.deck) deck = await loadDeck(startMsg.deck);
  } catch (err) {
    console.warn('[mp] โหลด deck ของหัวห้องไม่ได้ — ใช้ deck เดิมแทน', err);
    // ต้องบอกผู้เล่นตรง ๆ ไม่ใช่เงียบ: ศึกชิงคำจะใช้คำจาก deck ของหัวห้อง
    // ถ้าเราถือคนละ deck ตัวเลือกที่เห็นจะไม่ตรงกับที่เพื่อนเห็น และเราจะงงว่าทำไมแพ้ตลอด
    hud.toast('⚠️ โหลดชุดคำของหัวห้องไม่ได้ — ใช้ชุดคำเดิมของคุณแทน', 3600);
  }
  // ⚠️ ระหว่างที่ await อยู่ ผู้เล่นอาจกดออกจากห้องไปแล้ว
  // ถ้าไม่เช็ก โค้ดหลัง await จะลากเขากลับเข้าสนามแข่งที่เขาเพิ่งออกมา
  if (!net.isConnected() || !mpActive) return;
  ui.hideAll();
  hud.showLeaderboard(true);
  hud.setLeaderboard(mpRoster, net.selfId(), null);
  state = 'countdown';
  runCountdown(() => {
    startRun();
    const label = MODE_LABEL[startMsg?.mode] || MODE_LABEL.solo;
    hud.toast(`${label} · ${run.zone.name} — พลังจะไหลลงเรื่อย ๆ ตอบถูกเพื่อเติม!`, 3200);
    void label;
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
  mpWatch = null; watchQuestion = null; mpLastSentQuestion = null;
  net.watch(null);
  hud.setSpectateTarget(null);
  const wasEliminated = mpFinished;   // จำไว้ก่อน เพราะบรรทัดล่างจะล้างธงทิ้ง
  stopSpeaking();
  stopAmbience();
  clearInterval(countdownTimer);
  clearTimeout(winnerTimer);
  hud.countdown(null);
  hud.showWinner(null);
  hud.hide();
  hud.showSpectate(false);
  hud.showLeaderboard(false);
  hud.setFinalBanner(false);
  hud.showContest(null);
  ghosts.reset();
  mpFinished = false;
  mpRoundOver = false;
  mpTarget = null;
  // ล้างคะแนน/ออกซิเจนเก่าใน roster ไม่งั้นล็อบบี้จะโชว์สถานะของรอบที่จบไปแล้ว
  //
  // ⚠️ finished ต้อง "ไม่รีเซ็ต" ถ้ารอบยังไม่จบ
  // toLobby ถูกเรียกจากโหมดผู้ชมได้ด้วย (ตกรอบแล้วกดกลับห้อง) ถ้าส่ง finished:false ไป
  // host จะเห็นคนที่ตายไปแล้ว "ฟื้น" ขึ้นมาเป็นผู้รอด → รอบนั้นอาจประกาศให้ผีเป็นผู้ชนะ
  // และถ้าเขาเป็นคนสุดท้ายที่เหลือ รอบจะค้างไม่จบเลย
  net.sendState({
    score: 0, gates: 0, coins: 0, oxy: 1, ammo: 0,
    alive: false, finished: mpRoundOver ? false : wasEliminated,
  });
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
/** ตัดขาดจากห้องแข่งให้หมดจด — ใช้ร่วมกันทุกทางออก (กลับเมนู / ไปห้องซ้อม) */
function exitMultiplayer() {
  if (net.isConnected()) net.leave();
  mpActive = false;
  mpFinished = false;
  mpRoundOver = false;
  mpTarget = null;
  if (run) run.contest = null;
  clearInterval(countdownTimer);
  clearTimeout(winnerTimer);
  hud.countdown(null);
  hud.showWinner(null);
  hud.showPodium(null);
  hud.showLeaderboard(false);
  hud.setFinalBanner(false);
  hud.showContest(null);
  hud.showSpectate(false);
  ghosts.reset();
}

function leaveToMenu() {
  mpWatch = null; watchQuestion = null; mpLastSentQuestion = null;
  net.watch(null);
  hud.setSpectateTarget(null);
  exitMultiplayer();
  toMenu();
}

/* ── ผู้กำกับ: คำนวณระยะจากเวลา ──────────────────────────── */

/**
 * "จังหวะความยาก" ที่ผู้กำกับใช้ตัดสินใจ — แยกจาก run.gates ที่ใช้นับคะแนน
 *
 * ทำไมต้องแยก? เพราะมีสองสถานการณ์ที่ความยากต้องไม่เดินตามจำนวนด่านที่ผ่าน:
 *   โหมดฝึก → ตรึงไว้ที่ 0 (ห้องซ้อมไม่ควรยากขึ้นเพราะซ้อมนาน)
 *   รอบชิง  → ตรึงไว้ที่ค่าคงที่ เพราะทุกเครื่องต้องเจอด่านชุดเดียวกันเป๊ะ
 *             ถ้าอิง run.gates ของแต่ละคน (ซึ่งไม่เท่ากัน) แทร็กจะแตกทันที
 */
function pace() {
  if (run.practice) return 0;
  if (run.finalRound) return CFG.br.final.pace;
  return run.gates;
}

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
    question = buildQuestion(run.deck, entry.word, { speechEnabled: isSpeechUsable() });
    question.mode = entry.mode;
    question.practiceEntry = entry;
  } else if (run.finalRound) {
    // ⚠️ รอบชิงต้องสุ่มด้วย run.rng ล้วน ๆ และบังคับกลยุทธ์ตัวลวงให้เท่ากันทุกเครื่อง
    // ไม่งั้น "เมล็ดเดียวกัน" ก็ยังได้คนละโจทย์ เพราะสถิติ SRS ของแต่ละคนไม่เหมือนกัน
    const word = pickWordSeeded(run.deck, run.recent, run.rng);
    question = buildQuestion(run.deck, word, { speechEnabled: false, box: 2 }, run.rng);
    question.mode = 'text';
  } else {
    const word = run.forcedWord || pickWord(run.deck, run.recent);
    run.forcedWord = null;
    question = buildQuestion(run.deck, word, { speechEnabled: isSpeechUsable() });
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
  // ⚠️ ทุกการสุ่มในฟังก์ชันนี้ต้องผ่าน rnd() ไม่ใช่ Math.random()
  // เพราะตอนรอบชิง rnd คือตัวสุ่มจากเมล็ดร่วม — ถ้าหลุดไปเรียก Math.random แม้แค่ที่เดียว
  // แทร็กของแต่ละคนจะเริ่มเหลื่อมกันจากจุดนั้นเป็นต้นไปทันที
  const rnd = run.rng;
  const rule = obstacleRuleFor(pace());
  const start = gateArrival + CFG.pacing.obstacleEdgeMargin;
  const end = gateArrival + CFG.pacing.breatherSeconds - CFG.pacing.obstacleEdgeMargin;
  if (end <= start) return;

  // ── ยานลำเลียง (RIDE) ตัดสินใจ "ก่อน" ของทุกอย่าง ──
  // เพราะยานยาวกินทั้งช่วงพัก เลนของมันต้องสงวนไว้: ห้ามมีสิ่งกีดขวาง/เหรียญพื้น/ดาว
  // (ของพวกนั้นจะไปอยู่ใต้ท้องยาน มองไม่เห็นและเก็บไม่ได้ = ดูเหมือนเกมพัง)
  let trainLane = -1;
  if (!practice && pace() >= CFG.trains.rideAfterGates && rnd() < CFG.trains.rideChance) {
    trainLane = Math.floor(rnd() * CFG.world.laneCount);
    run.events.push({ kind: 'train', time: gateArrival + 0.55, lane: trainLane, lead: 1.7 });
  }

  const groundLanes = [0, 1, 2].filter(l => l !== trainLane);

  const waves = rule.waves[0] +
    Math.floor(rnd() * (rule.waves[1] - rule.waves[0] + 1));

  for (let w = 0; w < waves; w++) {
    const slot = waves === 1 ? 0.5 : (w + 0.5) / waves;
    const time = start + (end - start) * slot;

    // ⚠️ กฎความปลอดภัย: ห้ามบล็อกครบทุกเลนพื้นในเวลาเดียวกันเด็ดขาด
    // และช่วงมียาน (เหลือเลนพื้นแค่ 2) จำกัดสิ่งกีดขวางไว้ 1 ชิ้น
    // → เส้นทางรอดมีเสมอ: เลนพื้นที่ว่าง หรือกระโดดขึ้นหลังคายาน
    const cap = trainLane >= 0 ? 1 : CFG.world.laneCount - 1;
    const simultaneous = Math.min(rule.simultaneous, cap, groundLanes.length - 1 || 1);
    // ⚠️ ห้ามใช้ sort(() => rnd() - 0.5) เพื่อสับไพ่เด็ดขาด
    // สเปกไม่ได้กำหนดว่า Array.prototype.sort ต้องเรียก comparator กี่ครั้ง
    // (V8 ใช้ TimSort, JSC/SpiderMonkey ใช้อย่างอื่น) → จำนวนครั้งที่ดึง rnd() ต่างกันตามเบราว์เซอร์
    // ในรอบชิงที่ทุกเครื่องต้องดึงเลขจากเมล็ดเดียวกัน "ตามลำดับเดียวกัน" นี่คือจุดที่สายจะเหลื่อม
    // ทันทีที่ผู้เล่นสองคนใช้เบราว์เซอร์คนละตัว — และมันจะเพี้ยนเงียบ ๆ ไม่มี error ให้เห็น
    // Fisher–Yates ดึงเลขคงที่ n-1 ครั้งเสมอ และยังกระจายตัวถูกต้องกว่าด้วย
    const lanes = groundLanes.slice();
    for (let k = lanes.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [lanes[k], lanes[j]] = [lanes[j], lanes[k]];
    }
    lanes.length = simultaneous;

    for (const lane of lanes) {
      run.events.push({
        kind: 'obstacle',
        time,
        type: pickObstacleType(pace(), rnd),
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
  if (!practice && pace() >= CFG.trains.oncomingAfterGates
      && rnd() < CFG.trains.oncomingChance) {
    const time = gateArrival + CFG.pacing.breatherSeconds * 0.55;
    const cand = groundLanes.filter(l => laneFreeAt(l, time));
    // ⚠️ ต้องดึง rnd() "เสมอ" ไม่ใช่ดึงเฉพาะตอน cand ไม่ว่าง
    // เพราะ laneFreeAt อ่าน run.events ซึ่งมีของที่ *ไม่ตรงกันระหว่างเครื่อง* ปนอยู่ได้
    // (ม่านพลังงานจากกระสุน "ปลดเกราะ" ถูกยัดเข้า run.events ของเหยื่อคนเดียว)
    // ถ้าปล่อยให้การดึงเลขขึ้นกับเงื่อนไขนั้น สายสุ่มของสองเครื่องจะเหลื่อมกันทันที
    const pick = Math.floor(rnd() * CFG.world.laneCount);
    if (cand.length) {
      run.events.push({
        kind: 'oncoming',
        time,
        lane: cand[pick % cand.length],
        lead: CFG.trains.hornLeadSeconds,
      });
    }
  }

  // ห้องซ้อมไม่มีเหรียญเลย — ไม่ใช่ "เหรียญที่ไม่มีค่า" แต่คือไม่มีให้เห็นตั้งแต่แรก
  // แถวเหรียญคือสิ่งที่ดึงสายตาแรงที่สุดในจอ ถ้าปล่อยไว้ห้องซ้อมจะไม่ใช่ห้องซ้อมอีกต่อไป
  if (practice) return;
  if (rnd() > CFG.coins.chancePerBreather) return;

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

  const n = CFG.coins.runMin + Math.floor(rnd() * (CFG.coins.runMax - CFG.coins.runMin + 1));
  const t0 = gateArrival + 0.45;
  const lane = groundLanes[Math.floor(rnd() * groundLanes.length)];
  const lastCoinTime = pushCoinRow(lane, t0, n);

  // แถวที่สองอีกเลน (เหลื่อมเวลานิดหน่อยให้ตาไล่ทัน) — "เก็บเงินเพลิน" ต้องมีให้เลือกทาง
  if (rnd() < CFG.coins.doubleLaneChance && groundLanes.length > 1) {
    const others = groundLanes.filter(l => l !== lane);
    pushCoinRow(others[Math.floor(rnd() * others.length)], t0 + 0.3, Math.max(3, n - 2));
  }

  // ไอพ่นสำรองวางไว้ท้ายแถวเหรียญ = รางวัลของคนที่เก็บจนจบแถว
  if (rnd() < CFG.powerup.chancePerBreather && laneFreeAt(lane, lastCoinTime + 0.3)) {
    run.events.push({ kind: 'jet', time: lastCoinTime + 0.3, lane, lead: CFG.powerup.lead });
  }

  // ดาวสะสม — วางเฉพาะเลนพื้นที่ว่างจริง ๆ (ใต้ท้องยานคือจุดบอด)
  // รอบชิงไม่มีดาว: ด่านโบนัสจะพาคนหนึ่งหายไปจากสนาม 14 วินาทีกลางการดวลตัวต่อตัว
  if (!run.finalRound && run.stars < CFG.stars.needed && rnd() < CFG.stars.chancePerBreather) {
    const starTime = gateArrival + CFG.pacing.breatherSeconds * 0.62;
    const free = groundLanes.filter(l => laneFreeAt(l, starTime));
    if (free.length) {
      run.events.push({
        kind: 'star',
        time: starTime,
        lane: free[Math.floor(rnd() * free.length)],
        lead: CFG.stars.lead,
      });
    }
  }
}

function runDirector() {
  // โหมดฝึก: เวลาคิดกว้างสุดตลอด (ระดับความยากของเกมจริงไม่เกี่ยวกับการสอนคำใหม่)
  const windowSeconds = answerWindowFor(pace());

  // โหมดฝึก: คิวหมดชั่วคราว (ทุกข้อกำลังรอตัดสิน/รอวนกลับ) → เว้นการ spawn ด่านไว้ก่อน
  const gateReady = !run.gateSpawned && run.time >= run.nextGateArrival - windowSeconds
    && !(run.practice && !run.practice.queue.length);

  if (gateReady) {
    const arrival = run.nextGateArrival;
    spawnGate(windowSeconds);
    scheduleBreather(arrival);

    // จองคิวด่านถัดไป: [เวลามาถึงของด่านนี้] + [ช่วงพัก] + [เวลาคิดของด่านหน้า]
    run.nextGateArrival = arrival + CFG.pacing.breatherSeconds + answerWindowFor(pace() + 1);
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
  run.nextGateArrival = run.time + CFG.bonus.landSeconds + answerWindowFor(pace()) + 0.7;
  run.gateSpawned = false;
}

/* ── ผลของการตอบ ─────────────────────────────────────────── */

function passGate(gate) {
  const q = gate.question;
  srs.record(deck.id, q.word.en, true);
  clearWords(deck.id, [q.word.en]);   // ตอบถูกแล้ว → ปลดออกจากคิว "คำที่ต้องทวน"

  run.gates += 1;
  run.score += Math.round(CFG.score.perGate * run.combo * (run.br ? run.zone.reward : 1));
  run.combo = Math.min(CFG.score.comboMax, run.combo + 1);

  sfx.correct(run.combo);
  speak(q.word.en);            // dual coding: เห็น/ได้ยินคำเดียวกันซ้ำอีกครั้ง

  // ⭐ หัวใจของ Battle Royale: ตอบถูก = ได้หายใจ (ไม่ใช่แค่ได้แต้ม)
  // โซนที่ยากกว่าคืนออกซิเจนมากกว่า — นี่คือสิ่งที่ทำให้ "เลือกโซนโหด" คุ้มค่าจริง
  if (run.br) {
    addOxygen(CFG.br.storm.refillOnCorrect * run.zone.reward, 'gate');
    chargeWeapon();
  }

  hud.setScore(run.score, run.gates, run.combo);
}

/** ทุกครั้งที่พลาดคำ ให้หย่อนคำนั้นลงคิวฝึกทันที — ตายเร็ว = ได้ซ้อมตรงจุดมากขึ้น */
function noteMiss(word) {
  if (word?.en) addMissed(deck.id, [word.en]);
}

/**
 * กด "ใส่" ไอพ่นจากคลัง (Space/Enter/แตะจอ ระหว่างวิ่ง)
 * ใส่แล้วมีเปลวที่หลังตลอด และกันตายได้ 1 ครั้ง — ทุกสาเหตุ (ตอบผิด/ชนของ/ชนยาน)
 * ⚠️ เก็บมาเฉย ๆ โดยไม่ใส่ = ไม่กันอะไรเลย ชนแล้วตายปกติ (นี่คือการตัดสินใจของผู้เล่น)
 */
function equipJet() {
  if (state !== 'running' || !run || run.bonus || run.contest) return;
  if (run.jetArmed) { hud.toast('ไอพ่นใส่อยู่แล้ว', 900); return; }
  if (run.jets <= 0) return;
  run.jets -= 1;
  run.jetArmed = true;
  sfx.jetEquip();
  syncGear();
  hud.toast(`${armorEmoji()} ใส่${armorName()}แล้ว — กันตายได้ 1 ครั้ง`, 1600);
}

/** ไอพ่นที่ใส่อยู่ช่วยชีวิตจากการ "ชน" (สิ่งกีดขวาง/ยาน) — พุ่งข้ามแล้วเปลวดับ */
function rescueWithJet(message) {
  run.jetArmed = false;
  run.combo = 1;
  run.invuln = CFG.powerup.invulnMs / 1000;
  player.boost();
  sfx.jetUse();
  syncGear();
  hud.setScore(run.score, run.gates, run.combo);
  hud.toast(message, 2000);
}

/** ตอบผิดแต่ "ใส่ไอพ่นไว้" → พุ่งข้ามลำแสง แต่ยังนับว่าตอบผิดอยู่ */
function saveWithJet(gate) {
  const q = gate.question;
  run.jetArmed = false;
  run.combo = 1;
  run.invuln = CFG.powerup.invulnMs / 1000;

  srs.record(deck.id, q.word.en, false);   // เชิงเกมรอด แต่เชิงการเรียนรู้ไม่รอด
  noteMiss(q.word);
  pendingRetryWord = q.word;

  player.boost();
  sfx.jetUse();
  speak(q.word.en);

  syncGear();
  hud.setScore(run.score, run.gates, run.combo);
  hud.toast(`${armorEmoji()} ${armorName()}ช่วยไว้! คำที่ถูกคือ "${q.word.en}" = ${q.word.th}`, 2200);
}

function die(cause, word, chosen) {
  state = 'dying';
  dyingTimer = 0;

  world.shake(1.1);
  stopAmbience();
  hud.showContest(null);
  if (cause === 'obstacle') sfx.crash();
  if (cause === 'storm') sfx.horn();

  // ชนสิ่งกีดขวางไม่ใช่ความผิดเรื่องคำศัพท์ → ไม่นับว่าตอบผิด
  if (cause === 'lane' && word) srs.record(deck.id, word.en, false);
  // แต่ "ออกซิเจนหมด" คือความผิดเรื่องคำศัพท์เต็ม ๆ — คำที่ค้างอยู่ตอนนั้นควรได้ซ้อม
  if ((cause === 'lane' || cause === 'storm') && word) noteMiss(word);

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
    net.sendState({
      score: run.score, gates: run.gates, coins: run.coins,
      alive: false, finished: true, oxy: 0, ammo: 0,
    });
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
        hud.setPracticeProgress(run.practice.total - run.practice.remaining, run.practice.total);
        if (run.practice.remaining <= 0) { practiceDone(); return; }
      } else {
        srs.record(deck.id, q.word.en, false);
        run.combo = 1;
        run.invuln = 1.2;
        // วนกลับไปท้ายคิว — remaining ต้อง "คงเดิม" เพราะมันนับ *จำนวนครั้งที่ต้องตอบถูก*
        // ไม่ใช่จำนวนใบในคิว (ตอบผิดคือทำงานเพิ่ม ไม่ใช่เพิ่มเป้าหมาย)
        run.practice.queue.push(q.practiceEntry);
        noteMiss(q.word);
        speak(q.word.en);
        hud.toast(`ยังไม่ใช่ — "${q.word.en}" = ${q.word.th} (เดี๋ยวเจอกันอีกรอบ)`, 2400);
        hud.setScore(run.score, run.gates, run.combo);
      }
      hud.setPracticeProgress(run.practice.total - run.practice.remaining, run.practice.total);
      continue;
    }

    if (correct) {
      passGate(gate);
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

/**
 * ซิงก์ "สถานะเกราะ" ไปยังทั้ง HUD และตัวละครในฉากพร้อมกันจากที่เดียว
 *
 * ⚠️ เดิมสองอย่างนี้ถูกสั่งแยกกันคนละบรรทัด (hud.setJets / player.setArmed)
 * ซึ่งแปลว่าทุกครั้งที่เพิ่มทางที่เกราะเปลี่ยนได้ ต้องจำให้ครบทั้งคู่
 * พอมีทางที่เกราะเปลี่ยนได้ 6 ทาง (เก็บ/ใส่/โดนปลด/ช่วยชีวิต 3 แบบ) โอกาสลืมคือ 100%
 * และอาการที่ได้คือ "ตัวละครยังถือดาบอยู่ทั้งที่เกราะหมดแล้ว" = UI โกหกผู้เล่น
 */
function syncGear() {
  hud.setJets(run.jets, run.jetArmed);
  player.setGear(run.jets, run.jetArmed);
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
  syncGear();
  hud.setScore(run.score, run.gates, run.combo);

  // เข้าด่านโบนัสหลังประมวลผลของที่เก็บได้ทั้งหมดในเฟรมนี้เสร็จก่อน
  // (enterBonus ล้าง pool ทิ้ง ถ้าเรียกกลางลูปจะทำให้ของที่เหลือหายไปเฉย ๆ)
  if (enteredBonus) enterBonus();
}

/* ── วงจรหลัก ────────────────────────────────────────────── */

/**
 * 🔀 กระสุน "สลับธง": สลับตำแหน่งธง 2 ใบ พร้อมย้าย correctIndex ตามไปด้วย
 *
 * ⚠️ จุดที่พลาดง่ายที่สุดคือลืมย้าย correctIndex — ผลคือคำตอบที่ถูกไปโผล่ในเลนที่ผิด
 * ซึ่งไม่ใช่ "ยากขึ้น" แต่คือ "เกมโกง" ผู้เล่นที่รู้คำจะตอบผิดโดยไม่มีทางรู้ตัวเลย
 * กติกาต้องยังยุติธรรมเสมอหลังโดนอาวุธ — เปลี่ยนได้แค่ว่าต้องอ่านใหม่
 *
 * และสลับแค่ 2 ใบ ไม่ใช่สับใหม่ทั้งแถว เพราะสับหมด = โจทย์ใหม่ทั้งข้อ (แรงเกินไป)
 */
function swapFlags(q) {
  const n = q.options.length;
  const i = Math.floor(Math.random() * n);
  const j = (i + 1 + Math.floor(Math.random() * (n - 1))) % n;
  [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
  if (q.correctIndex === i) q.correctIndex = j;
  else if (q.correctIndex === j) q.correctIndex = i;

  hud.setQuestion(q);
  hud.flashSwap();
  sfx.select();
}

/** ส่งสถานะสรุปให้เพื่อน ~6–7 ครั้ง/วินาที (ถี่พอให้ลื่น เบาพอไม่ท่วมเน็ต)
 *  lane/py = ตำแหน่งสำหรับวาดโกสต์ของเราในจอเพื่อน (ฝั่งเขา lerp ให้ลื่นเอง)
 *  oxy/ammo = ให้ตารางคะแนนบอกได้ว่าใครกำลังจะร่วง และใครกำลังจะยิง */
function broadcastMpState() {
  if (!mpActive || mpFinished) return;
  const now = performance.now();
  if (now - mpBroadcastAt < 150) return;
  mpBroadcastAt = now;
  const payload = {
    score: run.score, gates: run.gates, coins: run.coins,
    alive: true, finished: false,
    lane: player.nearestLane(), py: +player.group.position.y.toFixed(2),
    oxy: +run.oxy.toFixed(2), ammo: run.ammo, zone: run.zone.id,
    skin: wallet.selected(),
  };

  // ── โจทย์สำหรับ "ผู้ชมที่สิงเราอยู่" ──
  // ส่งเฉพาะตอนโจทย์เปลี่ยนจริง ๆ ไม่ใช่ทุก 150ms — host เก็บค่าล่าสุดไว้ให้เอง
  // (ประหยัดแบนด์วิดท์ราว 95% เพราะโจทย์เปลี่ยนทุก ~5 วิ แต่สถานะส่งทุก 0.15 วิ)
  const q = run.activeQuestion;
  if (q && q !== mpLastSentQuestion) {
    mpLastSentQuestion = q;
    payload.q = {
      mode: q.mode,
      th: q.word.th, en: q.word.en, emoji: q.word.emoji || '',
      opts: q.options.map(o => o.en),
      trans: q.options.map(o => o.th || ''),
      correctIndex: q.correctIndex,
    };
  }
  net.sendState(payload);
}

function update(dt) {
  ghosts.update(dt);   // โกสต์เพื่อนขยับทุกสถานะ — ตายแล้วก็ยังดูเพื่อนแข่งต่อได้ (spectate)

  if (state === 'running') {
    run.time += dt;

    // ── ความเร็ว: ฐาน + ความเร่งตามเวลา + ตัวปรับชั่วคราวสองตัว ──
    // แยก speedBase ออกมาเพราะรอบชิงต้องเริ่มที่ความเร็วกลาง ๆ ของทุกคนเท่ากัน
    // ไม่ใช่ความเร็วที่แต่ละคนสะสมมาต่างกัน (คนที่รอดนานจะได้เปรียบ/เสียเปรียบฟรี ๆ)
    //
    // ⚠️ ทั้งสองตัวปรับต้องเป็น "ค่าที่ค่อย ๆ ไล่" (blend) ไม่ใช่สวิตช์เปิด-ปิด
    // บทเรียนที่เจ็บ: เดิมเขียนศึกชิงคำเป็น run.speed += (slow - run.speed)*k ในบล็อกถัดไป
    // แต่บรรทัดนี้เขียนทับ run.speed ใหม่ทุกเฟรม → การไล่ถูกลบทิ้งทุกเฟรม โลกไม่เคยช้าลงจริง
    // หลักคิด: ค่าที่คำนวณใหม่ทั้งก้อนทุกเฟรม ห้ามเก็บ "สถานะที่สะสม" ไว้ในตัวมันเอง
    // ต้องแยกสถานะออกมาไว้ในตัวแปรของตัวเอง (surgeBlend / slowBlend) แล้วค่อยประกอบร่างทีหลัง
    run.surgeT = Math.max(0, run.surgeT - dt);
    const surgeTarget = run.surgeT > 0 ? 1 : 0;
    run.surgeBlend += (surgeTarget - run.surgeBlend) * Math.min(1, dt * 2.2);
    run.slowBlend += ((run.contest ? 1 : 0) - run.slowBlend) * Math.min(1, dt * 2.5);

    let base = Math.min(CFG.speed.max, run.speedBase + CFG.speed.accel * run.time);
    if (run.practice) base = Math.min(base, CFG.practice.maxSpeed);
    // เร่งความเร็วไล่เข้าเป้าใน ~0.5 วิ ไม่กระชากทันที — ของที่ลอยอยู่กลางทางจะได้ไม่
    // ถูกบีบเวลามาถึงจนต่ำกว่าพื้นเวลาตอบสนองของมนุษย์ (CFG.pacing.obstacleLeadFloor)
    base += CFG.br.weapon.surgeBonus * run.surgeBlend;
    run.speed = base + (CFG.br.contest.slowSpeed - base) * run.slowBlend;
    run.invuln = Math.max(0, run.invuln - dt);

    run.fogT = Math.max(0, run.fogT - dt);
    hud.setFog(run.fogSpan > 0 ? run.fogT / run.fogSpan : 0);

    updateStorm(dt);
    if (state !== 'running') return;          // ออกซิเจนหมดในเฟรมนี้

    // ── ศึกชิงคำ: โลกช้าลงจนเกือบหยุด ไม่มีของเกิดใหม่ ไม่มีอะไรทำอันตราย ──
    if (run.contest) {
      const c = run.contest;
      c.t -= dt;                       // ปล่อยให้ติดลบได้ — ค่าติดลบคือตัวนับ "รอผลนานแค่ไหนแล้ว"
      hud.setContestTimer(Math.max(0, c.t) / CFG.br.contest.answerSeconds);
      // ไม่ตอบภายในเวลา = ส่งคำตอบว่างไป (ให้ host รู้ว่าเราตอบแล้ว จะได้ไม่รอเก้อ)
      if (c.t <= 0 && !c.sent) { c.sent = true; net.sendContestAnswer(c.id, -1); }

      // ⚠️ ตาข่ายกันค้าง: ถ้าข้อความ "ผลตัดสิน" หายไประหว่างทาง (เน็ตกระตุก/host หลุด)
      // ผู้เล่นจะติดอยู่ในโลกสโลว์โมชันตลอดกาลโดยไม่มีอะไรมาปลดให้
      // กติกาที่ต้องยึด: ทุกสถานะที่ "รอข้อความจากคนอื่น" ต้องมีทางออกด้วยตัวเองเสมอ
      if (c.t <= -CONTEST_GRACE) { endContest(); return; }

      player.update(dt, sfx);
      pickups.update(dt, run.speed);
      world.update(dt, run.speed, player.x());
      updateAmbience(run.speed);
      hud.setActiveLane(player.nearestLane());
      broadcastMpState();
      return;
    }

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

    // 🔀 กระสุน "สลับธง" ทำงานใน "ช่วงเวลาหนึ่ง" เท่านั้น ไม่ใช่ทุกจังหวะที่เร็วกว่าเกณฑ์
    // จังหวะนี้สำคัญมาก และต้องมีขอบทั้งสองด้าน:
    //   สลับเร็วเกิน → เหมือนแค่ "โจทย์มาช้าไปนิด" แทบไม่มีผล (อาวุธไร้ความหมาย)
    //   สลับช้าเกิน → ธงย้ายที่ตอนเหลือ 0.1 วิ = ตอบไม่ได้ (ผิดกฎเหล็กของอาวุธ)
    // ถ้าเลยหน้าต่างนี้ไปแล้ว swapPending จะค้างไว้ไปสลับที่ "ด่านถัดไป" แทน
    // — ยังโดนอยู่ แต่โดนในจังหวะที่ยังแก้ได้
    if (run.swapPending && pending
        && ratio < CFG.br.weapon.swapAtRatio && ratio > CFG.br.weapon.swapFloorRatio) {
      run.swapPending = false;
      swapFlags(pending.question);
    }

    broadcastMpState();
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
        // เลือกให้อัตโนมัติ: สิงคนที่นำอยู่ — ผู้เล่นที่เพิ่งตายไม่ควรต้องมานั่งหาว่าจะดูใคร
        const lead = [...mpRoster].filter(p => !p.finished && p.id !== net.selfId())
          .sort((a, b) => b.score - a.score)[0];
        if (lead) watchPlayer(lead.id);
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

/**
 * สลับแท็บ/สลับแอปกลางเกม
 *
 * เล่นเดี่ยว → พักให้เลย (มารยาทที่ดี ไม่มีใครเสียหาย)
 * โหมดแข่ง → พักไม่ได้ (ดูเหตุผลที่ pauseGame) แต่ก็ลงโทษให้ตายทันทีไม่ได้เหมือนกัน
 *   เพราะบนมือถือ การมีสายเข้า/แจ้งเตือนเด้งคือเรื่องที่เกิดขึ้นเองโดยผู้เล่นไม่ได้ตั้งใจ
 * ทางสายกลางที่ยุติธรรม: ปล่อยให้ "พายุกินตามเวลาจริงที่หายไป"
 *   → หนีไม่ได้ (ไม่มีช่องโกงด้วยการซ่อนแท็บ) แต่ก็ไม่ได้ถูกฆ่าเพราะเรื่องนอกเกม
 */
let hiddenAt = 0;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state === 'running') {
      if (inLiveRace()) hiddenAt = performance.now();
      else pauseGame();
    }
  } else if (hiddenAt && state === 'running' && run?.br) {
    const away = Math.min(90, (performance.now() - hiddenAt) / 1000);   // กันเคสสลับไปทั้งวัน
    hiddenAt = 0;
    if (away > 1 && !run.bonus && !run.contest) {
      const dead = addOxygen(-drainOver(away, run.stormLvl), null);
      hud.toast(`🌪️ หายไป ${Math.round(away)} วิ — พายุกินพลังไปตามเวลาจริง`, 2600);
      if (dead) die('storm', gates.pending()?.question.word ?? null, null);
    }
  } else {
    hiddenAt = 0;
  }
  lastFrame = performance.now();
});

/* ── เริ่มระบบ ───────────────────────────────────────────── */

async function selectDeck(file) {
  deck = await loadDeck(file);
  pendingRetryWord = null;
  ui.setDeckInfo(deck);
  ui.setPracticeBadge(pendingCount(deck.id));
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
    world,
    hud,
    CFG,
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
    // ── Battle Royale: เรียกกลไกแต่ละอย่างตรง ๆ เพื่อทดสอบโดยไม่ต้องรอเวลาจริง ──
    onStorm, onContestStart, onContestResult, enterFinalRound, onAttacked,
    fireWeapon, cycleAmmo, contestPick, selectTarget,
    forceBattle: () => { if (run) { run.br = true; hud.setBattleVisible(true); hud.setOxygen(run.oxy, run.stormLvl); } },
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
