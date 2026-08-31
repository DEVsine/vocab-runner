/**
 * hud.js — ทุกอย่างที่ "อยู่บนกระจกหน้า" (ไม่ได้อยู่ในโลกเกม)
 *
 * กฎที่ใช้ตัดสินว่าอะไรควรเป็น DOM อะไรควรเป็น 3D:
 *   ของที่อยู่ในโลกเกมต้องมีระยะ → 3D
 *   ของที่ต้องอ่านออกเสมอไม่ว่าอยู่ไกลแค่ไหน → DOM
 *
 * ตัวเลือกคำศัพท์เคยเป็นป้ายในโลก 3D แล้วอ่านไม่ทัน เพราะขนาดตัวอักษร
 * ถูกจำกัดด้วยความกว้างเลนและถูกเปอร์สเปกทีฟบีบ พอย้ายมาเป็น "ธง" บน DOM
 * ข้อจำกัดนั้นหายไปหมด — และได้ฟอนต์ไทยของระบบมาใช้ฟรีด้วย
 *
 * ⚠️ กฎ pointer-events ของไฟล์นี้
 * #hud ทั้งผืนตั้ง pointer-events:none เพื่อไม่ให้บังการปัดนิ้วบน canvas
 * ของชิ้นไหนที่ "ต้องกดได้" (ปุ่มแอ็กชัน, แถวตารางคะแนน, การ์ดศึกชิงคำ)
 * ต้องเปิด pointer-events:auto กลับมาเองเป็นชิ้น ๆ — ลืมข้อนี้เมื่อไหร่
 * ปุ่มจะ "เห็นแต่กดไม่ได้" ซึ่งเป็นบั๊กที่หาสาเหตุยากมากบนมือถือ
 */

import { CFG } from './config.js';
import { formatDistance } from './format.js';
import { fetchImage, cachedImage } from './images.js';
import { playerHue } from './net.js';
import { ammoById } from './weapons.js';
import { characterById } from './characters.js';
import { stormPhase } from './storm.js';

const $ = id => document.getElementById(id);

/* ไอคอน/ชื่อ/สีของไอเทมจับเวลา — config.js เก็บแต่ค่าที่ใช้วาดวัตถุ 3D
   สีตรงกับสีลูกบาศก์/เพชรที่เพิ่งวิ่งชนเก็บมา เพื่อให้ "ของที่เก็บได้"
   กับ "ชิปบน HUD" เป็นชิ้นเดียวกันในสายตาผู้เล่นโดยไม่ต้องอ่านตัวหนังสือ */
const BOOST_META = {
  magnet: { icon: '🧲', label: 'แม่เหล็กดูดเหรียญ', color: '#ef4444' },
  x2:     { icon: '✨', label: 'คะแนน ×2',        color: '#a78bfa' },
};

function makeBoostChip({ icon, label, color }) {
  const node = document.createElement('div');
  node.className = 'boost-chip';
  // ชื่อเต็มอยู่ใน aria-label ตามธรรมเนียมของแถวนี้ — #hud ปิด pointer-events
  // ทั้งผืน tooltip จึงไม่มีวันโผล่ แต่ screen reader ยังอ่านได้
  //
  // ⚠️ role="img" ต้องอยู่ที่ <span> อีโมจิ ไม่ใช่ที่กล่องนอก (ทรงเดียวกับชิปเหรียญ/ดาว
  // ใน index.html) เพราะ role=img ตัดลูกหลานทั้งกิ่งออกจาก accessibility tree
  // ถ้าไปใส่ที่กล่องนอก ตัวเลขเวลาที่เหลือจะไม่มีวันถูกอ่าน — เหลือแค่ชื่อไอเทมค้างอยู่
  node.innerHTML = `<span class="boost-icon" role="img" aria-label="${label}">${icon}</span>`
    + `<span class="boost-label">${label}</span>`
    + '<span class="boost-time"></span>'
    + '<span class="boost-bar"><i></i></span>';
  node.querySelector('.boost-bar i').style.background = color;
  return { node, time: node.querySelector('.boost-time'), fill: node.querySelector('.boost-bar i') };
}

export function createHUD(handlers = {}) {
  const el = {
    root: $('hud'),
    prompt: $('hud-prompt'),
    laneFlags: $('lane-flags'),
    score: $('hud-score'),
    dist: $('hud-dist'),
    gates: $('hud-gates'),
    best: $('hud-best'),
    coins: $('hud-coins'),
    stars: $('hud-stars'),
    starsBox: document.querySelector('.stat.stars'),
    collect: $('hud-collect'),
    boosts: $('hud-boosts'),
    characterSkill: $('hud-character-skill'),
    skillStatus: $('hud-skill-status'),
    skillValue: $('hud-skill-value'),
    skillFill: $('hud-skill-fill'),
    jets: $('hud-jets'),
    bonusBanner: $('bonus-banner'),
    bonusTimer: $('bonus-timer'),
    bonusTimerBar: $('bonus-timer-bar'),
    finalBanner: $('final-banner'),
    combo: $('hud-combo'),
    comboValue: $('hud-combo-value'),
    promptLabel: $('hud-prompt-label'),
    lessonStep: $('hud-lesson-step'),
    promptWord: $('hud-prompt-word'),
    promptEmoji: $('hud-prompt-emoji'),
    promptImage: $('hud-prompt-image'),
    timerBar: $('hud-timer-bar'),
    hint: $('hud-controls-hint'),
    toast: $('hud-toast'),
    practice: $('hud-practice'),
    practiceLabel: $('pr-hud-label'),
    practiceBar: $('pr-hud-bar'),
    practiceCount: $('pr-hud-count'),
    stormBar: $('storm-bar'),
    stormTag: $('storm-tag'),
    stormPct: $('storm-pct'),
    oxyFill: $('oxy-fill'),
    actions: $('hud-actions'),
    actEquip: $('act-equip'),
    actAmmo: $('act-ammo'),
    actAmmoIcon: $('act-ammo-icon'),
    actAmmoText: $('act-ammo-text'),
    actFire: $('act-fire'),
    actFireText: $('act-fire-text'),
    actFireCharge: $('act-fire-charge'),
    actBonus: $('act-bonus'),
    cheatTag: $('cheat-tag'),
    mpLeaderboard: $('mp-leaderboard'),
    mpLbToggle: $('mp-lb-toggle'),
    mpLbList: $('mp-lb-list'),
    mpCountdown: $('mp-countdown'),
    mpCountdownNum: $('mp-countdown-num'),
    mpWinner: $('mp-winner'),
    mpWinnerText: $('mp-winner-text'),
    spectate: $('spectate-banner'),
    spectateText: $('spectate-text'),
    podium: $('podium'),
    spectateExit: $('btn-spectate-exit'),
    pause: $('btn-hud-pause'),
    bonusTitle: document.querySelector('#bonus-banner .bonus-title'),
    bonusSub: document.querySelector('#bonus-banner .bonus-sub'),
    contest: $('contest'),
    contestWord: $('contest-word'),
    contestOptions: $('contest-options'),
    contestBar: $('contest-bar'),
    contestResult: $('contest-result'),
  };

  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const flags = Array.from(document.querySelectorAll('#lane-flags .flag')).map(node => ({
    node,
    bar: node.querySelector('.flag-bar'),
    word: node.querySelector('.flag-word'),
    trans: node.querySelector('.flag-trans'),
  }));

  // นับ "รุ่น" ของโจทย์ — รูปมาจากเน็ตแบบ async ถ้าโจทย์เปลี่ยนไปก่อนรูปมาถึง
  // เราต้องทิ้งรูปเก่าที่กำลังโหลดค้าง ไม่ให้มันโผล่ทับโจทย์ใหม่
  let questionToken = 0;

  // สีธงต้องตรงกับสีแผ่นพื้นของเลนนั้นเสมอ — ตั้งครั้งเดียวตอนสร้าง
  flags.forEach((f, i) => f.node.style.setProperty('--lane', CFG.world.laneColorsCss[i]));

  let hintTimer = null;
  let toastTimer = null;
  let lastDistText = '';
  let bannerTimer = null;
  let activeBoosts = [];   // สถานะไอเทมจับเวลาเฟรมล่าสุด (EZL-71)
  const boostChips = new Map();   // type → ชิปที่สร้างไว้แล้ว (ดูเหตุผลที่ setBoosts)
  let contestCursor = 1;
  let contestLocked = false;

  const PROMPT_LABEL = {
    text: 'วิ่งเข้าเลนคำอังกฤษที่ถูก',
    image: '',
    audio: '',
    joke: 'มุกกวน — ตอบผิดก็ไม่เป็นไร',
    subject: '🔊 ฟังโจทย์แล้ววิ่งเข้าเลนคำตอบ',
  };

  const PROMPT_MODE_CLASS = ['prompt-mode-image', 'prompt-mode-audio', 'prompt-mode-text'];

  // โจทย์ที่เป็น "ประโยค" ต้องใช้สไตล์ตัวเล็กหลายบรรทัดของมุกกวน
  // ไม่งั้นโจทย์วิชายาว ๆ จะล้นกล่องออกนอกจอ
  const LONG_PROMPT_MODES = new Set(['joke', 'subject']);

  /* ── ปุ่มแอ็กชันบนจอ ─────────────────────────────────────── */
  el.actEquip.addEventListener('click', (e) => { e.stopPropagation(); handlers.onEquip?.(); });
  el.actAmmo.addEventListener('click', (e) => { e.stopPropagation(); handlers.onCycleAmmo?.(); });
  el.actFire.addEventListener('click', (e) => { e.stopPropagation(); handlers.onFire?.(); });
  // ⚠️ สองปุ่มนี้คือทางออกเดียวของผู้เล่นมือถือ (ไม่มีปุ่ม Esc ให้กด)
  el.pause.addEventListener('click', (e) => { e.stopPropagation(); handlers.onPause?.(); });
  el.actBonus.addEventListener('click', (e) => { e.stopPropagation(); handlers.onForceBonus?.(); });
  el.spectateExit.addEventListener('click', (e) => { e.stopPropagation(); handlers.onLeaveSpectate?.(); });

  /* ── ผู้ชมแตะธงเพื่อลองตอบเอง ─────────────────────────────
   * ธงปกติ pointer-events:none (ห้ามบังการปัดนิ้ว) — เปิดเฉพาะตอนเป็นผู้ชม
   * ผ่านคลาส .guessable ที่ setSpectateTarget เป็นคนใส่/ถอด */
  el.laneFlags.addEventListener('click', (e) => {
    const flag = e.target.closest('.flag');
    if (!flag || !el.laneFlags.classList.contains('guessable')) return;
    handlers.onFlagPick?.(Number(flag.dataset.lane));
  });

  /* ── แตะชื่อในตารางคะแนน = เล็งเป้า ──────────────────────── */
  el.mpLbList.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) handlers.onSelectTarget?.(li.dataset.id);
  });

  /* ── ย่อ/ขยายตารางคะแนน ───────────────────────────────────
   * เริ่มที่ "ย่อ" บนจอแคบ เพราะตารางเต็มรูปแบบทับเลนขวาจนมองไม่เห็นตัวเอง
   * แต่ย่อ ≠ ซ่อน — แถวยังอยู่ครบและยังแตะเล็งเป้าได้ ซึ่งบนมือถือคือทางเดียวที่ทำได้
   * จำค่าที่ผู้เล่นเลือกไว้ด้วย ไม่งั้นต้องมากดใหม่ทุกแมตช์ */
  const LB_KEY = `${CFG.storageKey}:mpLbCompact`;
  const savedCompact = localStorage.getItem(LB_KEY);
  const compact0 = savedCompact === null ? window.innerWidth < 820 : savedCompact === '1';
  el.mpLeaderboard.classList.toggle('compact', compact0);
  el.mpLbToggle.setAttribute('aria-expanded', String(!compact0));
  el.mpLbToggle.addEventListener('click', () => {
    const on = el.mpLeaderboard.classList.toggle('compact');
    el.mpLbToggle.setAttribute('aria-expanded', String(!on));
    try { localStorage.setItem(LB_KEY, on ? '1' : '0'); } catch { /* โหมดส่วนตัวเขียนไม่ได้ ไม่เป็นไร */ }
  });

  /* ── การ์ดศึกชิงคำ: แตะตัวเลือกได้ตรง ๆ ──────────────────── */
  el.contestOptions.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-index]');
    if (btn && !contestLocked) handlers.onContestPick?.(Number(btn.dataset.index));
  });

  function renderContestCursor() {
    Array.from(el.contestOptions.children).forEach((btn, i) => {
      btn.classList.toggle('cursor', i === contestCursor);
    });
  }

  /**
   * โหลดรูปจริงของคำแล้ว "สลับ" เข้ามาแทน emoji เมื่อพร้อม
   * token = รุ่นของโจทย์ตอนเรียก ถ้าโจทย์เปลี่ยนไปก่อนรูปมา (questionToken ขยับ) ก็ทิ้ง
   */
  function showPhoto(word, token) {
    const applyPhoto = (url) => {
      if (token !== questionToken || !url) return;
      const img = el.promptImage;
      img.onload = () => {
        if (token !== questionToken) return;     // โจทย์เปลี่ยนระหว่างรอโหลด → อย่าโผล่ทับ
        img.classList.remove('hidden');
        el.promptEmoji.classList.add('hidden');
      };
      img.onerror = () => {};                     // รูปเสีย/โหลดไม่ได้ → คง emoji ไว้เฉย ๆ
      img.src = url;
    };

    /* รูปในเครื่องมาก่อนเสมอ — เร็วกว่า ตรงคำกว่า และเล่นได้แม้ไม่มีเน็ต
     * ⚠️ ต้องอ้างจาก import.meta.url ไม่ใช่เส้นทางเทียบหน้าเว็บ
     * เหตุผลเดียวกับ models.js: หน้าใน /dev/ จะไปหา /dev/assets/... ซึ่งไม่มี
     * แล้วรูปจะหายเงียบ ๆ โดยไม่มีอะไรบอกว่าสาเหตุคือเส้นทาง */
    if (word.img) {
      applyPhoto(new URL(`../assets/${word.img}`, import.meta.url).href);
      return;
    }

    const cached = cachedImage(word.en);
    if (cached === null) return;                  // เคยหาแล้วไม่มีรูป → ใช้ emoji ต่อ
    if (typeof cached === 'string') { applyPhoto(cached); return; }
    fetchImage(word.en).then(applyPhoto);         // ยังไม่รู้ → ยิงเน็ตแล้วค่อยสลับ
  }

  return {
    show() {
      el.root.classList.remove('hidden');
      el.hint.classList.remove('faded');
      clearTimeout(hintTimer);
      // คำใบ้ปุ่มควรหายไปเองหลังผู้เล่นเริ่มจับทางได้ ไม่ต้องให้ไปปิดเอง
      hintTimer = setTimeout(() => el.hint.classList.add('faded'), 6000);
    },

    hide() {
      el.root.classList.add('hidden');
      clearTimeout(hintTimer);
      clearTimeout(toastTimer);
      clearTimeout(bannerTimer);
      el.toast.classList.add('hidden');
      el.bonusBanner.classList.add('hidden');
      el.bonusTimer.classList.add('hidden');
      el.finalBanner.classList.add('hidden');
    },

    /** แสดงโจทย์ 1 ข้อ (รูปแบบ text / image / audio) พร้อมธงคำตอบ 3 ใบ */
    setQuestion(question) {
      const { mode, word, options } = question;
      const token = ++questionToken;   // โจทย์ใหม่ → ยกเลิกรูปเก่าที่ยังโหลดค้างอยู่

      el.prompt.classList.remove(...PROMPT_MODE_CLASS);
      if (PROMPT_MODE_CLASS.includes(`prompt-mode-${mode}`)) {
        el.prompt.classList.add(`prompt-mode-${mode}`);
      }

      const label = PROMPT_LABEL[mode] ?? PROMPT_LABEL.text;
      el.promptLabel.textContent = label;
      el.promptLabel.classList.toggle('hidden', !label);

      el.promptWord.classList.toggle('joke', LONG_PROMPT_MODES.has(mode));
      el.promptWord.classList.remove('prompt-th');
      el.promptImage.classList.add('hidden');   // ตั้งต้นซ่อนรูปไว้เสมอ
      el.promptWord.classList.add('hidden');

      if (mode === 'image') {
        // รูปอย่างเดียว — ไม่โชว์คำอังกฤษคู่ (เสียงอ่านให้แทน)
        el.promptEmoji.textContent = word.emoji || '🖼️';
        el.promptEmoji.classList.remove('hidden');
        showPhoto(word, token);
      } else if (mode === 'audio') {
        // เสียงอย่างเดียว — ไอคอนบอกว่าต้องฟัง ไม่โชว์คำใดบนจอ
        el.promptEmoji.textContent = '🔊';
        el.promptEmoji.classList.remove('hidden');
      } else {
        el.promptEmoji.classList.add('hidden');
        if (question.antonym) {
          // โจทย์คำตรงข้าม — สลับภาษาตามที่ deck.js สุ่มไว้ (promptLang)
          // ถามด้วยคำอังกฤษ = วัดว่าอ่าน en ออก · ถามด้วยคำไทย = วัดว่าแปลกลับได้
          const target = question.promptLang === 'en' ? word.en : word.th;
          el.promptWord.textContent = `คำตรงข้ามของ "${target}"`;
        } else {
          el.promptWord.textContent = LONG_PROMPT_MODES.has(mode) ? word.q : word.th;
        }
        el.promptWord.classList.remove('hidden');
        if (mode === 'text' && !word.subject) el.promptWord.classList.add('prompt-th');
      }

      flags.forEach((f, i) => {
        f.word.textContent = options[i].en;
        f.trans.textContent = '';
        // ตัวเลือกของ deck วิชาไม่มีคำแปล → dataset ว่าง → revealMeanings ข้ามให้เอง
        f.trans.dataset.th = options[i].th || '';   // เก็บไว้เผยตอนเฉลย (ผู้ชมใช้)
        f.node.classList.remove('correct', 'wrong', 'revealed');
      });
    },

    /** ตอบเสร็จแล้ว → เผยคำแปลไทยใต้ทุกธง เพื่อปิดวงจร "เห็นคำ↔รู้ความหมาย" */
    revealMeanings(options) {
      flags.forEach((f, i) => {
        const th = options[i]?.th;
        if (!th) return;
        f.trans.textContent = th;
        f.node.classList.add('revealed');
      });
    },

    setQuestionVisible(on) {
      el.prompt.classList.toggle('hidden', !on);
      el.laneFlags.classList.toggle('hidden', !on);
    },

    /** ป้ายขั้นสอนโหมดเด็ก / speak-all — null = ซ่อน */
    setLessonStep(label) {
      if (!label) {
        el.lessonStep.classList.add('hidden');
        el.lessonStep.textContent = '';
        return;
      }
      el.lessonStep.textContent = label;
      el.lessonStep.classList.remove('hidden');
    },

    clearQuestion() {
      el.prompt.classList.remove(...PROMPT_MODE_CLASS);
      el.promptWord.textContent = '—';
      el.promptWord.classList.remove('hidden', 'joke', 'prompt-th');
      el.promptEmoji.classList.add('hidden');
      el.promptImage.classList.add('hidden');
      el.promptLabel.textContent = PROMPT_LABEL.text;
      el.promptLabel.classList.remove('hidden');
      this.setLessonStep(null);
      questionToken++;                 // กันรูปที่ค้างโหลดไม่ให้โผล่หลังเคลียร์โจทย์
      flags.forEach(f => {
        f.word.textContent = '—';
        f.trans.textContent = '';
        f.node.classList.remove('correct', 'wrong', 'revealed');
      });
      this.setTimer(0);
    },

    setActiveLane(index) {
      flags.forEach((f, i) => f.node.classList.toggle('active', i === index));
    },

    markResult(correctIndex) {
      flags.forEach((f, i) => {
        f.node.classList.toggle('correct', i === correctIndex);
        f.node.classList.toggle('wrong', i !== correctIndex);
      });
    },

    /** 🔀 โดนกระสุนสลับธง — กะพริบทั้งแถวให้รู้ตัวว่า "ต้องอ่านใหม่" */
    flashSwap() {
      el.laneFlags.classList.remove('swapping');
      void el.laneFlags.offsetWidth;   // reflow เพื่อรีสตาร์ทอนิเมชัน
      el.laneFlags.classList.add('swapping');
      setTimeout(() => el.laneFlags.classList.remove('swapping'), 700);
    },

    /** 🌫️ หมอกบังคำแปล — เบลอ "โจทย์" เท่านั้น ไม่แตะธงคำตอบ
     *  (เบลอทั้งจอ = ตอบไม่ได้ ซึ่งผิดกฎเหล็กของอาวุธ) */
    setFog(ratio) {
      const r = Math.max(0, Math.min(1, ratio));
      // 5.5px คือ "อ่านยากขึ้นชัดเจน แต่ยังเดารูปคำได้" — 9px ทำให้ตัวหนังสือหายไปเลย
      el.prompt.style.setProperty('--fog', `${(r * 5.5).toFixed(2)}px`);
      el.prompt.classList.toggle('fogged', r > 0.01);
    },

    setScore(score, gates, combo) {
      el.score.textContent = score;
      el.gates.textContent = gates;
      // Plan 1A วางตัวคูณเป็นข้อมูลหลักบนแถวบน แม้ยังเป็น ×1 ก็ต้องอยู่ตำแหน่งเดิม
      // HUD จึงไม่กระโดดเข้า-ออกเมื่อเริ่มต่อคอมโบ และผู้เล่นเห็นความหมายของค่านี้
      // ก่อนที่มันจะเพิ่มขึ้น แทนที่จะเจอเอฟเฟกต์ใหม่โผล่มาโดยไม่มีบริบท
      el.combo.classList.remove('hidden');
      el.comboValue.textContent = Math.max(1, combo);
    },

    setCoins(n) { el.coins.textContent = n; },

    /** ระยะทางวิ่ง (เมตร) — ถูกเรียกทุกเฟรม จึงแตะ DOM เฉพาะตอนข้อความเปลี่ยนจริง */
    setDistance(meters) {
      const text = formatDistance(meters);
      if (text === lastDistText) return;
      lastDistText = text;
      el.dist.textContent = text;
    },

    setStars(collected, needed) {
      el.stars.textContent = `${collected}/${needed}`;
      el.starsBox.classList.toggle('ready', collected >= needed);
    },

    /** ของสะสมทั้งชุด (เหรียญ/ดาว/เกราะ) — ห้องซ้อมปิดทั้งแถบ */
    setCollectiblesVisible(on) {
      el.collect.classList.toggle('hidden', !on);
      el.actEquip.classList.toggle('hidden', !on);
      el.practice.classList.toggle('hidden', on);
    },

    /** ปุ่มเกราะต้องพูดภาษาของตัวละครที่ใส่อยู่ รวมถึงคำกริยา "ใช้" ของสกิลกรงเล็บ */
    setArmorLabel(emoji, name, action = 'ใส่') {
      el.actEquip.querySelector('.act-icon').textContent = emoji;
      el.actEquip.querySelector('.act-text').textContent = `${action}${name}`;
    },

    setPracticeProgress(done, total) {
      el.practiceCount.textContent = `${Math.max(0, done)}/${total}`;
      el.practiceBar.style.transform = `scaleX(${total ? Math.max(0, done) / total : 0})`;
    },

    /* ── โหมดสอบ ──────────────────────────────────────────────
     *
     * ใช้ "แถบเดียวกัน" กับโหมดฝึก เปลี่ยนแค่ป้าย เพราะทั้งสองโหมดตอบคำถามเดียวกัน
     * ให้ผู้เล่น: "เหลืออีกเท่าไหร่ถึงจะจบ" — แถบที่สองที่หน้าตาเหมือนกันแต่ id ต่างกัน
     * คือหนี้ที่ต้องจ่ายทุกครั้งที่มีคนแก้สไตล์ของแถบใดแถบหนึ่ง
     *
     * ⚠️ ต้องเรียก *หลัง* setCollectiblesVisible เสมอ — ตัวนั้นสลับ .hidden ของแถบนี้
     * ตามตรรกะ "ไม่ใช่โหมดฝึก = ซ่อน" ซึ่งไม่รู้จักโหมดสอบ
     */
    setExamMode(on) {
      el.practice.classList.toggle('hidden', !on);
      el.practiceLabel.textContent = on ? 'ข้อ' : 'ฝึก';
      // ดาว = ตัวนับเข้าด่านโบนัส ซึ่งโหมดสอบไม่มี · ตัวเลขที่ค้างอยู่ที่ 0 ยังชวนให้มอง
      el.starsBox.classList.toggle('hidden', on);
      // ปุ่มเกราะ: โหมดสอบไม่ปล่อยเกราะเลย ปุ่มที่กดแล้วไม่เกิดอะไรคือปุ่มที่ทำให้สับสน
      el.actEquip.classList.toggle('hidden', on);
    },

    setExamProgress(done, total) {
      el.practiceCount.textContent = `${Math.max(0, done)}/${total}`;
      el.practiceBar.style.transform = `scaleX(${total ? Math.max(0, done) / total : 0})`;
    },

    /* ── 🌪️ พายุ + ⚔️ อาวุธ (เฉพาะ Battle Royale) ────────── */

    setBattleVisible(on) {
      el.stormBar.classList.toggle('hidden', !on);
      el.actAmmo.classList.toggle('hidden', !on);
      el.actFire.classList.toggle('hidden', !on);
    },

    setOxygen(ratio, level) {
      const r = Math.max(0, Math.min(1, ratio));
      el.oxyFill.style.transform = `scaleX(${r})`;
      el.stormPct.textContent = `${Math.round(r * 100)}%`;
      const phase = stormPhase(level || 1);
      el.stormTag.textContent = `🌪️ ${phase.tag} ×${(level || 1).toFixed(1)}`;
      // ⚠️ ห้ามใช้ className = '…' ตรงนี้เด็ดขาด
      // มันเขียนทับ "ทุกคลาส" รวมถึง .hidden ที่ setBattleVisible เพิ่งใส่ไว้
      // ผลคือแถบพายุโผล่ในโหมดเล่นเดี่ยวทั้งที่ไม่ควรมี — และหาสาเหตุยากมาก
      // เพราะโค้ดที่ "ซ่อน" กับโค้ดที่ "ทำให้โผล่" อยู่คนละฟังก์ชันและดูไม่เกี่ยวกันเลย
      for (const c of ['calm', 'rising', 'strong', 'extreme']) {
        el.stormBar.classList.toggle(c, c === phase.cls);
      }
      el.stormBar.classList.toggle('danger', r < CFG.br.storm.warnAt);
    },

    /** เติมพลังสำเร็จ — กะพริบเขียวสั้น ๆ ให้รู้สึกว่า "ตอบถูก = ได้หายใจ" */
    pulseOxygen() {
      el.oxyFill.classList.remove('pulse');
      void el.oxyFill.offsetWidth;
      el.oxyFill.classList.add('pulse');
    },

    /**
     * @param {number} ammo กระสุนในมือ
     * @param {number} charge ความคืบหน้าไปยังกระสุนนัดถัดไป 0..1
     * @param {string} ammoId ชนิดกระสุนที่เลือกอยู่
     * @param {string|null} targetId เป้าที่เล็งไว้ (null = ให้ระบบเล็งผู้นำให้)
     */
    setWeapon(ammo, charge, ammoId, targetId) {
      const a = ammoById(ammoId);
      el.actAmmoIcon.textContent = a.emoji;
      el.actAmmoText.textContent = a.name;
      el.actFireText.textContent = ammo > 0 ? `ยิง ×${ammo}` : 'ชาร์จ…';
      el.actFire.classList.toggle('ready', ammo > 0);
      el.actFire.classList.toggle('aimed', !!targetId);
      el.actFireCharge.style.transform = `scaleX(${Math.max(0, Math.min(1, charge))})`;
    },

    setFinalBanner(on) {
      el.finalBanner.classList.toggle('hidden', !on);
    },

    /** 🧪 โหมดทดลอง (ปลดด้วยรหัสลับในร้านค้า) — ปุ่มลัดเข้าด่านโบนัส + ป้ายบอกว่ากำลังเปิดอยู่ */
    setCheatVisible(on) {
      el.actBonus.classList.toggle('hidden', !on);
      el.cheatTag.classList.toggle('hidden', !on);
    },

    showBonusBanner(ms = 2600) {
      el.bonusBanner.classList.remove('hidden');
      el.bonusBanner.style.animation = 'none';
      void el.bonusBanner.offsetWidth;
      el.bonusBanner.style.animation = '';
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => el.bonusBanner.classList.add('hidden'), ms);
    },

    hideBonusBanner() {
      clearTimeout(bannerTimer);
      el.bonusBanner.classList.add('hidden');
    },

    setBonusTimer(ratio) {
      if (ratio === null) {
        el.bonusTimer.classList.add('hidden');
        return;
      }
      el.bonusTimer.classList.remove('hidden');
      el.bonusTimerBar.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
    },

    /**
     * สถานะไอเทมจับเวลา (EZL-71): [{ type: 'magnet'|'x2', remainingMs }]
     *
     * main ป้อนเข้ามา "ทุกเฟรม" — จึงต้องอัปเดตชิปตัวเดิม ไม่ใช่สร้าง DOM ใหม่
     * (สร้างใหม่ 60 ครั้ง/วินาทีคือการโยนงานให้ GC ฟรี ๆ และทำให้ชิปกระพริบ)
     * ชิปจึงถูกจำไว้ใน boostChips แล้วลบเฉพาะตัวที่หมดเวลาไปแล้วจริง ๆ
     */
    setBoosts(list) {
      activeBoosts = list;
      const alive = new Set();

      for (const { type, remainingMs } of list) {
        const meta = BOOST_META[type];
        if (!meta) continue;          // ไอเทมใหม่ที่ยังไม่มีหน้าตา — เงียบไว้ดีกว่าพัง
        alive.add(type);

        let chip = boostChips.get(type);
        if (!chip) {
          chip = makeBoostChip(meta);
          boostChips.set(type, chip);
          el.boosts.appendChild(chip.node);
        }

        chip.time.textContent = `${Math.max(0, remainingMs / 1000).toFixed(1)} วิ`;
        // active() ส่งมาแต่เวลาที่เหลือ — สัดส่วนหลอดต้องหารด้วยเวลาเต็มจาก config เอง
        const totalMs = CFG.boosts.items[type].durationSeconds * 1000;
        chip.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, remainingMs / totalMs))})`;
      }

      for (const [type, chip] of boostChips) {
        if (alive.has(type)) continue;
        chip.node.remove();
        boostChips.delete(type);
      }
    },
    getBoosts: () => activeBoosts,

    /** HUD ของสกิลประจำตัว — null = ตัวที่ใส่อยู่ไม่มีสกิลนี้ */
    setCharacterSkill(info) {
      if (!info) {
        el.characterSkill.classList.add('hidden');
        el.characterSkill.classList.remove('casting', 'near-ready');
        return;
      }
      const ratio = Math.max(0, Math.min(1, info.chargeRatio ?? 0));
      const casting = info.phase === 'burst';
      el.characterSkill.classList.remove('hidden');
      el.characterSkill.classList.toggle('casting', casting);
      el.characterSkill.classList.toggle('near-ready', !casting && ratio >= CFG.blackPanther.traceStartsAt);
      el.skillStatus.textContent = casting ? 'กำลังระเบิดไปข้างหน้า' : (ratio >= CFG.blackPanther.traceStartsAt ? 'พลังใกล้เต็ม!' : 'วิ่งเพื่อสะสมพลัง');
      el.skillValue.textContent = casting ? 'ปล่อยพลัง!' : `${Math.round(ratio * 100)}%`;
      el.skillFill.style.transform = `scaleX(${casting ? 1 : ratio})`;
    },

    /** @param {number} n เกราะในคลัง (ยังไม่ใส่) @param {boolean} armed ใส่อยู่ = pip เรืองแสงพิเศษ */
    setJets(n, armed = false) {
      el.jets.innerHTML = '';
      if (armed) {
        const pip = document.createElement('div');
        pip.className = 'jet-pip armed';
        el.jets.appendChild(pip);
      }
      for (let i = 0; i < n; i++) {
        const pip = document.createElement('div');
        pip.className = 'jet-pip';
        el.jets.appendChild(pip);
      }
      el.actEquip.classList.toggle('ready', n > 0 && !armed);
      el.actEquip.classList.toggle('armed', armed);
    },

    setBest(best) { el.best.textContent = best; },

    /** @param {number} ratio 1 = เพิ่งเห็นโจทย์, 0 = หมดเวลา */
    setTimer(ratio) {
      const r = Math.max(0, Math.min(1, ratio));
      el.timerBar.style.transform = `scaleX(${r})`;
      el.timerBar.classList.toggle('urgent', r < 0.33);
    },

    toast(message, ms = 1600) {
      el.toast.textContent = message;
      el.toast.classList.remove('hidden');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.add('hidden'), ms);
    },

    /* ── ⚡ ศึกชิงคำ ────────────────────────────────────────── */

    showContest(contest) {
      if (!contest) {
        el.contest.classList.add('hidden');
        el.contestResult.textContent = '';
        el.contestResult.className = '';
        return;
      }
      contestCursor = 1;
      contestLocked = false;
      el.contestWord.textContent = contest.th;
      el.contestResult.textContent = '';
      el.contestResult.className = '';
      el.contestOptions.innerHTML = contest.options.map((o, i) => `
        <button type="button" data-index="${i}" style="--lane:${CFG.world.laneColorsCss[i]}">
          <span class="co-bar"></span>
          <span class="co-en">${escapeHtml(o.en)}</span>
        </button>`).join('');
      renderContestCursor();
      el.contest.classList.remove('hidden');
      el.contestBar.style.transform = 'scaleX(1)';
    },

    setContestTimer(ratio) {
      const r = Math.max(0, Math.min(1, ratio));
      el.contestBar.style.transform = `scaleX(${r})`;
      el.contestBar.classList.toggle('urgent', r < 0.35);
    },

    moveContestCursor(delta) {
      const n = el.contestOptions.children.length || 3;
      contestCursor = (contestCursor + delta + n) % n;
      renderContestCursor();
    },

    contestCursor: () => contestCursor,

    markContestPick(index) {
      contestLocked = true;
      Array.from(el.contestOptions.children).forEach((btn, i) => {
        btn.classList.toggle('picked', i === index);
      });
      el.contestResult.textContent = 'ล็อกคำตอบแล้ว — รอผลตัดสิน…';
      el.contestResult.className = 'waiting';
    },

    /** เฉลย + ประกาศผู้ชนะ — ช่วงนี้คือ "บทเรียน" ของคนที่ตอบผิด ต้องค้างให้อ่านทัน */
    revealContest(correctIndex, picked, winnerName, iWon) {
      Array.from(el.contestOptions.children).forEach((btn, i) => {
        btn.classList.toggle('correct', i === correctIndex);
        btn.classList.toggle('wrong', i === picked && i !== correctIndex);
        btn.classList.remove('cursor');
      });
      if (iWon) {
        el.contestResult.textContent = '⚡ คุณตอบถูกก่อน! พลังเต็ม + กระสุน 1 นัด';
        el.contestResult.className = 'win';
      } else if (picked === correctIndex) {
        el.contestResult.textContent = `ถูกต้อง! แต่ ${winnerName || 'คู่แข่ง'} เร็วกว่า — ได้พลังคืนบางส่วน`;
        el.contestResult.className = 'ok';
      } else {
        el.contestResult.textContent = winnerName
          ? `${winnerName} ตอบถูกก่อน — พายุกินพลังคุณไปนิดหน่อย`
          : 'ไม่มีใครตอบถูก — พายุกินพลังทุกคน';
        el.contestResult.className = 'lose';
      }
    },

    /* ── โหมดแข่งหลายคน ── */

    showLeaderboard(on) {
      el.mpLeaderboard.classList.toggle('hidden', !on);
    },

    /**
     * วาดตารางคะแนนสด — เรียงคะแนนมาก→น้อย, ไฮไลต์แถวของเราเอง
     * จุดสีหน้าชื่อ = สีเดียวกับโกสต์ของคนนั้นในฉาก (จับคู่กันได้ด้วยตาเดียว)
     * แถบใต้ชื่อ = ออกซิเจนของคนนั้น — เห็นได้ทันทีว่าใครกำลังจะร่วง (= เป้าที่คุ้มที่สุด)
     */
    setLeaderboard(players, selfId, targetId = null, watchId = null) {
      const rows = [...players].sort((a, b) => (b.score - a.score) || (b.gates - a.gates));
      el.mpLbList.innerHTML = rows.map((p, i) => {
        const oxy = Math.max(0, Math.min(1, p.oxy ?? 1));
        const cls = [
          p.id === selfId ? 'me' : '',
          p.finished ? 'dead' : '',
          p.id === targetId ? 'targeted' : '',
          p.id === watchId ? 'watched' : '',
        ].filter(Boolean).join(' ');
        return `
        <li class="${cls}" data-id="${escapeHtml(p.id)}">
          <span class="lb-rank">${i === 0 ? '👑' : i + 1}</span>
          <span class="mp-dot" style="color:hsl(${playerHue(p.id)},85%,62%)"></span>
          <span class="lb-body">
            <span class="lb-name">${escapeHtml(p.name)}${p.team != null ? ` <small>T${p.team + 1}</small>` : ''}</span>
            <span class="lb-oxy"><i style="transform:scaleX(${oxy.toFixed(2)})"></i></span>
          </span>
          <span class="lb-score">${p.score}</span>
          <span class="lb-flag">${p.finished ? '💀' : p.id === watchId ? '👁️' : p.id === targetId ? '🎯' : '🏃'}</span>
        </li>`;
      }).join('');
    },

    /** เปลี่ยนข้อความป้ายด่านโบนัสตามธีม (ทางช้างเผือก/เมืองใต้ทะเล/ฯลฯ) */
    setBonusFlavor(title, sub) {
      el.bonusTitle.textContent = title;
      el.bonusSub.textContent = sub;
    },

    /** ป้ายบอกว่ากำลังสิงใครอยู่ + เปิดให้ธงกดได้ */
    setSpectateTarget(name) {
      el.spectateText.textContent = name
        ? `👁️ กำลังสิง ${name} — แตะธงเพื่อลองตอบ`
        : '💀 ตกรอบแล้ว — แตะชื่อในตารางเพื่อสิง';
      el.laneFlags.classList.toggle('guessable', !!name);
    },

    /** ผลการเดาของผู้ชม — เขียว = ถูก, แดง = ที่เลือกผิด (เฉลยยังโชว์เขียวเสมอ) */
    setSpectateGuess(res) {
      if (!res) {
        flags.forEach(f => f.node.classList.remove('correct', 'wrong', 'revealed'));
        return;
      }
      flags.forEach((f, i) => {
        f.node.classList.toggle('correct', i === res.correct);
        f.node.classList.toggle('wrong', i === res.picked && i !== res.correct);
      });
      this.revealMeanings(flags.map(f => ({ th: f.trans.dataset.th || '' })));
    },

    /**
     * แท่นรับรางวัล 3 อันดับ — เรียง 2-1-3 ในโค้ดเพื่อให้ที่ 1 อยู่กลาง
     * @param {Array<{name,score,skin,id}>} top3
     */
    showPodium(top3) {
      const slots = [...el.podium.querySelectorAll('.pod-slot')];
      if (!top3 || !top3.length) {
        el.podium.classList.add('hidden');
        slots.forEach(sl => { sl.innerHTML = ''; });
        return;
      }
      const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
      slots.forEach((sl) => {
        const rank = Number(sl.dataset.rank);
        const p = top3[rank - 1];
        if (!p) { sl.classList.add('empty'); sl.innerHTML = ''; return; }
        sl.classList.remove('empty');
        sl.style.setProperty('--hue', playerHue(p.id));
        sl.innerHTML = `
          <div class="pod-medal">${MEDAL[rank]}</div>
          <div class="pod-char">${characterById(p.skin).emoji}</div>
          <div class="pod-name">${escapeHtml(p.name)}</div>
          <div class="pod-score">${p.score}</div>
          <div class="pod-block"><span>${rank}</span></div>`;
      });
      el.podium.classList.remove('hidden');
    },

    showSpectate(on) {
      el.spectate.classList.toggle('hidden', !on);
    },

    showWinner(text) {
      if (!text) { el.mpWinner.classList.add('hidden'); return; }
      el.mpWinnerText.textContent = text;
      el.mpWinner.classList.remove('hidden');
      el.mpWinnerText.style.animation = 'none';
      void el.mpWinnerText.offsetWidth;
      el.mpWinnerText.style.animation = '';
    },

    countdown(n) {
      if (n === null) { el.mpCountdown.classList.add('hidden'); return; }
      el.mpCountdown.classList.remove('hidden');
      el.mpCountdownNum.textContent = n;
      el.mpCountdownNum.style.animation = 'none';
      void el.mpCountdownNum.offsetWidth;   // reflow เพื่อรีสตาร์ทอนิเมชัน
      el.mpCountdownNum.style.animation = '';
    },
  };
}
