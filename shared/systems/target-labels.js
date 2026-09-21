import * as THREE from 'three';

/**
 * Etykiety celów na ekranie (nazwa, rasa, dystans) - HTML nałożony na canvas.
 * Cel poza ekranem dostaje wskaźnik przy krawędzi ze strzałką w jego stronę.
 * NPC-e są małe i daleko (setki-tysiące jednostek), bez tego nie da się ich
 * znaleźć w kadrze.
 */
export function createTargetLabels(container, camera) {
  const els = new Map();
  const v = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  function ensure(id) {
    let el = els.get(id);
    if (!el) {
      const div = document.createElement('div');
      div.className = 'tlabel';
      div.innerHTML = '<div class="tl-arrow"></div><div class="tl-title"></div><div class="tl-sub"></div>';
      container.appendChild(div);
      el = { div, title: div.querySelector('.tl-title'), sub: div.querySelector('.tl-sub'), arrow: div.querySelector('.tl-arrow') };
      els.set(id, el);
    }
    return el;
  }

  /** items: [{ id, position, title, sub, color }] */
  function update(items) {
    camera.updateMatrixWorld(true);
    camera.getWorldPosition(camPos);
    const W = window.innerWidth, H = window.innerHeight;
    const seen = new Set();

    for (const it of items) {
      seen.add(it.id);
      const e = ensure(it.id);
      v.copy(it.position).project(camera);
      let x = v.x, y = v.y;
      const behind = v.z > 1;
      if (behind) { x = -x; y = -y; }
      const on = !behind && Math.abs(x) < 0.86 && Math.abs(y) < 0.86;
      const dist = camPos.distanceTo(it.position);

      e.div.style.color = it.color;
      e.title.textContent = it.title;
      e.sub.textContent = `${it.sub} · ${dist >= 10000 ? (dist / 1000).toFixed(1) + ' tys.' : Math.round(dist)} j.`;
      e.div.classList.toggle('off', !on);

      if (!on) {
        const s = Math.max(Math.abs(x) / 0.78, Math.abs(y) / 0.82, 1e-6); // margines na szerokość etykiety
        x /= s; y /= s;
        e.arrow.textContent = Math.abs(x) > Math.abs(y) * (W / H) ? (x > 0 ? '▶' : '◀') : (y > 0 ? '▲' : '▼');
      } else {
        e.arrow.textContent = '';
      }
      e.div.style.left = `${(x * 0.5 + 0.5) * W}px`;
      e.div.style.top = `${(1 - (y * 0.5 + 0.5)) * H}px`;
      e.div.style.display = '';
    }

    for (const [id, e] of els) {
      if (!seen.has(id)) { e.div.remove(); els.delete(id); }
    }
  }

  return { update };
}
