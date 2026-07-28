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
 */

import { CFG } from './config.js';
import { fetchImage, cachedImage } from './images.js';

const $ = id => document.getElementById(id);

export function createHUD() {
  const el = {
    root: $('hud'),
    prompt: $('hud-prompt'),
    laneFlags: $('lane-flags'),
    score: $('hud-score'),
    gates: $('hud-gates'),
    best: $('hud-best'),
    coins: $('hud-coins'),
    stars: $('hud-stars'),
    starsBox: document.querySelector('.stat.stars'),
    jets: $('hud-jets'),
    bonusBanner: $('bonus-banner'),
    bonusTimer: $('bonus-timer'),
    bonusTimerBar: $('bonus-timer-bar'),
    combo: $('hud-combo'),
    comboValue: $('hud-combo-value'),
    promptLabel: $('hud-prompt-label'),
    promptWord: $('hud-prompt-word'),
    promptEmoji: $('hud-prompt-emoji'),
    promptImage: $('hud-prompt-image'),
    timerBar: $('hud-timer-bar'),
    hint: $('hud-controls-hint'),
    toast: $('hud-toast'),
    mpLeaderboard: $('mp-leaderboard'),
    mpLbList: $('mp-lb-list'),
    mpCountdown: $('mp-countdown'),
    mpCountdownNum: $('mp-countdown-num'),
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

  const PROMPT_LABEL = {
    text: 'วิ่งเข้าเลนที่แปลว่า',
    image: 'รูปนี้คือคำว่าอะไร',
    audio: 'ฟังแล้วเลือกคำที่ได้ยิน',
    joke: 'มุกกวน — ตอบผิดก็ไม่เป็นไร',
  };

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
      clearTimeout(this._bannerTimer);
      el.toast.classList.add('hidden');
      el.bonusBanner.classList.add('hidden');
      el.bonusTimer.classList.add('hidden');
    },

    /** แสดงโจทย์ 1 ข้อ (รูปแบบ text / image / audio) พร้อมธงคำตอบ 3 ใบ */
    setQuestion(question) {
      const { mode, word, options } = question;
      const token = ++questionToken;   // โจทย์ใหม่ → ยกเลิกรูปเก่าที่ยังโหลดค้างอยู่

      el.promptLabel.textContent = PROMPT_LABEL[mode] ?? PROMPT_LABEL.text;
      el.promptWord.classList.toggle('joke', mode === 'joke');
      el.promptImage.classList.add('hidden');   // ตั้งต้นซ่อนรูปไว้เสมอ

      if (mode === 'image') {
        // โชว์ emoji เป็น "ตัวยืน" ก่อน แล้วค่อยสลับเป็นรูปจริงเมื่อโหลดสำเร็จ
        // (ถ้ารูปไม่มา ก็ไม่แย่ไปกว่าเดิม — ยังเห็น emoji ตอบได้ตามปกติ)
        el.promptEmoji.textContent = word.emoji || '🖼️';
        el.promptEmoji.classList.remove('hidden');
        el.promptWord.classList.add('hidden');
        showPhoto(word, token);
      } else if (mode === 'audio') {
        // โหมดเสียง: โชว์คำแปลไทยคู่กับไอคอนลำโพง
        // → เปลี่ยนจาก "จับเสียงให้ได้แล้วสะกด" เป็น "ฟังเสียง + เห็นความหมาย เลือกคำอังกฤษ"
        el.promptEmoji.classList.add('hidden');
        el.promptWord.textContent = `🔊 ${word.th}`;
        el.promptWord.classList.remove('hidden');
      } else {
        el.promptWord.textContent = mode === 'joke' ? word.q : word.th;
        el.promptWord.classList.remove('hidden');
        el.promptEmoji.classList.add('hidden');
      }

      flags.forEach((f, i) => {
        f.word.textContent = options[i].en;
        f.trans.textContent = '';
        f.node.classList.remove('correct', 'wrong', 'revealed');
      });
    },

    /** ตอบเสร็จแล้ว → เผยคำแปลไทยใต้ทุกธง (โดยเฉพาะใบที่ถูก) เพื่อปิดวงจรการเรียนรู้
     *  โจทย์มุกกวนในโบนัสไม่มีคำแปล (options เป็น {en} ล้วน) จะข้ามให้เอง */
    revealMeanings(options) {
      flags.forEach((f, i) => {
        const th = options[i]?.th;
        if (!th) return;
        f.trans.textContent = th;
        f.node.classList.add('revealed');
      });
    },

    /** ซ่อน/แสดง UI ของคำถาม (กล่องโจทย์ + ธง 3 ใบ)
     *  ด่านโบนัสไม่มีคำถามแล้ว การปล่อยกล่องว่าง "—" ค้างไว้ดูรก จึงซ่อนทั้งชุด */
    setQuestionVisible(on) {
      el.prompt.classList.toggle('hidden', !on);
      el.laneFlags.classList.toggle('hidden', !on);
    },

    clearQuestion() {
      el.promptWord.textContent = '—';
      el.promptWord.classList.remove('hidden', 'joke');
      el.promptEmoji.classList.add('hidden');
      el.promptImage.classList.add('hidden');
      el.promptLabel.textContent = PROMPT_LABEL.text;
      questionToken++;                 // กันรูปที่ค้างโหลดไม่ให้โผล่หลังเคลียร์โจทย์
      flags.forEach(f => {
        f.word.textContent = '—';
        f.trans.textContent = '';
        f.node.classList.remove('correct', 'wrong', 'revealed');
      });
      this.setTimer(0);
    },

    /** ไฮไลต์ธงของเลนที่ตัวละครอยู่ตอนนี้ */
    setActiveLane(index) {
      flags.forEach((f, i) => f.node.classList.toggle('active', i === index));
    },

    /** ระบายผลตอนหมดเวลา: เขียว = คำตอบที่ถูก, แดง = เลนที่โดนเลเซอร์ */
    markResult(correctIndex) {
      flags.forEach((f, i) => {
        f.node.classList.toggle('correct', i === correctIndex);
        f.node.classList.toggle('wrong', i !== correctIndex);
      });
    },

    setScore(score, gates, combo) {
      el.score.textContent = score;
      el.gates.textContent = gates;
      if (combo > 1) {
        el.combo.classList.remove('hidden');
        el.comboValue.textContent = combo;
      } else {
        el.combo.classList.add('hidden');
      }
    },

    setCoins(n) { el.coins.textContent = n; },

    setStars(collected, needed) {
      el.stars.textContent = `${collected}/${needed}`;
      el.starsBox.classList.toggle('ready', collected >= needed);
    },

    showBonusBanner(ms = 2600) {
      el.bonusBanner.classList.remove('hidden');
      // สร้าง element ใหม่เพื่อรีสตาร์ทอนิเมชัน (วิธีที่ถูกคือ reflow แต่แบบนี้อ่านง่ายกว่า)
      el.bonusBanner.style.animation = 'none';
      void el.bonusBanner.offsetWidth;
      el.bonusBanner.style.animation = '';
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => el.bonusBanner.classList.add('hidden'), ms);
    },

    hideBonusBanner() {
      clearTimeout(this._bannerTimer);
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

    /** @param {number} n ไอพ่นในคลัง (ยังไม่ใส่) @param {boolean} armed ใส่อยู่ = pip เรืองแสงพิเศษ */
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

    /* ── โหมดแข่งหลายคน ── */

    showLeaderboard(on) {
      el.mpLeaderboard.classList.toggle('hidden', !on);
    },

    /** วาดตารางคะแนนสด — เรียงคะแนนมาก→น้อย, ไฮไลต์แถวของเราเอง */
    setLeaderboard(players, selfId) {
      const rows = [...players].sort((a, b) => (b.score - a.score) || (b.gates - a.gates));
      el.mpLbList.innerHTML = rows.map((p, i) => `
        <li class="${p.id === selfId ? 'me' : ''} ${p.finished ? 'dead' : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span class="lb-name">${escapeHtml(p.name)}</span>
          <span class="lb-score">${p.score}</span>
          <span class="lb-flag">${p.finished ? '💀' : '🏃'}</span>
        </li>`).join('');
    },

    /** นับถอยหลัง: ส่งตัวเลข (โชว์+เล่นอนิเมชัน) หรือ null เพื่อซ่อน */
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
