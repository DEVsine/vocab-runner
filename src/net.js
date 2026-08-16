/**
 * net.js — ชั้นเครือข่ายสำหรับโหมดแข่งหลายคน (ห่อ PeerJS/WebRTC)
 *
 * ── ทำไมออกแบบเป็น "host-relay star" ไม่ใช่ full-mesh ──
 * ถ้าให้ทุกคนต่อหากันเองแบบตาข่าย (mesh) จำนวนคอนเนกชัน = n·(n−1)/2 และแต่ละคน
 * ต้องรวมสถานะจากหลายทางเอง ยุ่งและพังง่าย เราเลยใช้ดาว: คนสร้างห้อง = "host"
 * ทุกคนต่อเข้า host คนเดียว, host รวมสถานะทุกคนแล้ว "กระจาย" (relay) กลับไปให้ทุกคน
 * → client แต่ละคนมีคอนเนกชันเดียว และเห็นภาพรวมตรงกันเสมอ (host เป็นแหล่งความจริง)
 *
 * ── "โลกใครโลกมัน" กับข้อยกเว้นสามอย่าง ──
 * ปกติเราส่งแค่ "สถานะสรุป" (ชื่อ, คะแนน, รอด/ตาย, ตำแหน่งคร่าว ๆ) ไม่กี่ครั้งต่อวินาที
 * ไม่ได้ sync โลกให้ตรงกัน — ทนเน็ตช้าได้และไม่ต้องรื้อ engine ให้ deterministic
 * แต่มีสามอย่างที่ **ต้อง** ตรงกันทุกเครื่อง เพราะมันคือตัวเกม:
 *   1) พายุ  — host คุมนาฬิกาแล้วกระจายระดับ (ไม่งั้นแต่ละคนตายคนละเวลาแบบไม่มีเหตุผล)
 *   2) ศึกชิงคำ — โจทย์เดียวกันพร้อมกัน (นี่คือจุดเดียวที่ทุกคน "ปะทะกันตรง ๆ" ได้)
 *   3) รอบชิง — เมล็ดสุ่มเดียวกัน ทำให้ 2 นาทีสุดท้ายเป็นแทร็กเดียวกันจริง ๆ
 * สังเกตว่าทั้งสามอย่างส่งข้อมูล "น้อยมาก" (ตัวเลขไม่กี่ตัว) — นั่นคือเหตุผลที่
 * มันเป็นไปได้โดยไม่ต้องมีเซิร์ฟเวอร์: เราซิงค์ "กติกา" ไม่ได้ซิงค์ "โลก"
 *
 * ⚠️ พึ่ง broker ฟรีของ PeerJS สำหรับ "จับคู่" (signaling) เท่านั้น หลังต่อติดแล้ว
 *    ข้อมูลวิ่ง P2P ตรงระหว่างเครื่อง — ไม่มีเซิร์ฟเวอร์ของเรา, ไม่ต้องสมัครบัญชี
 */

import { CFG } from './config.js';
import { stormLevel } from './storm.js';
import { randomSeed } from './rng.js';

const NS = 'vocabrun';                              // เติมหน้า id กัน "ชน" กับแอปอื่นบน broker เดียวกัน
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัด I,O,0,1 ทิ้ง กันอ่านรหัสผิด
const BROADCAST_MIN_MS = 110;                        // host กระจาย roster ถี่สุดเท่านี้ (กันสแปม)
const STALE_MS = 9000;                               // ไม่ได้ข่าวจากใครเกินนี้ = ถือว่าหลุด
const UID_KEY = 'vocab-runner:uid';

const hasPeer = () => typeof window !== 'undefined' && typeof window.Peer === 'function';

function makeCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/**
 * รหัสประจำ "แท็บ" ที่อยู่ข้ามการรีเฟรช
 *
 * ⚠️ นี่คือตัวแก้บั๊ก "ออกแล้วเข้าใหม่ ชื่อซ้ำ"
 * PeerJS แจก id ใหม่ทุกครั้งที่เปิดคอนเนกชัน ดังนั้นคนเดิมที่รีเฟรชหน้า
 * จะกลายเป็น "คนใหม่" ในสายตา host ส่วนตัวเก่ายังค้างอยู่ในรายชื่อ
 * → เห็นชื่อเดียวกันสองแถว แถวหนึ่งเป็นผีที่ไม่มีวันขยับ
 *
 * ทางแก้เชิงหลักการ: อย่าใช้ "ที่อยู่ของคอนเนกชัน" เป็น "ตัวตนของผู้เล่น"
 * ตัวตนต้องมาจากฝั่งผู้เล่นเองและอยู่ทน host จึงใช้ uid ตัดสินว่า "คนนี้คือคนเดิม"
 *
 * ── ทำไม sessionStorage ไม่ใช่ localStorage ──
 * localStorage ใช้ร่วมกันทุกแท็บของโดเมนเดียวกัน ถ้าเก็บไว้ที่นั่น การเปิดเกม
 * สองแท็บบนเครื่องเดียว (พ่อลูกเล่นด้วยกัน / คนทดสอบเอง) จะกลายเป็น "คนเดียวกัน"
 * แล้วแท็บที่เข้าทีหลังจะเตะแท็บแรกออกจากห้องทันที — แก้บั๊กหนึ่งไปสร้างอีกบั๊กหนึ่ง
 * sessionStorage แยกตามแท็บแต่ "อยู่รอดการรีเฟรช" ซึ่งตรงกับนิยามของ
 * "คนเดิมที่กลับเข้ามาใหม่" พอดีเป๊ะ
 *
 * ⚠️ ไม่ได้เช็ก conn.open ก่อนไล่ตัวเก่าออกโดยตั้งใจ:
 * ตอนรีเฟรช คอนเนกชันเก่าจะยัง "ดูเหมือนเปิดอยู่" ในสายตา host อีกหลายวินาที
 * (ICE ต้องรอ timeout เอง) — ถ้ารอให้มันปิดก่อน ผู้เล่นจะเห็นชื่อซ้ำอยู่ดี
 */
function myUid() {
  try {
    let u = sessionStorage.getItem(UID_KEY);
    if (!u) {
      u = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(UID_KEY, u);
    }
    return u;
  } catch {
    // โหมดส่วนตัวอ่าน/เขียนไม่ได้ — ยอมเสียคุณสมบัติ "จำได้ข้ามรีเฟรช" ไป
    // (ยังเหลือตาข่ายอีกสองชั้น: pruneStale และการเติมเลขท้ายชื่อที่ซ้ำ)
    return `u${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * สีประจำผู้เล่น (hue 0–360) คำนวณจาก id แบบ deterministic
 * ทุกเครื่องได้สีเดียวกันโดย "ไม่ต้องส่งสีผ่านเน็ตเลย" — เพราะทุกคนเห็น id เดียวกัน
 * ใช้ร่วมกัน 3 ที่: ตัวโกสต์ในฉาก, จุดสีในล็อบบี้, จุดสีในตารางคะแนน
 */
export function playerHue(id) {
  let h = 0;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function createNet() {
  let peer = null;
  let isHost = false;
  let hostConn = null;          // ฝั่ง client: คอนเนกชันไปยัง host
  const conns = new Map();      // ฝั่ง host: id -> DataConnection
  const roster = new Map();     // ฝั่ง host: id -> สถานะผู้เล่น (แหล่งความจริง)
  let selfId = null;
  let selfName = 'ผู้เล่น';
  const selfUid = myUid();
  let roomCode = null;
  let lastBroadcast = 0;
  let staleTimer = null;

  const cb = {
    roster: () => {}, start: () => {}, status: () => {},
    error: () => {}, closed: () => {}, winner: () => {}, attack: () => {},
    storm: () => {}, contest: () => {}, contestResult: () => {}, final: () => {},
  };
  // host เรียกฟังก์ชันนี้เพื่อขอ "โจทย์ศึกชิงคำ" จากตัวเกม (net.js ไม่รู้จัก deck)
  let questionSource = null;

  /* ── ตัวช่วยฝั่ง host ─────────────────────────────────────── */

  // lane/py = ตำแหน่งล่าสุดของผู้เล่น ใช้วาด "โกสต์" ของกันและกันในฉาก
  // oxy = ออกซิเจน 0..1 (พายุ), ammo = กระสุนในมือ — ตารางคะแนนใช้ทั้งคู่
  function blankState(id, name, host, uid) {
    return {
      id, name, host, uid,
      score: 0, gates: 0, coins: 0, alive: false, finished: false,
      lane: 1, py: 0, oxy: 1, ammo: 0, zone: 'mid', skin: 'astro',
    };
  }

  /**
   * ชื่อที่ไม่ชนกับใครในห้อง — คนละเครื่องที่ตั้งชื่อเหมือนกันจะได้ (2), (3) ต่อท้าย
   * (ต่างจากกรณี uid ซ้ำ ซึ่งคือ "คนเดิม" และต้องถูกแทนที่ ไม่ใช่ต่อเลข)
   */
  function uniqueName(base, uid) {
    const wanted = (base || 'ผู้เล่น').slice(0, 16);
    const taken = new Set(
      [...roster.values()].filter(p => p.uid !== uid).map(p => p.name)
    );
    if (!taken.has(wanted)) return wanted;
    for (let i = 2; i < 40; i++) {
      const candidate = `${wanted} (${i})`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${wanted} (${Math.floor(Math.random() * 900) + 100})`;
  }

  /** ไล่ "ตัวเก่า" ของ uid นี้ออกจากห้อง ก่อนรับตัวใหม่เข้ามา */
  function evictOldSelf(uid, keepPeerId) {
    if (!uid) return false;
    let removed = false;
    for (const [id, p] of [...roster]) {
      if (p.uid !== uid || id === keepPeerId) continue;
      roster.delete(id);
      participants.delete(id);
      const old = conns.get(id);
      if (old) { try { old.close(); } catch { /* ปิดไปแล้ว */ } }
      conns.delete(id);
      removed = true;
    }
    return removed;
  }

  /* ── Battle Royale: host ตัดสิน "ผู้รอดคนสุดท้าย" ──────────────
   * participants = รายชื่อผู้เล่น ณ ตอนกดเริ่มรอบ (คนที่เข้าห้องทีหลังไม่นับรอบนี้)
   * ตกรอบได้ 3 ทาง: ตายในเกม, ออกซิเจนหมด (พายุ), หรือหลุดการเชื่อมต่อ
   * เหลือ ≤1 คน → ประกาศผู้ชนะครั้งเดียวแล้วปิดรอบ */
  let roundActive = false;
  let participants = new Set();
  let raceMode = 'solo';       // solo | duo | squad
  let teams = {};              // id -> เลขทีม (เฉพาะโหมดทีม)
  let raceStartedAt = 0;       // performance.now() ตอนกดเริ่ม (host เท่านั้น)
  let stormTimer = null;
  let contestTimer = null;
  let contestState = null;     // { id, correctIndex, winnerId, winnerName, resultTimer }
  let contestSeq = 0;
  let finalStarted = false;

  const raceSeconds = () => (raceStartedAt ? (performance.now() - raceStartedAt) / 1000 : 0);

  function sendAll(msg) {
    for (const c of conns.values()) { try { c.send(msg); } catch { /* กำลังปิด */ } }
  }

  function aliveIds() {
    return [...participants].filter(id => {
      const p = roster.get(id);
      return p && !p.finished;
    });
  }

  function checkWinner() {
    if (!isHost || !roundActive) return;
    const alive = aliveIds();

    let msg;
    if (raceMode === 'solo') {
      if (alive.length > 1) { maybeStartFinal(alive); return; }
      const winId = alive[0] ?? null;
      const p = winId ? roster.get(winId) : null;
      msg = { t: 'winner', id: winId, name: p?.name ?? '—', score: p?.score ?? 0 };
    } else {
      // โหมดทีม: นับ "ทีมที่ยังมีคนรอด" — สมาชิกที่ตายไปก่อนก็ชนะด้วยในฐานะทีม
      const aliveTeams = new Set(alive.map(id => teams[id] ?? 0));
      if (aliveTeams.size > 1) { maybeStartFinal(alive); return; }
      const teamIdx = [...aliveTeams][0] ?? null;
      const winnerIds = teamIdx === null
        ? []
        : [...participants].filter(id => teams[id] === teamIdx);
      msg = {
        t: 'winner', team: teamIdx, winnerIds,
        names: winnerIds.map(id => roster.get(id)?.name || 'ผู้เล่น'),
      };
    }

    endRound();
    sendAll(msg);
    cb.winner(msg);
  }

  /**
   * รอบชิง: เหลือน้อยคนแล้ว → ส่ง "เมล็ดสุ่ม" ตัวเดียวให้ทุกคน
   *
   * ทำไมทำ deterministic แค่ตอนท้าย ไม่ทำทั้งเกม?
   * การซิงค์โลกทั้งเกมแปลว่าต้องล็อกทุกอย่างที่สุ่ม (คำถามด้วย!) ให้ตรงกันตลอด
   * ซึ่งขัดกับหัวใจของเกมสอนคือ "คำที่คุณเจอต้องมาจากจุดอ่อนของคุณเอง"
   * แต่ตอนเหลือ 2–3 คน มันไม่ใช่บทเรียนแล้ว มันคือการดวล — ตรงนั้นความยุติธรรม
   * สำคัญกว่าความเฉพาะตัว เราจึงสลับโหมดเฉพาะช่วงท้ายที่มันคุ้ม
   */
  function maybeStartFinal(alive) {
    if (finalStarted || alive.length < 2 || alive.length > CFG.br.final.atAlive) return;
    // ⚠️ ต้องมีคนตกรอบไปแล้วอย่างน้อย 1 คน ไม่งั้นห้อง 3 คนจะเข้ารอบชิง "ตั้งแต่วินาทีแรก"
    // (alive = 3 ซึ่ง ≤ เกณฑ์พอดี) แล้วทั้งแมตช์จะกลายเป็นรอบชิงล้วน ๆ
    // — โซนลงจอด/พายุที่ค่อย ๆ แรงขึ้นจะไม่มีความหมายเลย
    if (alive.length >= participants.size) return;
    if (raceMode !== 'solo') {
      // โหมดทีม: เข้ารอบชิงเมื่อเหลือ 2 ทีมและคนรวมกันไม่เกินเกณฑ์
      const t = new Set(alive.map(id => teams[id] ?? 0));
      if (t.size < 2) return;
    }
    finalStarted = true;
    const msg = { t: 'final', seed: randomSeed(), alive: alive.length };
    sendAll(msg);
    cb.final(msg);
  }

  /* ── พายุ: host คุมนาฬิกาเดียว แล้วกระจายให้ทุกคน ─────────────
   * ถ้าปล่อยให้แต่ละเครื่องจับเวลาเอง นาฬิกาจะเหลื่อมกันทีละนิดจนถึงจุดที่
   * "คนหนึ่งเจอพายุระดับ 3 ตอนอีกคนยังระดับ 2" = ตายกันคนละกติกา
   * ค่าที่ส่งคือ "วินาทีของแมตช์" ไม่ใช่ระดับพายุ เพราะวินาทีคือความจริงดิบ
   * ส่วนสูตรแปลงเป็นระดับอยู่ใน storm.js ที่ทุกเครื่องมีเหมือนกันอยู่แล้ว */
  function startStormClock() {
    clearInterval(stormTimer);
    raceStartedAt = performance.now();
    const tick = () => {
      if (!roundActive) return;
      const sec = raceSeconds();
      const msg = { t: 'storm', sec: +sec.toFixed(2), level: +stormLevel(sec).toFixed(3) };
      sendAll(msg);
      cb.storm(msg);
    };
    tick();
    stormTimer = setInterval(tick, CFG.br.storm.broadcastMs);
  }

  /* ── ศึกชิงคำ ────────────────────────────────────────────────
   * host หยิบโจทย์จากตัวเกม (questionSource) แล้วยิงให้ทุกคนพร้อมกัน
   * ผู้ชนะคือ "ข้อความตอบถูกใบแรกที่มาถึง host" — เกณฑ์เดียวที่ตัดสินได้จริง
   * ในระบบที่ไม่มีนาฬิกากลาง (เราไม่มีเซิร์ฟเวอร์ จึงไม่มีเวลาสัมบูรณ์ให้เทียบ) */
  function scheduleContests() {
    clearTimeout(contestTimer);
    const c = CFG.br.contest;
    const fire = () => {
      if (!roundActive) return;
      runContest();
      contestTimer = setTimeout(fire, c.everySeconds * 1000);
    };
    contestTimer = setTimeout(fire, c.firstAtSeconds * 1000);
  }

  function runContest() {
    if (!isHost || !roundActive || contestState) return;
    const alive = aliveIds();
    if (alive.length < 2) return;               // ดวลคนเดียวไม่มีความหมาย
    const q = questionSource?.();
    if (!q) return;

    const id = ++contestSeq;
    contestState = { id, correctIndex: q.correctIndex, winnerId: null, winnerName: null, answers: new Set() };
    const msg = { t: 'contest', id, ...q };
    sendAll(msg);
    cb.contest(msg);

    // เผื่อเวลาเดินทางของข้อความคนสุดท้ายอีกนิด แล้วค่อยประกาศผล
    contestState.resultTimer = setTimeout(() => {
      const cur = contestState;
      if (!cur) return;
      contestState = null;
      const result = {
        t: 'contestResult', id: cur.id,
        winnerId: cur.winnerId, winnerName: cur.winnerName,
        correctIndex: cur.correctIndex,
      };
      sendAll(result);
      cb.contestResult(result);
    }, CFG.br.contest.answerSeconds * 1000 + 700);
  }

  function recordContestAnswer(fromId, fromName, id, index) {
    if (!contestState || contestState.id !== id) return;
    if (contestState.answers.has(fromId)) return;   // ตอบได้ครั้งเดียว
    contestState.answers.add(fromId);
    if (contestState.winnerId) return;
    if (index === contestState.correctIndex) {
      contestState.winnerId = fromId;
      contestState.winnerName = fromName;
    }
  }

  /* ── อาวุธ: ผู้ยิงเลือกเป้าเอง แต่ host เป็นคนตรวจ ────────────
   * เดิม host เป็นคนเล็งให้ (ยิงใส่ผู้นำเสมอ) ซึ่งดีเชิงสมดุลแต่ผู้เล่นไม่ได้ตัดสินใจอะไร
   * ตอนนี้ผู้เล่นเลือกเป้าเอง — แต่ host ยังต้องตรวจ 3 อย่างที่ client โกหกได้:
   *   เป้ายังมีชีวิตไหม / เป็นคนละทีมไหม / อยู่ในรอบนี้ไหม
   * แล้วคืนค่ากลับไปว่า "โดนผู้นำหรือเปล่า" เพื่อให้เกมจ่ายโบนัสล่าผู้นำได้ถูก */
  function routeAttack(fromId, fromName, targetId, ammo) {
    if (!roundActive) return;
    const eligible = (id) => {
      if (id === fromId) return false;
      const p = roster.get(id);
      if (!p || p.finished || !participants.has(id)) return false;
      if (raceMode !== 'solo' && teams[id] === teams[fromId]) return false;
      return true;
    };

    let target = targetId && eligible(targetId) ? targetId : null;
    if (!target) {
      // ไม่ได้เลือกเป้า (หรือเป้าตายไปแล้ว) → ถอยกลับเป็นพฤติกรรมเดิม: ยิงผู้นำ
      const candidates = [...participants].filter(eligible);
      if (!candidates.length) return;
      candidates.sort((a, b) => (roster.get(b)?.score ?? 0) - (roster.get(a)?.score ?? 0));
      target = candidates[0];
    }

    // "ผู้นำ" = คะแนนสูงสุดในบรรดาคนที่ยังรอดทั้งหมด (ไม่แบ่งทีม) — ใช้จ่ายค่าหัว
    const leader = aliveIds().sort(
      (a, b) => (roster.get(b)?.score ?? 0) - (roster.get(a)?.score ?? 0)
    )[0];

    const msg = { t: 'atkTo', from: fromName, ammo };
    if (target === selfId) cb.attack(fromName, ammo);
    else { try { conns.get(target)?.send(msg); } catch { /* ปิดอยู่ */ } }

    // แจ้งกลับผู้ยิงว่ายิงโดนใคร (และเป็นผู้นำหรือไม่)
    const ack = {
      t: 'atkAck', targetId: target,
      targetName: roster.get(target)?.name || 'คู่แข่ง',
      leader: target === leader,
    };
    if (fromId === selfId) cb.attackAck?.(ack);
    else { try { conns.get(fromId)?.send(ack); } catch { /* ปิดอยู่ */ } }
  }

  /* ── โหมดสิง: ผู้ชมขอดูโจทย์ของคนที่ยังวิ่งอยู่ ────────────────
   * ⚠️ โจทย์ต้องส่งแบบ "เจาะจงถึงผู้ชมคนนั้น" เท่านั้น ห้ามใส่ไปใน roster เด็ดขาด
   * เพราะ roster ถูกกระจายให้ทุกคนรวมถึงคนที่ยังเล่นอยู่ — และในรอบชิงที่ทุกคน
   * วิ่งบนแทร็กเดียวกัน โจทย์ของคนอื่นก็คือโจทย์ของเราเอง
   * ถ้าส่งคำตอบที่ถูกไปกับ roster เท่ากับแจกเฉลยให้คู่แข่งที่วิ่งตามหลังอยู่
   */
  const watching = new Map();      // ผู้ชม id -> id ของคนที่สิงอยู่

  function relayQuestion(fromId, q) {
    if (!q) return;
    const msg = { t: 'watchQ', from: fromId, q };
    for (const [watcher, target] of watching) {
      if (target !== fromId) continue;
      if (watcher === selfId) cb.watchQ?.(msg);
      else { try { conns.get(watcher)?.send(msg); } catch { /* ปิดอยู่ */ } }
    }
  }

  let trailingTimer = null;

  /**
   * ⚠️ ต้องเป็น throttle แบบ "เก็บขอบท้าย" (trailing edge) เสมอ
   *
   * บั๊กที่เคยเกิด: ข้อความ "ผม/เธอตายแล้ว" มาถึงภายใน 110ms หลัง broadcast รอบก่อน
   * → โดนข้ามเพราะ throttle และ "ไม่มีการนัดส่งภายหลัง" พอคนตายหยุดส่งข้อความใหม่
   * ก็ไม่มีอะไรมากระตุ้น broadcast อีก → ทุกคนเห็นคนตายวิ่งต่อค้างอยู่ตลอดกาล
   *
   * หลักคิด: throttle แบบทิ้งขอบท้ายใช้ได้กับ "สตรีมที่ไหลต่อเนื่อง" เท่านั้น
   * ถ้าข้อความสุดท้ายของชุดมีความหมาย (เช่น สถานะจบเกม) ต้องนัดส่งตามหลังเสมอ
   */
  function broadcastRoster(force = false) {
    if (!isHost) return;
    const now = performance.now();
    if (!force && now - lastBroadcast < BROADCAST_MIN_MS) {
      if (!trailingTimer) {
        trailingTimer = setTimeout(() => {
          trailingTimer = null;
          broadcastRoster(true);
        }, BROADCAST_MIN_MS);
      }
      return;
    }
    lastBroadcast = now;
    // แนบเลขทีมไปกับ roster — ล็อบบี้/ตารางคะแนนใช้แสดงป้ายทีมโดยไม่ต้องมีข้อความแยก
    const players = [...roster.values()].map(({ lastSeen, q, ...p }) => ({ ...p, team: teams[p.id] }));
    sendAll({ t: 'roster', players });
    cb.roster(players);          // host ก็ต้องเห็น roster ของตัวเองด้วย
  }

  function pruneStale() {
    if (!isHost) return;
    const now = performance.now();
    let changed = false;
    for (const [id, p] of roster) {
      if (id === selfId) continue;
      const conn = conns.get(id);
      // ⚠️ เดิมข้ามคนที่ยังมี conn อยู่ — แต่บนมือถือ คอนเนกชันที่ "ตายแล้ว"
      // มักไม่ยิง close/error เลย (แอปถูกพักกลางคัน) → ผีค้างในห้องตลอดกาล
      // จึงต้องเช็ก conn.open ด้วย ไม่ใช่แค่ "มี conn อยู่ไหม"
      const live = conn && conn.open;
      if (!live && now - (p.lastSeen || 0) > STALE_MS) {
        roster.delete(id);
        conns.delete(id);
        changed = true;
      }
    }
    if (changed) { broadcastRoster(true); checkWinner(); }
  }

  /* ── รับข้อความ (host) ───────────────────────────────────── */

  function onHostData(conn, data) {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'state') {
      const prev = roster.get(conn.peer);
      if (!prev) return;                       // ยังไม่ผ่าน open (หรือถูกไล่ออกไปแล้ว)
      roster.set(conn.peer, {
        ...prev, ...(data.s || {}),
        id: conn.peer, name: prev.name, host: false, uid: prev.uid,
        lastSeen: performance.now(),
      });
      if (data.s?.q) relayQuestion(conn.peer, data.s.q);
      broadcastRoster();
      checkWinner();     // สถานะใหม่อาจเป็น "ผมตายแล้ว" → เช็กว่าเหลือคนสุดท้ายหรือยัง
    } else if (data.t === 'watch') {
      watching.set(conn.peer, data.target || null);
    } else if (data.t === 'atk') {
      routeAttack(conn.peer, roster.get(conn.peer)?.name || 'คู่แข่ง', data.target, data.ammo);
    } else if (data.t === 'contestAnswer') {
      recordContestAnswer(conn.peer, roster.get(conn.peer)?.name || 'คู่แข่ง', data.id, data.index);
    }
  }

  function acceptConnection(conn) {
    conn.on('open', () => {
      const uid = conn.metadata?.uid || null;
      // คนเดิมที่รีเฟรช/เข้าใหม่ → ไล่ตัวเก่าออกก่อน แล้วค่อยรับตัวใหม่เข้าแทน
      const rejoined = evictOldSelf(uid, conn.peer);

      conns.set(conn.peer, conn);
      const name = uniqueName(conn.metadata?.name, uid);
      const entry = blankState(conn.peer, name, false, uid);
      entry.lastSeen = performance.now();
      roster.set(conn.peer, entry);

      try { conn.send({ t: 'welcome', id: conn.peer, name }); } catch { /* ปิดไปแล้ว */ }
      broadcastRoster(true);
      cb.status(rejoined
        ? `${name} กลับเข้าห้องแล้ว (${conns.size + 1} คน)`
        : `มีผู้เล่นเข้าห้อง (${conns.size + 1} คน)`);
      if (rejoined) checkWinner();   // ตัวเก่าที่ถูกไล่ออกอาจเป็นคนสุดท้ายที่ยัง "รอด" อยู่
    });
    conn.on('data', (d) => onHostData(conn, d));
    const drop = () => {
      // ⚠️ ห้ามลบมั่ว: ถ้าคนนี้กลับเข้ามาแล้วด้วย peer id ใหม่ conn เก่าจะยิง close ตามหลัง
      // ต้องเช็กว่า conn ที่กำลังปิดคือ "ตัวที่ลงทะเบียนอยู่จริง" ก่อนถึงจะลบ roster
      if (conns.get(conn.peer) !== conn) return;
      conns.delete(conn.peer);
      roster.delete(conn.peer);
      broadcastRoster(true);
      checkWinner();     // หลุดกลางรอบ = ตกรอบ (กติกา Battle Royale)
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  /* ── รับข้อความ (client) ─────────────────────────────────── */

  function onClientData(data) {
    if (!data || typeof data !== 'object') return;
    switch (data.t) {
      case 'welcome': if (data.name) selfName = data.name; break;
      case 'roster': cb.roster(data.players || []); break;
      case 'start': applyStartMsg(data); cb.start(data); break;
      case 'winner': cb.winner(data); break;
      case 'atkTo': cb.attack(data.from || 'คู่แข่ง', data.ammo); break;
      case 'atkAck': cb.attackAck?.(data); break;
      case 'watchQ': cb.watchQ?.(data); break;
      case 'storm': cb.storm(data); break;
      case 'contest': cb.contest(data); break;
      case 'contestResult': cb.contestResult(data); break;
      case 'final': cb.final(data); break;
      case 'closed': cb.closed(); teardown(); break;
      default: break;
    }
  }

  /** client จำโหมด/ทีมของรอบนี้ไว้ เผื่อ UI ต้องใช้ */
  function applyStartMsg(msg) {
    raceMode = msg.mode || 'solo';
    teams = msg.teams || {};
  }

  /* ── API สาธารณะ ─────────────────────────────────────────── */

  function on(event, fn) { cb[event] = fn; }

  function host(name, onReady) {
    if (!hasPeer()) { cb.error('เบราว์เซอร์นี้โหลดไลบรารีเชื่อมต่อไม่ได้'); return; }
    // ⚠️ กดสร้าง/เข้าห้องซ้ำได้เสมอ (เน็ตช้า ผู้เล่นก็กดซ้ำ) ถ้าไม่ล้าง peer เดิมทิ้งก่อน
    // เราจะมีคอนเนกชันผีลอยอยู่หลายชุด แต่ละชุดมี handler ของตัวเอง — พอชุดเก่าตาย
    // มันจะยิง 'closed' มาปิดห้องที่ชุดใหม่เพิ่งเปิดสำเร็จ
    teardown();
    selfName = (name || 'ผู้เล่น').slice(0, 16);
    isHost = true;

    let attempts = 0;
    const tryOpen = () => {
      roomCode = makeCode();
      peer = new window.Peer(`${NS}-${roomCode}`, { debug: 1 });

      peer.on('open', (id) => {
        selfId = id;
        roster.set(selfId, {
          ...blankState(selfId, selfName, true, selfUid), lastSeen: performance.now(),
        });
        cb.status('สร้างห้องแล้ว — รอเพื่อนเข้ามา');
        clearInterval(staleTimer);
        staleTimer = setInterval(pruneStale, 2000);
        broadcastRoster(true);
        onReady?.(roomCode);
      });
      peer.on('connection', acceptConnection);
      peer.on('error', (err) => {
        // รหัสห้องบังเอิญซ้ำ → สุ่มใหม่แล้วลองอีกครั้ง (ไม่เกิน 5 รอบ)
        if (err.type === 'unavailable-id' && attempts++ < 5) {
          try { peer.destroy(); } catch { /* noop */ }
          tryOpen();
          return;
        }
        cb.error(peerErrorText(err));
      });
    };
    tryOpen();
  }

  function join(code, name, onReady) {
    if (!hasPeer()) { cb.error('เบราว์เซอร์นี้โหลดไลบรารีเชื่อมต่อไม่ได้'); return; }
    teardown();          // ดูเหตุผลใน host()
    selfName = (name || 'ผู้เล่น').slice(0, 16);
    isHost = false;
    roomCode = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (roomCode.length < 4) { cb.error('รหัสห้องต้องมี 4 ตัวอักษร'); return; }

    peer = new window.Peer(undefined, { debug: 1 });
    peer.on('open', (id) => {
      selfId = id;
      const conn = peer.connect(`${NS}-${roomCode}`, {
        reliable: true, serialization: 'json',
        metadata: { name: selfName, uid: selfUid },
      });
      hostConn = conn;

      let opened = false;
      conn.on('open', () => {
        opened = true;
        cb.status('เข้าห้องสำเร็จ — รอหัวห้องเริ่มแข่ง');
        onReady?.(roomCode);
      });
      conn.on('data', onClientData);
      conn.on('close', () => { cb.closed(); teardown(); });
      conn.on('error', () => cb.error('การเชื่อมต่อมีปัญหา'));

      // ถ้าต่อไม่ติดใน 8 วิ = รหัสผิด/host ไม่อยู่/เน็ตบล็อก
      setTimeout(() => { if (!opened) cb.error('เข้าห้องไม่ได้ — เช็กรหัส หรือหัวห้องอาจออกไปแล้ว'); }, 8000);
    });
    peer.on('error', (err) => cb.error(peerErrorText(err)));
  }

  /** host เริ่มแข่ง: กระจายสัญญาณเริ่ม + deck + โหมด + ทีม ให้ทุกคนพร้อมกัน
   *  พร้อมล็อกรายชื่อผู้เข้ารอบ Battle Royale ณ วินาทีนี้ */
  function startRace(deckFile, mode = 'solo') {
    if (!isHost) return;
    raceMode = mode;
    teams = {};
    const ids = [...roster.keys()];   // Map รักษาลำดับการเข้าห้อง → จับทีมตามลำดับเข้า
    if (mode !== 'solo') {
      const size = mode === 'duo' ? 2 : 4;
      const teamCount = Math.max(1, Math.ceil(ids.length / size));
      // ⚠️ จับทีมแล้วได้ "ทีมเดียว" (เช่น ดูโอ้แต่มีกัน 2 คน) = ไม่มีคู่แข่งข้ามทีม
      // ระบบจะประกาศทีมนั้นชนะทันทีตอนออกตัว! → ถอยกลับเป็นโหมดเดี่ยวแทน
      if (teamCount < 2) {
        raceMode = 'solo';
      } else {
        // แจกแบบวนรอบ (round-robin) — ขนาดทีมต่างกันไม่เกิน 1 คนเสมอ ยุติธรรมสุดที่ทำได้
        ids.forEach((id, i) => { teams[id] = i % teamCount; });
      }
    }
    participants = new Set(ids);
    roundActive = participants.size >= 2;
    finalStarted = false;
    contestState = null;
    // ล้างธง "ตกรอบ" ของรอบก่อน — ไม่งั้นเปิดรอบใหม่ปุ๊บระบบจะเห็นทุกคนตายแล้ว
    for (const p of roster.values()) { p.finished = false; p.alive = false; p.oxy = 1; p.ammo = 0; }

    const msg = { t: 'start', deck: deckFile, mode: raceMode, teams };
    sendAll(msg);
    broadcastRoster(true);            // ให้ทุกคนเห็นป้ายทีมทันทีตอนออกตัว

    if (roundActive) { startStormClock(); scheduleContests(); }
    cb.start(msg);
  }

  function endRound() {
    roundActive = false;
    finalStarted = false;
    clearInterval(stormTimer); stormTimer = null;
    clearTimeout(contestTimer); contestTimer = null;
    if (contestState?.resultTimer) clearTimeout(contestState.resultTimer);
    contestState = null;
    raceStartedAt = 0;
  }

  /**
   * อัปเดตสถานะของเรา (เรียกจากเกมเป็นระยะ)
   * @param {{score:number,gates:number,coins:number,alive:boolean,finished:boolean,
   *          lane?:number,py?:number,oxy?:number,ammo?:number,zone?:string}} s
   */
  function sendState(s) {
    if (!peer) return;
    if (isHost) {
      const cur = roster.get(selfId) || blankState(selfId, selfName, true, selfUid);
      roster.set(selfId, {
        ...cur, ...s, id: selfId, name: selfName, host: true, uid: selfUid,
        lastSeen: performance.now(),
      });
      if (s.q) relayQuestion(selfId, s.q);
      broadcastRoster();
      checkWinner();     // host ตายเองก็ต้องเช็กเหมือนกัน (host เป็นแค่ผู้เล่นคนหนึ่งในรอบ)
    } else if (hostConn && hostConn.open) {
      try { hostConn.send({ t: 'state', name: selfName, s }); } catch { /* คอนเนกชันปิด */ }
    }
  }

  /** ยิงอาวุธ: เลือกเป้าเอง (ว่าง = ให้ host เล็งผู้นำให้เหมือนเดิม) */
  function sendAttack(targetId = null, ammo = 'break') {
    if (isHost) routeAttack(selfId, selfName, targetId, ammo);
    else if (hostConn && hostConn.open) {
      try { hostConn.send({ t: 'atk', target: targetId, ammo }); } catch { /* ปิดอยู่ */ }
    }
  }

  /** บอก host ว่าเรากำลังสิงใครอยู่ (null = เลิกสิง) */
  function watch(targetId) {
    if (isHost) { watching.set(selfId, targetId); return; }
    if (hostConn && hostConn.open) {
      try { hostConn.send({ t: 'watch', target: targetId }); } catch { /* ปิดอยู่ */ }
    }
  }

  /** ส่งคำตอบศึกชิงคำ (ครั้งเดียวต่อรอบ — host จะเมินใบที่สอง) */
  function sendContestAnswer(id, index) {
    if (isHost) recordContestAnswer(selfId, selfName, id, index);
    else if (hostConn && hostConn.open) {
      try { hostConn.send({ t: 'contestAnswer', id, index }); } catch { /* ปิดอยู่ */ }
    }
  }

  function teardown() {
    clearInterval(staleTimer);
    staleTimer = null;
    clearTimeout(trailingTimer);
    trailingTimer = null;
    endRound();
    participants.clear();
    raceMode = 'solo';
    teams = {};
    watching.clear();
    conns.clear();
    roster.clear();
    hostConn = null;
    if (peer) { try { peer.destroy(); } catch { /* noop */ } }
    peer = null;
    isHost = false;
    selfId = null;
    roomCode = null;
  }

  function leave() {
    // host แจ้งลูกห้องว่าปิดห้องก่อนดับตัวเอง (ไม่งั้นลูกห้องจะค้างรอ)
    if (isHost) sendAll({ t: 'closed' });
    teardown();
  }

  return {
    on, host, join, startRace, sendState, sendAttack, sendContestAnswer, watch, leave,
    /** ตัวเกมเป็นคนรู้จัก deck — host เรียกฟังก์ชันนี้เพื่อขอโจทย์ศึกชิงคำ */
    setQuestionSource: (fn) => { questionSource = fn; },
    amHost: () => isHost,
    isConnected: () => !!peer,
    selfId: () => selfId,
    selfName: () => selfName,
    code: () => roomCode,
    mode: () => raceMode,
    supported: hasPeer,
  };
}

function peerErrorText(err) {
  switch (err?.type) {
    case 'browser-incompatible': return 'เบราว์เซอร์นี้ไม่รองรับการเชื่อมต่อ P2P';
    case 'network': return 'ต่อ broker ไม่ได้ — เช็กอินเทอร์เน็ต';
    case 'peer-unavailable': return 'ไม่พบห้องนี้ — เช็กรหัสอีกครั้ง';
    case 'server-error': return 'บริการจับคู่ขัดข้องชั่วคราว ลองใหม่อีกครั้ง';
    case 'unavailable-id': return 'รหัสห้องชนกัน ลองสร้างใหม่';
    default: return `เชื่อมต่อไม่สำเร็จ (${err?.type || 'unknown'})`;
  }
}
