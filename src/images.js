/**
 * images.js — หารูปถ่ายจริงของคำศัพท์ สำหรับโจทย์โหมด "ภาพ"
 *
 * ── ทำไมไม่ดึงจาก Google Images ตรง ๆ ──
 * Google ไม่มี public image-search API ให้ใช้ฟรี (ตัวที่มีคือ Custom Search ที่
 * จำกัดโควตาและต้องมี API key) การ scrape หน้าเว็บผลค้นหาก็ผิดข้อกำหนดและพังง่าย
 * เมื่อ Google เปลี่ยนหน้า เราจึงใช้ **Openverse** แทน — คลังภาพเสรี (CC/PDM) ของ
 * WordPress ที่เปิด API ให้เรียกได้โดยไม่ต้องมี key, รองรับ CORS, และกรองภาพผู้ใหญ่ได้
 *
 * ── หลักการออกแบบสำคัญ: ต้องมี fallback เสมอ ──
 * รูปมาจากเครือข่าย = อาจช้า/ล่ม/หาไม่เจอ ถ้าโจทย์ภาพพึ่งรูปอย่างเดียวแล้วรูปไม่มา
 * มันจะกลายเป็น "โจทย์ที่ตอบไม่ได้" ทันที เราจึงโชว์ emoji เดิมไว้ก่อนเสมอ แล้วค่อย
 * "สลับ" เป็นรูปจริงเมื่อโหลดสำเร็จ — worst case จึงไม่แย่ไปกว่าของเดิมเลย
 *
 * ── แคช 2 ชั้น ──
 *   1) mem (Map)      — กันยิงซ้ำภายในเซสชันเดียว
 *   2) localStorage   — จำข้ามเซสชัน (คำเดิมเคยหารูปได้แล้วไม่ต้องยิงเน็ตอีก)
 * ค่าที่แคชได้: string (URL ที่เจอ) หรือ null (ยิงแล้วไม่เจอจริง ๆ)
 * ⚠️ ไม่แคช "พลาดเพราะเน็ตล่ม" ลง localStorage — ไม่งั้นพอเน็ตกลับมาก็ยังจำว่าไม่มีรูป
 */

import { CFG } from './config.js';

const mem = new Map();          // en -> string | null
let ls = {};

try {
  ls = JSON.parse(localStorage.getItem(CFG.images.cacheKey) || '{}');
} catch {
  ls = {};                      // localStorage โดนปิด/ข้อมูลเสีย ก็ทำงานต่อได้ด้วย mem อย่างเดียว
}

function persist(en, url) {
  mem.set(en, url);
  try {
    ls[en] = url;
    localStorage.setItem(CFG.images.cacheKey, JSON.stringify(ls));
  } catch { /* เต็ม/ปิดอยู่ — ไม่เป็นไร */ }
}

/**
 * ค่ารูปที่รู้อยู่แล้ว (ไม่ยิงเน็ต)
 * @returns {string | null | undefined} URL, null (ไม่มีรูป), undefined (ยังไม่รู้)
 */
export function cachedImage(en) {
  if (mem.has(en)) return mem.get(en);
  if (Object.prototype.hasOwnProperty.call(ls, en)) return ls[en];
  return undefined;
}

/**
 * หา URL รูปของคำ (ยิงเน็ตครั้งเดียวต่อคำ แล้วแคชไว้)
 * @returns {Promise<string | null>}
 */
export async function fetchImage(en) {
  if (!CFG.images.enabled) return null;

  const known = cachedImage(en);
  if (known !== undefined) return known;

  try {
    const url = new URL(CFG.images.endpoint);
    url.searchParams.set('q', en);
    url.searchParams.set('mature', 'false');            // กรองภาพผู้ใหญ่ออก
    url.searchParams.set('page_size', String(CFG.images.pageSize));

    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // เลือกผลแรกที่มีรูปพอใช้ — thumbnail เป็นรูปย่อที่ Openverse พร็อกซีให้ (โหลดไว)
    const hit = (data.results || []).find(r => r.thumbnail || r.url);
    const found = hit ? (hit.thumbnail || hit.url) : null;

    persist(en, found);      // เจอหรือไม่เจอก็จำ (null = ยืนยันแล้วว่าไม่มี ไม่ต้องยิงซ้ำ)
    return found;
  } catch (err) {
    // เน็ตล่ม/โดนบล็อก — จำไว้แค่ในเซสชันนี้ (ไม่ลง localStorage) เผื่อเน็ตกลับมาแล้วลองใหม่รอบหน้า
    mem.set(en, null);
    return null;
  }
}
