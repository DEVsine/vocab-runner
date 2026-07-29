/**
 * ui.js — ทุกหน้าจอที่ไม่ใช่ตัวเกม: เมนู, จอตาย, สถิติ, พัก
 * รวมถึงการจำค่าที่ผู้เล่นตั้งไว้ (deck ที่เลือก, เปิด/ปิดเสียง)
 */

import { CFG } from './config.js';
import { playerHue } from './net.js';
import { THEMES, THEME_ORDER } from './themes.js';
import { CHARACTERS, CHARACTER_ORDER, characterById } from './characters.js';
import { wallet } from './wallet.js';
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
    shop: $('screen-shop'),
    practice: $('screen-practice'),
    practiceDone: $('screen-practice-done'),
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

  /* ── ธีมของโลก ─────────────────────────────────────────── */

  const themeSelect = $('theme-select');
  for (const id of THEME_ORDER) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = THEMES[id].name;
    themeSelect.appendChild(opt);
  }
  themeSelect.value = THEMES[prefs.theme] ? prefs.theme : 'space';

  themeSelect.addEventListener('change', () => {
    prefs.theme = themeSelect.value;
    savePrefs(prefs);
    handlers.onThemeChange(themeSelect.value);
  });

  /* ── ตัวละคร + กระเป๋าเหรียญ + ร้านค้า ──────────────────── */

  function refreshIdentity() {
    const c = characterById(wallet.selected());
    $('menu-char-emoji').textContent = c.emoji;
    $('menu-char-name').textContent = c.name;
    $('menu-wallet-coins').textContent = wallet.coins();
  }

  function renderShop() {
    $('shop-coins').textContent = wallet.coins();
    $('shop-grid').innerHTML = CHARACTER_ORDER.map(id => {
      const c = CHARACTERS[id];
      const owned = wallet.owned(id);
      const selected = wallet.selected() === id;
      const action = selected
        ? '<span class="shop-owned-tag">✓ ใส่อยู่</span>'
        : owned
          ? `<button class="btn" data-select="${id}">ใส่ตัวนี้</button>`
          : `<button class="btn" data-buy="${id}">ซื้อ <span class="shop-price">🪙 ${c.price}</span></button>`;
      return `
        <div class="shop-card ${selected ? 'selected' : ''}">
          <div class="shop-emoji">${c.emoji}</div>
          <div class="shop-name">${c.name}</div>
          <div class="shop-weapon">${c.weaponEmoji} ${c.weapon}<br>${c.desc}</div>
          ${action}
        </div>`;
    }).join('');
  }

  $('shop-grid').addEventListener('click', (e) => {
    const buyId = e.target.closest('[data-buy]')?.dataset.buy;
    const selectId = e.target.closest('[data-select]')?.dataset.select;
    if (buyId) {
      const c = CHARACTERS[buyId];
      if (wallet.buy(buyId, c.price)) {
        wallet.select(buyId);
        handlers.onCharacterChange(buyId);
      } else {
        alert(`เหรียญไม่พอ — ${c.name} ราคา ${c.price} เหรียญ (มี ${wallet.coins()})`);
      }
    } else if (selectId) {
      wallet.select(selectId);
      handlers.onCharacterChange(selectId);
    } else return;
    renderShop();
    refreshIdentity();
  });

  $('btn-shop').addEventListener('click', () => { renderShop(); show('shop'); });
  $('btn-shop-close').addEventListener('click', () => handlers.onMenu());

  /* ── โหมดฝึก: การ์ดสอนคำทีละใบ ──────────────────────────── */

  let prWords = [];
  let prIdx = 0;

  function prRender() {
    const w = prWords[prIdx];
    if (!w) return;
    $('pr-index').textContent = prIdx + 1;
    $('pr-total').textContent = prWords.length;
    $('pr-emoji').textContent = w.emoji || '📝';
    $('pr-en').textContent = w.en;
    $('pr-th').textContent = w.th;
    $('btn-pr-prev').disabled = prIdx === 0;
    const last = prIdx === prWords.length - 1;
    $('btn-pr-next').classList.toggle('hidden', last);
    $('btn-pr-run').classList.toggle('hidden', !last);
    handlers.onSpeakWord(w);      // อ่านออกเสียงอัตโนมัติทุกครั้งที่เปิดการ์ด (dual coding)
  }

  function showPracticeTeach(words) {
    prWords = words;
    prIdx = 0;
    show('practice');
    prRender();
  }

  $('btn-pr-prev').addEventListener('click', () => { if (prIdx > 0) { prIdx--; prRender(); } });
  $('btn-pr-next').addEventListener('click', () => { if (prIdx < prWords.length - 1) { prIdx++; prRender(); } });
  $('btn-pr-speak').addEventListener('click', () => handlers.onSpeakWord(prWords[prIdx]));
  $('btn-pr-run').addEventListener('click', () => handlers.onPracticeRun(prWords));
  $('btn-pr-back').addEventListener('click', () => handlers.onMenu());
  $('btn-pr-again').addEventListener('click', () => handlers.onPracticeAgain());
  $('btn-pr-done-menu').addEventListener('click', () => handlers.onMenu());
  $('btn-practice').addEventListener('click', () => handlers.onPracticeAgain());

  function showPracticeDone(words, coins) {
    $('pr-done-words').innerHTML = words.map(w =>
      `<span class="chip">${w.en} = ${w.th}</span>`).join('');
    $('pr-done-coin-count').textContent = coins;
    refreshIdentity();
    show('practiceDone');
  }

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

  /* ── โหมดแข่ง (เดี่ยว/ดูโอ้/สควอด) — หัวห้องเท่านั้นที่เลือกได้ ── */
  let mpModeValue = 'solo';
  document.querySelectorAll('#mp-modes .mp-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      mpModeValue = btn.dataset.mode;
      document.querySelectorAll('#mp-modes .mp-mode').forEach(b =>
        b.classList.toggle('active', b === btn));
    });
  });

  /** สลับล็อบบี้ไปสถานะ "อยู่ในห้องแล้ว" */
  function mpEnterRoom(code, amHost) {
    mpSetup.classList.add('hidden');
    mpRoom.classList.remove('hidden');
    $('mp-room-code').textContent = code;
    $('btn-mp-start').classList.toggle('hidden', !amHost);
    $('mp-modes').classList.toggle('hidden', !amHost);
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
        ${p.team != null ? `<span class="mp-team-badge">ทีม ${p.team + 1}</span>` : ''}
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
    mpMode: () => mpModeValue,

    // ── ธีม / ร้านค้า / โหมดฝึก ──
    selectedTheme: () => themeSelect.value,
    refreshIdentity,
    showPracticeTeach,
    showPracticeDone,
  };
}
