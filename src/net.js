/**
 * net.js — ชั้นเครือข่ายสำหรับโหมดแข่งหลายคน (ห่อ PeerJS/WebRTC)
 *
 * ── ทำไมออกแบบเป็น "host-relay star" ไม่ใช่ full-mesh ──
 * ถ้าให้ทุกคนต่อหากันเองแบบตาข่าย (mesh) จำนวนคอนเนกชัน = n·(n−1)/2 และแต่ละคน
 * ต้องรวมสถานะจากหลายทางเอง ยุ่งและพังง่าย เราเลยใช้ดาว: คนสร้างห้อง = "host"
 * ทุกคนต่อเข้า host คนเดียว, host รวมสถานะทุกคนแล้ว "กระจาย" (relay) กลับไปให้ทุกคน
 * → client แต่ละคนมีคอนเนกชันเดียว และเห็นภาพรวมตรงกันเสมอ (host เป็นแหล่งความจริง)
 *
 * ── ทำไม "โลกใครโลกมัน" ถึงพอ (ไม่ sync เป๊ะ) ──
 * เราส่งแค่ "สถานะสรุป" (ชื่อ, คะแนน, ด่านผ่าน, รอด/ตาย) ไม่กี่ครั้งต่อวินาที
 * ไม่ได้ส่งตำแหน่งทุกวัตถุ → ข้อมูลน้อยมาก ทนเน็ตช้าได้ และไม่ต้องรื้อเกมให้ deterministic
 * นิยามของการแข่งจึงเป็น "ใครทำคะแนนสูงสุด" ไม่ใช่ "ใครถึงเส้นชัยก่อน"
 *
 * ⚠️ พึ่ง broker ฟรีของ PeerJS สำหรับ "จับคู่" (signaling) เท่านั้น หลังต่อติดแล้ว
 *    ข้อมูลวิ่ง P2P ตรงระหว่างเครื่อง — ไม่มีเซิร์ฟเวอร์ของเรา, ไม่ต้องสมัครบัญชี
 *    ข้อเสียที่ต้องยอมรับ: บางเครือข่าย (NAT เข้ม/ไฟร์วอลล์) อาจต่อไม่ติด
 */

const NS = 'vocabrun';                              // เติมหน้า id กัน "ชน" กับแอปอื่นบน broker เดียวกัน
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ตัด I,O,0,1 ทิ้ง กันอ่านรหัสผิด
const BROADCAST_MIN_MS = 110;                        // host กระจาย roster ถี่สุดเท่านี้ (กันสแปม)
const STALE_MS = 9000;                               // ไม่ได้ข่าวจากใครเกินนี้ = ถือว่าหลุด

const hasPeer = () => typeof window !== 'undefined' && typeof window.Peer === 'function';

function makeCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
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
  let roomCode = null;
  let lastBroadcast = 0;
  let staleTimer = null;

  const cb = {
    roster: () => {}, start: () => {}, status: () => {},
    error: () => {}, closed: () => {}, winner: () => {}, attack: () => {},
  };

  /* ── ตัวช่วยฝั่ง host ─────────────────────────────────────── */

  // lane/py = ตำแหน่งล่าสุดของผู้เล่น ใช้วาด "โกสต์" ของกันและกันในฉาก
  function blankState(id, name, host) {
    return {
      id, name, host,
      score: 0, gates: 0, coins: 0, alive: false, finished: false,
      lane: 1, py: 0,
    };
  }

  /* ── Battle Royale: host ตัดสิน "ผู้รอดคนสุดท้าย" ──────────────
   * participants = รายชื่อผู้เล่น ณ ตอนกดเริ่มรอบ (คนที่เข้าห้องทีหลังไม่นับรอบนี้)
   * ตกรอบได้ 2 ทาง: ตายในเกม (finished=true) หรือหลุดการเชื่อมต่อ (หายจาก roster)
   * เหลือ ≤1 คน → ประกาศผู้ชนะครั้งเดียวแล้วปิดรอบ
   * (ต้องมีผู้เล่น ≥2 ตอนเริ่ม ไม่งั้นเล่นคนเดียวจะ "ชนะ" ทันทีที่ตาย ซึ่งประหลาด) */
  let roundActive = false;
  let participants = new Set();
  let raceMode = 'solo';       // solo | duo | squad
  let teams = {};              // id -> เลขทีม (เฉพาะโหมดทีม)

  function checkWinner() {
    if (!isHost || !roundActive) return;
    const alive = [...participants].filter(id => {
      const p = roster.get(id);
      return p && !p.finished;
    });

    let msg;
    if (raceMode === 'solo') {
      if (alive.length > 1) return;
      const winId = alive[0] ?? null;
      const p = winId ? roster.get(winId) : null;
      msg = { t: 'winner', id: winId, name: p?.name ?? '—', score: p?.score ?? 0 };
    } else {
      // โหมดทีม: นับ "ทีมที่ยังมีคนรอด" — สมาชิกที่ตายไปก่อนก็ชนะด้วยในฐานะทีม
      const aliveTeams = new Set(alive.map(id => teams[id] ?? 0));
      if (aliveTeams.size > 1) return;
      const teamIdx = [...aliveTeams][0] ?? null;
      const winnerIds = teamIdx === null
        ? []
        : [...participants].filter(id => teams[id] === teamIdx);
      msg = {
        t: 'winner', team: teamIdx, winnerIds,
        names: winnerIds.map(id => roster.get(id)?.name || 'ผู้เล่น'),
      };
    }

    roundActive = false;
    for (const c of conns.values()) { try { c.send(msg); } catch { /* กำลังปิด */ } }
    cb.winner(msg);
  }

  /* ── อาวุธ "ปลดเกราะ": host เป็นคนเลือกเป้าเสมอ ──────────────
   * ผู้ยิงไม่ได้เลือกเป้าเอง — host เล็งให้ที่ "คู่แข่งคะแนนนำสุดที่ยังรอด"
   * (คนละทีมกับผู้ยิง) เพื่อให้อาวุธทำหน้าที่เชิงดีไซน์: ถ่วงคนนำ ไม่ใช่รุมคนท้าย */
  function routeAttack(fromId, fromName) {
    if (!roundActive) return;
    const candidates = [...participants].filter(id => {
      if (id === fromId) return false;
      const p = roster.get(id);
      if (!p || p.finished) return false;
      if (raceMode !== 'solo' && teams[id] === teams[fromId]) return false;
      return true;
    });
    if (!candidates.length) return;
    candidates.sort((a, b) => (roster.get(b)?.score ?? 0) - (roster.get(a)?.score ?? 0));
    const target = candidates[0];
    const msg = { t: 'atkTo', from: fromName };
    if (target === selfId) cb.attack(fromName);
    else { try { conns.get(target)?.send(msg); } catch { /* ปิดอยู่ */ } }
  }

  /** ยิงอาวุธปลดเกราะ (เกมเรียกตอนทำคอมโบสำเร็จ) */
  function sendAttack() {
    if (isHost) routeAttack(selfId, selfName);
    else if (hostConn && hostConn.open) {
      try { hostConn.send({ t: 'atk', name: selfName }); } catch { /* ปิดอยู่ */ }
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
      // ยังไม่ถึงเวลา — นัดส่ง "ขอบท้าย" ไว้ ให้สถานะล่าสุดออกไปแน่ ๆ
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
    const players = [...roster.values()].map(({ lastSeen, ...p }) => ({ ...p, team: teams[p.id] }));
    const msg = { t: 'roster', players };
    for (const c of conns.values()) { try { c.send(msg); } catch { /* คอนเนกชันกำลังปิด */ } }
    cb.roster(players);          // host ก็ต้องเห็น roster ของตัวเองด้วย
  }

  function pruneStale() {
    if (!isHost) return;
    const now = performance.now();
    let changed = false;
    for (const [id, p] of roster) {
      if (id === selfId) continue;
      if (!conns.has(id) && now - (p.lastSeen || 0) > STALE_MS) { roster.delete(id); changed = true; }
    }
    if (changed) broadcastRoster(true);
  }

  /* ── รับข้อความ (host) ───────────────────────────────────── */

  function onHostData(conn, data) {
    if (!data || typeof data !== 'object') return;
    if (data.t === 'state') {
      const prev = roster.get(conn.peer) || blankState(conn.peer, data.name || 'ผู้เล่น', false);
      roster.set(conn.peer, {
        ...prev, ...(data.s || {}),
        id: conn.peer, name: data.name || prev.name, host: false, lastSeen: performance.now(),
      });
      broadcastRoster();
      checkWinner();     // สถานะใหม่อาจเป็น "ผมตายแล้ว" → เช็กว่าเหลือคนสุดท้ายหรือยัง
    } else if (data.t === 'atk') {
      routeAttack(conn.peer, data.name || 'คู่แข่ง');
    }
  }

  function acceptConnection(conn) {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      roster.set(conn.peer, blankState(conn.peer, conn.metadata?.name || 'ผู้เล่น', false));
      roster.get(conn.peer).lastSeen = performance.now();
      try { conn.send({ t: 'welcome', id: conn.peer }); } catch { /* ปิดไปแล้ว */ }
      broadcastRoster(true);
      cb.status(`มีผู้เล่นเข้าห้อง (${conns.size + 1} คน)`);
    });
    conn.on('data', (d) => onHostData(conn, d));
    const drop = () => {
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
    if (data.t === 'roster') cb.roster(data.players || []);
    else if (data.t === 'start') cb.start(data);
    else if (data.t === 'winner') cb.winner(data);
    else if (data.t === 'atkTo') cb.attack(data.from || 'คู่แข่ง');
    else if (data.t === 'closed') { cb.closed(); teardown(); }
  }

  /* ── API สาธารณะ ─────────────────────────────────────────── */

  function on(event, fn) { if (event in cb) cb[event] = fn; }

  function host(name, onReady) {
    if (!hasPeer()) { cb.error('เบราว์เซอร์นี้โหลดไลบรารีเชื่อมต่อไม่ได้'); return; }
    selfName = (name || 'ผู้เล่น').slice(0, 16);
    isHost = true;

    let attempts = 0;
    const tryOpen = () => {
      roomCode = makeCode();
      peer = new window.Peer(`${NS}-${roomCode}`, { debug: 1 });

      peer.on('open', (id) => {
        selfId = id;
        roster.set(selfId, { ...blankState(selfId, selfName, true), lastSeen: performance.now() });
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
    selfName = (name || 'ผู้เล่น').slice(0, 16);
    isHost = false;
    roomCode = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (roomCode.length < 4) { cb.error('รหัสห้องต้องมี 4 ตัวอักษร'); return; }

    peer = new window.Peer(undefined, { debug: 1 });
    peer.on('open', (id) => {
      selfId = id;
      const conn = peer.connect(`${NS}-${roomCode}`, {
        reliable: true, serialization: 'json', metadata: { name: selfName },
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
    // ล้างธง "ตกรอบ" ของรอบก่อน — ไม่งั้นเปิดรอบใหม่ปุ๊บระบบจะเห็นทุกคนตายแล้ว
    for (const p of roster.values()) { p.finished = false; p.alive = false; }
    const msg = { t: 'start', deck: deckFile, mode: raceMode, teams };
    for (const c of conns.values()) { try { c.send(msg); } catch { /* noop */ } }
    broadcastRoster(true);            // ให้ทุกคนเห็นป้ายทีมทันทีตอนออกตัว
    cb.start(msg);
  }

  /**
   * อัปเดตสถานะของเรา (เรียกจากเกมเป็นระยะ)
   * @param {{score:number,gates:number,coins:number,alive:boolean,finished:boolean,lane?:number,py?:number}} s
   */
  function sendState(s) {
    if (!peer) return;
    if (isHost) {
      const cur = roster.get(selfId) || blankState(selfId, selfName, true);
      roster.set(selfId, { ...cur, ...s, id: selfId, name: selfName, host: true, lastSeen: performance.now() });
      broadcastRoster();
      checkWinner();     // host ตายเองก็ต้องเช็กเหมือนกัน (host เป็นแค่ผู้เล่นคนหนึ่งในรอบ)
    } else if (hostConn && hostConn.open) {
      try { hostConn.send({ t: 'state', name: selfName, s }); } catch { /* คอนเนกชันปิด */ }
    }
  }

  function teardown() {
    clearInterval(staleTimer);
    staleTimer = null;
    clearTimeout(trailingTimer);
    trailingTimer = null;
    roundActive = false;
    participants.clear();
    raceMode = 'solo';
    teams = {};
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
    if (isHost) for (const c of conns.values()) { try { c.send({ t: 'closed' }); } catch { /* noop */ } }
    teardown();
  }

  return {
    on, host, join, startRace, sendState, sendAttack, leave,
    amHost: () => isHost,
    isConnected: () => !!peer,
    selfId: () => selfId,
    code: () => roomCode,
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
