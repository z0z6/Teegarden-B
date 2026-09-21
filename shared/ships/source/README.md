# Statki — kod źródłowy (proceduralne generatory)

Te pliki `.js` to **źródło prawdy** dla modeli statków w
`shared/ships/models/*.glb`. Każdy eksportuje jedną funkcję budującą
(`buildWarbirdLight()`, `buildKharathDestroyer()` itd.) zwracającą gotowy
`THREE.Group` — czysta geometria three.js (`LatheGeometry`,
`ExtrudeGeometry`, `TorusGeometry`...), bez żadnych zewnętrznych plików
assetów. Nie są importowane przez samą grę (`step3-ships/` i dalej wczytują
gotowe `.glb`) — to narzędzie deweloperskie do (re)generowania modeli.

## Wzorzec współdzielenia zasobów

Każdy moduł buduje geometrię/materiały **tylko raz** (przy pierwszym
wywołaniu), a kolejne wywołania zwracają `Object3D.clone()` szablonu —
three.js kopiuje wtedy hierarchię/transformy, ale geometrię i materiały
przekazuje przez referencję. Dzięki temu N instancji tego samego statku
(np. flota NPC) to N tanich klonów, nie N-krotnie przeliczana geometria.

```js
import { buildWarbirdLight } from './warbird_light.js';

const a = buildWarbirdLight();                          // materiały współdzielone
const b = buildWarbirdLight({ uniqueMaterials: true });  // ta jedna instancja ma
                                                          // własne materiały (np.
                                                          // do przefarbowania na
                                                          // kolor frakcji)
```

## Jak zregenerować `.glb` z kodu źródłowego

Wymaga Node.js + kilku pakietów (tylko do generowania, nie do samej gry):

```bash
npm install three@0.184.0 gltfpack
```

### 1. Eksport do GLB + scalenie draw calls

Statki złożone z wielu osobnych `Mesh` (Kharath ma ich prawie 2000) trzeba
scalić po materiale przed eksportem, inaczej silnik dostanie tysiące draw
calls za darmo do zoptymalizowania. Przykład (analogicznie dla każdego
statku, zmień tylko import i nazwę pliku wyjściowego):

```js
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { writeFile } from 'fs/promises';
import { buildKharathDestroyer } from './kharath_destroyer.js';

// GLTFExporter w Node.js potrzebuje polyfilla FileReader:
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); });
  }
};

function mergeByMaterial(group) {
  const byMat = new Map();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed(); // ujednolicenie przed merge
    byMat.get(o.material).push(g);
  });
  const merged = new THREE.Group();
  for (const [material, geoms] of byMat) {
    merged.add(new THREE.Mesh(mergeGeometries(geoms, false), material));
  }
  return merged;
}

const merged = mergeByMaterial(buildKharathDestroyer());
new GLTFExporter().parse(merged, async (result) => {
  await writeFile('kharath-destroyer-raw.glb', Buffer.from(result));
}, console.error, { binary: true });
```

### 2. LOD + kompresja przez `gltfpack`

```bash
# LOD0: ten sam trójkąty co surowy eksport, ale skompresowany (meshopt)
npx gltfpack -i kharath-destroyer-raw.glb -o kharath-destroyer-lod0.glb -cc

# LOD1: ~35% trójkątów
npx gltfpack -i kharath-destroyer-raw.glb -o kharath-destroyer-lod1.glb -si 0.35 -sp -cc

# LOD2: ~6-10% trójkątów (dystans / słaby mobile / VR)
npx gltfpack -i kharath-destroyer-raw.glb -o kharath-destroyer-lod2.glb -si 0.08 -sp -sa -cc
```

Flagi: `-si R` = docelowy stosunek trójkątów, `-sp` = pozwól upraszczać
w poprzek granic materiałów (bez tego decymacja zatrzymuje się przedwcześnie
na modelach z wieloma osobnymi częściami), `-sa` = agresywna decymacja
(potrzebna, żeby LOD2 faktycznie zszedł nisko), `-cc` = kompresja meshopt +
kwantyzacja (bez utraty geometrii, tylko mniejszy plik).

**Efekt na Kharathcie** (1971 meshy, 372k trójkątów): LOD0 35 MB → 1,6 MB
po samej kompresji; LOD1 130k trójkątów / 598 KB; LOD2 22k trójkątów / 119 KB.

### 3. Wczytywanie skompresowanych plików w grze

Pliki `-cc` używają rozszerzenia `EXT_meshopt_compression` — `GLTFLoader`
potrzebuje dekodera:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
```

(już podpięte w `step3-ships/main.js`)

## Uwaga: konwencja "przodu"

Trzy myśliwce (`warbird-light`, `raptor-interceptor`, `warbird-heavy`)
mają dziób w lokalnym **+Z**. **Wyjątek: `kharath-destroyer` ma dziób w
-Z** (głowa z oczami i paszczą przy z ≈ -11..-14, dysze syfonów w +Z).
Silnik gry zakłada przód = lokalne -Z, więc myśliwce wymagają korekty
180°, a Kharath NIE.

Ta wiedza siedzi w jednym miejscu: pole `bowAxis` w
`shared/ships/fleet.js`. Dodając nowy statek, wpisz tam `bowAxis` zgodne
z generatorem (albo obróć geometrię już w generatorze, żeby było `'-Z'`)
— kroki 3 i 4 same zastosują właściwy obrót.
