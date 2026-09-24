# Flota — zasoby współdzielone między krokami

Każdy statek w 3 poziomach detalu (LOD0 = pełny, LOD2 = daleki dystans /
słaby sprzęt). Nazewnictwo plików: `{id}-lod{0,1,2}.glb`.

Modele generuje workflow **Build ships** (`.github/workflows/build-ships.yml`)
z listy w `source/ships.manifest.js`; w trybie `patch` dopisuje też wpisy do
`fleet.js` (SHIPS) i `shared/data/races.js` (SHIP_RACE). Aktualną flotę
najłatwiej obejrzeć w `tools/ship-gallery/`.

```
shared/ships/
├── README.md              (ten plik)
├── fleet.js                lista statków, orientacja dziobu, kadrowanie kamery
├── lod_helper.js           loadShipLOD() - THREE.LOD z 3 plików .glb naraz
├── models/                 gotowe .glb - TYLKO to wczytuje gra (GLTFLoader)
└── source/                 generatory proceduralne (narzędzie deweloperskie,
                             NIE jest importowane przez grę) - patrz
                             source/README.md po instrukcję regeneracji .glb
```

`step3-ships/` na razie zawsze ładuje `*-lod0.glb` bezpośrednio przez
`GLTFLoader`. `lod_helper.js` (gotowy `THREE.LOD` przełączający automatycznie
wg dystansu kamery) czeka na podpięcie — naturalny temat na kolejny krok,
szczególnie istotny gdy na scenie pojawi się więcej niż jeden statek naraz
(NPC, wrogowie, sojusznicy).

**Repo a duże pliki binarne:** łącznie `models/` waży ~4,6 MB. To jeszcze
mieści się wygodnie w zwykłym gicie, ale jeśli flota urośnie (więcej
statków, tekstury, wyższe LOD0), warto rozważyć [Git LFS](https://git-lfs.com/)
dla `shared/ships/models/*.glb`, żeby historia repo nie puchła z każdą
regeneracją modelu.

## `fleet.js` — jedno źródło prawdy dla kroków 3 i 4

Kroki 3 i 4 miały każdy własną kopię tablicy statków, obrotu modeli i
matematyki kamery, więc poprawka w jednym nie trafiała do drugiego (tak
Kharath leciał tyłem w kroku 4, a w kroku 3 nie był poprawiony wcale).
Teraz `fleet.js` zawiera:

- `SHIPS` — id, nazwa, plik i **`bowAxis`** (gdzie model ma dziób: `'+Z'`
  albo `'-Z'`). `visualYawFor(def)` zamienia to na obrót wokół Y.
- `deriveCameraRig()` — dobiera odległość kamery pogoniowej tak, żeby
  sylwetka **każdego** statku zajmowała na ekranie tyle samo miejsca
  (`TARGET_SCREEN_SIZE`, domyślnie 0.26 = rozmiar Kharatha przy dawnej
  kamerze). Sylwetkę mierzy z małego renderu (biały, nieoświetlony model
  w buforze offscreen) — próby liczenia jej z wierzchołków albo pola
  trójkątów nie zgadzały się z pikselami (Kharath ma cienkie ramiona i
  ukryte żebra). Koszt: kilka–kilkadziesiąt ms przy zaokrętowaniu.

Zmienia to WYŁĄCZNIE kamerę — rozmiary w świecie i fizyka lotu (liczona z
bounding boxa) są bez zmian. Chcesz statki większe/mniejsze na ekranie:
zmień `TARGET_SCREEN_SIZE`.
