import * as THREE from 'three';

/**
 * Gruz i meteoryty: prawdziwe obiekty fizyczne (dryfują ze stałą
 * prędkością, są "ciałami stałymi" dla resolveCollisions - patrz
 * collision.js), nie tylko wizualna dekoracja. To one dają dashboardowi
 * (shared/systems/dashboard.js) coś realnego do zgłaszania w kategorii
 * "zbliżające się obiekty" - w przeciwieństwie do wrogów/sojuszników,
 * których w grze jeszcze nie ma (patrz README).
 *
 * Dwa typy, oba "neutralne" (brak frakcji/AI):
 * - gruz: małe, wolne, liczne
 * - meteoryt: większe, szybsze, rzadsze, bardziej niebezpieczne przy zderzeniu
 */

function randomPointInShell(innerRadius, outerRadius) {
  const r = THREE.MathUtils.randFloat(innerRadius, outerRadius);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.cos(theta),
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi)
  );
}

function randomDirection() {
  return randomPointInShell(1, 1); // punkt na jednostkowej sferze = losowy kierunek
}

// Nieregularny "kamień": ikosaedr z lekko zaburzonymi wierzchołkami
// (żeby gruz/meteoryty nie wyglądały jak idealne kule).
function makeRockGeometry(radius, irregularity = 0.35) {
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const scale = 1 + (Math.random() - 0.5) * irregularity;
    pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} center - środek strefy, w której rozrzucany jest gruz (zwykle punkt startowy statku)
 * @param {object} opts
 */
export function createDebrisField(scene, center, {
  count = 70,
  innerRadius = 4000,   // nie rozrzucamy TUŻ przy statku - musi być czas na reakcję
  outerRadius = 60000,
  meteorFraction = 0.22,
} = {}) {
  const group = new THREE.Group();
  const items = [];

  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.95, metalness: 0.05 });
  const meteorMat = new THREE.MeshStandardMaterial({ color: 0x8a5636, roughness: 0.85, metalness: 0.1, emissive: 0x2a0f00, emissiveIntensity: 0.4 });

  for (let i = 0; i < count; i++) {
    const isMeteor = Math.random() < meteorFraction;
    const radius = isMeteor
      ? THREE.MathUtils.randFloat(25, 60)
      : THREE.MathUtils.randFloat(4, 18);

    const mesh = new THREE.Mesh(makeRockGeometry(radius), isMeteor ? meteorMat : debrisMat);
    mesh.position.copy(center).add(randomPointInShell(innerRadius, outerRadius));

    const speed = isMeteor
      ? THREE.MathUtils.randFloat(8, 22)
      : THREE.MathUtils.randFloat(1, 6);
    const velocity = randomDirection().multiplyScalar(speed);

    // powolna rotacja własna - czysto kosmetyczna, nie wpływa na fizykę
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.3);

    group.add(mesh);
    items.push({
      id: `debris-${i}`,
      mesh,
      velocity,
      spin,
      radius,
      isMeteor,
      label: isMeteor ? 'meteoryt' : 'gruz',
    });
  }

  scene.add(group);

  function update(dt) {
    for (const it of items) {
      it.mesh.position.addScaledVector(it.velocity, dt);
      it.mesh.rotation.x += it.spin.x * dt;
      it.mesh.rotation.y += it.spin.y * dt;
      it.mesh.rotation.z += it.spin.z * dt;
    }
  }

  /** Usuwa pole ze sceny (zmiana układu gwiezdnego - krok 8). */
  function dispose() {
    scene.remove(group);
    group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } });
    items.length = 0;
  }

  return { group, items, update, dispose };
}
