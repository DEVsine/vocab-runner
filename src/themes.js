/**
 * themes.js — ธีมของโลกทั้ง 5 แบบ (ฉาก + สิ่งกีดขวาง + ด่านโบนัสประจำธีม)
 *
 * ── หลักการสำคัญ: ธีมเปลี่ยน "หน้าตา" ไม่เปลี่ยน "กติกา" ──
 * สิ่งกีดขวางทุกธีมยังเป็น 3 ชนิดเดิม (เตี้ย=กระโดด, สูง=สไลด์, เต็ม=เปลี่ยนเลน)
 * แค่เปลี่ยนสี+ชื่อเรียกให้เข้าเรื่องราว — ผู้เล่นย้ายธีมแล้วทักษะเดิมใช้ได้ทันที
 *
 * ⚠️ สิ่งเดียวที่ "ห้ามธีมแตะ" คือสีประจำเลน (ฟ้า/เหลือง/ชมพู)
 * เพราะมันคือตัวเชื่อมระหว่างธงคำตอบบนจอกับเลนบนพื้น — หัวใจของเกมฝึกศัพท์
 * ธีมที่สวยแต่ทำให้ตอบคำถามยากขึ้นคือธีมที่ออกแบบพลาด
 */

export const THEMES = {
  space: {
    id: 'space',
    name: '🚀 สถานีอวกาศ',
    world: {
      bg: 0x04060f, floor: 0x222a44, hull: 0x2c3654, hullDark: 0x1a2138,
      frame: 0x93a0bd, lamp: 0x8fc4dd, neonA: 0x22d3ee, neonB: 0xf472b6, accent: 0xfb923c,
    },
    obstacles: {
      lowName: 'อุกกาบาต', highName: 'ขยะอวกาศ', wallName: 'ม่านพลังงาน',
      rock: 0xc09274, rockGlow: 0x8a4a1e, core: 0xffab4a, trail: 0xffb877,
      panel: 0x5f74b4, panelGlow: 0x2f57a6, metal: 0xc6d0e6, wing: 0x4a90e2,
      field: 0xff5d79, fieldEdge: 0xff8aa1,
    },
    bonus: {
      title: '★ ทางช้างเผือก ★',
      sub: 'กวาดเหรียญให้เต็มที่ — ที่นี่ไม่มีอะไรทำอันตรายคุณได้',
      sky: 0xffffff, nebula: 0xffffff, dust: 0xdcefff, rock: 0x3a4568,
    },
  },

  pirate: {
    id: 'pirate',
    name: '🏴‍☠️ โจรสลัด',
    world: {
      // พื้น = ไม้ดาดฟ้าเรือ, ฟ้า = คืนกลางทะเลใต้แสงจันทร์
      bg: 0x081420, floor: 0x7a4e28, hull: 0x1d4a52, hullDark: 0x0d2b32,
      frame: 0x7fae9e, lamp: 0x9fe8d8, neonA: 0x2dd4bf, neonB: 0x60a5fa, accent: 0xf4b860,
      laneLine: 0x4a2e16, sky: 0xa8c4e0, ground: 0x1a2430,
    },
    obstacles: {
      lowName: 'หีบสมบัติ', highName: 'สมอเรือ', wallName: 'กำแพงคลื่นยักษ์',
      rock: 0xb98a4e, rockGlow: 0x6b4a12, core: 0xffd166, trail: 0x9be8d8,
      panel: 0x3b7a6e, panelGlow: 0x1d5248, metal: 0x9fb3ac, wing: 0x2dd4bf,
      field: 0x38bdf8, fieldEdge: 0x8bd9ff,
    },
    bonus: {
      title: '☠ เมืองใต้ทะเล ☠',
      sub: 'ดำดิ่งเก็บสมบัติ — ปลอดภัยทุกฝีจังหวะคลื่น',
      sky: 0x6fd6c9, nebula: 0x3fd0b6, dust: 0xa5f3e8, rock: 0x1d5f66,
    },
  },

  candy: {
    id: 'candy',
    name: '🍭 เมืองขนมหวาน',
    world: {
      // พื้น = ครีมเค้กชมพูเข้ม, ฟ้า = พลบค่ำสีองุ่น
      bg: 0x241030, floor: 0xa85f8f, hull: 0x5e2d5c, hullDark: 0x38173a,
      frame: 0xe6a9d8, lamp: 0xffd9f2, neonA: 0xff8fd8, neonB: 0xa78bfa, accent: 0xfff28a,
      laneLine: 0xffe1f5, sky: 0xffc4e8, ground: 0x4a2447,
    },
    obstacles: {
      lowName: 'ลูกกวาดยักษ์', highName: 'อมยิ้มห้อย', wallName: 'กำแพงเยลลี่',
      rock: 0xff9ed2, rockGlow: 0xc2417f, core: 0xfff28a, trail: 0xffc7ec,
      panel: 0xb07ae0, panelGlow: 0x7a41b8, metal: 0xffe1f5, wing: 0xff8fd8,
      field: 0xa3e635, fieldEdge: 0xd6ff8a,
    },
    bonus: {
      title: '🍬 แดนขนมหวานพิศวง 🍬',
      sub: 'สายไหมโปรยปราย — เก็บท็อปปิ้งให้หนำใจ',
      sky: 0xffc4e8, nebula: 0xff9ed2, dust: 0xffe1f5, rock: 0x8a3f76,
    },
  },

  farm: {
    id: 'farm',
    name: '🐴 ฟาร์มสัตว์',
    world: {
      // พื้น = ทางดินเหยียบแน่น, ฟ้า = เย็นย่ำสีทอง
      bg: 0x1a2410, floor: 0x6e5230, hull: 0x54432a, hullDark: 0x33291a,
      frame: 0xc9b18a, lamp: 0xffeebb, neonA: 0x86efac, neonB: 0xfbbf24, accent: 0xf87171,
      laneLine: 0xa8895a, sky: 0xffe8b8, ground: 0x2a3a1a,
    },
    obstacles: {
      lowName: 'กองฟาง', highName: 'ป้ายฟาร์ม', wallName: 'รั้วคอกม้า',
      rock: 0xd9b45c, rockGlow: 0x8a6a1e, core: 0xffe08a, trail: 0xf5deb0,
      panel: 0x8a6a3e, panelGlow: 0x5c421e, metal: 0xd9c9a8, wing: 0x86efac,
      field: 0xa16207, fieldEdge: 0xd9a94e,
    },
    bonus: {
      title: '🐎 ควบม้าทุ่งทอง 🐎',
      sub: 'ห้อตะบึงเก็บเหรียญ — ทุ่งกว้างไร้สิ่งกีดขวาง',
      sky: 0xffe9b0, nebula: 0xffd166, dust: 0xfff2c8, rock: 0x6a5a2e,
    },
  },

  desert: {
    id: 'desert',
    name: '🏜️ ทะเลทราย',
    world: {
      // พื้น = ทรายอัดแน่น, ฟ้า = โพล้เพล้ส้มอิฐ
      bg: 0x241608, floor: 0xa8834e, hull: 0x6e5230, hullDark: 0x42311c,
      frame: 0xd9b98a, lamp: 0xffdf9e, neonA: 0xfbbf24, neonB: 0xfb7185, accent: 0x38bdf8,
      laneLine: 0xd9b98a, sky: 0xffd9a0, ground: 0x4a3418,
    },
    obstacles: {
      lowName: 'หินผา', highName: 'กิ่งกระบองเพชร', wallName: 'พายุทราย',
      rock: 0xd9a25c, rockGlow: 0x8a5a1e, core: 0xffb84a, trail: 0xf0cf9e,
      panel: 0x7a9a4e, panelGlow: 0x4a6a28, metal: 0xe8d5b0, wing: 0x9ac26a,
      field: 0xe8b45c, fieldEdge: 0xffd9a0,
    },
    bonus: {
      title: '🌴 โอเอซิสลับ 🌴',
      sub: 'น้ำใสใต้เงาปาล์ม — พักเหนื่อยแล้วโกยเหรียญ',
      sky: 0x8ad0e8, nebula: 0x38bdf8, dust: 0xd6f3ff, rock: 0x8a6a3e,
    },
  },
};

export const THEME_ORDER = ['space', 'pirate', 'candy', 'farm', 'desert'];

export function themeById(id) {
  return THEMES[id] || THEMES.space;
}
