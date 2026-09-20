/**
 * Zunifikowany stan sterowania lotem, zasilany przez TRZY niezależne
 * źródła wejścia (klawiatura+mysz, dotyk, kontrolery XR), tak żeby
 * fizyka lotu (main.js/updateShip) w ogóle nie musiała wiedzieć, skąd
 * pochodzi input - czyta tylko `state.pitch/yaw/roll/throttle/boost/brake`.
 *
 * Wszystkie osie w zakresie -1..1 (throttle: -1 pełny wsteczny, +1 pełny
 * do przodu), niezależnie od źródła.
 */
import * as THREE from 'three';

export function createFlightInput({ onShipSwitch } = {}) {
  const state = {
    pitch: 0, yaw: 0, roll: 0, throttle: 0,
    boost: false, brake: false,
    source: 'keyboard', // 'keyboard' | 'touch' | 'xr' - do debugowania/HUD
  };

  // ============================================================
  // ŹRÓDŁO 1: Klawiatura + mysz (desktop) - bez zmian względem
  // wcześniejszej wersji main.js, tylko przeniesione tutaj.
  // ============================================================
  let mouseX = 0, mouseY = 0;
  const keys = new Set();

  window.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
    state.source = 'keyboard';
  });
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
    if (digit !== undefined) onShipSwitch?.(digit);
    state.source = 'keyboard';
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  function updateKeyboard() {
    const forwardInput = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    let roll = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) roll += 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) roll -= 1;

    state.pitch = -mouseY;
    state.yaw = -mouseX;
    state.roll = roll;
    state.throttle = forwardInput;
    state.boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
    state.brake = keys.has('Space');
  }

  // ============================================================
  // ŹRÓDŁO 2: Dotyk (Android/mobile) - dwa wirtualne joysticki
  // (lewy: pitch/yaw celowania, prawy: X=roll, Y=throttle) + przyciski
  // boost/brake. Schemat "twin-stick" typowy dla mobilnych symulatorów
  // lotu (jeden kciuk = celowanie, drugi = ciąg/przechył).
  // ============================================================
  function makeJoystick(zoneEl, knobEl) {
    const jState = { x: 0, y: 0, active: false, pointerId: null };
    const radius = () => zoneEl.clientWidth / 2;

    function setKnob(dx, dy) {
      const r = radius();
      const mag = Math.hypot(dx, dy);
      const clamped = mag > r ? r / mag : 1;
      const kx = dx * clamped, ky = dy * clamped;
      knobEl.style.transform = `translate(${kx}px, ${ky}px)`;
      jState.x = kx / r;
      jState.y = ky / r;
    }
    function reset() {
      jState.x = 0; jState.y = 0; jState.active = false; jState.pointerId = null;
      knobEl.style.transform = 'translate(0px, 0px)';
    }

    zoneEl.addEventListener('pointerdown', (e) => {
      jState.active = true;
      jState.pointerId = e.pointerId;
      zoneEl.setPointerCapture(e.pointerId);
      const rect = zoneEl.getBoundingClientRect();
      setKnob(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
      state.source = 'touch';
    });
    zoneEl.addEventListener('pointermove', (e) => {
      if (!jState.active || e.pointerId !== jState.pointerId) return;
      const rect = zoneEl.getBoundingClientRect();
      setKnob(e.clientX - (rect.left + rect.width / 2), e.clientY - (rect.top + rect.height / 2));
    });
    const end = (e) => { if (e.pointerId === jState.pointerId) reset(); };
    zoneEl.addEventListener('pointerup', end);
    zoneEl.addEventListener('pointercancel', end);

    return jState;
  }

  let leftStick = null, rightStick = null;
  let touchBoostBtn = null, touchBrakeBtn = null;

  /**
   * Podłącza UI dotykowe do istniejących elementów DOM (patrz
   * step4-stellar-physics/index.html, sekcja #touch-controls).
   * Bezpieczne wywołać nawet gdy elementy nie istnieją (np. w wersji
   * bez UI dotykowego) - po prostu nic się wtedy nie podłączy.
   */
  function attachTouchUI({ leftZone, leftKnob, rightZone, rightKnob, boostBtn, brakeBtn }) {
    if (leftZone && leftKnob) leftStick = makeJoystick(leftZone, leftKnob);
    if (rightZone && rightKnob) rightStick = makeJoystick(rightZone, rightKnob);
    if (boostBtn) {
      touchBoostBtn = boostBtn;
      const setBoost = (v) => { state.boost = v; state.source = 'touch'; };
      boostBtn.addEventListener('pointerdown', () => setBoost(true));
      boostBtn.addEventListener('pointerup', () => setBoost(false));
      boostBtn.addEventListener('pointercancel', () => setBoost(false));
    }
    if (brakeBtn) {
      touchBrakeBtn = brakeBtn;
      const setBrake = (v) => { state.brake = v; state.source = 'touch'; };
      brakeBtn.addEventListener('pointerdown', () => setBrake(true));
      brakeBtn.addEventListener('pointerup', () => setBrake(false));
      brakeBtn.addEventListener('pointercancel', () => setBrake(false));
    }
  }

  function updateTouch() {
    if (!leftStick && !rightStick) return false; // UI dotykowe niepodłączone
    if (!leftStick.active && !rightStick?.active && !touchBoostBtn && !touchBrakeBtn) {
      // brak aktywnego dotyku - nie nadpisujemy state (niech trzyma ostatnią
      // wartość z innego źródła, np. klawiatury, jeśli user ma i jedno, i drugie)
      return leftStick.active || rightStick?.active;
    }
    state.yaw = -(leftStick?.x ?? 0);
    state.pitch = -(leftStick?.y ?? 0);
    state.roll = -(rightStick?.x ?? 0);
    state.throttle = -(rightStick?.y ?? 0); // joystick w górę (ujemne y ekranu) = do przodu
    return true;
  }

  // ============================================================
  // ŹRÓDŁO 3: Kontrolery XR (VR) - odczyt gamepadów z aktywnej sesji
  // WebXR. Mapowanie wg profilu "xr-standard" (Meta Quest Touch i
  // większość kontrolerów zgodnych z WebXR Input Profiles): axes[2]/[3]
  // to główny drążek (thumbstick), buttons[0] to spust (trigger),
  // buttons[1] to chwyt boczny (squeeze/grip).
  // NIEPRZETESTOWANE NA REALNYM SPRZĘCIE - mapowanie osi/przycisków
  // bywa różne między producentami; jeśli Twój kontroler reaguje
  // odwrotnie/nie reaguje, to pierwsze miejsce do poprawki.
  // ============================================================
  function updateXR(renderer) {
    const session = renderer?.xr?.getSession?.();
    if (!session) return false;

    let found = false;
    let yaw = 0, pitch = 0, roll = 0, throttle = 0, boost = false, brake = false;

    for (const source of session.inputSources) {
      const gp = source.gamepad;
      if (!gp) continue;
      found = true;
      const axes = gp.axes;
      // xr-standard: axes[2]=stick X, axes[3]=stick Y (niektóre przeglądarki/
      // urządzenia dają je na axes[0]/[1] - bierzemy ten z większą wychyloną
      // wartością, żeby działało niezależnie od konkretnego mapowania).
      const sx = Math.abs(axes[2] ?? 0) > Math.abs(axes[0] ?? 0) ? axes[2] : axes[0];
      const sy = Math.abs(axes[3] ?? 0) > Math.abs(axes[1] ?? 0) ? axes[3] : axes[1];

      if (source.handedness === 'left') {
        // lewy kontroler: drążek = celowanie (pitch/yaw), spust = hamulec
        yaw = -(sx ?? 0);
        pitch = -(sy ?? 0);
        if (gp.buttons[0]?.pressed) brake = true;
      } else if (source.handedness === 'right') {
        // prawy kontroler: drążek X = roll, Y = throttle, spust = ciąg
        // dodatkowy, chwyt boczny (squeeze) = boost
        roll = -(sx ?? 0);
        throttle = -(sy ?? 0);
        if (gp.buttons[0]?.pressed) throttle = Math.max(throttle, 1);
        if (gp.buttons[1]?.pressed) boost = true;
      }
    }

    if (found) {
      state.yaw = yaw; state.pitch = pitch; state.roll = roll;
      state.throttle = throttle; state.boost = boost; state.brake = brake;
      state.source = 'xr';
    }
    return found;
  }

  /** Wywoływane raz na klatkę z animate(). `renderer` opcjonalny - podaj
   * go tylko gdy w scenie jest WebXR, żeby sprawdzić kontrolery. */
  function update(renderer) {
    const xrActive = renderer ? updateXR(renderer) : false;
    if (xrActive) return state;
    const touchActive = updateTouch();
    if (touchActive) return state;
    updateKeyboard();
    return state;
  }

  return { state, update, attachTouchUI };
}
