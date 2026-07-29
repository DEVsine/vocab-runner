/**
 * ui.js — ทุกหน้าจอที่ไม่ใช่ตัวเกม: เมนู, จอตาย, สถิติ, พัก
 * รวมถึงการจำค่าที่ผู้เล่นตั้งไว้ (deck ที่เลือก, เปิด/ปิดเสียง)
 */

import { CFG } from './config.js';
import { playerHue } from './net.js';
import * as srs from './srs.js';

const $ = id => document.getElementById(id);
const PREFS_KEY = `${CFG.storageKey}:prefs`;

/** กันชื่อผู้เล่น (ข้อมูลจากเครื่องอื่น) ไม่ให้แทรก HTML เข้ามาตอนวาดรายชื่อ */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* โหมดส่วนตัวของ Safari เขียนไม่ได้ — ไม่ใช่เรื่องคอขาดบาดตาย */ }
}

export function createUI(handlers) {
  const screens = {
    menu: $('screen-menu'),
    dead: $('screen-dead'),
    stats: $('screen-stats'),
    pause: $('screen-pause'),
    multiplayer: $('screen-mp'),
  };

  const prefs = loadPrefs();
  let current = 'menu';

  function show(name) {
    current = name;
    for (const [key, el] of Object.entries(screens)) {
      el.classList.toggle('hidden', key !== name);
    }
  }

  function hideAll() {
    current = null;
    for (const el of Object.values(screens)) el.classList.add('hidden');
  }

  /* ── เมนู: รายการ deck ─────────────────────────────────── */

  const deckSelect = $('deck-select');
  const deckInfo = $('deck-info');

  function fillDeckList(index) {
    deckSelect.innerHTML = '';
    for (const entry of index.decks) {
      const opt = document.createElement('option');
      opt.value = entry.file;
      opt.textContent = entry.name;
      deckSelect.appendChild(opt);
    }
    const preferred = index.decks.some(d => d.file === prefs.deckFile)
      ? prefs.deckFile
      : index.decks[0].file;
    deckSelect.value = preferred;
    return preferred;
  }

  function setDeckInfo(deck) {
    const best = srs.getBest(deck.id);
    const s = srs.summarize(deck);
    deckInfo.textContent =
      `${deck.words.length} คำ · เจอแล้ว ${s.seen} · แม่นแล้ว ${s.mastered}` +
      (best.score ? ` · สถิติสูงสุด ${best.score}` : '');
  }

  deckSelect.addEventListener('change', () => {
    prefs.deckFile = deckSelect.value;
    savePrefs(prefs);
    handlers.onDeckChange(deckSelect.value);
  });

  /* ── สวิตช์เสียง ───────────────────────────────────────── */

  const toggleSfx = $('toggle-sfx');
  const toggleSpeech = $('toggle-speech');
  toggleSfx.checked = prefs.sfx !== false;
  toggleSpeech.checked = prefs.speech !== false;

  toggleSfx.addEventListener('change', () => {
    prefs.sfx = toggleSfx.checked;
    savePrefs(prefs);
    handlers.onAudioPrefs(toggleSfx.checked, toggleSpeech.checked);
  });
  toggleSpeech.addEventListener('change', () => {
    prefs.speech = toggleSpeech.checked;
    savePrefs(prefs);
    handlers.onAudioPrefs(toggleSfx.checked, toggleSpeech.checked);
  });

  /* ── ปุ่มต่าง ๆ ────────────────────────────────────────── */

  $('btn-test-speech').addEventListener('click', () => handlers.onTestSpeech());
  $('btn-start').addEventListener('click', () => handlers.onStart());
  $('btn-retry').addEventListener('click', () => handlers.onStart());
  $('btn-to-menu').addEventListener('click', () => handlers.onMenu());
  $('btn-resume').addEventListener('click', () => handlers.onResume());
  $('btn-quit').addEventListener('click', () => handlers.onMenu());
  $('btn-stats').addEventListener('click', () => handlers.onOpenStats());
  $('btn-stats-close').addEventListener('click', () => handlers.onMenu());

  /* ── เล่นหลายคน (lobby) ─────────────────────────────────── */

  const mpName = $('mp-name');
  const mpCode = $('mp-code');
  const mpSetup = $('mp-setup');
  const mpRoom = $('mp-room');
  const mpPlayers = $('mp-players');
  mpName.value = prefs.mpName || '';

  const rememberName = () => { prefs.mpName = mpName.value.trim(); savePrefs(prefs); };

  $('btn-multiplayer').addEventListener('click', () => handlers.onOpenMultiplayer());
  $('btn-mp-create').addEventListener('click', () => { rememberName(); handlers.onMPCreate(mpName.value.trim()); });
  $('btn-mp-join').addEventListener('click', () => { rememberName(); handlers.onMPJoin(mpName.value.trim(), mpCode.value.trim()); });
  $('btn-mp-start').addEventListener('click', () => handlers.onMPStart());
  $('btn-mp-back').addEventListener('click', () => handlers.onMPLeave());
  mpCode.addEventListener('input', () => { mpCode.value = mpCode.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

  $('btn-mp-copy').addEventListener('click', async () => {
    const code = $('mp-room-code').textContent;
    try { await navigator.clipboard.writeText(code); mpSetStatus('คัดลอกรหัสแล้ว', 'ok'); }
    catch { mpSetStatus('คัดลอกไม่ได้ — พิมพ์รหัสให้เพื่อนเอง', 'fail'); }
  });

  function mpSetStatus(message, kind = '') {
    const node = $('mp-status');
    node.textContent = message || '';
    node.className = `mp-status ${kind}`;
  }

  /** สลับล็อบบี้ไปสถานะ "อยู่ในห้องแล้ว" */
  function mpEnterRoom(code, amHost) {
    mpSetup.classList.add('hidden');
    mpRoom.classList.remove('hidden');
    $('mp-room-code').textContent = code;
    $('btn-mp-start').classList.toggle('hidden', !amHost);
    $('mp-wait').classList.toggle('hidden', amHost);
  }

  /** กลับไปหน้าตั้งค่าห้อง (ตอนออก/ห้องปิด) */
  function mpResetLobby() {
    mpSetup.classList.remove('hidden');
    mpRoom.classList.add('hidden');
    mpPlayers.innerHTML = '';
    mpCode.value = '';
    mpSetStatus('');
  }

  /** วาดรายชื่อผู้เล่นในล็อบบี้ — จุดสี = สีโกสต์ของคนนั้นในฉากตอนแข่ง */
  function mpRenderPlayers(players, selfId) {
    mpPlayers.innerHTML = players.map(p => `
      <li>
        <span class="mp-dot" style="color:hsl(${playerHue(p.id)},85%,62%)"></span>
        <span>${escapeHtml(p.name)}</span>
        ${p.id === selfId ? '<span class="mp-you">(คุณ)</span>' : ''}
        ${p.host ? '<span class="mp-host-badge">หัวห้อง</span>' : ''}
      </li>
    `).join('');
  }

  /* ── จอตาย ─────────────────────────────────────────────── */

  function showDeath(info) {
    $('dead-word').textContent = info.word ? info.word.en : '—';
    $('dead-meaning').textContent = info.word ? info.word.th : '';
    $('dead-chose').textContent = info.chosen
      ? `คุณอยู่เลน "${info.chosen.en}" = ${info.chosen.th}`
      : (info.cause === 'obstacle' ? 'ชนสิ่งกีดขวาง — คำนี้ยังไม่ถูกนับว่าตอบผิด' : '');
    document.querySelector('.dead-tag').textContent =
      info.cause === 'obstacle' ? 'ชนสิ่งกีดขวาง' : 'โดนเลเซอร์ — เลือกเลนผิด';
    $('dead-score').textContent = info.score;
    $('dead-gates').textContent = info.gates;
    $('dead-coins').textContent = info.coins ?? 0;
    $('dead-best').textContent = info.best;
    show('dead');
  }

  /* ── หน้าสถิติ ─────────────────────────────────────────── */

  function renderStats(deck) {
    const s = srs.summarize(deck);
    $('stats-summary').innerHTML = `
      <div class="chip">ทั้งหมด <b>${s.total}</b> คำ</div>
      <div class="chip">เคยเจอ <b>${s.seen}</b></div>
      <div class="chip">แม่นแล้ว (กล่อง 3) <b>${s.mastered}</b></div>
      <div class="chip">ต้องซ้อม (กล่อง 1) <b>${s.struggling}</b></div>
    `;

    const tbody = document.querySelector('#stats-table tbody');
    const seenRows = s.rows.filter(r => r.seen > 0);

    if (!seenRows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-note">ยังไม่มีข้อมูล — เล่นสักรอบก่อนนะ</td></tr>`;
      return;
    }

    tbody.innerHTML = seenRows.map(r => `
      <tr>
        <td class="en">${r.en}</td>
        <td>${r.th}</td>
        <td><span class="box-pill box-${r.box}">${r.box}</span></td>
        <td>${r.correct}/${r.seen}${r.wrong ? ` <span style="color:var(--danger)">(ผิด ${r.wrong})</span>` : ''}</td>
      </tr>
    `).join('');
  }

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([srs.exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vocab-runner-stats.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('btn-import').addEventListener('click', () => $('import-file').click());

  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      srs.importJSON(await file.text());
      handlers.onStatsChanged();
    } catch (err) {
      alert(`นำเข้าไม่สำเร็จ: ${err.message}`);
    }
    e.target.value = '';
  });

  $('btn-reset').addEventListener('click', () => {
    if (confirm('ล้างสถิติของชุดคำนี้ทั้งหมด? ย้อนกลับไม่ได้')) {
      handlers.onResetDeck();
    }
  });

  return {
    show,
    hideAll,
    current: () => current,
    fillDeckList,
    setDeckInfo,
    showDeath,
    renderStats,

    /** @param {'pending'|'ok'|'fail'} kind */
    setSpeechStatus(message, kind = 'pending') {
      const node = $('speech-status');
      node.textContent = message;
      node.className = `speech-status ${kind}`;
    },

    selectedDeckFile: () => deckSelect.value,
    audioPrefs: () => ({ sfx: toggleSfx.checked, speech: toggleSpeech.checked }),

    // ── เล่นหลายคน ──
    mpEnterRoom,
    mpResetLobby,
    mpRenderPlayers,
    mpSetStatus,
    mpNameValue: () => mpName.value.trim(),
  };
}
