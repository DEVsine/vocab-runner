/**
 * kids-lesson.js — ลำดับโจทย์โหมดเด็ก (teach → retrieve ทีละช่องทาง)
 *
 * แทนที่จะสุ่มโหมด/คำปนกัน ให้เด็กเจอชุดคำ ~5 คำเดิมซ้ำในโหมดเดียวกันก่อน
 * แล้วค่อยเลื่อนขั้น: รูป → เสียง → ไทย → ชุดคำใหม่
 */

import { CFG } from './config.js';

function randInt(min, max, rand) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function slicePool(deck, start, size) {
  const words = deck.words;
  if (!words.length) return [];
  const startIdx = ((start % words.length) + words.length) % words.length;
  const out = [];
  for (let i = 0; i < size && i < words.length; i++) {
    out.push(words[(startIdx + i) % words.length]);
  }
  return out;
}

function phaseBudget(phase, rand) {
  return randInt(phase.min, phase.max, rand);
}

/**
 * @param {object} deck — เด็คที่กรองแล้ว (kidsDeck)
 * @param {{ groupStart?: number, rand?: Function }} opts
 */
export function createKidsLesson(deck, { groupStart = 0, rand = Math.random } = {}) {
  const { poolSize, phases } = CFG.kids.lesson;
  const pool = slicePool(deck, groupStart, poolSize);
  const phaseIndex = 0;
  return {
    groupStart,
    pool,
    phases,
    phaseIndex,
    phaseRemaining: phaseBudget(phases[0], rand),
    wordIndex: 0,
  };
}

/** ขั้นถัดไปของชุดคำเดียวกัน — รีเซ็ตเป็นโหมดรูป */
export function advanceKidsGroup(lesson, deck, rand = Math.random) {
  const { poolSize, phases } = CFG.kids.lesson;
  lesson.groupStart += lesson.pool.length || poolSize;
  lesson.pool = slicePool(deck, lesson.groupStart, poolSize);
  lesson.phaseIndex = 0;
  lesson.phaseRemaining = phaseBudget(phases[0], rand);
  lesson.wordIndex = 0;
}

/** เลื่อนไปโหมดถัดไปในชุดคำเดิม (รูป → เสียง → ไทย) */
export function advanceKidsPhase(lesson, deck, rand = Math.random) {
  lesson.phaseIndex += 1;
  if (lesson.phaseIndex >= lesson.phases.length) {
    advanceKidsGroup(lesson, deck, rand);
    return;
  }
  lesson.wordIndex = 0;
  lesson.phaseRemaining = phaseBudget(lesson.phases[lesson.phaseIndex], rand);
}

/**
 * โจทย์ด่านถัดไป — คืน { word, mode } แล้วอัปเดตสถานะภายใน
 */
export function nextKidsGate(lesson, deck, rand = Math.random) {
  if (!lesson.pool.length) {
    lesson.pool = slicePool(deck, lesson.groupStart, CFG.kids.lesson.poolSize);
  }

  const phase = lesson.phases[lesson.phaseIndex];
  const word = lesson.pool[lesson.wordIndex % lesson.pool.length];
  lesson.wordIndex += 1;

  const mode = phase.mode;
  lesson.phaseRemaining -= 1;
  if (lesson.phaseRemaining <= 0) advanceKidsPhase(lesson, deck, rand);

  return { word, mode };
}

/** ใช้ในเทส — อ่านโหมด/จำนวนด่านของขั้นปัจจุบันโดยไม่เปลี่ยนสถานะ */
export function peekKidsPhase(lesson) {
  const phase = lesson.phases[lesson.phaseIndex];
  return { mode: phase.mode, remaining: lesson.phaseRemaining };
}

const STEP_ICONS = { image: '🖼️', audio: '🔊', text: '🔤' };
const STEP_NAMES = { image: 'รูป', audio: 'เสียง', text: 'ไทย' };

/** ป้ายขั้นสอนบน HUD — remaining หลัง nextKidsGate = ด่านที่เหลือหลังด่านนี้ */
export function kidsStepLabel(lesson) {
  if (!lesson) return null;
  const phase = lesson.phases[lesson.phaseIndex];
  const icon = STEP_ICONS[phase.mode] ?? '❓';
  const name = STEP_NAMES[phase.mode] ?? phase.mode;
  const left = lesson.phaseRemaining + 1;
  return `${icon} สอน${name} · อีก ${left} ด่าน`;
}
