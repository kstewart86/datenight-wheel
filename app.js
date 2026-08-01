/* Date Night Wheel */
(() => {
  'use strict';

  // Fallback lists, used only when the page is opened straight from disk and
  // data/*.json can't be fetched. The server copies are the real source.
  const SEED = {
    restaurants: [
      { id: 'grand-old-house', name: 'Grand Old House', weight: 1 },
      { id: 'the-wharf', name: 'The Wharf', weight: 1 },
      { id: 'agua', name: 'Agua', weight: 1 },
      { id: 'marios', name: "Mario's", weight: 1 },
      { id: 'bonny-moon-beach-club', name: 'Bonny Moon Beach Club', weight: 1 },
      { id: 'luca', name: 'Luca', weight: 1 },
      { id: 'ms-pipers', name: "Ms. Piper's", weight: 1 },
    ],
    bars: [
      { id: 'lobby', name: 'Lobby', weight: 8 },
      { id: 'bones', name: 'Bones', weight: 8 },
      { id: 'jacks', name: "Jack's", weight: 1 },
      { id: 'stay-home', name: 'Stay Home', weight: 1 },
    ],
  };

  const WHEELS = {
    restaurants: {
      tagline: 'Where are we eating tonight?',
      panelTitle: 'The lineup',
      placeholder: 'Add a new restaurant…',
      confirmWord: 'restaurant',
    },
    bars: {
      tagline: 'What bar should we go to?',
      panelTitle: 'The bars',
      placeholder: 'Add a new bar…',
      confirmWord: 'bar',
    },
  };

  const COLORS = [
    '#e23e6b', '#f2843c', '#ffc46b', '#7bc47f',
    '#3fa9b5', '#5c73d8', '#9b5de5', '#ef6f9c',
    '#d64545', '#ec9a3c', '#57b894', '#4f8ede',
  ];

  // Bump alongside the ?v= on the script/stylesheet tags in index.html so a
  // deploy can't leave a visitor on a cached mix of old and new files.
  const ASSET_VERSION = 3;

  const TAU = Math.PI * 2;
  const POINTER = -Math.PI / 2; // wheel pointer sits at 12 o'clock
  const SOUND_KEY = 'dnw.sound';
  const TAB_KEY = 'dnw.tab';
  const MAX_HISTORY = 12;
  const MAX_WEIGHT = 50;

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
    weight: $('add-weight'),
    notice: $('notice'),
    history: $('history'),
    clearHistory: $('clear-history'),
    storageNote: $('storage-note'),
    sound: $('sound'),
    tagline: $('tagline'),
    panelTitle: $('panel-title'),
    tabs: Array.from(document.querySelectorAll('.tab')),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Per-wheel state. `slices` holds one entry index per wheel slice, so an
  // item with weight 8 appears in eight places.
  const state = {
    restaurants: { items: [], slices: [], rotation: 0, history: [] },
    bars: { items: [], slices: [], rotation: 0, history: [] },
  };

  let active = 'restaurants';
  let hasApi = false;
  let spinning = false;

  const wheel = () => state[active];

  /* ------------------------------------------------------------------ *
   * storage
   * ------------------------------------------------------------------ */

  const historyKey = (list) => `dnw.history.${list}`;
  const listKey = (list) => `dnw.list.${list}`;

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

  async function api(list, path, options) {
    const res = await fetch(`/api/${list}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function normalise(items) {
    return items.map((r) => ({ ...r, weight: Math.max(1, Math.min(MAX_WEIGHT, Number(r.weight) || 1)) }));
  }

  async function loadWheel(list) {
    if (hasApi) {
      state[list].items = normalise(await api(list, '', { method: 'GET' }));
      return;
    }

    const stored = load(listKey(list), null);
    if (stored) {
      state[list].items = normalise(stored);
      return;
    }
    try {
      const res = await fetch(`data/${list}.json?v=${ASSET_VERSION}`);
      if (!res.ok) throw new Error('missing');
      state[list].items = normalise(await res.json());
    } catch {
      state[list].items = normalise(SEED[list]);
    }
  }

  async function loadEverything() {
    try {
      state.restaurants.items = normalise(await api('restaurants', '', { method: 'GET' }));
      hasApi = true;
    } catch {
      hasApi = false;
    }

    if (hasApi) {
      await loadWheel('bars');
      els.storageNote.textContent = 'Saved to data/ in the project — changes stick for good.';
    } else {
      await loadWheel('restaurants');
      await loadWheel('bars');
      els.storageNote.textContent =
        location.protocol === 'file:'
          ? 'Opened as a file: changes are saved in this browser only. Run "node server.js" to save them into data/.'
          : 'Read-only hosting: additions are saved in this browser only, not to the data files, and other devices won’t see them.';
    }

    Object.keys(state).forEach((list) => {
      state[list].history = load(historyKey(list), []);
      rebuildSlices(list);
    });
  }

  function persistLocal(list) {
    if (!hasApi) save(listKey(list), state[list].items);
  }

  /* ------------------------------------------------------------------ *
   * slices
   * ------------------------------------------------------------------ */

  // Expand weights into individual slices, interleaved so repeats of the same
  // place are spread around the wheel instead of forming one giant wedge.
  // Uses the Sainte-Laguë divisor method: pick whoever is furthest behind.
  function buildSlices(items) {
    const total = items.reduce((sum, r) => sum + r.weight, 0);
    const placed = items.map(() => 0);
    const slices = [];

    for (let n = 0; n < total; n++) {
      let best = -1;
      let bestScore = -Infinity;
      items.forEach((r, i) => {
        if (placed[i] >= r.weight) return;
        const score = r.weight / (2 * placed[i] + 1);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best === -1) break;
      placed[best]++;
      slices.push(best);
    }
    return slices;
  }

  function rebuildSlices(list) {
    state[list].slices = buildSlices(state[list].items);
  }

  const totalWeight = (items) => items.reduce((sum, r) => sum + r.weight, 0);

  /* ------------------------------------------------------------------ *
   * mutations
   * ------------------------------------------------------------------ */

  function showNotice(message) {
    els.notice.textContent = message;
    els.notice.hidden = !message;
  }

  const cleanName = (value) => value.trim().replace(/\s+/g, ' ');

  function cleanWeight(value) {
    if (value === '' || value === undefined || value === null) return 1;
    const weight = Number(value);
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
      throw new Error(`Slices must be a whole number from 1 to ${MAX_WEIGHT}.`);
    }
    return weight;
  }

  function assertNameFree(items, name, exceptId) {
    if (items.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`${name} is already on the wheel.`);
    }
  }

  async function addEntry(list, rawName, rawWeight) {
    const name = cleanName(rawName);
    const weight = cleanWeight(rawWeight);
    if (!name) return false;

    if (hasApi) {
      state[list].items = normalise(
        await api(list, '', { method: 'POST', body: JSON.stringify({ name, weight }) })
      );
    } else {
      assertNameFree(state[list].items, name);
      let id = slugify(name);
      const taken = new Set(state[list].items.map((r) => r.id));
      for (let n = 2; taken.has(id); n++) id = `${slugify(name)}-${n}`;
      state[list].items.push({ id, name, weight });
      persistLocal(list);
    }
    rebuildSlices(list);
    return true;
  }

  async function updateEntry(list, id, rawName, rawWeight) {
    const name = cleanName(rawName);
    const weight = cleanWeight(rawWeight);
    if (!name) throw new Error('Please give it a name.');

    if (hasApi) {
      state[list].items = normalise(
        await api(list, `/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify({ name, weight }),
        })
      );
    } else {
      assertNameFree(state[list].items, name, id);
      const target = state[list].items.find((r) => r.id === id);
      if (target) {
        target.name = name;
        target.weight = weight;
      }
      persistLocal(list);
    }
    rebuildSlices(list);
  }

  async function removeEntry(list, id) {
    if (hasApi) {
      state[list].items = normalise(await api(list, `/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    } else {
      state[list].items = state[list].items.filter((r) => r.id !== id);
      persistLocal(list);
    }
    rebuildSlices(list);
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
    const { items, slices, rotation } = wheel();
    const c = size / 2;
    const radius = c - 6;
    ctx.clearRect(0, 0, size, size);

    if (slices.length === 0) {
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
      ctx.fillText('Add somewhere to begin', c, c * 0.55);
      return;
    }

    const seg = TAU / slices.length;
    const fontSize = Math.max(9, Math.min(size * 0.042, (size * 1.05) / slices.length, 22));

    slices.forEach((itemIndex, i) => {
      const item = items[itemIndex];
      const start = rotation + i * seg;

      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, radius, start, start + seg);
      ctx.closePath();
      ctx.fillStyle = COLORS[itemIndex % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 11, 31, 0.55)';
      ctx.lineWidth = slices.length > 24 ? 1 : 2;
      ctx.stroke();

      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(start + seg / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fontSize}px "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(24, 12, 30, 0.92)';
      ctx.fillText(fitText(item.name, radius * 0.68), radius - radius * 0.12, 0);
      ctx.restore();
    });

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

  function sliceAt(rot) {
    const { slices } = wheel();
    if (slices.length === 0) return -1;
    const seg = TAU / slices.length;
    const offset = ((POINTER - rot) % TAU + TAU) % TAU;
    return Math.floor(offset / seg) % slices.length;
  }

  function winnerAt(rot) {
    const { items, slices } = wheel();
    const index = sliceAt(rot);
    return index === -1 ? null : items[slices[index]];
  }

  /* ------------------------------------------------------------------ *
   * spinning
   * ------------------------------------------------------------------ */

  function spin() {
    const w = wheel();
    if (spinning || w.slices.length === 0) return;
    spinning = true;
    els.spin.disabled = true;
    els.result.classList.remove('win');
    els.result.innerHTML = '<span class="result-label">Spinning…</span>';
    sound.unlock();

    const list = active;
    const seg = TAU / w.slices.length;
    const target = Math.floor(Math.random() * w.slices.length);
    // Land somewhere inside the chosen slice, but not right on an edge.
    const jitter = (Math.random() * 0.7 + 0.15) * seg;
    const targetRotation = POINTER - target * seg - jitter;
    const from = w.rotation;
    const delta = ((targetRotation - from) % TAU + TAU) % TAU;
    const turns = 5 + Math.floor(Math.random() * 3);
    const distance = turns * TAU + delta;
    const duration = reduceMotion ? 600 : 4600 + Math.random() * 900;

    let lastSlice = sliceAt(from);
    const start = performance.now();

    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4); // easeOutQuart
      w.rotation = from + distance * eased;
      if (active === list) drawWheel();

      const current = sliceAt(w.rotation);
      if (current !== lastSlice) {
        lastSlice = current;
        sound.tick(1 - t * 0.6);
      }

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        w.rotation = ((from + distance) % TAU + TAU) % TAU;
        if (active === list) drawWheel();
        finish(list, winnerAt(w.rotation));
      }
    }

    requestAnimationFrame(frame);
  }

  function finish(list, winner) {
    spinning = false;
    els.spin.disabled = state[active].slices.length === 0;
    if (!winner) return;

    els.result.textContent = `Tonight: ${winner.name}`;
    els.result.classList.add('win');
    sound.fanfare();
    if (!reduceMotion) launchConfetti();

    state[list].history.unshift({ name: winner.name, at: Date.now() });
    state[list].history = state[list].history.slice(0, MAX_HISTORY);
    save(historyKey(list), state[list].history);
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
    const { items, slices } = wheel();
    const total = totalWeight(items);
    els.list.innerHTML = '';
    els.count.textContent = slices.length === items.length ? String(items.length) : `${items.length} · ${slices.length} slices`;
    els.spin.disabled = spinning || slices.length === 0;

    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'The wheel is empty. Add somewhere to go!';
      els.list.append(li);
      return;
    }

    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.dataset.id = item.id;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = COLORS[i % COLORS.length];

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;

      const odds = document.createElement('span');
      odds.className = 'odds';
      const pct = total ? Math.round((item.weight / total) * 100) : 0;
      odds.innerHTML = `×${item.weight} · <b>${pct}%</b>`;
      odds.title = `${item.weight} of ${total} slices`;

      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'icon-btn';
      edit.title = `Edit ${item.name}`;
      edit.setAttribute('aria-label', `Edit ${item.name}`);
      edit.textContent = '✎';
      edit.addEventListener('click', () => startEdit(li, item));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn danger';
      del.title = `Remove ${item.name}`;
      del.setAttribute('aria-label', `Remove ${item.name}`);
      del.textContent = '✕';
      del.addEventListener('click', async () => {
        if (!window.confirm(`Remove ${item.name} from the wheel?`)) return;
        const list = active;
        await guard(() => removeEntry(list, item.id));
      });

      li.append(swatch, name, odds, edit, del);
      els.list.append(li);
    });
  }

  function startEdit(li, item) {
    const list = active;
    li.innerHTML = '';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 60;
    nameInput.value = item.name;
    nameInput.setAttribute('aria-label', 'Name');

    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.min = '1';
    weightInput.max = String(MAX_WEIGHT);
    weightInput.value = String(item.weight);
    weightInput.setAttribute('aria-label', 'Slices on the wheel');
    weightInput.title = 'How many slices it gets';

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

    const commit = () => guard(() => updateEntry(list, item.id, nameInput.value, weightInput.value));
    const abandon = () => {
      showNotice('');
      renderList();
    };

    confirm.addEventListener('click', commit);
    cancel.addEventListener('click', abandon);

    [nameInput, weightInput].forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          abandon();
        }
      });
    });

    li.append(nameInput, weightInput, confirm, cancel);
    nameInput.focus();
    nameInput.select();
  }

  function renderHistory() {
    const { history } = wheel();
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

  function switchTo(list) {
    if (!state[list] || list === active) return;
    active = list;
    save(TAB_KEY, list);

    els.tabs.forEach((tab) => {
      const on = tab.dataset.list === list;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    });

    const config = WHEELS[list];
    els.tagline.textContent = config.tagline;
    els.panelTitle.textContent = config.panelTitle;
    els.input.placeholder = config.placeholder;
    els.input.value = '';
    els.weight.value = '1';

    showNotice('');
    els.result.classList.remove('win');
    els.result.innerHTML = '<span class="result-label">Pick a fate</span>';
    renderList();
    renderHistory();
    drawWheel();
  }

  /* ------------------------------------------------------------------ *
   * wiring
   * ------------------------------------------------------------------ */

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (spinning) return;
      switchTo(tab.dataset.list);
    });
  });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const list = active;
    if (!cleanName(els.input.value)) return;
    const ok = await guard(() => addEntry(list, els.input.value, els.weight.value));
    if (ok) {
      els.input.value = '';
      els.weight.value = '1';
    }
    els.input.focus();
  });

  els.spin.addEventListener('click', spin);

  els.clearHistory.addEventListener('click', () => {
    wheel().history = [];
    save(historyKey(active), []);
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
    await loadEverything();

    const saved = load(TAB_KEY, 'restaurants');
    if (state[saved] && saved !== active) {
      active = 'restaurants';
      switchTo(saved);
    } else {
      const config = WHEELS[active];
      els.tagline.textContent = config.tagline;
      els.panelTitle.textContent = config.panelTitle;
      els.input.placeholder = config.placeholder;
    }

    sizeConfetti();
    resizeCanvas();
    renderList();
    renderHistory();
  })();
})();
