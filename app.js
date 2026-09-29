// Training log. Sign in, plans and logs go through cloud.js (Firebase); everything
// else is plain DOM. Loaded as a module, so it runs in strict mode on its own.
import * as Cloud from './cloud.js';

{
  const DAY_IDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
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
    user: null,
    admin: false,
    plan: null,
    draft: null,
    openEx: new Set(),
    openForm: new Set(),
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

  /* ================= saving ================= */

  function persist(key) {
    Cloud.saveSession(state.user.uid, key, state.logs.sessions[key]).catch(() => {});
  }

  let syncPending = 0;
  function showSync(pending, err) {
    syncPending = pending;
    if (err) toast(err.code === 'permission-denied' ? 'This account no longer has access. Ask the owner.' : `Could not sync: ${err.message}`);
    const el = $('#sync');
    if (!el) return;
    el.textContent = pending ? (navigator.onLine ? 'Syncing' : 'Saved on this phone, syncs when online') : 'Synced';
    el.classList.toggle('waiting', !!pending);
  }

  /* ================= plan + session model ================= */

  // The plan being edited while the editor is open, otherwise the saved plan.
  const activePlan = () => (state.view === 'edit' ? state.draft : state.plan);
  const findDay = (id) => activePlan().days.find((d) => d.id === id) || activePlan().days[0];
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
    persist(key);
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

  /* ================= hold timer (timed sets and stretches) ================= */
  // One countdown at a time. Each-side items run side 1, a short switch, then side 2.
  // The running button is found by data-hold and updated in place, so typing elsewhere isn't disturbed.

  const SWITCH_SECONDS = 5;
  const CLOCK_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
    '<path d="M12 9.5v4l2.5 2M10 3h4M18.5 6.5l1.5-1.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const hold = { key: null, phases: [], phase: 0, end: 0, started: 0, handle: null, onDone: null, onStop: null, lock: null };
  let audio = null;

  function beep(count = 1, freq = 880) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      for (let i = 0; i < count; i++) {
        const t = audio.currentTime + i * 0.22;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        osc.connect(gain).connect(audio.destination);
        osc.start(t);
        osc.stop(t + 0.18);
      }
    } catch {
      /* no audio available */
    }
    if (navigator.vibrate) navigator.vibrate(count > 1 ? [200, 100, 200] : 150);
  }

  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) hold.lock = await navigator.wakeLock.request('screen');
      else if (!on && hold.lock) {
        const lock = hold.lock;
        hold.lock = null;
        await lock.release();
      }
    } catch {
      /* not supported or not allowed; the timer still works */
    }
  }

  const holdLeft = () => Math.max(0, Math.ceil((hold.end - Date.now()) / 1000));
  const isSwitch = () => hold.phases.length > 1 && hold.phase === 1;

  const holdContent = () => [
    h('span', { class: 'hold-time', text: isSwitch() ? 'Switch' : fmtClock(holdLeft()) }),
    hold.phases.length > 1 && !isSwitch() ? h('span', { class: 'hold-side', text: hold.phase === 0 ? 'side 1' : 'side 2' }) : null,
  ];

  function paintHold() {
    for (const btn of document.querySelectorAll(`[data-hold="${CSS.escape(hold.key)}"]`)) btn.replaceChildren(...holdContent().filter(Boolean));
  }

  function tickHold() {
    if (!hold.key) return;
    if (holdLeft() <= 0) {
      if (hold.phase < hold.phases.length - 1) {
        hold.phase++;
        hold.end = Date.now() + hold.phases[hold.phase] * 1000;
        beep(isSwitch() ? 1 : 2, isSwitch() ? 660 : 880);
      } else {
        const done = hold.onDone;
        clearHold();
        beep(3, 988);
        done();
        return;
      }
    }
    paintHold();
    hold.handle = setTimeout(tickHold, 250);
  }

  function clearHold() {
    clearTimeout(hold.handle);
    Object.assign(hold, { key: null, phases: [], phase: 0, onDone: null, onStop: null });
    keepAwake(false);
  }

  function startHold(key, seconds, perSide, onDone, onStop) {
    if (hold.key) clearHold();
    stopTimer(); // starting the next hold means the rest is over
    Object.assign(hold, {
      key,
      phases: perSide ? [seconds, SWITCH_SECONDS, seconds] : [seconds],
      phase: 0,
      started: Date.now(),
      end: Date.now() + seconds * 1000,
      onDone,
      onStop,
    });
    beep(1, 660); // also unlocks audio on iPhone, which needs a tap first
    keepAwake(true);
    renderTrain();
    tickHold();
  }

  function stopHold() {
    const { onStop, started, phases } = hold;
    const held = Math.min(Math.round((Date.now() - started) / 1000), phases[0]);
    clearHold();
    if (onStop) onStop(held);
    renderTrain();
  }

  // Seconds for one side of a timed item, or 0 if it isn't timed.
  const holdSeconds = (unit, amount) => (unit === 'sec' ? amount : unit === 'min' ? amount * 60 : 0);

  function holdButton(key, seconds, perSide, name, onDone, onStop) {
    const running = hold.key === key;
    const btn = h('button', {
      type: 'button',
      class: `tick hold${running ? ' running' : ''}`,
      'data-hold': key,
      'aria-label': running ? `Stop the timer for ${name}` : `Start a ${fmtClock(seconds)} timer for ${name}${perSide ? ', each side' : ''}`,
      onclick: () => (hold.key === key ? stopHold() : startHold(key, seconds, perSide, onDone, onStop)),
    });
    if (running) append(btn, holdContent());
    else btn.innerHTML = CLOCK_SVG;
    return btn;
  }

  /* ================= rendering ================= */

  function render() {
    renderHeader();
    renderStrip();
    $('#view-train').hidden = state.view !== 'train';
    $('#view-history').hidden = state.view !== 'history';
    $('#view-edit').hidden = state.view !== 'edit';
    if (state.view === 'train') renderTrain();
    else if (state.view === 'history') renderHistory();
    else renderEdit();
  }

  function renderHeader() {
    const day = findDay(state.dayId);
    const focus = day.focus ? `${day.focus.replace(/\.$/, '')}.` : '';
    if (state.view === 'history') {
      $('#title').textContent = 'History';
      $('#subtitle').textContent = 'Every logged session for one exercise, newest first.';
    } else if (state.view === 'edit') {
      $('#title').textContent = 'Edit plan';
      $('#subtitle').textContent = `${day.name}. Pick a day, change anything, then save.`;
    } else {
      $('#title').textContent = day.name;
      $('#subtitle').textContent = day.optional ? `Optional session. ${focus}` : focus;
    }
    $('#btn-history').textContent = state.view === 'history' ? 'Train' : 'History';
    $('#btn-history').hidden = state.view === 'edit';
    $('#day-strip').hidden = state.view === 'history';
  }

  function renderStrip() {
    const todayId = DAY_IDS[new Date().getDay()];
    const core = h('div', { class: 'side core' });
    const optional = h('div', { class: 'side optional' });
    for (const day of activePlan().days) {
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
        persist(key);
        renderTrain();
      },
    });

    const exercises = day.exercises.map((base) => resolveEx(base, session));
    const planned = exercises.reduce((n, ex) => n + ex.sets, 0);
    const done = day.exercises.reduce((n, base) => n + variantsOf(base).reduce((m, v) => m + doneSets(session, v.id).length, 0), 0);

    const root = $('#view-train');
    root.replaceChildren();
    append(root, [
      h('p', { class: 'logging' }, `Logging for ${fmtLong(localISO())} · `, h('span', { id: 'sync', text: 'Synced' })),
      renderPrefs(),
      day.note ? h('p', { class: 'note', text: day.note }) : null,
      warm.name
        ? h('div', { class: 'warmup' }, h('div', null, h('h2', { text: warm.minutes ? `${warm.name}, ${warm.minutes} min` : warm.name }), day.stair ? h('p', { text: day.stair }) : null), stairTick)
        : null,
      renderStretches('pre', key),
      exercises.length
        ? [h('ol', { class: 'exercises' }, exercises.map((ex) => renderExercise(ex, key))), h('p', { class: 'summary', text: `${done} of ${planned} sets done` })]
        : h('p', { class: 'empty', text: 'Nothing planned for this day. Add exercises from Menu, Edit plan.' }),
      renderStretches('post', key),
    ]);
    showSync(syncPending);
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
        persist(key);
        renderTrain();
      },
    });
  }

  /* ---------- form diagrams + stretches ---------- */

  const stretchesOf = (plan) => plan.stretches || (window.Forms && window.Forms.stretches) || { pre: [], post: [] };
  const hasForm = (id) => !!(window.Forms && window.Forms.has(id));

  // Tapping a name shows stick figures for each phase of the movement.
  function formToggle(id, name, tag) {
    if (!hasForm(id)) return h(tag, { text: name });
    const open = state.openForm.has(id);
    return h(
      tag,
      null,
      h('button', {
        type: 'button',
        class: 'form-btn',
        'aria-expanded': String(open),
        onclick: () => {
          open ? state.openForm.delete(id) : state.openForm.add(id);
          renderTrain();
        },
      }, name, h('span', { class: 'form-hint', text: open ? 'Hide form' : 'Form', 'aria-hidden': 'true' }))
    );
  }

  function renderForm(id) {
    if (!state.openForm.has(id) || !hasForm(id)) return null;
    const form = window.Forms.get(id);
    return h(
      'div',
      { class: 'form' },
      h(
        'div',
        { class: 'form-frames' },
        form.frames.map((fr, i) =>
          h('figure', null, h('div', { html: fr.svg }), h('figcaption', null, h('b', { text: `${i + 1}. ${fr.label}` }), ' ', fr.cue))
        )
      ),
      form.ret ? h('p', { class: 'form-ret' }, h('b', { text: 'Return. ' }), form.ret) : null
    );
  }

  const doseText = (st) => `${st.target}${st.unit === 'sec' ? ' s' : ''}${st.perSide ? ' each' : ''}`;

  function renderStretches(which, key) {
    const list = stretchesOf(state.plan)[which] || [];
    if (!list.length) return null;
    const session = state.logs.sessions[key];
    const doneMap = (session && session.stretched) || {};
    const title = which === 'pre' ? 'Stretch before you lift' : 'Stretch after';
    const sub = which === 'pre' ? 'Moving stretches, after the warm-up.' : 'Hold each one and breathe.';
    return h(
      'section',
      { class: `stretches ${which}` },
      h('div', { class: 'st-head' }, h('h2', { text: title }), h('p', { text: `${sub} ${list.filter((st) => doneMap[st.id]).length} of ${list.length} done.` })),
      h(
        'ol',
        { class: 'st-list' },
        list.map((st) => {
          const done = !!doneMap[st.id];
          return h(
            'li',
            { class: done ? 'done' : null },
            h(
              'div',
              { class: 'st-row' },
              formToggle(st.id, st.name, 'span'),
              h('span', { class: 'st-dose', text: doseText(st) }),
              st.unit === 'sec' && !done
                ? holdButton(`st:${key}:${st.id}`, Math.round(num(st.target) || 0), st.perSide, st.name, () => {
                    const s = ensureSession(key);
                    s.stretched = { ...(s.stretched || {}), [st.id]: true };
                    s.updated = Date.now();
                    persist(key);
                    renderTrain();
                  })
                : h('span'),
              h('button', {
                type: 'button',
                class: 'tick small',
                'aria-pressed': String(done),
                'aria-label': done ? `Mark ${st.name} not done` : `Mark ${st.name} done`,
                html: CHECK_SVG,
                onclick: () => {
                  const s = ensureSession(key);
                  s.stretched = { ...(s.stretched || {}), [st.id]: !done };
                  s.updated = Date.now();
                  persist(key);
                  renderTrain();
                },
              })
            ),
            renderForm(st.id)
          );
        })
      )
    );
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
      h('div', { class: 'ex-head' }, formToggle(ex.id, ex.name, 'h3'), h('span', { class: 'rx', text: rxText(ex) })),
      renderForm(ex.id),
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

    // Timed sets get a countdown: it logs the set when it finishes, or the time held if stopped early.
    const amount = num(entry.r) ?? ex.target;
    const timed = !done && holdSeconds(ex.unit, amount) > 0;
    const timerBtn = timed
      ? holdButton(
          `set:${key}:${ex.id}:${i}`,
          Math.round(holdSeconds(ex.unit, amount)),
          ex.perSide,
          label,
          () => {
            const w = wInput ? num(wInput.value) ?? num(wInput.placeholder) : null;
            setEntry(key, ex.id, i, { w, r: amount, done: true });
            startTimer(restFor(ex));
            renderTrain();
          },
          (held) => {
            if (held > 0) setEntry(key, ex.id, i, { r: ex.unit === 'min' ? Math.round((held / 60) * 10) / 10 : held });
          }
        )
      : null;

    return h(
      'li',
      { class: `set${ex.weighted ? '' : ' bw'}${holdSeconds(ex.unit, 1) ? ' timed' : ''}${done ? ' done' : ''}` },
      h('span', { class: 'n', text: String(i + 1), 'aria-hidden': 'true' }),
      wInput ? h('span', { class: 'inp' }, wInput, h('span', { class: 'suffix', text: 'lb', 'aria-hidden': 'true' })) : null,
      wInput ? h('span', { class: 'x', text: '×', 'aria-hidden': 'true' }) : null,
      h('span', { class: 'inp' }, rInput, h('span', { class: 'suffix', text: UNIT[ex.unit], 'aria-hidden': 'true' })),
      holdSeconds(ex.unit, 1) ? timerBtn || h('span') : null,
      tick
    );
  }

  function renderHistory() {
    const root = $('#view-history');
    if (!state.histEx || !findEx(state.histEx)) {
      const first = findDay(state.dayId).exercises[0] || state.plan.days.flatMap((d) => d.exercises)[0];
      if (!first) {
        root.replaceChildren(h('p', { class: 'empty', text: 'Your plan has no exercises yet. Add some from Menu, Edit plan.' }));
        return;
      }
      state.histEx = resolveEx(first, state.logs.sessions[sessionKey(state.dayId)]).id;
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

  /* ================= plan editor ================= */

  const DEFAULT_DAYS = [
    ['mon', 'Monday', 'Mon', false], ['tue', 'Tuesday', 'Tue', false], ['wed', 'Wednesday', 'Wed', false],
    ['thu', 'Thursday', 'Thu', false], ['fri', 'Friday', 'Fri', false], ['sat', 'Saturday', 'Sat', true], ['sun', 'Sunday', 'Sun', true],
  ];
  const UNITS = [
    { v: 'reps', label: 'Reps' },
    { v: 'sec', label: 'Seconds' },
    { v: 'm', label: 'Meters' },
    { v: 'min', label: 'Minutes' },
  ];

  function blankPlan() {
    return {
      version: 1,
      warmup: { name: 'Warm-up', minutes: 10 },
      notes: [],
      days: DEFAULT_DAYS.map(([id, name, short, optional]) => ({ id, name, short, optional, focus: '', stair: '', exercises: [] })),
    };
  }

  function newExercise() {
    return {
      id: `ex-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: '', sets: 3, target: 10, unit: 'reps', perSide: false,
      weighted: true, weight: null, inc: 5, rest: 90, load: '', why: '',
    };
  }

  // Accepts a plan saved from this app (.json) or the old setup/plan.js file.
  function parsePlanText(text) {
    const plan = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!plan || !Array.isArray(plan.days) || !plan.days.every((d) => d.id && d.name && Array.isArray(d.exercises))) {
      throw new Error('That file does not look like a training plan.');
    }
    return plan;
  }

  function openEditor() {
    state.draft = structuredClone(state.plan);
    state.draft.stretches = structuredClone(stretchesOf(state.plan));
    state.openEx = new Set();
    state.view = 'edit';
    window.scrollTo(0, 0);
    render();
  }

  function closeEditor() {
    state.draft = null;
    state.view = 'train';
    if (!state.plan.days.some((d) => d.id === state.dayId)) state.dayId = state.plan.days[0].id;
    window.scrollTo(0, 0);
    render();
  }

  // Fills gaps and turns typed text into numbers. Returns { message, exId } for a problem, or null.
  function cleanDraft(plan) {
    for (const day of plan.days) {
      for (const ex of day.exercises) {
        ex.name = String(ex.name || '').trim();
        if (!ex.name) {
          state.dayId = day.id;
          state.openEx.add(ex.id);
          return { message: `Every exercise on ${day.name} needs a name.`, exId: ex.id };
        }
        ex.sets = Math.max(1, Math.round(num(ex.sets) ?? 1));
        ex.target = Math.max(1, num(ex.target) ?? 1);
        ex.rest = Math.max(0, Math.round(num(ex.rest) ?? 0));
        ex.weight = ex.weighted ? num(ex.weight) : null;
        ex.inc = ex.weighted ? Math.max(0, num(ex.inc) ?? 0) : 0;
        ex.why = String(ex.why || '').trim();
        ex.load = String(ex.load || '').trim() || (!ex.weighted ? 'bodyweight' : ex.weight != null ? `${fmt(ex.weight)} lb` : 'a weight at RPE 7');
      }
    }
    plan.notes = (plan.notes || []).map((n) => String(n).trim()).filter(Boolean);
    for (const which of ['pre', 'post']) {
      const list = (plan.stretches && plan.stretches[which]) || [];
      for (const st of list) {
        st.name = String(st.name || '').trim();
        st.target = Math.max(1, num(st.target) ?? 1);
      }
      if (plan.stretches) plan.stretches[which] = list.filter((st) => st.name);
    }
    return null;
  }

  async function saveDraft(asTemplate) {
    const problem = cleanDraft(state.draft);
    if (problem) {
      toast(problem.message);
      render();
      $(`[data-ex="${problem.exId}"] input`)?.focus();
      return;
    }
    const plan = state.draft;
    if (asTemplate) {
      Cloud.saveTemplate(structuredClone(plan)).then(
        () => toast('Saved as the starting plan for new members.'),
        (err) => toast(`Could not save the template: ${err.message}`)
      );
      return;
    }
    state.plan = plan;
    Cloud.savePlan(state.user.uid, plan).catch(() => {});
    $('#m-notes').replaceChildren(...(plan.notes || []).map((n) => h('p', { text: n })));
    toast('Plan saved.');
    closeEditor();
  }

  function field(label, input, cls = '') {
    return h('label', { class: `field ${cls}` }, label, input);
  }
  function textIn(obj, prop, attrs = {}, onchange) {
    return h('input', {
      type: 'text',
      value: obj[prop] ?? '',
      ...attrs,
      oninput: (e) => {
        obj[prop] = e.target.value;
        if (onchange) onchange(e.target.value);
      },
    });
  }
  const numIn = (obj, prop, attrs = {}) => textIn(obj, prop, { inputmode: 'decimal', autocomplete: 'off', ...attrs });
  function checkIn(label, obj, prop, rerender) {
    return h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: !!obj[prop],
        onchange: (e) => {
          obj[prop] = e.target.checked;
          if (rerender) renderEdit();
        },
      }),
      label
    );
  }

  function renderEditExercise(day, ex, i) {
    const list = day.exercises;
    const summaryName = h('span', { class: 'ed-name', text: ex.name || 'New exercise' });
    const move = (to) => {
      list.splice(i, 1);
      list.splice(to, 0, ex);
      renderEdit();
    };
    let armed = false;
    const remove = h('button', {
      type: 'button',
      class: 'ghost danger',
      text: 'Remove',
      onclick: (e) => {
        // Two taps instead of a confirm dialog. Logged history for it is kept either way.
        if (!armed) {
          armed = true;
          e.target.textContent = 'Tap again to remove';
          return;
        }
        list.splice(i, 1);
        state.openEx.delete(ex.id);
        renderEdit();
      },
    });

    const details = h(
      'details',
      { class: 'ed-ex', open: state.openEx.has(ex.id), 'data-ex': ex.id },
      h('summary', null, summaryName, h('span', { class: 'rx', text: rxText({ ...ex, sets: num(ex.sets) ?? ex.sets, target: num(ex.target) ?? ex.target }) })),
      h(
        'div',
        { class: 'ed-grid' },
        field('Name', textIn(ex, 'name', { placeholder: 'e.g. Leg press' }, (v) => (summaryName.textContent = v || 'New exercise')), 'span2'),
        field('Why (optional)', textIn(ex, 'why'), 'span2'),
        field('Sets', numIn(ex, 'sets', { inputmode: 'numeric' })),
        field('Target per set', numIn(ex, 'target')),
        field(
          'Measured in',
          h(
            'select',
            {
              onchange: (e) => {
                ex.unit = e.target.value;
                renderEdit();
              },
            },
            UNITS.map((u) => h('option', { value: u.v, text: u.label, selected: u.v === ex.unit }))
          )
        ),
        field('Rest (seconds)', numIn(ex, 'rest', { inputmode: 'numeric' })),
        h('div', { class: 'span2 ed-checks' }, checkIn('Per arm or leg', ex, 'perSide'), checkIn('Uses weight', ex, 'weighted', true)),
        ex.weighted
          ? [
              field('Start weight (lb, blank = by feel)', numIn(ex, 'weight')),
              field('Add when every set hits target (lb)', numIn(ex, 'inc')),
              field('Starting load note (optional)', textIn(ex, 'load', { placeholder: 'e.g. a weight at RPE 7' }), 'span2'),
            ]
          : null
      ),
      h(
        'div',
        { class: 'ed-row' },
        h('button', { type: 'button', class: 'ghost', text: 'Move up', disabled: i === 0, onclick: () => move(i - 1) }),
        h('button', { type: 'button', class: 'ghost', text: 'Move down', disabled: i === list.length - 1, onclick: () => move(i + 1) }),
        remove
      )
    );
    details.addEventListener('toggle', () => (details.open ? state.openEx.add(ex.id) : state.openEx.delete(ex.id)));
    return h('li', null, details);
  }

  function renderEditStretches(plan, which, label) {
    const list = plan.stretches[which];
    return h(
      'div',
      { class: 'span2 ed-stretches' },
      h('h3', { text: label }),
      h(
        'ol',
        { class: 'ed-st-list' },
        list.map((st, i) =>
          h(
            'li',
            null,
            field('Name', textIn(st, 'name'), 'span2'),
            field('Amount', numIn(st, 'target')),
            field(
              'Measured in',
              h('select', { onchange: (e) => (st.unit = e.target.value) }, [
                h('option', { value: 'reps', text: 'Reps', selected: st.unit === 'reps' }),
                h('option', { value: 'sec', text: 'Seconds', selected: st.unit === 'sec' }),
              ])
            ),
            h(
              'div',
              { class: 'span2 ed-row' },
              checkIn('Each side', st, 'perSide'),
              h('button', { type: 'button', class: 'ghost', text: 'Up', disabled: i === 0, onclick: () => { list.splice(i - 1, 0, ...list.splice(i, 1)); renderEdit(); } }),
              h('button', { type: 'button', class: 'ghost danger', text: 'Remove', onclick: () => { list.splice(i, 1); renderEdit(); } })
            )
          )
        )
      ),
      h('button', {
        type: 'button',
        class: 'ghost wide',
        text: 'Add a stretch',
        onclick: () => {
          list.push({ id: `st-${Date.now().toString(36)}`, name: '', target: 30, unit: 'sec', perSide: true });
          renderEdit();
        },
      })
    );
  }

  function renderEdit() {
    const plan = state.draft;
    plan.stretches = plan.stretches || structuredClone(stretchesOf({}));
    const day = findDay(state.dayId);
    const scrollY = window.scrollY;
    plan.warmup = plan.warmup || { name: '', minutes: '' };
    const notes = h('textarea', {
      rows: 3,
      oninput: (e) => (plan.notes = e.target.value.split('\n')),
    });
    notes.value = (plan.notes || []).join('\n');

    const fileIn = h('input', {
      type: 'file',
      accept: '.json,.js,application/json,text/javascript',
      onchange: async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        try {
          state.draft = parsePlanText(await file.text());
          state.openEx = new Set();
          toast('Plan loaded. Check it over, then save.');
          render();
        } catch (err) {
          toast(err.message || 'Could not read that file.');
        }
      },
    });

    const root = $('#view-edit');
    root.replaceChildren();
    append(root, [
      h(
        'section',
        { class: 'ed-day' },
        h('h2', { text: day.name }),
        field('Focus', textIn(day, 'focus', { placeholder: 'e.g. Lower strength' })),
        field('Warm-up note', textIn(day, 'stair', { placeholder: 'e.g. Zone 2, easy pace' })),
        field('Note shown at the top (optional)', textIn(day, 'note')),
        checkIn('Optional day', day, 'optional', true)
      ),
      h('ol', { class: 'ed-list' }, day.exercises.map((ex, i) => renderEditExercise(day, ex, i))),
      h('button', {
        type: 'button',
        class: 'ghost wide',
        text: `Add an exercise to ${day.name}`,
        onclick: () => {
          const ex = newExercise();
          day.exercises.push(ex);
          state.openEx.add(ex.id);
          renderEdit();
          root.querySelector(`[data-ex="${ex.id}"] input`)?.focus();
        },
      }),
      h(
        'section',
        { class: 'ed-all' },
        h('h2', { text: 'Every day' }),
        h(
          'div',
          { class: 'ed-grid' },
          field('Warm-up (blank hides it)', textIn(plan.warmup, 'name', { placeholder: 'e.g. StairMaster' })),
          field('Warm-up minutes', numIn(plan.warmup, 'minutes')),
          field('Notes in the menu, one per line', notes, 'span2'),
          renderEditStretches(plan, 'pre', 'Stretches before (every day)'),
          renderEditStretches(plan, 'post', 'Stretches after (every day)')
        ),
        h('label', { class: 'ghost wide file-btn' }, 'Replace the whole plan from a file', fileIn)
      ),
      h(
        'div',
        { class: 'ed-actions' },
        h('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeEditor }),
        h('button', { type: 'button', class: 'primary', text: 'Save plan', onclick: () => saveDraft(false) })
      ),
      state.admin
        ? h('button', { type: 'button', class: 'ghost wide', text: 'Also use this as the starting plan for new members', onclick: () => saveDraft(true) })
        : null,
    ]);
    window.scrollTo(0, scrollY);
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

  function exportBackup() {
    const payload = {
      kind: 'tt-training-backup',
      version: 2,
      exported: new Date().toISOString(),
      plan: state.plan,
      sessions: state.logs.sessions,
    };
    download(`training-backup-${localISO()}.json`, JSON.stringify(payload, null, 1));
    toast('Backup exported. Your logs are also saved to your account.');
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.kind !== 'tt-training-backup') throw new Error('That file is not a training backup.');
      if (!data.sessions) throw new Error('That backup is from the old password version of the app and can’t be opened here.');
      let n = 0;
      for (const [k, s] of Object.entries(data.sessions)) {
        const mine = state.logs.sessions[k];
        if (!mine || (s.updated || 0) > (mine.updated || 0)) {
          state.logs.sessions[k] = s;
          persist(k);
          n++;
        }
      }
      render();
      toast(n ? `Imported ${n} session${n === 1 ? '' : 's'}.` : 'Nothing new in that backup.');
    } catch (err) {
      toast(err.message || 'Import failed.');
    }
  }

  /* ================= sign in ================= */

  const AUTH_ERRORS = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes, or reset your password.',
    'auth/network-request-failed': 'No connection. Signing in the first time needs the internet.',
    'auth/user-disabled': 'This account has been turned off.',
  };

  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-msg').textContent = message || '';
    $('#login-btn').disabled = false;
    $('#login-btn').textContent = 'Sign in';
  }

  async function enter(user) {
    $('#login-btn').textContent = 'Loading';
    try {
      let member = null;
      try {
        member = await Cloud.membership(user.email || '');
      } catch (err) {
        if (err.code !== 'unavailable') throw err;
        member = {}; // offline: trust the cached session, the rules still guard the data
      }
      if (!member) {
        await Cloud.signOutUser({ wipe: false });
        showLogin(`${user.email} hasn’t been invited yet. Ask the owner to add you.`);
        return;
      }
      state.user = user;
      state.admin = member.admin === true;

      let plan = await Cloud.loadPlan(user.uid);
      let fresh = false;
      if (!plan) {
        plan = (await Cloud.loadTemplate()) || blankPlan();
        fresh = !plan.days.some((d) => d.exercises.length);
        Cloud.savePlan(user.uid, plan).catch(() => {});
      }
      state.logs.sessions = await Cloud.loadSessions(user.uid);
      start(plan);
      if (fresh) {
        toast('Welcome. Add your exercises to get started.');
        openEditor();
      }
    } catch (err) {
      showLogin(err.code === 'permission-denied' ? 'This account doesn’t have access. Ask the owner.' : `Could not load your plan: ${err.message}`);
    }
  }

  function start(plan) {
    state.plan = plan;
    state.view = 'train';
    const todayId = DAY_IDS[new Date().getDay()];
    state.dayId = plan.days.some((d) => d.id === todayId) ? todayId : plan.days[0].id;

    $('#m-user').textContent = `Signed in as ${state.user.email}`;
    $('#m-notes').replaceChildren(...(plan.notes || []).map((n) => h('p', { text: n })));
    $('#login').hidden = true;
    $('#app').hidden = false;
    render();
  }

  function boot() {
    if (!Cloud.configured) {
      showLogin('Firebase isn’t set up yet. Fill in firebase-config.js and upload it.');
      $('#login-btn').disabled = true;
      return;
    }
    Cloud.onSync(showSync);
    let first = true;
    Cloud.onUser((user) => {
      if (user) enter(user);
      else if (first || !state.user) showLogin();
      first = false;
    });
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Signing in';
    $('#login-msg').textContent = '';
    try {
      await Cloud.signIn($('#email').value, $('#password').value, $('#remember').checked);
      $('#password').value = '';
      // onUser takes it from here
    } catch (err) {
      showLogin(AUTH_ERRORS[err.code] || `Could not sign in: ${err.message}`);
      $('#password').select();
    }
  });

  $('#forgot').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) {
      $('#login-msg').textContent = 'Type your email above first, then tap Forgot password.';
      $('#email').focus();
      return;
    }
    try {
      await Cloud.resetPassword(email);
    } catch {
      /* same message either way, so the form doesn't reveal who has an account */
    }
    $('#login-msg').textContent = `If ${email} has an account, a reset link is on its way.`;
  });

  $('#btn-history').addEventListener('click', () => {
    state.view = state.view === 'history' ? 'train' : 'history';
    window.scrollTo(0, 0);
    render();
  });

  const menu = $('#menu');
  $('#btn-menu').addEventListener('click', () => menu.showModal());
  $('#m-close').addEventListener('click', () => menu.close());
  menu.addEventListener('click', (e) => {
    if (e.target === menu) menu.close(); // tap on backdrop
  });
  $('#m-edit').addEventListener('click', () => {
    menu.close();
    if (state.view !== 'edit') openEditor();
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
  $('#m-signout').addEventListener('click', async () => {
    await Cloud.signOutUser();
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
}
