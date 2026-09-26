import * as THREE from 'three';

/**
 * WYGLĄD WARSTWY EKONOMICZNEJ (krok 10): stacje, drony, iskry, promień.
 * Logika jest w economy.js; tu tylko siatki i ich animacja. Wszystko
 * proceduralne (bez plików), bez tekstur z canvasa - moduł ładuje się też
 * w Node (testy), gdzie nic nie jest rysowane.
 *
 * Stacje są duże (120-150 j. promienia, kilka długości statku), bo z
 * pasa planetoid trzeba je widzieć z kilku tysięcy jednostek. Drony są
 * małe (ok. 5 j.) - z daleka rój czytamy po świetlikach silników (Points
 * o minimalnym rozmiarze w pikselach), z bliska po kadłubach.
 */

// ------------------------------------------------------------
// świecące punkty (silniki dronów, iskry, światła pozycyjne)
// ------------------------------------------------------------
function glowMaterial({ minPx = 2, maxPx = 48, scale = 300 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: scale } },
    vertexShader: `
      attribute float aSize; attribute vec3 aColor; varying vec3 vColor;
      uniform float uScale;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uScale / -mv.z, ${minPx.toFixed(1)}, ${maxPx.toFixed(1)});
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a *= a;
        gl_FragColor = vec4(vColor * a * 1.6, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

function glowPoints(max, opts) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const pts = new THREE.Points(geo, glowMaterial(opts));
  pts.frustumCulled = false; // pozycje zmieniają się co klatkę, bounding sphere byłaby nieaktualna
  return pts;
}

// ------------------------------------------------------------
// STACJE
// ------------------------------------------------------------
const hullMat = () => new THREE.MeshStandardMaterial({ color: 0x9aa4ae, metalness: 0.65, roughness: 0.45 });
const darkMat = () => new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.5, roughness: 0.6 });
const lightMat = (hex) => new THREE.MeshBasicMaterial({ color: hex, toneMapped: false });

/**
 * Buduje model stacji danego typu.
 * @returns {{ group, parts, spinners, beacons, ghost, accent, turret, muzzles }}
 */
export function buildStationModel(type, accentHex) {
  const accent = new THREE.Color(accentHex);
  const group = new THREE.Group();
  const parts = [];      // kolejność "montażu" przy budowie
  const spinners = [];   // { obj, axis, speed }
  const beacons = [];    // światła pozycyjne (mrugają)
  let turret = null;     // głowica platformy obronnej
  const muzzles = [];    // wyloty luf (lokalnie w głowicy)
  const H = hullMat(), D = darkMat();
  const A = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.5 });
  const add = (mesh, parent = group) => { parent.add(mesh); parts.push(mesh); return mesh; };
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };
  const beacon = (x, y, z, hex, parent = group, phase = Math.random() * 6) => {
    const b = mesh(new THREE.SphereGeometry(2.6, 8, 6), lightMat(hex), x, y, z);
    b.userData.phase = phase; parent.add(b); beacons.push(b); return b;
  };

  if (type === 'dok') {
    // rdzeń, pierścień mieszkalny na szprychach, zatoka dronów u spodu, panele
    add(mesh(new THREE.CylinderGeometry(22, 26, 110, 20), H));
    add(mesh(new THREE.CylinderGeometry(48, 34, 20, 24), D, 0, -62, 0));
    const bayRing = add(mesh(new THREE.TorusGeometry(42, 2.4, 8, 40), A, 0, -72, 0));
    bayRing.rotation.x = Math.PI / 2;
    const ring = new THREE.Group(); group.add(ring);
    spinners.push({ obj: ring, axis: new THREE.Vector3(0, 1, 0), speed: 0.12 });
    const torus = add(mesh(new THREE.TorusGeometry(98, 10, 12, 64), H), ring);
    torus.rotation.x = Math.PI / 2;
    const glowBand = add(mesh(new THREE.TorusGeometry(98, 10.4, 4, 64, Math.PI * 2), A), ring);
    glowBand.rotation.x = Math.PI / 2; glowBand.scale.set(1, 1, 0.12);
    for (let i = 0; i < 4; i++) {
      const s = add(mesh(new THREE.BoxGeometry(196, 5, 5), D), ring);
      s.rotation.y = (i * Math.PI) / 4;
    }
    for (const side of [-1, 1]) {
      add(mesh(new THREE.BoxGeometry(60, 4, 4), D, side * 50, 40, 0));
      const panel = add(mesh(new THREE.BoxGeometry(110, 1.5, 38), new THREE.MeshStandardMaterial({ color: 0x1b3160, metalness: 0.6, roughness: 0.35, emissive: 0x0a1a3a, emissiveIntensity: 0.6 }), side * 135, 40, 0));
      panel.rotation.z = side * 0.08;
    }
    add(mesh(new THREE.CylinderGeometry(1.2, 1.2, 70, 6), D, 0, 90, 0));
    beacon(0, 126, 0, 0xff5a4d);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; beacon(Math.cos(a) * 46, -70, Math.sin(a) * 46, accentHex, group, i * 0.5); }
  } else if (type === 'siedziba') {
    // krok 12: SIEDZIBA RASY. Lokalnie +Z = dziób (w stronę pasa). Z tyłu
    // wieża mostka (kamera stoi tuż przed jej szybą, command.js HQ.bridge),
    // pod nią pokład hangaru wysunięty do przodu z jasnym wylotem (HQ.hangar),
    // niżej wielki pierścień mieszkalny, z boków skrzydła paneli.
    add(mesh(new THREE.CylinderGeometry(64, 78, 300, 28), H, 0, -40, -40));
    add(mesh(new THREE.CylinderGeometry(84, 84, 16, 28), A, 0, -120, -40)).userData.noScale = true;
    add(mesh(new THREE.SphereGeometry(70, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), H, 0, 110, -40));
    // pokład hangaru
    add(mesh(new THREE.BoxGeometry(150, 44, 280), D, 0, 30, 150));
    // pokład: ciemne płyty, jasne burty, pas startowy ze światłami prowadzącymi do wylotu
    add(mesh(new THREE.BoxGeometry(170, 8, 300), new THREE.MeshStandardMaterial({ color: 0x2a3340, metalness: 0.7, roughness: 0.55 }), 0, 56, 160));
    for (const x of [-80, 80]) add(mesh(new THREE.BoxGeometry(10, 64, 300), H, x, 28, 160));
    for (let z = 30; z <= 290; z += 52) add(mesh(new THREE.BoxGeometry(166, 1, 2), D, 0, 60.6, z)).userData.noScale = true;
    for (const x of [-26, 26]) add(mesh(new THREE.BoxGeometry(2, 1, 290), A, x, 60.8, 160)).userData.noScale = true;
    for (let z = 40; z <= 290; z += 25) add(mesh(new THREE.BoxGeometry(6, 1.4, 6), lightMat(0x9fd8ff), 0, 61, z)).userData.noScale = true;
    for (const x of [-64, 64]) {
      add(mesh(new THREE.BoxGeometry(22, 14, 30), H, x, 67, 70));
      add(mesh(new THREE.BoxGeometry(18, 2, 18), lightMat(0xffb13d), x, 74.5, 70)).userData.noScale = true;
    }
    // wylot hangaru: świecąca rama i wnętrze
    const mouth = add(mesh(new THREE.PlaneGeometry(120, 34), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.55, toneMapped: false })), group);
    mouth.position.set(0, 26, 301); mouth.userData.noScale = true;
    for (const [w, h, x, y] of [[132, 4, 0, 45], [132, 4, 0, 7], [4, 42, -64, 26], [4, 42, 64, 26]]) add(mesh(new THREE.BoxGeometry(w, h, 6), A, x, y, 302)).userData.noScale = true;
    for (let z = 40; z <= 290; z += 50) for (const x of [-86, 86]) beacon(x, 58, z, z > 260 ? 0x9fd8ff : 0xffd36b, group, z * 0.02);
    // wieża mostka z pasem okien (szyba od strony +Z)
    add(mesh(new THREE.BoxGeometry(110, 58, 90), H, 0, 128, 78));
    add(mesh(new THREE.BoxGeometry(112, 10, 4), new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false }), 0, 132, 124)).userData.noScale = true;
    add(mesh(new THREE.BoxGeometry(8, 90, 8), D, 0, 200, 60));
    beacon(0, 248, 60, 0xff5a4d);
    // pierścień mieszkalny na szprychach
    const ring = new THREE.Group(); ring.position.set(0, -60, -40); group.add(ring);
    spinners.push({ obj: ring, axis: new THREE.Vector3(0, 1, 0), speed: 0.05 });
    const torus = add(mesh(new THREE.TorusGeometry(250, 22, 14, 96), H), ring);
    torus.rotation.x = Math.PI / 2;
    const band = add(mesh(new THREE.TorusGeometry(250, 22.6, 4, 96), A), ring);
    band.rotation.x = Math.PI / 2; band.scale.set(1, 1, 0.1);
    for (let i = 0; i < 6; i++) {
      const sp = add(mesh(new THREE.BoxGeometry(500, 8, 8), D), ring);
      sp.rotation.y = (i * Math.PI) / 6;
    }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; beacon(Math.cos(a) * 272, 0, Math.sin(a) * 272, i % 3 ? 0xffffff : accentHex, ring, i * 0.6); }
    // skrzydła paneli i radiatory z tyłu
    for (const side of [-1, 1]) {
      add(mesh(new THREE.BoxGeometry(120, 6, 6), D, side * 130, 20, -120));
      for (let k = 0; k < 2; k++) {
        const panel = add(mesh(new THREE.BoxGeometry(150, 2, 70), new THREE.MeshStandardMaterial({ color: 0x1b3160, metalness: 0.6, roughness: 0.35, emissive: 0x0a1a3a, emissiveIntensity: 0.7 }), side * (230 + k * 160), 20, -120));
        panel.rotation.x = 0.35;
      }
      const rad = add(mesh(new THREE.BoxGeometry(4, 130, 90), new THREE.MeshStandardMaterial({ color: 0x3a2020, emissive: 0xff5a2a, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.7 }), side * 70, -40, -200));
      rad.rotation.y = side * 0.4;
    }
  } else if (type === 'huta') {
    // krok 12: HUTA. Piec z żarzącymi się szczelinami, lej zasypowy u góry,
    // kominy i rozgrzane radiatory.
    const hot = new THREE.MeshBasicMaterial({ color: 0xff8a3a, toneMapped: false });
    add(mesh(new THREE.CylinderGeometry(72, 86, 170, 24), D));
    for (let y = -60; y <= 60; y += 30) add(mesh(new THREE.CylinderGeometry(87 - (y + 60) * 0.1, 87 - (y + 60) * 0.1, 4, 24, 1, true), hot, 0, y, 0)).userData.noScale = true;
    add(mesh(new THREE.CylinderGeometry(96, 40, 70, 20, 1, true), H, 0, 120, 0));
    add(mesh(new THREE.CylinderGeometry(94, 94, 3, 20, 1, true), A, 0, 154, 0)).userData.noScale = true;
    for (const [x, z] of [[-58, -40], [52, -46], [0, 64]]) {
      add(mesh(new THREE.CylinderGeometry(10, 14, 120, 10), H, x, 60, z));
      add(mesh(new THREE.CylinderGeometry(10.5, 10.5, 6, 10), hot, x, 122, z)).userData.noScale = true;
    }
    for (const side of [-1, 1]) {
      const rad = add(mesh(new THREE.BoxGeometry(150, 110, 4), new THREE.MeshStandardMaterial({ color: 0x4a2418, emissive: 0xff4a1a, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.6 }), side * 170, -10, 0));
      rad.rotation.y = side * 0.25;
      add(mesh(new THREE.BoxGeometry(60, 8, 8), D, side * 96, -10, 0));
    }
    add(mesh(new THREE.CylinderGeometry(50, 60, 30, 16), D, 0, -100, 0));
    add(mesh(new THREE.TorusGeometry(56, 3, 6, 32), A, 0, -116, 0)).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; beacon(Math.cos(a) * 98, 156, Math.sin(a) * 98, accentHex, group, i * 0.5); }
  } else if (type === 'reaktor') {
    // krok 12: REAKTOR. Świecący rdzeń w klatce obracających się pierścieni,
    // wieniec żeber chłodzących.
    add(mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ color: 0x9ff6ff, toneMapped: false })));
    add(mesh(new THREE.SphereGeometry(52, 24, 16), new THREE.MeshStandardMaterial({ color: 0x2a7f95, emissive: 0x2ad6ff, emissiveIntensity: 0.5, transparent: true, opacity: 0.35, metalness: 0.2, roughness: 0.2, depthWrite: false })));
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group(); group.add(g);
      g.rotation.set(i * 1.05, i * 0.7, 0);
      spinners.push({ obj: g, axis: new THREE.Vector3(0, 1, 0), speed: 0.35 + i * 0.2 });
      add(mesh(new THREE.TorusGeometry(70 + i * 9, 3.2, 8, 48), i === 1 ? A : H), g);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const fin = add(mesh(new THREE.BoxGeometry(4, 120, 60), D, Math.cos(a) * 118, 0, Math.sin(a) * 118));
      fin.rotation.y = -a;
    }
    add(mesh(new THREE.CylinderGeometry(126, 126, 6, 32, 1, true), H, 0, 62, 0));
    add(mesh(new THREE.CylinderGeometry(126, 126, 6, 32, 1, true), H, 0, -62, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; beacon(Math.cos(a) * 128, 66, Math.sin(a) * 128, accentHex, group, i * 0.4); }
  } else if (type === 'magazyn') {
    // grzbiet i dwa wieńce zbiorników
    add(mesh(new THREE.BoxGeometry(22, 22, 230), D));
    for (const z of [-60, 60]) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const tank = add(mesh(new THREE.CylinderGeometry(26, 26, 80, 18), H, Math.cos(a) * 44, Math.sin(a) * 44, z));
        tank.rotation.x = Math.PI / 2;
        const band = add(mesh(new THREE.TorusGeometry(26.6, 1.6, 6, 28), A, Math.cos(a) * 44, Math.sin(a) * 44, z));
        band.userData.noScale = true;
      }
    }
    for (const z of [-120, 120]) {
      add(mesh(new THREE.CylinderGeometry(34, 34, 8, 16), D, 0, 0, z)).rotation.x = Math.PI / 2;
      beacon(0, 38, z, accentHex);
      beacon(0, -38, z, 0xff5a4d);
    }
    add(mesh(new THREE.BoxGeometry(6, 70, 6), D, 0, 40, 0));
    beacon(0, 78, 0, 0xffffff);
  } else if (type === 'stocznia') {
    // stocznia wojenna: suchy dok (dwie szyny + suwnice), w środku szkielet kadłuba
    for (const x of [-60, 60]) add(mesh(new THREE.BoxGeometry(10, 14, 300), D, x, 0, 0));
    for (let z = -130; z <= 130; z += 65) {
      add(mesh(new THREE.BoxGeometry(130, 8, 8), D, 0, 46, z));
      for (const x of [-60, 60]) add(mesh(new THREE.BoxGeometry(8, 46, 8), D, x, 23, z));
    }
    add(mesh(new THREE.BoxGeometry(18, 10, 220), H, 0, 8, 0));
    for (let z = -95; z <= 95; z += 27) {
      const rib = add(mesh(new THREE.TorusGeometry(26, 2.2, 6, 16, Math.PI), H, 0, 8, z));
      rib.rotation.z = Math.PI;
    }
    add(mesh(new THREE.BoxGeometry(70, 30, 50), H, 0, -24, -165));
    add(mesh(new THREE.BoxGeometry(62, 3, 42), A, 0, -8, -165)).userData.noScale = true;
    for (let z = -130; z <= 130; z += 130) beacon(0, 52, z, accentHex, group, z * 0.01);
    for (const x of [-60, 60]) for (const z of [-150, 150]) beacon(x, 10, z, 0xff5a4d, group, x + z);
  } else if (type === 'wieza') {
    // platforma obronna: sześciokątna podstawa, pylon, obrotowa głowica z
    // podwójnym działem (lufy wzdłuż +Z - głowicę obraca lookAt na cel)
    add(mesh(new THREE.CylinderGeometry(70, 80, 16, 6), D));
    add(mesh(new THREE.CylinderGeometry(76, 76, 3, 6, 1, true), A, 0, 9, 0)).userData.noScale = true; // świecąca krawędź, nie cała płyta
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = add(mesh(new THREE.BoxGeometry(10, 70, 10), D, Math.cos(a) * 55, -40, Math.sin(a) * 55));
      leg.rotation.z = Math.cos(a) * 0.35; leg.rotation.x = -Math.sin(a) * 0.35;
    }
    add(mesh(new THREE.CylinderGeometry(18, 24, 40, 12), H, 0, 28, 0));
    turret = new THREE.Group(); turret.position.set(0, 58, 0); group.add(turret);
    add(mesh(new THREE.SphereGeometry(26, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.6), H), turret);
    add(mesh(new THREE.BoxGeometry(46, 16, 34), D, 0, 4, 2), turret);
    for (const x of [-11, 11]) {
      const barrel = add(mesh(new THREE.CylinderGeometry(3.4, 4.2, 70, 10), H, x, 6, 40), turret);
      barrel.rotation.x = Math.PI / 2;
      add(mesh(new THREE.CylinderGeometry(4.8, 4.8, 8, 10), A, x, 6, 74), turret).rotation.x = Math.PI / 2;
      muzzles.push(new THREE.Vector3(x, 6, 80));
    }
    beacon(0, 86, -6, 0xff5a4d, turret);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; beacon(Math.cos(a) * 74, 12, Math.sin(a) * 74, accentHex, group, i * 0.4); }
  } else {
    // przeładunek: kratownica, kontenery, obrotowa suwnica, lądowisko frachtowców
    add(mesh(new THREE.BoxGeometry(300, 12, 12), D));
    for (let x = -140; x <= 140; x += 35) add(mesh(new THREE.BoxGeometry(4, 40, 40), D, x, 0, 0));
    const boxColors = [0xb3462c, 0x2a8f86, 0xd9a93a, 0xd6dde3, 0x39639e];
    let ci = 0;
    for (let x = -120; x <= 120; x += 30) {
      for (const side of [-1, 1]) {
        const h = 1 + ((x / 30 + side) & 1);
        for (let k = 0; k < h; k++) {
          const c = new THREE.MeshStandardMaterial({ color: boxColors[ci++ % boxColors.length], metalness: 0.3, roughness: 0.7 });
          add(mesh(new THREE.BoxGeometry(24, 13, 30), c, x, (k - 0.5) * 14 + 7, side * 38));
        }
      }
    }
    const pad = add(mesh(new THREE.CylinderGeometry(70, 70, 6, 32), H, 0, -44, 0));
    const padRing = add(mesh(new THREE.TorusGeometry(64, 2.2, 6, 48), A, 0, -40.5, 0));
    padRing.rotation.x = Math.PI / 2;
    add(mesh(new THREE.CylinderGeometry(6, 6, 38, 8), D, 0, -22, 0));
    const gantry = new THREE.Group(); group.add(gantry);
    spinners.push({ obj: gantry, axis: new THREE.Vector3(1, 0, 0), speed: 0.25 });
    add(mesh(new THREE.TorusGeometry(58, 4, 8, 40), H, 150, 0, 0), gantry).rotation.y = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      beacon(150, Math.cos(a) * 58, Math.sin(a) * 58, accentHex, gantry, i * 0.8);
    }
    beacon(-152, 0, 0, 0x4dd6a0); beacon(152, 0, 0, 0x4dd6a0);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; beacon(Math.cos(a) * 64, -40, Math.sin(a) * 64, 0xffffff, group, i * 0.35); }
  }

  // "duch" całej stacji: siatka konstrukcyjna widoczna w trakcie budowy
  const ghostMat = new THREE.MeshBasicMaterial({ color: accent, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false });
  const ghost = new THREE.Group();
  for (const p of parts) {
    const g = new THREE.Mesh(p.geometry, ghostMat);
    p.updateMatrix();
    g.matrixAutoUpdate = false;
    g.matrix.copy(p.matrix);
    if (p.parent !== group) { p.parent.updateMatrix(); g.matrix.premultiply(p.parent.matrix); }
    ghost.add(g);
  }
  group.add(ghost);
  for (const p of parts) { p.userData.baseScale = p.scale.clone(); }
  return { group, parts, spinners, beacons, ghost, accent, turret, muzzles };
}

/** Postęp budowy 0..1: części "dojeżdżają" po kolei, siatka gaśnie. */
export function setStationProgress(model, p, ready) {
  const n = model.parts.length;
  const shown = ready ? n : p * n;
  model.parts.forEach((part, i) => {
    const t = THREE.MathUtils.clamp(shown - i, 0, 1);
    part.visible = t > 0;
    if (!part.userData.noScale) part.scale.copy(part.userData.baseScale).multiplyScalar(0.3 + 0.7 * t);
  });
  model.ghost.visible = !ready;
  for (const b of model.beacons) b.visible = ready;
}

const _axisQ = new THREE.Quaternion();
export function animateStation(model, dt, time, ready) {
  if (!ready) return;
  for (const s of model.spinners) {
    _axisQ.setFromAxisAngle(s.axis, s.speed * dt);
    s.obj.quaternion.multiply(_axisQ);
  }
  for (const b of model.beacons) {
    const on = Math.sin(time * 2.2 + b.userData.phase) > 0.55;
    b.scale.setScalar(on ? 1.6 : 0.7);
  }
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

// ------------------------------------------------------------
// DRONY: instancje kadłubów + świetliki silników
// ------------------------------------------------------------
export const DRONE_STATE_COLOR = {
  lot: new THREE.Color('#9fd8ff'),        // leci do złoża
  ladowanie: new THREE.Color('#9fd8ff'),
  wiercenie: new THREE.Color('#ffb13d'),  // wierci na powierzchni
  powrot: new THREE.Color('#4dd6a0'),     // wraca z urobkiem
  rozladunek: new THREE.Color('#4dd6a0'),
  czeka: new THREE.Color('#ff5a4d'),      // brak miejsca w stacjach
  ewakuacja: new THREE.Color('#e6c3ff'),  // alarm: ucieczka do doku
};

export function createDroneRenderer(scene, max = 600, { scale = 1 } = {}) {
  const body = new THREE.OctahedronGeometry(1, 0);
  body.scale(2.8 * scale, 1.1 * scale, 4.4 * scale); // krok 12: scale > 1 - drony w ujęciach okienka podglądu
  const mat = new THREE.MeshStandardMaterial({ color: 0xe2e7ec, metalness: 0.35, roughness: 0.45, emissive: 0x3a5068, emissiveIntensity: 0.8 });
  const inst = new THREE.InstancedMesh(body, mat, max);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.count = 0;
  inst.frustumCulled = false;
  const glow = glowPoints(max, { minPx: 3.5, maxPx: 26, scale: 520 });
  scene.add(inst, glow);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  const fwd = new THREE.Vector3(0, 0, 1), tail = new THREE.Vector3();
  let n = 0;
  const gp = glow.geometry.attributes.position, gc = glow.geometry.attributes.aColor, gs = glow.geometry.attributes.aSize;

  return {
    begin() { n = 0; },
    /** pos - położenie, dir - kierunek dziobu (jednostkowy), state - klucz DRONE_STATE_COLOR */
    push(pos, dir, state, pulse = 1, color = null) {
      if (n >= max) return;
      q.setFromUnitVectors(fwd, dir);
      m.compose(pos, q, s);
      inst.setMatrixAt(n, m);
      tail.copy(dir).multiplyScalar(-4.6 * scale).add(pos);
      gp.setXYZ(n, tail.x, tail.y, tail.z);
      const c = color ?? DRONE_STATE_COLOR[state] ?? DRONE_STATE_COLOR.lot; // krok 11: drony ras w kolorze rasy
      gc.setXYZ(n, c.r * pulse, c.g * pulse, c.b * pulse);
      gs.setX(n, (state === 'wiercenie' ? 8 : 10) * scale);
      n++;
    },
    end() {
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      glow.geometry.setDrawRange(0, n);
      gp.needsUpdate = gc.needsUpdate = gs.needsUpdate = true;
    },
    dispose() { scene.remove(inst, glow); body.dispose(); mat.dispose(); glow.geometry.dispose(); glow.material.dispose(); },
  };
}

// ------------------------------------------------------------
// ISKRY (wiercenie, spawanie przy budowie, promień gracza)
// ------------------------------------------------------------
export function createSparks(scene, max = 900) {
  const pts = glowPoints(max, { minPx: 1.5, maxPx: 16, scale: 260 });
  scene.add(pts);
  const P = [];
  for (let i = 0; i < max; i++) P.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Color(), size: 3 });
  let cursor = 0;
  const gp = pts.geometry.attributes.position, gc = pts.geometry.attributes.aColor, gs = pts.geometry.attributes.aSize;
  return {
    /** Wyrzut iskier z punktu `at` wzdłuż `normal` (rozrzut `spread`). */
    emit(at, normal, color, count = 3, speed = 30, spread = 0.9, life = 0.6, size = 3) {
      for (let k = 0; k < count; k++) {
        const s = P[cursor]; cursor = (cursor + 1) % max;
        s.p.copy(at);
        s.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(spread * 2).add(normal).normalize()
          .multiplyScalar(speed * (0.4 + Math.random() * 0.8));
        s.c.set(color);
        s.life = s.max = life * (0.5 + Math.random() * 0.8);
        s.size = size;
      }
    },
    update(dt) {
      let n = 0;
      for (const s of P) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.p.addScaledVector(s.v, dt);
        const k = Math.max(0, s.life / s.max);
        gp.setXYZ(n, s.p.x, s.p.y, s.p.z);
        gc.setXYZ(n, s.c.r * k, s.c.g * k, s.c.b * k);
        gs.setX(n, s.size * (0.4 + 0.6 * k));
        n++;
      }
      pts.geometry.setDrawRange(0, n);
      gp.needsUpdate = gc.needsUpdate = gs.needsUpdate = true;
    },
    dispose() { scene.remove(pts); pts.geometry.dispose(); pts.material.dispose(); },
  };
}

// ------------------------------------------------------------
// PROMIEŃ WYDOBYWCZY GRACZA
// ------------------------------------------------------------
export function createMiningBeam(scene) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  geo.translate(0, 0.5, 0);
  geo.rotateX(Math.PI / 2); // oś +Z, długość 1
  const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const halo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff9d3d, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const group = new THREE.Group();
  group.add(core, halo);
  group.visible = false;
  // rozbłysk w punkcie trafienia (skała się topi) - widoczny także, gdy sam
  // promień z perspektywy kamery jest prawie punktem
  const flare = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffc26b, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  flare.visible = false;
  scene.add(group, flare);
  const up = new THREE.Vector3(0, 0, 1), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  let t = 0;
  return {
    show(from, to, dt) {
      t += dt;
      dir.copy(to).sub(from);
      const len = dir.length();
      if (len < 1) { group.visible = false; flare.visible = false; return; }
      q.setFromUnitVectors(up, dir.divideScalar(len));
      group.position.copy(from);
      group.quaternion.copy(q);
      const w = 1 + Math.sin(t * 40) * 0.25;
      core.scale.set(1.3 * w, 1.3 * w, len);
      halo.scale.set(5 * w, 5 * w, len);
      flare.position.copy(to);
      flare.scale.setScalar(14 + Math.sin(t * 33) * 4);
      flare.visible = true;
      group.visible = true;
    },
    hide() { group.visible = false; flare.visible = false; },
    dispose() { scene.remove(group, flare); geo.dispose(); core.material.dispose(); halo.material.dispose(); flare.geometry.dispose(); flare.material.dispose(); },
  };
}

// ------------------------------------------------------------
// HOLOWNIKI: świetliki przewożące metal między stacjami (logistyka)
// ------------------------------------------------------------
export function createTugLanes(scene, max = 80) {
  const pts = glowPoints(max, { minPx: 2, maxPx: 14, scale: 300 });
  scene.add(pts);
  const gp = pts.geometry.attributes.position, gc = pts.geometry.attributes.aColor, gs = pts.geometry.attributes.aSize;
  const col = new THREE.Color('#ffd36b');
  const p = new THREE.Vector3();
  return {
    /** lanes: [{ from: Vector3, to: Vector3 }] - kilka świetlików na każdym torze */
    update(lanes, time) {
      let n = 0;
      for (const [li, lane] of lanes.entries()) {
        for (let k = 0; k < 4 && n < max; k++) {
          const f = (time * 0.12 + k / 4 + li * 0.13) % 1;
          p.copy(lane.from).lerp(lane.to, f);
          gp.setXYZ(n, p.x, p.y, p.z);
          const a = Math.sin(f * Math.PI);
          gc.setXYZ(n, col.r * a, col.g * a, col.b * a);
          gs.setX(n, 9);
          n++;
        }
      }
      pts.geometry.setDrawRange(0, n);
      gp.needsUpdate = gc.needsUpdate = gs.needsUpdate = true;
    },
    dispose() { scene.remove(pts); pts.geometry.dispose(); pts.material.dispose(); },
  };
}
