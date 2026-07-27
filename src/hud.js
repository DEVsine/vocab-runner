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

const $ = id => document.getElementById(id);

export function createHUD() {
  const el = {
    root: $('hud'),
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
    timerBar: $('hud-timer-bar'),
    hint: $('hud-controls-hint'),
    toast: $('hud-toast'),
  };

  const flags = Array.from(document.querySelectorAll('#lane-flags .flag')).map(node => ({
    node,
    bar: node.querySelector('.flag-bar'),
    word: node.querySelector('.flag-word'),
  }));

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

      el.promptLabel.textContent = PROMPT_LABEL[mode] ?? PROMPT_LABEL.text;

      el.promptWord.classList.toggle('joke', mode === 'joke');

      if (mode === 'image') {
        el.promptEmoji.textContent = word.emoji;
        el.promptEmoji.classList.remove('hidden');
        el.promptWord.classList.add('hidden');
      } else if (mode === 'audio') {
        el.promptEmoji.textContent = '🔊';
        el.promptEmoji.classList.remove('hidden');
        el.promptWord.classList.add('hidden');
      } else {
        el.promptWord.textContent = mode === 'joke' ? word.q : word.th;
        el.promptWord.classList.remove('hidden');
        el.promptEmoji.classList.add('hidden');
      }

      flags.forEach((f, i) => {
        f.word.textContent = options[i].en;
        f.node.classList.remove('correct', 'wrong');
      });
    },

    clearQuestion() {
      el.promptWord.textContent = '—';
      el.promptWord.classList.remove('hidden');
      el.promptEmoji.classList.add('hidden');
      el.promptLabel.textContent = PROMPT_LABEL.text;
      flags.forEach(f => {
        f.word.textContent = '—';
        f.node.classList.remove('correct', 'wrong');
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

    setJets(n) {
      el.jets.innerHTML = '';
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
  };
}
