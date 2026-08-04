#!/usr/bin/env python3
"""
prune-glb.py — ตัดคลิปอนิเมชันที่ไม่ได้ใช้ออกจากไฟล์ .glb แล้วบีบบัฟเฟอร์ใหม่

── ทำไมต้องมีไฟล์นี้ ──────────────────────────────────────────────
ชุดโมเดลสำเร็จรูปทำมาให้ "ใช้ได้กับทุกเกม" จึงยัดอนิเมชันมาให้ครบทุกท่า
KayKit Rogue_Hooded มี 77 คลิป (นั่ง นอน ยิงหน้าไม้ ร่ายเวทย์ ตาย 2 แบบ ...)
แต่เกมวิ่งใช้จริงแค่ 4 ท่า: วิ่ง / ยืน / ลอย / สไลด์

ผลคือไฟล์ 3.4 MB ที่เป็นข้อมูลอนิเมชันเสียราว 3.2 MB — ทั้งที่ตัวโมเดลจริง
มีแค่ 6,000 สามเหลี่ยม กับเทกซ์เจอร์ 17 KB
บนมือถือสัญญาณอ่อน นั่นคือความต่างระหว่าง "เข้าเกมได้" กับ "รอจนเลิกเล่น"

⚠️ ลบแค่ entry ใน animations ไม่พอ — ข้อมูลดิบยังนอนอยู่ในบัฟเฟอร์เหมือนเดิม
ต้องไล่ดูว่า accessor ไหนยังมีคนใช้ แล้ว **เขียนบัฟเฟอร์ใหม่ทั้งก้อน**
พร้อมรีแมปเลขอ้างอิงทุกตัว ไม่งั้นไฟล์จะพังแบบเงียบ ๆ (โหลดผ่านแต่โมเดลบิด)

ใช้: python3 dev/prune-glb.py <in.glb> <out.glb> <keep1> <keep2> ...
     ชื่อคลิปจับแบบ "มีคำนี้อยู่ในชื่อ" ไม่ต้องตรงเป๊ะ
"""
import json
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, _total = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2:
        raise SystemExit(f'{path}: ไม่ใช่ไฟล์ .glb เวอร์ชัน 2')
    gltf, blob, off = None, b'', 12
    while off < len(data):
        clen, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == JSON_CHUNK:
            gltf = json.loads(chunk.decode('utf-8'))
        elif ctype == BIN_CHUNK:
            blob = chunk
        off += 8 + clen + (-clen % 4)
    return gltf, blob


def write_glb(path, gltf, blob):
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * (-len(js) % 4)                 # ทั้งสองชังก์ต้องยาวหารด้วย 4 ลงตัว
    blob += b'\0' * (-len(blob) % 4)
    total = 12 + 8 + len(js) + (8 + len(blob) if blob else 0)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<II', len(js), JSON_CHUNK))
        f.write(js)
        if blob:
            f.write(struct.pack('<II', len(blob), BIN_CHUNK))
            f.write(blob)


def prune(src, dst, keep_words):
    gltf, blob = read_glb(src)
    anims = gltf.get('animations', [])
    kept = [a for a in anims
            if any(w.lower() in a.get('name', '').lower() for w in keep_words)]
    if not kept:
        raise SystemExit('ไม่พบคลิปที่ตรงกับคำที่ระบุเลย — ยกเลิกเพื่อไม่ให้ได้ไฟล์ที่ขยับไม่ได้')
    gltf['animations'] = kept

    # ── 1. หา accessor ที่ยังมีคนใช้อยู่ ──────────────────────────
    used = set()
    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            used.update(prim.get('attributes', {}).values())
            if 'indices' in prim:
                used.add(prim['indices'])
            for target in prim.get('targets', []):
                used.update(target.values())
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used.add(skin['inverseBindMatrices'])
    for anim in kept:
        for s in anim.get('samplers', []):
            used.add(s['input'])
            used.add(s['output'])

    acc_map = {old: new for new, old in enumerate(sorted(used))}
    accessors = [gltf['accessors'][i] for i in sorted(used)]

    # ── 2. หา bufferView ที่ยังมีคนใช้ (accessor ที่เหลือ + รูปภาพ) ──
    bv_used = {a['bufferView'] for a in accessors if 'bufferView' in a}
    bv_used |= {img['bufferView'] for img in gltf.get('images', []) if 'bufferView' in img}

    # ── 3. เขียนบัฟเฟอร์ใหม่แบบบีบ (เรียงต่อกัน จัดแนว 4 ไบต์) ────
    new_blob = bytearray()
    bv_map, views = {}, []
    for new_i, old_i in enumerate(sorted(bv_used)):
        bv = dict(gltf['bufferViews'][old_i])
        start = bv.get('byteOffset', 0)
        chunk = blob[start:start + bv['byteLength']]
        while len(new_blob) % 4:
            new_blob.append(0)
        bv['byteOffset'] = len(new_blob)
        new_blob += chunk
        bv['buffer'] = 0
        bv_map[old_i] = new_i
        views.append(bv)

    # ── 4. รีแมปเลขอ้างอิงทุกตัว ──────────────────────────────────
    for a in accessors:
        if 'bufferView' in a:
            a['bufferView'] = bv_map[a['bufferView']]
    for img in gltf.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = bv_map[img['bufferView']]
    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            prim['attributes'] = {k: acc_map[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = acc_map[prim['indices']]
            if 'targets' in prim:
                prim['targets'] = [{k: acc_map[v] for k, v in t.items()}
                                   for t in prim['targets']]
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = acc_map[skin['inverseBindMatrices']]
    for anim in kept:
        for s in anim['samplers']:
            s['input'] = acc_map[s['input']]
            s['output'] = acc_map[s['output']]

    gltf['accessors'] = accessors
    gltf['bufferViews'] = views
    gltf['buffers'] = [{'byteLength': len(new_blob)}]

    write_glb(dst, gltf, bytes(new_blob))
    return len(anims), len(kept)


if __name__ == '__main__':
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    src, dst, words = sys.argv[1], sys.argv[2], sys.argv[3:]
    before, after = prune(src, dst, words)
    import os
    b, a = os.path.getsize(src), os.path.getsize(dst)
    print(f'คลิป {before} → {after} · ขนาด {b/1024:.0f} KB → {a/1024:.0f} KB '
          f'(เหลือ {a/b*100:.0f}%)')
