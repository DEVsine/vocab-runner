/**
 * ui.js — ทุกหน้าจอที่ไม่ใช่ตัวเกม: เมนู, จอตาย, สถิติ, พัก
 * รวมถึงการจำค่าที่ผู้เล่นตั้งไว้ (deck ที่เลือก, เปิด/ปิดเสียง)
 */

import { CFG } from './config.js';
import { formatDistance } from './format.js';
import { playerHue } from './net.js';
import { THEMES, THEME_ORDER } from './themes.js';
import { CHARACTERS, CHARACTER_ORDER, characterById } from './characters.js';
import { wallet } from './wallet.js';
import { cheats, redeem } from './cheats.js';
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

  /**
   * รายการ deck — จัดกลุ่มด้วย <optgroup> เมื่อ index.json ประกาศ `groups` ไว้
   *
   * ⚠️ deck ที่ไม่ระบุ `group` ต้องตกไปอยู่กลุ่มแรกเสมอ (คำศัพท์)
   * นี่ไม่ใช่แค่ความสะดวก แต่เป็นสัญญาเดียวกับ `type` ที่หายไป = vocab:
   * ไฟล์เดิม 9 อันต้องทำงานต่อได้โดยไม่ต้องแก้ และถ้าวันหนึ่งมีคนเพิ่ม deck
   * โดยลืมใส่ group มันต้องยังโผล่ในรายการ ไม่ใช่หายเงียบไปจาก dropdown
   */
  function fillDeckList(index) {
    deckSelect.innerHTML = '';
    const groups = Array.isArray(index.groups) && index.groups.length ? index.groups : null;

    if (!groups) {
      for (const entry of index.decks) deckSelect.appendChild(deckOption(entry));
    } else {
      const fallback = groups[0].id;
      const known = new Set(groups.map(g => g.id));
      for (const g of groups) {
        const members = index.decks.filter(
          d => (known.has(d.group) ? d.group : fallback) === g.id,
        );
        if (!members.length) continue;
        const box = document.createElement('optgroup');
        box.label = g.name;
        for (const entry of members) box.appendChild(deckOption(entry));
        deckSelect.appendChild(box);
      }
    }

    const preferred = index.decks.some(d => d.file === prefs.deckFile)
      ? prefs.deckFile
      : index.decks[0].file;
    deckSelect.value = preferred;
    return preferred;
  }

  function deckOption(entry) {
    const opt = document.createElement('option');
    opt.value = entry.file;
    opt.textContent = entry.name;
    return opt;
  }

  function setDeckInfo(deck) {
    const best = srs.getBest(deck.id);
    const s = srs.summarize(deck);
    const unit = deck.type === 'subject' ? 'ข้อ' : 'คำ';
    deckInfo.textContent =
      `${deck.words.length} ${unit} · เจอแล้ว ${s.seen} · แม่นแล้ว ${s.mastered}` +
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

  $('btn-shop').addEventListener('click', () => { renderShop(); shopCodeStatus(''); show('shop'); });
  $('btn-shop-close').addEventListener('click', () => handlers.onMenu());

  /* ── รหัสลับของบัญชีทดลอง ────────────────────────────────── */

  function shopCodeStatus(message, kind = '') {
    const node = $('shop-code-status');
    node.textContent = message || '';
    node.className = `shop-code-status ${kind}`;
  }

  function useShopCode() {
    const input = $('shop-code-input');
    const result = redeem(input.value);
    if (!result) return;

    if (result.action === 'invalid') {
      shopCodeStatus(result.message, 'fail');
      return;
    }

    if (result.action === 'coins') wallet.deposit(result.coins);
    cheats.setEnabled(result.enable);

    input.value = '';
    shopCodeStatus(result.message + (result.note ? `\n${result.note}` : ''), 'ok');
    renderShop();
    refreshIdentity();
    handlers.onCheatsChanged?.();
  }

  $('btn-shop-code').addEventListener('click', useShopCode);
  $('shop-code-input').addEventListener('keydown', (e) => {
    // ⚠️ ต้องหยุด event ไม่ให้ไหลไปถึงตัวรับปุ่มของเกม ไม่งั้นการพิมพ์จะถูกแปลเป็นคำสั่งเดินซ้าย/ขวา
    e.stopPropagation();
    if (e.key === 'Enter') useShopCode();
  });

  /* ── โหมดฝึก: การ์ดสอนคำทีละใบ ──────────────────────────── */

  let prWords = [];
  let prIdx = 0;
  let prMissed = new Set();

  /**
   * ใบสอน 1 ใบ
   *
   * deck ศัพท์ = "เห็นคำ + คำแปล + รูป"   → สิ่งที่ต้องจำคือการจับคู่คำกับความหมาย
   * deck วิชา  = "ใบความรู้"              → สิ่งที่ต้องจำคือข้อเท็จจริง (fact)
   *   ตั้งใจ *ไม่* โชว์ตัวคำถามในใบสอน — ถ้าโชว์ ผู้เรียนจะจำคู่ "คำถามนี้ตอบข้อนี้"
   *   แทนที่จะจำความรู้ แล้วพอเจอคำถามที่ถามมุมอื่นก็ตอบไม่ได้
   *   (fact ถูกเขียนให้ "ครอบคลุมคำตอบ" ตามสเปกของไฟล์ deck ด้วยเหตุผลนี้)
   */
  function prRender() {
    const w = prWords[prIdx];
    if (!w) return;
    $('pr-index').textContent = prIdx + 1;
    $('pr-total').textContent = prWords.length;
    $('pr-unit').textContent = w.subject ? 'ข้อ' : 'คำ';
    $('pr-emoji').textContent = w.subject ? '💡' : (w.emoji || '📝');
    $('pr-en').textContent = w.subject ? w.fact : w.en;
    $('pr-en').classList.toggle('subject', !!w.subject);
    $('pr-th').textContent = w.subject
      ? (w.page ? `📖 หน้า ${w.page}` : '')
      : w.th;
    // ป้าย "เคยพลาด" ทำให้ผู้เล่นเห็นว่าชุดนี้ไม่ได้สุ่มมั่ว แต่มาจากความผิดพลาดของเขาเอง
    $('pr-tag').textContent = w.subject ? '🔁 ข้อที่เคยพลาด' : '🔁 คำที่เคยพลาด';
    $('pr-tag').classList.toggle('hidden', !prMissed.has(srs.itemId(w)));
    $('btn-pr-prev').disabled = prIdx === 0;
    const last = prIdx === prWords.length - 1;
    $('btn-pr-next').classList.toggle('hidden', last);
    $('btn-pr-run').classList.toggle('hidden', !last);
    handlers.onSpeakWord(w);      // อ่านออกเสียงอัตโนมัติทุกครั้งที่เปิดการ์ด (dual coding)
  }

  function showPracticeTeach(words, missed = new Set()) {
    prWords = words;
    prMissed = missed;
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

  function showPracticeDone(words) {
    $('pr-done-words').innerHTML = words.map(w =>
      w.subject
        ? `<span class="chip">${escapeHtml(w.choices?.[w.answer] ?? '')}</span>`
        : `<span class="chip">${escapeHtml(w.en)} = ${escapeHtml(w.th)}</span>`).join('');
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

  /* ── ความเร็ว / ประเภทโจทย์ / โหมดเด็ก ─────────────────── */

  const speedSelect = $('speed-select');
  const qModeBoxes = { text: $('qmode-text'), image: $('qmode-image'), audio: $('qmode-audio') };
  const toggleKids = $('toggle-kids');
  const qModeNote = $('qmode-note');
  const kidsNote = $('kids-note');

  speedSelect.value = CFG.speedModes[prefs.speedMode] ? prefs.speedMode : 'ramp';
  const savedModes = Array.isArray(prefs.qModes) ? prefs.qModes : null;
  for (const [id, box] of Object.entries(qModeBoxes)) {
    box.checked = savedModes ? savedModes.includes(id) : true;
  }
  toggleKids.checked = prefs.kids === true;

  const checkedModes = () =>
    Object.entries(qModeBoxes).filter(([, b]) => b.checked).map(([id]) => id);

  /* โหมดเด็กเป็น "ชุดค่าสำเร็จรูป" ไม่ใช่สวิตช์อิสระ — มันทับความเร็วกับประเภทโจทย์
   * จึงต้องปิดสองอันนั้นให้เห็นด้วยตา ไม่งั้นผู้ใช้จะเลือกค่าที่ไม่มีผลแล้วงงว่าทำไมไม่เปลี่ยน
   * (ปิดเฉพาะการแก้ไข ไม่ล้างค่าที่เก็บไว้ — ปิดโหมดเด็กแล้วต้องได้ค่าเดิมกลับมาครบ) */
  function syncKidsLock() {
    const on = toggleKids.checked;
    speedSelect.disabled = on;
    for (const box of Object.values(qModeBoxes)) box.disabled = on;
    kidsNote.classList.toggle('hidden', !on);
    if (on) {
      qModeNote.textContent = 'โหมดเด็กกำลังคุมอยู่ — ใช้รูปกับเสียงเท่านั้น';
      return;
    }
    const n = checkedModes().length;
    qModeNote.textContent = n === 0
      ? '⚠️ ยังไม่ได้เลือกสักประเภท — เกมจะสุ่มให้เองทุกแบบ'
      : '';
  }
  syncKidsLock();

  speedSelect.addEventListener('change', () => {
    prefs.speedMode = speedSelect.value;
    savePrefs(prefs);
  });
  for (const box of Object.values(qModeBoxes)) {
    box.addEventListener('change', () => {
      prefs.qModes = checkedModes();
      savePrefs(prefs);
      syncKidsLock();
    });
  }
  toggleKids.addEventListener('change', () => {
    prefs.kids = toggleKids.checked;
    savePrefs(prefs);
    syncKidsLock();
  });

  /* ── ปุ่มต่าง ๆ ────────────────────────────────────────── */

  $('btn-test-speech').addEventListener('click', () => handlers.onTestSpeech());
  $('btn-start').addEventListener('click', () => handlers.onStart());
  $('btn-retry').addEventListener('click', () => handlers.onStart());
  $('btn-dead-practice').addEventListener('click', () => handlers.onPracticeAgain());
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

  /* ── โซนลงจอด — "เลือกจุดดรอป" ของเราคือเลือกระดับความยากของคำ ────
   * ต่างจากโหมดทีมตรงที่ทุกคนเลือกเองได้ (ไม่ใช่แค่หัวห้อง) เพราะมันคือ
   * การเดิมพันของแต่ละคน: โซนโหดคืนออกซิเจน/แต้มต่อคำมากกว่า แต่ตอบยากกว่า */
  let mpZoneValue = CFG.br.zones.some(z => z.id === prefs.zone) ? prefs.zone : 'mid';
  const mpZones = $('mp-zones');
  mpZones.innerHTML = CFG.br.zones.map(z => `
    <button type="button" class="mp-zone ${z.id === mpZoneValue ? 'active' : ''}" data-zone="${z.id}">
      <b>${z.name}</b>
      <small>${z.sub}</small>
      <em>×${z.reward.toFixed(2)} แต้ม/พลัง</em>
    </button>`).join('');

  mpZones.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zone]');
    if (!btn) return;
    mpZoneValue = btn.dataset.zone;
    prefs.zone = mpZoneValue;
    savePrefs(prefs);
    mpZones.querySelectorAll('.mp-zone').forEach(b =>
      b.classList.toggle('active', b === btn));
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

  const DEATH_TAG = {
    obstacle: 'ชนสิ่งกีดขวาง',
    lane: 'โดนเลเซอร์ — เลือกเลนผิด',
    storm: '🌪️ พลังหมด — พายุกลืนไป',
    quit: 'ออกจากรอบเอง',
  };
  const DEATH_NOTE = {
    obstacle: 'ชนสิ่งกีดขวาง — คำนี้ยังไม่ถูกนับว่าตอบผิด',
    storm: 'เติมพลังได้ทางเดียวคือตอบถูก — คำที่ค้างอยู่ถูกส่งไปซ้อมแล้ว',
    quit: 'ออกจากรอบกลางคัน — คะแนนถูกล็อกไว้เท่าที่ทำได้',
  };

  /**
   * จอตายคือ "ที่เดียว" ที่ผู้เล่นได้อ่านเฉลยแบบไม่ต้องรีบ
   * deck ศัพท์เฉลยด้วยคำ+คำแปล · deck วิชาเฉลยด้วยคำตอบที่ถูก + ใบความรู้ (fact)
   * ที่ต้องมี fact ตรงนี้เพราะ toast ระหว่างวิ่งหายไปใน 2–3 วินาที
   * ซึ่งสั้นเกินกว่าจะอ่านประโยคความรู้จบ — เฉลยที่อ่านไม่ทันเท่ากับไม่มีเฉลย
   */
  function showDeath(info) {
    const w = info.word;
    const subject = !!w?.subject;
    $('dead-word').textContent = w ? (subject ? (w.choices?.[w.answer] ?? '—') : w.en) : '—';
    $('dead-word').classList.toggle('subject', subject);
    $('dead-meaning').textContent = w ? (subject ? w.fact : w.th) : '';
    document.querySelector('.missed-label').textContent = subject ? 'คำตอบที่ถูก' : 'คำที่พลาด';

    if (info.chosen) {
      // ตัวเลือกของ deck วิชาไม่มีคำแปล — ห้ามต่อ " = undefined" ท้ายข้อความ
      $('dead-chose').textContent = info.chosen.th
        ? `คุณอยู่เลน "${info.chosen.en}" = ${info.chosen.th}`
        : `คุณอยู่เลน "${info.chosen.en}"`;
    } else {
      $('dead-chose').textContent = DEATH_NOTE[info.cause] || '';
    }
    if (subject && w.q) $('dead-chose').textContent += `\nโจทย์: ${w.q}`;
    document.querySelector('.dead-tag').textContent = DEATH_TAG[info.cause] || DEATH_TAG.lane;
    $('dead-score').textContent = info.score;
    $('dead-dist').textContent = formatDistance(info.distance ?? 0);
    $('dead-gates').textContent = info.gates;
    $('dead-coins').textContent = info.coins ?? 0;
    $('dead-best').textContent = info.best;
    show('dead');
  }

  /* ── หน้าสถิติ ─────────────────────────────────────────── */

  function renderStats(deck) {
    const s = srs.summarize(deck);
    const subject = deck.type === 'subject';
    // หัวตารางต้องเปลี่ยนตามชนิด ไม่งั้น deck วิชาจะได้หัวคอลัมน์ว่า "คำ / ความหมาย"
    // ทับข้อมูลที่จริง ๆ แล้วคือ "โจทย์ / ใบความรู้"
    const head = document.querySelector('#stats-table thead tr');
    if (head) {
      head.children[0].textContent = subject ? 'โจทย์' : 'คำ';
      head.children[1].textContent = subject ? 'ใบความรู้' : 'ความหมาย';
    }
    $('stats-summary').innerHTML = `
      <div class="chip">ทั้งหมด <b>${s.total}</b> ${subject ? 'ข้อ' : 'คำ'}</div>
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

    kidsMode: () => toggleKids.checked,
    // โหมดเด็กชนะเสมอ — ค่าที่ผู้ใช้ตั้งเองยังอยู่ในที่เก็บ แค่ไม่ถูกใช้ระหว่างเปิดโหมดเด็ก
    speedMode: () => (toggleKids.checked ? CFG.kids.speedMode : speedSelect.value),
    questionModes: () => (toggleKids.checked ? CFG.kids.modes : checkedModes()),

    // ── เล่นหลายคน ──
    mpEnterRoom,
    mpResetLobby,
    mpRenderPlayers,
    mpSetStatus,
    mpNameValue: () => mpName.value.trim(),
    mpMode: () => mpModeValue,
    selectedZone: () => mpZoneValue,

    // ── ธีม / ร้านค้า / โหมดฝึก ──
    selectedTheme: () => themeSelect.value,
    refreshIdentity,
    showPracticeTeach,
    showPracticeDone,

    /** ป้ายตัวเลขบนปุ่มโหมดฝึก = จำนวนคำที่รอทวนอยู่ (มาจากการพลาดในเกมจริง) */
    setPracticeBadge(n) {
      const badge = $('practice-badge');
      badge.textContent = n;
      badge.classList.toggle('hidden', !n);
    },
  };
}
