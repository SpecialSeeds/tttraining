'use strict';

(() => {
  const DAY_IDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const LOG_KEY = 'tt.logs.v1';
  const ORPHAN_KEY = 'tt.logs.orphaned';
  const PREF_KEY = 'tt.prefs';
  const EQUIP = [
    { v: 'machine', label: 'Machines' },
    { v: 'mixed', label: 'Mixed' },
    { v: 'free', label: 'Free' },
  ];
  const REST = [
    { v: 1, label: 'Full' },
    { v: 0.75, label: 'Shorter' },
    { v: 0.5, label: 'Rushed' },
  ];
  const KIND_LABEL = { machine: 'Machine', free: 'Free' };
  const UNIT = { reps: 'reps', sec: 's', m: 'm', min: 'min' };
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" ' +
    'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const state = {
    vault: null,
    key: null,
    plan: null,
    logs: { sessions: {} },
    dayId: null,
    view: 'train',
    histEx: null,
    prefs: loadPrefs(),
  };

  /* ================= helpers ================= */

  const $ = (sel, root = document) => root.querySelector(sel);

  function append(node, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid instanceof Node ? kid : String(kid));
    }
    return node;
  }

  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'selected') node[k] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    return append(node, kids);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

  function localISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const asDate = (iso) => new Date(iso + 'T12:00:00');
  const fmtShort = (iso) => asDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtLong = (iso) => asDate(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3800);
  }

  /* ================= device preferences (not encrypted, nothing personal) ================= */

  function loadPrefs() {
    const prefs = { equip: 'machine', rest: 1 };
    try {
      Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}'));
    } catch {
      /* storage blocked or corrupt: use defaults */
    }
    return prefs;
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(state.prefs));
    } catch {
      /* ignore */
    }
  }

  /* ================= IndexedDB: optional "stay signed in" ================= */
  // Stores the non extractable CryptoKey object. The raw key bytes and the
  // password are never written anywhere.

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('tt-vault', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction('keys', mode).objectStore('keys'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const idbGet = (k) => idbDo('readonly', (s) => s.get(k));
  const idbSet = (k, v) => idbDo('readwrite', (s) => s.put(v, k));
  const idbDel = (k) => idbDo('readwrite', (s) => s.delete(k));

  /* ================= logs (encrypted at rest) ================= */

  let saveChain = Promise.resolve();
  function saveLogs() {
    saveChain = saveChain
      .then(async () => {
        const box = await Vault.encryptWithKey(state.key, state.logs);
        localStorage.setItem(LOG_KEY, JSON.stringify({ salt: state.vault.kdf.salt, box }));
      })
      .catch((err) => toast(`Could not save on this device: ${err.message}`));
    return saveChain;
  }

  async function loadLogs() {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return;
    try {
      const stored = JSON.parse(raw);
      if (stored.salt !== state.vault.kdf.salt) throw new Error('different vault');
      state.logs = await Vault.decryptWithKey(state.key, stored.box);
      if (!state.logs || typeof state.logs.sessions !== 'object') state.logs = { sessions: {} };
    } catch {
      // Logs were written under other credentials. Keep them aside, never overwrite.
      localStorage.setItem(ORPHAN_KEY, raw);
      localStorage.removeItem(LOG_KEY);
      state.logs = { sessions: {} };
    }
  }

  /* ================= plan + session model ================= */

  const findDay = (id) => state.plan.days.find((d) => d.id === id) || state.plan.days[0];
  // The plan exercise plus its machine and free weight swaps (variants.js, or `alts` in the plan).
  function variantsOf(base) {
    const alts = { ...((window.VARIANTS || {})[base.id] || {}), ...(base.alts || {}) };
    const out = [{ ...base, kind: 'plan', baseId: base.id }];
    for (const kind of ['machine', 'free']) {
      if (alts[kind]) out.push({ ...base, ...alts[kind], kind, baseId: base.id });
    }
    return out;
  }

  // Which version to show: a swap picked this session, else whatever already has
  // sets logged today, else the Equipment setting, else the plan as written.
  function resolveEx(base, session) {
    const vs = variantsOf(base);
    const pick = session && session.picks && session.picks[base.id];
    return (
      (pick && vs.find((v) => v.id === pick)) ||
      vs.find((v) => doneSets(session, v.id).length) ||
      vs.find((v) => v.kind === state.prefs.equip) ||
      vs[0]
    );
  }

  const restFor = (ex) => {
    const full = ex.rest ?? 90;
    return full ? Math.max(15, Math.round((full * state.prefs.rest) / 5) * 5) : 0;
  };
  const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  const allExercises = () =>
    state.plan.days.flatMap((d) => d.exercises.flatMap((ex) => variantsOf(ex).map((v) => ({ ...v, dayId: d.id }))));
  const findEx = (id) => allExercises().find((e) => e.id === id);
  const sessionKey = (dayId) => `${localISO()}|${dayId}`;

  function ensureSession(key) {
    const [date, day] = key.split('|');
    if (!state.logs.sessions[key]) state.logs.sessions[key] = { date, day, stair: false, sets: {}, updated: Date.now() };
    return state.logs.sessions[key];
  }

  function setEntry(key, exId, i, patch) {
    const s = ensureSession(key);
    const arr = (s.sets[exId] = s.sets[exId] || []);
    while (arr.length <= i) arr.push({});
    Object.assign(arr[i], patch);
    s.updated = Date.now();
    saveLogs();
  }

  const doneSets = (session, exId) => ((session && session.sets && session.sets[exId]) || []).filter((s) => s && s.done);

  function lastPerformance(exId, excludeKey) {
    let best = null;
    for (const [k, s] of Object.entries(state.logs.sessions)) {
      if (k === excludeKey || !doneSets(s, exId).length) continue;
      if (!best || s.date > best.date || (s.date === best.date && (s.updated || 0) > (best.updated || 0))) best = s;
    }
    return best;
  }

  // Double progression: repeat the load until every set reaches the target, then add ex.inc.
  function suggest(ex, last) {
    if (!ex.weighted) return { weight: null, text: null };
    if (!last) return { weight: ex.weight ?? null, text: `Start with ${ex.load}.` };
    const sets = doneSets(last, ex.id);
    const w = Math.max(0, ...sets.map((s) => num(s.w) ?? 0));
    if (!w) return { weight: ex.weight ?? null, text: null };
    const hit = sets.length >= ex.sets && sets.every((s) => (num(s.r) ?? 0) >= ex.target);
    if (hit && ex.inc) return { weight: w + ex.inc, text: `Every set reached ${ex.target} last time, so move up to ${fmt(w + ex.inc)} lb.` };
    if (hit) return { weight: w, text: `Every set reached ${ex.target} last time.` };
    return { weight: w, text: `Stay at ${fmt(w)} lb until every set reaches ${ex.target}.` };
  }

  const unitText = (ex) => (ex.unit === 'reps' ? '' : ` ${UNIT[ex.unit]}`);
  const rxText = (ex) => `${ex.sets} × ${ex.target}${unitText(ex)}${ex.perSide ? ' each' : ''}`;

  function formatSets(ex, sets) {
    const done = sets.filter((s) => s && s.done);
    const reps = (s) => fmt(num(s.r) ?? 0);
    const weights = [...new Set(done.map((s) => num(s.w)).filter((v) => v !== null))];
    if (ex.weighted && weights.length === 1) return `${fmt(weights[0])} lb × ${done.map(reps).join(', ')}${unitText(ex)}`;
    if (ex.weighted && weights.length > 1) return done.map((s) => `${fmt(num(s.w) ?? 0)} × ${reps(s)}`).join(', ') + unitText(ex);
    return done.map(reps).join(', ') + unitText(ex);
  }

  /* ================= rest timer ================= */

  const timer = { end: 0, handle: null, hide: null };

  function startTimer(seconds) {
    if (!seconds) return;
    clearTimeout(timer.hide);
    clearTimeout(timer.handle);
    timer.end = Date.now() + seconds * 1000;
    const el = $('#timer');
    el.classList.remove('over');
    el.hidden = false;
    tickTimer();
  }

  function tickTimer() {
    const left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
    $('#timer-time').textContent = fmtClock(left);
    if (left > 0) {
      timer.handle = setTimeout(tickTimer, 250);
      return;
    }
    $('#timer').classList.add('over');
    $('#timer-time').textContent = 'Go';
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    timer.hide = setTimeout(stopTimer, 5000);
  }

  function stopTimer() {
    clearTimeout(timer.handle);
    clearTimeout(timer.hide);
    $('#timer').hidden = true;
  }

  /* ================= rendering ================= */

  function render() {
    renderHeader();
    renderStrip();
    $('#view-train').hidden = state.view !== 'train';
    $('#view-history').hidden = state.view !== 'history';
    if (state.view === 'train') renderTrain();
    else renderHistory();
  }

  function renderHeader() {
    const day = findDay(state.dayId);
    if (state.view === 'history') {
      $('#title').textContent = 'History';
      $('#subtitle').textContent = 'Every logged session for one exercise, newest first.';
    } else {
      $('#title').textContent = day.name;
      $('#subtitle').textContent = day.optional ? `Optional session. ${day.focus}.` : `${day.focus}.`;
    }
    $('#btn-history').textContent = state.view === 'history' ? 'Train' : 'History';
    $('#day-strip').hidden = state.view !== 'train';
  }

  function renderStrip() {
    const todayId = DAY_IDS[new Date().getDay()];
    const core = h('div', { class: 'side core' });
    const optional = h('div', { class: 'side optional' });
    for (const day of state.plan.days) {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'day',
          'aria-pressed': String(day.id === state.dayId),
          'aria-label': `${day.name}${day.optional ? ', optional' : ''}${day.id === todayId ? ', today' : ''}`,
          onclick: () => {
            state.dayId = day.id;
            render();
          },
        },
        day.short,
        day.id === todayId ? h('span', { class: 'ball', 'aria-hidden': 'true' }) : null
      );
      (day.optional ? optional : core).append(btn);
    }
    $('#day-strip').replaceChildren(core, h('div', { class: 'net', 'aria-hidden': 'true' }), optional);
  }

  function renderTrain() {
    const day = findDay(state.dayId);
    const key = sessionKey(day.id);
    const session = state.logs.sessions[key];
    const warm = { ...state.plan.warmup, ...(day.warmup || {}) };
    const scrollY = window.scrollY;

    const stairDone = !!(session && session.stair);
    const stairTick = h('button', {
      type: 'button',
      class: 'tick',
      'aria-pressed': String(stairDone),
      'aria-label': stairDone ? `Mark ${warm.name} not done` : `Mark ${warm.name} done`,
      html: CHECK_SVG,
      onclick: () => {
        ensureSession(key).stair = !stairDone;
        ensureSession(key).updated = Date.now();
        saveLogs();
        renderTrain();
      },
    });

    const exercises = day.exercises.map((base) => resolveEx(base, session));
    const planned = exercises.reduce((n, ex) => n + ex.sets, 0);
    const done = day.exercises.reduce((n, base) => n + variantsOf(base).reduce((m, v) => m + doneSets(session, v.id).length, 0), 0);

    const root = $('#view-train');
    root.replaceChildren();
    append(root, [
      h('p', { class: 'logging', text: `Logging for ${fmtLong(localISO())}` }),
      renderPrefs(),
      day.note ? h('p', { class: 'note', text: day.note }) : null,
      h('div', { class: 'warmup' }, h('div', null, h('h2', { text: `${warm.name}, ${warm.minutes} min` }), h('p', { text: day.stair })), stairTick),
      h('ol', { class: 'exercises' }, exercises.map((ex) => renderExercise(ex, key))),
      h('p', { class: 'summary', text: `${done} of ${planned} sets done` }),
    ]);
    window.scrollTo(0, scrollY);
  }

  function segmented(label, options, current, onpick) {
    return h(
      'div',
      { class: 'pref', role: 'group', 'aria-label': label },
      h('span', { class: 'pref-label', text: label, 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'seg' },
        options.map((o) =>
          h('button', {
            type: 'button',
            text: o.label,
            'aria-pressed': String(o.v === current),
            onclick: () => onpick(o.v),
          })
        )
      )
    );
  }

  function renderPrefs() {
    const pick = (field) => (v) => {
      state.prefs[field] = v;
      savePrefs();
      renderTrain();
    };
    return h(
      'div',
      { class: 'prefs' },
      segmented('Equipment', EQUIP, state.prefs.equip, pick('equip')),
      segmented('Rest', REST, state.prefs.rest, pick('rest'))
    );
  }

  function renderSwap(ex, key) {
    const base = findDay(state.dayId).exercises.find((e) => e.id === ex.baseId);
    const vs = variantsOf(base);
    if (vs.length < 2) return null;
    const next = vs[(vs.findIndex((v) => v.id === ex.id) + 1) % vs.length];
    return h('button', {
      type: 'button',
      class: 'swap',
      text: 'Swap',
      'aria-label': `Swap ${ex.name} for ${next.name}`,
      onclick: () => {
        const s = ensureSession(key);
        s.picks = { ...(s.picks || {}), [base.id]: next.id };
        s.updated = Date.now();
        saveLogs();
        renderTrain();
      },
    });
  }

  function renderExercise(ex, key) {
    const last = lastPerformance(ex.id, key);
    const sug = suggest(ex, last);
    const logged = (state.logs.sessions[key] && state.logs.sessions[key].sets[ex.id]) || [];
    const count = Math.max(ex.sets, logged.length);

    const rows = h('ol', { class: 'sets' });
    for (let i = 0; i < count; i++) rows.append(renderSet(ex, key, i, logged[i], sug));

    return h(
      'li',
      { class: 'ex' },
      h('div', { class: 'ex-head' }, h('h3', { text: ex.name }), h('span', { class: 'rx', text: rxText(ex) })),
      h(
        'p',
        { class: 'why' },
        KIND_LABEL[ex.kind] ? h('span', { class: 'kind', text: KIND_LABEL[ex.kind] }) : null,
        ex.why,
        restFor(ex) ? h('span', { class: 'rest', text: ` Rest ${fmtClock(restFor(ex))}.` }) : null,
        renderSwap(ex, key)
      ),
      last || sug.text
        ? h(
            'p',
            { class: 'meta' },
            last ? h('span', { class: 'last', text: `Last time, ${fmtShort(last.date)}: ${formatSets(ex, last.sets[ex.id])}` }) : null,
            sug.text
          )
        : null,
      rows,
      h('button', {
        type: 'button',
        class: 'add-set',
        text: 'Add a set',
        onclick: () => {
          setEntry(key, ex.id, count, {});
          renderTrain();
        },
      })
    );
  }

  function renderSet(ex, key, i, entry, sug) {
    entry = entry || {};
    const done = !!entry.done;
    const label = `${ex.name}, set ${i + 1}`;

    const wInput = ex.weighted
      ? h('input', {
          type: 'text',
          inputmode: 'decimal',
          autocomplete: 'off',
          value: entry.w != null ? fmt(entry.w) : '',
          placeholder: sug.weight != null ? fmt(sug.weight) : '',
          'aria-label': `${label}, weight in pounds`,
          onchange: (e) => setEntry(key, ex.id, i, { w: num(e.target.value) }),
        })
      : null;

    const rInput = h('input', {
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      value: entry.r != null ? fmt(entry.r) : '',
      placeholder: String(ex.target),
      'aria-label': `${label}, ${UNIT[ex.unit]}${ex.perSide ? ' per side' : ''}`,
      onchange: (e) => setEntry(key, ex.id, i, { r: num(e.target.value) }),
    });

    const tick = h('button', {
      type: 'button',
      class: 'tick',
      'aria-pressed': String(done),
      'aria-label': done ? `Mark ${label} not done` : `Mark ${label} done`,
      html: CHECK_SVG,
      onclick: () => {
        if (done) {
          setEntry(key, ex.id, i, { done: false });
        } else {
          // Empty boxes take the suggested weight and the target, so one tap logs a set as planned.
          const w = wInput ? num(wInput.value) ?? num(wInput.placeholder) : null;
          const r = num(rInput.value) ?? ex.target;
          setEntry(key, ex.id, i, { w, r, done: true });
          startTimer(restFor(ex));
        }
        renderTrain();
      },
    });

    return h(
      'li',
      { class: `set${ex.weighted ? '' : ' bw'}${done ? ' done' : ''}` },
      h('span', { class: 'n', text: String(i + 1), 'aria-hidden': 'true' }),
      wInput ? h('span', { class: 'inp' }, wInput, h('span', { class: 'suffix', text: 'lb', 'aria-hidden': 'true' })) : null,
      wInput ? h('span', { class: 'x', text: '×', 'aria-hidden': 'true' }) : null,
      h('span', { class: 'inp' }, rInput, h('span', { class: 'suffix', text: UNIT[ex.unit], 'aria-hidden': 'true' })),
      tick
    );
  }

  function renderHistory() {
    const root = $('#view-history');
    if (!state.histEx || !findEx(state.histEx)) {
      const key = sessionKey(state.dayId);
      state.histEx = resolveEx(findDay(state.dayId).exercises[0], state.logs.sessions[key]).id;
    }
    const ex = findEx(state.histEx);

    const select = h('select', {
      onchange: (e) => {
        state.histEx = e.target.value;
        renderHistory();
      },
    });
    for (const day of state.plan.days) {
      select.append(
        h(
          'optgroup',
          { label: day.name },
          day.exercises.flatMap(variantsOf).map((e) =>
            h('option', { value: e.id, text: KIND_LABEL[e.kind] ? `${e.name} (${KIND_LABEL[e.kind].toLowerCase()})` : e.name, selected: e.id === ex.id })
          )
        )
      );
    }

    const sessions = Object.values(state.logs.sessions)
      .filter((s) => doneSets(s, ex.id).length)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.updated || 0) - (a.updated || 0));

    root.replaceChildren();
    append(root, [
      h('label', { class: 'field' }, 'Exercise', select),
      sessions.length
        ? [
            chart(ex, sessions.slice().reverse()),
            h(
              'ol',
              { class: 'hist' },
              sessions.map((s) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'd' }, fmtShort(s.date), h('small', { text: findDay(s.day).name })),
                  h('span', { text: formatSets(ex, s.sets[ex.id]) })
                )
              )
            ),
          ]
        : h('p', { class: 'empty', text: `No sets logged for ${ex.name} yet. Log a set on ${findDay(ex.dayId).name} and it shows up here.` }),
    ]);
  }

  function chart(ex, sessions) {
    if (sessions.length < 2) return null;
    const vals = sessions.map((s) => {
      const d = doneSets(s, ex.id);
      return Math.max(...d.map((x) => (ex.weighted ? num(x.w) ?? 0 : num(x.r) ?? 0)));
    });
    const W = 320, H = 150, left = 36, right = 10, top = 14, bottom = 26;
    const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
    const pts = vals.map((v, i) => [
      left + (i * (W - left - right)) / (vals.length - 1),
      H - bottom - ((v - min) / span) * (H - top - bottom),
    ]);
    const poly = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
    const last = pts[pts.length - 1];
    const measure = ex.weighted ? 'Top weight (lb)' : `Best set (${UNIT[ex.unit]})`;
    const svg =
      `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(measure)} for ${esc(ex.name)}, ` +
      `from ${fmt(vals[0])} to ${fmt(vals[vals.length - 1])}">` +
      `<line x1="${left}" y1="${H - bottom}" x2="${W - right}" y2="${H - bottom}" stroke="#F3F6FA" stroke-opacity=".3"/>` +
      `<text x="${left - 6}" y="${top + 4}" text-anchor="end" fill="#A7BEDB" font-size="11">${fmt(max)}</text>` +
      `<text x="${left - 6}" y="${H - bottom + 4}" text-anchor="end" fill="#A7BEDB" font-size="11">${fmt(min)}</text>` +
      `<text x="${left}" y="${H - 6}" fill="#A7BEDB" font-size="11">${esc(fmtShort(sessions[0].date))}</text>` +
      `<text x="${W - right}" y="${H - 6}" text-anchor="end" fill="#A7BEDB" font-size="11">${esc(fmtShort(sessions[sessions.length - 1].date))}</text>` +
      `<polyline points="${poly}" fill="none" stroke="#F3F6FA" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      pts.slice(0, -1).map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#F3F6FA"/>`).join('') +
      `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="5" fill="#FF9F1C"/></svg>`;
    return [h('div', { html: svg }), h('p', { class: 'chart-caption', text: measure })];
  }

  /* ================= backup ================= */

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBackup() {
    await saveLogs();
    const payload = {
      kind: 'tt-training-backup',
      version: 1,
      exported: new Date().toISOString(),
      logs: JSON.parse(localStorage.getItem(LOG_KEY) || 'null'),
      orphaned: localStorage.getItem(ORPHAN_KEY),
    };
    download(`training-backup-${localISO()}.json`, JSON.stringify(payload));
    toast('Backup exported. It stays encrypted with your credentials.');
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.kind !== 'tt-training-backup' || !data.logs) throw new Error('That file is not a training backup.');
      if (data.logs.salt !== state.vault.kdf.salt) {
        throw new Error('This backup was made with a different username or password. Sign in with those to open it.');
      }
      const imported = await Vault.decryptWithKey(state.key, data.logs.box);
      let n = 0;
      for (const [k, s] of Object.entries(imported.sessions || {})) {
        const mine = state.logs.sessions[k];
        if (!mine || (s.updated || 0) > (mine.updated || 0)) {
          state.logs.sessions[k] = s;
          n++;
        }
      }
      await saveLogs();
      render();
      toast(n ? `Imported ${n} session${n === 1 ? '' : 's'}.` : 'Nothing new in that backup.');
    } catch (err) {
      toast(err.message || 'Import failed.');
    }
  }

  /* ================= boot + login ================= */

  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-msg').textContent = message || '';
    $('#username').focus();
  }

  async function start(key, plan) {
    state.key = key;
    state.plan = plan;
    await loadLogs();
    const todayId = DAY_IDS[new Date().getDay()];
    state.dayId = plan.days.some((d) => d.id === todayId) ? todayId : plan.days[0].id;

    $('#m-notes').replaceChildren(...(plan.notes || []).map((n) => h('p', { text: n })));
    $('#login').hidden = true;
    $('#app').hidden = false;
    render();
  }

  async function boot() {
    if (!window.crypto || !crypto.subtle) {
      showLogin('This page needs HTTPS to unlock. Open it from your github.io address.');
      $('#login-btn').disabled = true;
      return;
    }
    try {
      const res = await fetch('vault.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      state.vault = await res.json();
    } catch {
      showLogin('vault.json was not found next to index.html. Create it with setup.html and upload it.');
      $('#login-btn').disabled = true;
      return;
    }

    try {
      const saved = await idbGet('session');
      if (saved && saved.salt === state.vault.kdf.salt) {
        const plan = await Vault.decryptWithKey(saved.key, state.vault.data);
        return start(saved.key, plan);
      }
    } catch {
      /* no saved session, or it no longer matches: fall through to login */
    }
    showLogin();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    const user = $('#username').value;
    const pass = $('#password').value;
    btn.disabled = true;
    btn.textContent = 'Unlocking';
    $('#login-msg').textContent = '';
    try {
      const { key, plan } = await Vault.unlock(state.vault, user, pass);
      try {
        if ($('#remember').checked) await idbSet('session', { key, salt: state.vault.kdf.salt });
        else await idbDel('session');
      } catch {
        /* private browsing can block IndexedDB; signing in still works */
      }
      $('#password').value = '';
      await start(key, plan);
    } catch {
      $('#login-msg').textContent = 'Username or password is incorrect.';
      $('#password').select();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  });

  $('#btn-history').addEventListener('click', () => {
    state.view = state.view === 'history' ? 'train' : 'history';
    window.scrollTo(0, 0);
    render();
  });

  const menu = $('#menu');
  $('#btn-menu').addEventListener('click', () => {
    $('#m-orphan').hidden = !localStorage.getItem(ORPHAN_KEY);
    menu.showModal();
  });
  $('#m-close').addEventListener('click', () => menu.close());
  menu.addEventListener('click', (e) => {
    if (e.target === menu) menu.close(); // tap on backdrop
  });
  $('#m-export').addEventListener('click', exportBackup);
  $('#m-import').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) {
      menu.close();
      await importBackup(file);
    }
  });
  $('#m-lock').addEventListener('click', async () => {
    await saveChain;
    try {
      await idbDel('session');
    } catch {
      /* ignore */
    }
    location.reload();
  });

  $('#timer-more').addEventListener('click', () => {
    timer.end = Math.max(timer.end, Date.now()) + 15000;
    $('#timer').classList.remove('over');
    clearTimeout(timer.hide);
    clearTimeout(timer.handle);
    tickTimer();
  });
  $('#timer-less').addEventListener('click', () => {
    timer.end -= 15000;
    clearTimeout(timer.handle);
    tickTimer();
  });
  $('#timer-skip').addEventListener('click', stopTimer);

  boot();
})();
