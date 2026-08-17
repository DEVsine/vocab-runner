/**
 * black-panther-fx.js — คลื่นพลังสีม่วงที่กวาดจากตัวผู้เล่นไปข้างหน้า
 *
 * ใช้ object pool ทั้งคลื่นและเศษระเบิด: สกิลยิงซ้ำได้ตลอดรอบโดยไม่สร้าง garbage
 * ใหม่กลางเกม ซึ่งสำคัญกว่าจำนวนโพลิกอนบนมือถือเสียอีก
 */
import * as THREE from 'three';

const PURPLE = 0xa855f7;
const HOT_PURPLE = 0xe9d5ff;

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

export function createBlackPantherFx(scene, { range = 82 } = {}) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.72, 1, 32);
  for (let i = 0; i < 9; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: i % 3 === 0 ? HOT_PURPLE : PURPLE,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, material);
    root.add(ring);
    rings.push(ring);
  }

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({
      color: PURPLE, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  core.scale.set(1.5, 1.1, 1.8);
  root.add(core);

  // เศษพลังตอนอุปสรรคแตก — pool เล็ก ๆ พอ เพราะหนึ่งคลื่นเจอของพร้อมกันไม่มาก
  const debris = [];
  const debrisGeo = new THREE.TetrahedronGeometry(0.12, 0);
  const debrisMat = new THREE.MeshBasicMaterial({
    color: HOT_PURPLE, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < 42; i++) {
    const mesh = new THREE.Mesh(debrisGeo, debrisMat);
    mesh.visible = false;
    scene.add(mesh);
    debris.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
  }

  function updateDebris(dt) {
    for (const p of debris) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 5.5 * dt;
      p.mesh.rotation.x += dt * 8;
      p.mesh.rotation.y += dt * 11;
      const k = Math.max(0, p.life / 0.55);
      p.mesh.scale.setScalar(0.45 + k);
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  return {
    range,

    update(dt, skillState, playerX = 0) {
      updateDebris(dt);
      const active = skillState?.phase === 'burst' || skillState?.started || skillState?.ended;
      root.visible = !!active;
      if (!active) return;

      root.position.x = playerX;
      const p = Math.max(0, Math.min(1, skillState.burstRatio ?? 0));
      core.position.set(0, 1.05, -range * p);
      const coreFade = Math.sin(Math.min(1, p * 1.7) * Math.PI);
      core.material.opacity = 0.16 * coreFade;
      core.scale.set(1.8 + p * 5.4, 1.2 + p * 3.8, 2 + p * 5);

      for (let i = 0; i < rings.length; i++) {
        const delay = i * 0.055;
        const local = Math.max(0, Math.min(1, (p - delay) / (1 - delay)));
        const travel = easeOutCubic(local);
        const ring = rings[i];
        ring.position.set(0, 1.25 + Math.sin(i * 1.8) * 0.18, -range * travel);
        const radius = 1.2 + travel * 5.5;
        ring.scale.set(radius, radius * 0.68, 1);
        ring.material.opacity = local > 0 ? 0.58 * Math.sin(local * Math.PI) : 0;
      }
    },

    burstAt({ x, y = 1, z }) {
      let made = 0;
      for (const p of debris) {
        if (p.life > 0) continue;
        const a = made * 2.399;
        const speed = 2.8 + (made % 4) * 0.65;
        p.mesh.position.set(x, y, z);
        p.mesh.visible = true;
        p.mesh.material = debrisMat;
        p.life = 0.48 + (made % 3) * 0.06;
        p.vx = Math.cos(a) * speed;
        p.vy = 1.5 + (made % 5) * 0.55;
        p.vz = Math.sin(a) * speed;
        made += 1;
        if (made >= 9) break;
      }
    },

    reset() {
      root.visible = false;
      for (const ring of rings) ring.material.opacity = 0;
      for (const p of debris) { p.life = 0; p.mesh.visible = false; }
    },
  };
}
