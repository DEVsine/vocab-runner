/**
 * black-panther-skill.js — state machine บริสุทธิ์ของพลังจลน์ไวเบรเนียม
 *
 * โมดูลนี้ไม่รู้จัก three.js, DOM หรือสิ่งกีดขวางเลย จึงเทสต์กติกาได้ตรง ๆ:
 * วิ่งสะสมระยะ → คลื่นกวาดจากใกล้ไปไกล → เริ่มสะสมรอบใหม่
 */
export function createBlackPantherSkill({ chargeDistance, burstSeconds } = {}) {
  if (!(chargeDistance > 0)) throw new Error('chargeDistance must be > 0');
  if (!(burstSeconds > 0)) throw new Error('burstSeconds must be > 0');

  let phase = 'charging';
  let charged = 0;
  let burstT = 0;

  function snapshot(extra = {}) {
    return {
      phase,
      chargeRatio: phase === 'burst' ? 1 : Math.min(1, charged / chargeDistance),
      burstRatio: burstT,
      sweepFrom: burstT,
      sweepTo: burstT,
      started: false,
      ended: false,
      source: null,
      ...extra,
    };
  }

  return {
    /**
     * @param {{distance?:number, dt?:number, enabled?:boolean, activate?:boolean}} step
     * distance คือระยะที่ "วิ่งจริง" ในเฟรมนี้ ไม่ใช่เวลา เพื่อให้โหมดเร็วชาร์จตามโลกที่ผ่านไปจริง
     * activate คือคำสั่งใช้พลังจากกรงเล็บ (Space/ปุ่มบนจอ) ซึ่งเริ่มคลื่นได้ทันที
     */
    tick({ distance = 0, dt = 0, enabled = true, activate = false } = {}) {
      if (!enabled) {
        phase = 'charging';
        charged = 0;
        burstT = 0;
        return snapshot();
      }

      if (phase === 'charging') {
        if (activate) {
          phase = 'burst';
          burstT = 0;
          return snapshot({ started: true, source: 'claw' });
        }

        charged = Math.min(chargeDistance, charged + Math.max(0, distance));
        if (charged < chargeDistance) return snapshot();

        // แยกเฟรม "เต็มแล้ว" ออกจากเฟรมที่คลื่นเริ่มเดิน ให้ UI/ลายบนร่างมีจังหวะประกาศสกิล
        phase = 'burst';
        burstT = 0;
        return snapshot({ started: true, source: 'charge' });
      }

      const from = burstT;
      burstT = Math.min(1, burstT + Math.max(0, dt) / burstSeconds);
      const to = burstT;
      const ended = burstT >= 1;
      const result = snapshot({ sweepFrom: from, sweepTo: to, ended });

      if (ended) {
        phase = 'charging';
        charged = 0;
        burstT = 0;
      }
      return result;
    },

    reset() {
      phase = 'charging';
      charged = 0;
      burstT = 0;
    },

    current: () => snapshot(),
  };
}
