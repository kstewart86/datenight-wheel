/* Date Night Wheel */
(() => {
  'use strict';

  // Fallback list, used only when the page is opened straight from disk and
  // data/restaurants.json can't be fetched. The server copy is the real source.
  const SEED = [
    { id: 'grand-old-house', name: 'Grand Old House' },
    { id: 'the-wharf', name: 'The Wharf' },
    { id: 'agua', name: 'Agua' },
    { id: 'marios', name: "Mario's" },
    { id: 'bonny-moon-beach-club', name: 'Bonny Moon Beach Club' },
    { id: 'luca', name: 'Luca' },
    { id: 'ms-pipers', name: "Ms. Piper's" },
  ];

  const COLORS = [
    '#e23e6b', '#f2843c', '#ffc46b', '#7bc47f',
    '#3fa9b5', '#5c73d8', '#9b5de5', '#ef6f9c',
    '#d64545', '#ec9a3c', '#57b894', '#4f8ede',
  ];

  const TAU = Math.PI * 2;
  const POINTER = -Math.PI / 2; // wheel pointer sits at 12 o'clock
  const HISTORY_KEY = 'dnw.history';
  const LIST_KEY = 'dnw.list';
  const SOUND_KEY = 'dnw.sound';
  const MAX_HISTORY = 12;

  const $ = (id) => document.getElementById(id);
  const els = {
    wheel: $('wheel'),
    confetti: $('confetti'),
    spin: $('spin'),
    result: $('result'),
    list: $('list'),
    count: $('count'),
    form: $('add-form'),
    input: $('add-input'),
    notice: $('notice'),
    history: $('history'),
    clearHistory: $('clear-history'),
    storageNote: $('storage-note'),
    sound: $('sound'),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let restaurants = [];
  let history = load(HISTORY_KEY, []);
  let hasApi = false;
  let rotation = 0;
  let spinning = false;

  /* ------------------------------------------------------------------ *
   * storage
   * ------------------------------------------------------------------ */

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode — nothing we can do */
    }
  }

  function slugify(name) {
    return (
      name.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ||
      'spot'
    );
  }

  async function api(path, options) {
    const res = await fetch(`/api/restaurants${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  async function loadRestaurants() {
    try {
      restaurants = await api('', { method: 'GET' });
      hasApi = true;
      els.storageNote.textContent = 'Saved to data/restaurants.json — changes stick for good.';
      return;
    } catch {
      hasApi = false;
    }

    const stored = load(LIST_KEY, null);
    if (stored) {
      restaurants = stored;
    } else {
      try {
        const res = await fetch('data/restaurants.json');
        restaurants = await res.json();
      } catch {
        restaurants = SEED.slice();
      }
    }
    els.storageNote.textContent =
      'Offline mode: changes are saved in this browser only. Run "node server.js" to save them into data/restaurants.json.';
  }

  function persistLocal() {
    if (!hasApi) save(LIST_KEY, restaurants);
  }

  /* ------------------------------------------------------------------ *
   * mutations
   * ------------------------------------------------------------------ */

  function showNotice(message) {
    els.notice.textContent = message;
    els.notice.hidden = !message;
  }

  function cleanName(value) {
    return value.trim().replace(/\s+/g, ' ');
  }

  async function addRestaurant(rawName) {
    const name = cleanName(rawName);
    if (!name) return false;

    if (hasApi) {
      restaurants = await api('', { method: 'POST', body: JSON.stringify({ name }) });
      return true;
    }

    if (restaurants.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`${name} is already on the wheel.`);
    }
    let id = slugify(name);
    const taken = new Set(restaurants.map((r) => r.id));
    for (let n = 2; taken.has(id); n++) id = `${slugify(name)}-${n}`;
    restaurants.push({ id, name });
    persistLocal();
    return true;
  }

  async function renameRestaurant(id, rawName) {
    const name = cleanName(rawName);
    if (!name) throw new Error('Please give the place a name.');

    if (hasApi) {
      restaurants = await api(`/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      });
      return;
    }

    if (restaurants.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`${name} is already on the wheel.`);
    }
    const target = restaurants.find((r) => r.id === id);
    if (target) target.name = name;
    persistLocal();
  }

  async function removeRestaurant(id) {
    if (hasApi) {
      restaurants = await api(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return;
    }
    restaurants = restaurants.filter((r) => r.id !== id);
    persistLocal();
  }

  /* ------------------------------------------------------------------ *
   * sound
   * ------------------------------------------------------------------ */

  const sound = (() => {
    let ctx = null;
    const enabled = () => els.sound.checked;

    function context() {
      if (!ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        ctx = new Ctor();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function blip({ freq, duration, type = 'triangle', gain = 0.12, at = 0 }) {
      const c = context();
      if (!c) return;
      const t = c.currentTime + at;
      const osc = c.createOscillator();
      const vol = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      vol.gain.setValueAtTime(gain, t);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(vol).connect(c.destination);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    }

    return {
      unlock() {
        if (enabled()) context();
      },
      tick(strength = 1) {
        if (!enabled()) return;
        blip({ freq: 900 + Math.random() * 120, duration: 0.045, type: 'square', gain: 0.05 * strength });
      },
      fanfare() {
        if (!enabled()) return;
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
          blip({ freq, duration: 0.42, gain: 0.13, at: i * 0.09 });
        });
      },
    };
  })();

  /* ------------------------------------------------------------------ *
   * wheel drawing
   * ------------------------------------------------------------------ */

  const ctx = els.wheel.getContext('2d');
  let size = 620;

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const css = els.wheel.clientWidth || 460;
    size = css;
    els.wheel.width = Math.round(css * dpr);
    els.wheel.height = Math.round(css * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWheel();
  }

  function fitText(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let cut = text;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return `${cut.trim()}…`;
  }

  function drawWheel() {
    const c = size / 2;
    const radius = c - 6;
    ctx.clearRect(0, 0, size, size);

    if (restaurants.length === 0) {
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `600 ${Math.max(13, size * 0.036)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Add a place to begin', c, c * 0.55);
      return;
    }

    const seg = TAU / restaurants.length;
    const fontSize = Math.max(11, Math.min(size * 0.042, (size * 0.9) / restaurants.length, 22));

    restaurants.forEach((r, i) => {
      const start = rotation + i * seg;
      const end = start + seg;

      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, radius, start, end);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 11, 31, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(start + seg / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(24, 12, 30, 0.92)';
      ctx.fillText(fitText(r.name, radius * 0.68), radius - radius * 0.12, 0);
      ctx.restore();
    });

    // hub ring
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.16, 0, TAU);
    ctx.fillStyle = 'rgba(20, 11, 31, 0.9)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(c, c, radius, 0, TAU);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  function winnerAt(rot) {
    if (restaurants.length === 0) return null;
    const seg = TAU / restaurants.length;
    const offset = ((POINTER - rot) % TAU + TAU) % TAU;
    return restaurants[Math.floor(offset / seg) % restaurants.length];
  }

  function boundaryCount(rot) {
    const seg = TAU / restaurants.length;
    return Math.floor(((POINTER - rot) % TAU + TAU) % TAU / seg);
  }

  /* ------------------------------------------------------------------ *
   * spinning
   * ------------------------------------------------------------------ */

  function spin() {
    if (spinning || restaurants.length === 0) return;
    spinning = true;
    els.spin.disabled = true;
    els.result.classList.remove('win');
    els.result.innerHTML = '<span class="result-label">Spinning…</span>';
    sound.unlock();

    const seg = TAU / restaurants.length;
    const index = Math.floor(Math.random() * restaurants.length);
    // Land somewhere inside the chosen slice, but not right on an edge.
    const jitter = (Math.random() * 0.7 + 0.15) * seg;
    const targetRotation = POINTER - index * seg - jitter;
    const delta = ((targetRotation - rotation) % TAU + TAU) % TAU;
    const turns = 5 + Math.floor(Math.random() * 3);
    const from = rotation;
    const distance = turns * TAU + delta;
    const duration = reduceMotion ? 600 : 4600 + Math.random() * 900;

    let lastBoundary = boundaryCount(rotation);
    const start = performance.now();

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4); // easeOutQuart
      rotation = from + distance * eased;
      drawWheel();

      const boundary = boundaryCount(rotation);
      if (boundary !== lastBoundary) {
        lastBoundary = boundary;
        sound.tick(1 - t * 0.6);
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        rotation = ((from + distance) % TAU + TAU) % TAU;
        drawWheel();
        finish(winnerAt(rotation));
      }
    }

    requestAnimationFrame(frame);
  }

  function finish(winner) {
    spinning = false;
    els.spin.disabled = false;
    if (!winner) return;

    els.result.textContent = `Tonight: ${winner.name}`;
    els.result.classList.add('win');
    sound.fanfare();
    if (!reduceMotion) launchConfetti();

    history.unshift({ name: winner.name, at: Date.now() });
    history = history.slice(0, MAX_HISTORY);
    save(HISTORY_KEY, history);
    renderHistory();
  }

  /* ------------------------------------------------------------------ *
   * confetti
   * ------------------------------------------------------------------ */

  const confettiCtx = els.confetti.getContext('2d');
  let confettiPieces = [];
  let confettiRaf = null;

  function sizeConfetti() {
    const dpr = window.devicePixelRatio || 1;
    els.confetti.width = Math.round(window.innerWidth * dpr);
    els.confetti.height = Math.round(window.innerHeight * dpr);
    confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function launchConfetti() {
    const rect = els.wheel.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;

    for (let i = 0; i < 140; i++) {
      const angle = Math.random() * TAU;
      const speed = 5 + Math.random() * 11;
      confettiPieces.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        w: 5 + Math.random() * 7,
        h: 8 + Math.random() * 8,
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 0.35,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      });
    }
    if (confettiPieces.length > 600) confettiPieces = confettiPieces.slice(-600);

    if (!confettiRaf) {
      confettiRaf = requestAnimationFrame(function step() {
        confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        confettiPieces = confettiPieces.filter((p) => {
          p.vy += 0.32;
          p.vx *= 0.99;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.spin;
          p.life -= 0.006;
          if (p.life <= 0 || p.y > window.innerHeight + 40) return false;

          confettiCtx.save();
          confettiCtx.translate(p.x, p.y);
          confettiCtx.rotate(p.rot);
          confettiCtx.globalAlpha = Math.max(0, Math.min(1, p.life));
          confettiCtx.fillStyle = p.color;
          confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          confettiCtx.restore();
          return true;
        });

        if (confettiPieces.length) {
          confettiRaf = requestAnimationFrame(step);
        } else {
          confettiCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
          confettiRaf = null;
        }
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * rendering
   * ------------------------------------------------------------------ */

  function renderList() {
    els.list.innerHTML = '';
    els.count.textContent = String(restaurants.length);
    els.spin.disabled = spinning || restaurants.length === 0;

    if (restaurants.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'The wheel is empty. Add somewhere to eat!';
      els.list.append(li);
      return;
    }

    restaurants.forEach((r, i) => {
      const li = document.createElement('li');
      li.dataset.id = r.id;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = COLORS[i % COLORS.length];

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.name;

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'icon-btn';
      edit.title = `Rename ${r.name}`;
      edit.setAttribute('aria-label', `Rename ${r.name}`);
      edit.textContent = '✎';
      edit.addEventListener('click', () => startEdit(li, r));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn danger';
      del.title = `Remove ${r.name}`;
      del.setAttribute('aria-label', `Remove ${r.name}`);
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        if (!window.confirm(`Remove ${r.name} from the wheel?`)) return;
        await guard(() => removeRestaurant(r.id));
      });

      li.append(swatch, name, edit, del);
      els.list.append(li);
    });
  }

  function startEdit(li, restaurant) {
    li.innerHTML = '';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 60;
    input.value = restaurant.name;
    input.setAttribute('aria-label', 'Restaurant name');

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'icon-btn';
    confirm.textContent = '✓';
    confirm.title = 'Save';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'icon-btn danger';
    cancel.textContent = '✕';
    cancel.title = 'Cancel';

    const commit = () => guard(() => renameRestaurant(restaurant.id, input.value));

    confirm.addEventListener('click', commit);
    cancel.addEventListener('click', () => {
      showNotice('');
      renderList();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        showNotice('');
        renderList();
      }
    });

    li.append(input, confirm, cancel);
    input.focus();
    input.select();
  }

  function renderHistory() {
    els.history.innerHTML = '';
    els.clearHistory.hidden = history.length === 0;

    if (history.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No spins yet.';
      els.history.append(li);
      return;
    }

    history.forEach((entry) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = entry.name;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = new Date(entry.at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      li.append(name, when);
      els.history.append(li);
    });
  }

  // Runs a mutation, then redraws — surfacing any error as a notice.
  async function guard(fn) {
    try {
      showNotice('');
      await fn();
      renderList();
      drawWheel();
      return true;
    } catch (err) {
      showNotice(err.message || 'Something went wrong.');
      renderList();
      drawWheel();
      return false;
    }
  }

  /* ------------------------------------------------------------------ *
   * wiring
   * ------------------------------------------------------------------ */

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = els.input.value;
    if (!cleanName(value)) return;
    const ok = await guard(() => addRestaurant(value));
    if (ok) els.input.value = '';
    els.input.focus();
  });

  els.spin.addEventListener('click', spin);

  els.clearHistory.addEventListener('click', () => {
    history = [];
    save(HISTORY_KEY, history);
    renderHistory();
  });

  els.sound.checked = load(SOUND_KEY, true);
  els.sound.addEventListener('change', () => {
    save(SOUND_KEY, els.sound.checked);
    sound.unlock();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
      e.preventDefault();
      spin();
    }
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
    sizeConfetti();
  });

  (async function init() {
    await loadRestaurants();
    sizeConfetti();
    resizeCanvas();
    renderList();
    renderHistory();
  })();
})();
