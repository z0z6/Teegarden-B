# Flota — zasoby współdzielone między krokami

Cztery statki, każdy w 3 poziomach detalu (LOD0 = pełny, LOD2 = daleki
dystans / słaby sprzęt). Nazewnictwo plików: `{statek}-lod{0,1,2}.glb`.

| Statek | Klasa | Długość | LOD0 | LOD1 | LOD2 |
|---|---|---|---|---|---|
| `warbird-light` | Lekki myśliwiec | ~17 j. | 553 KB | 122 KB | 24 KB |
| `raptor-interceptor` | Przechwytywacz | ~15 j. | 566 KB | 132 KB | 26 KB |
| `warbird-heavy` | Ciężki niszczyciel eskorty | ~18 j. | 820 KB | 162 KB | 38 KB |
| `kharath-destroyer` | Ciężki niszczyciel (kapitalny) | ~180 j. | 1,6 MB | 598 KB | 119 KB |

```
shared/ships/
├── README.md              (ten plik)
├── lod_helper.js           loadShipLOD() - THREE.LOD z 3 plików .glb naraz
├── models/                 gotowe .glb - TYLKO to wczytuje gra (GLTFLoader)
│   ├── warbird-light-lod{0,1,2}.glb
│   ├── raptor-interceptor-lod{0,1,2}.glb
│   ├── warbird-heavy-lod{0,1,2}.glb
│   └── kharath-destroyer-lod{0,1,2}.glb
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
