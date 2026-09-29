'use strict';

// Form diagrams: tiny stick figures for each phase of an exercise, plus the default
// pre and post workout stretches. A pose is a set of joint angles in degrees:
//   0 points down, 90 forward (side view) or outward (front view), 180 up, -90 back or inward.
// A limb can also be { to: [x, y], bend } to reach a point, measured from the hip (legs)
// or the base of the neck (arms). Front view mirrors x for the left side automatically.
(() => {
  const SEG = { torso: 30, neck: 3, head: 6.5, upper: 16, fore: 15, hand: 5, thigh: 23, shin: 22 };
  const FLOOR = 104;
  const W = 100;
  const H = 110;

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const dir = (a, s = 1) => [s * Math.sin(rad(a)), Math.cos(rad(a))];
  const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const angleTo = (from, to, s) => deg(Math.atan2(s * (to[0] - from[0]), to[1] - from[1]));
  const pick = (list, i, dflt) => (list ? list[i] ?? list[0] : dflt);

  function limb(root, spec, l1, l2, s, origin) {
    if (Array.isArray(spec)) {
      const m = add(root, dir(spec[0], s), l1);
      return { mid: m, end: add(m, dir(spec[1], s), l2), tip: spec[2] };
    }
    const target = [origin[0] + s * spec.to[0], origin[1] + spec.to[1]];
    const d = Math.min(Math.hypot(target[0] - root[0], target[1] - root[1]), l1 + l2 - 0.01);
    const cos = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const a1 = angleTo(root, target, s) + (spec.bend ?? 1) * deg(Math.acos(cos));
    const m = add(root, dir(a1, s), l1);
    return { mid: m, end: add(m, dir(angleTo(m, target, s), s), l2), tip: spec.tip };
  }

  function build(p, front) {
    const td = dir(p.t ?? 180);
    const J = { hip: [0, 0] };
    J.neck = add(J.hip, td, SEG.torso * (p.ts ?? 1));
    J.head = add(J.neck, dir((p.t ?? 180) + (p.nod ?? 0)), SEG.neck + SEG.head);
    const perp = [-td[1], td[0]];
    for (const i of [0, 1]) {
      const s = front && i === 1 ? -1 : 1;
      const sh = front ? add(J.neck, perp, 8.5 * s) : J.neck;
      const hp = front ? add(J.hip, perp, 5.5 * s) : J.hip;
      const as = p.as ? pick(p.as, i) : 1;
      const arm = limb(sh, pick(p.a, i, [0, 0]), SEG.upper * as, SEG.fore * as, s, J.neck);
      const leg = limb(hp, pick(p.l, i, [0, 0]), SEG.thigh * (p.fs ?? 1), SEG.shin, s, J.hip);
      Object.assign(J, { [`sh${i}`]: sh, [`el${i}`]: arm.mid, [`ha${i}`]: arm.end, [`hp${i}`]: hp, [`kn${i}`]: leg.mid, [`an${i}`]: leg.end });
      if (arm.tip != null) J[`fi${i}`] = add(arm.end, dir(arm.tip, s), SEG.hand);
      J[`to${i}`] = add(leg.end, dir(leg.tip ?? 90, s), front ? 4 : 7);
    }
    J.hm = mid(J.ha0, J.ha1);
    return J;
  }

  // Moves the figure so `pin[0]` lands on (pin[1], pin[2]); a null y rests the lowest point on the floor.
  function place(J, pin) {
    const [name, x, y] = pin;
    const low = Math.max(J.head[1] + SEG.head, ...Object.values(J).map((q) => q[1]));
    const dx = x - J[name][0];
    const dy = y == null ? FLOOR - 1.6 - low : y - J[name][1];
    for (const k of Object.keys(J)) J[k] = [J[k][0] + dx, J[k][1] + dy];
    return J;
  }

  /* ---------- drawing ---------- */

  const f = (n) => Math.round(n * 10) / 10;
  const line = (pts, cls) => `<polyline class="${cls}" points="${pts.map((q) => `${f(q[0])},${f(q[1])}`).join(' ')}"/>`;
  const at = (J, j, dx = 0, dy = 0) => [J[j][0] + dx, J[j][1] + dy];

  const PROPS = {
    rect: (J, x, y, w, h) => `<rect class="eq" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5"/>`,
    line: (J, x1, y1, x2, y2) => line([[x1, y1], [x2, y2]], 'eq-line'),
    wall: (J, x) => line([[x, 8], [x, FLOOR]], 'eq-line'),
    db(J, j, horiz = 1) {
      const [x, y] = at(J, j);
      return horiz
        ? `<rect class="db" x="${f(x - 5)}" y="${f(y - 1.2)}" width="10" height="2.4"/><rect class="db" x="${f(x - 6)}" y="${f(y - 3)}" width="2.6" height="6" rx=".8"/><rect class="db" x="${f(x + 3.4)}" y="${f(y - 3)}" width="2.6" height="6" rx=".8"/>`
        : `<rect class="db" x="${f(x - 1.2)}" y="${f(y - 5)}" width="2.4" height="10"/><rect class="db" x="${f(x - 3)}" y="${f(y - 6)}" width="6" height="2.6" rx=".8"/><rect class="db" x="${f(x - 3)}" y="${f(y + 3.4)}" width="6" height="2.6" rx=".8"/>`;
    },
    plate: (J, j, dx = 0, dy = 0, r = 7) => `<circle class="plate" cx="${f(J[j][0] + dx)}" cy="${f(J[j][1] + dy)}" r="${r}"/>`,
    ball: (J, j, r = 5.5, dx = 0, dy = 0) => `<circle class="ball" cx="${f(J[j][0] + dx)}" cy="${f(J[j][1] + dy)}" r="${r}"/>`,
    roller: (J, j, dx = 0, dy = 0, r = 4) => `<circle class="eq" cx="${f(J[j][0] + dx)}" cy="${f(J[j][1] + dy)}" r="${r}"/>`,
    pad: (J, j, dx, dy, w, h) => `<rect class="eq" x="${f(J[j][0] + dx - w / 2)}" y="${f(J[j][1] + dy - h / 2)}" width="${w}" height="${h}" rx="1.2"/>`,
    cable: (J, j, x, y) => line([J[j], [x, y]], 'cable') + `<circle class="eq" cx="${x}" cy="${y}" r="2.6"/>`,
    band: (J, j, x, y) => line([J[j], [x, y]], 'band'),
    band2: (J, j1, j2) => line([J[j1], J[j2]], 'band'),
    bar(J, j1, j2, ext = 7) {
      const [a, b] = [J[j1], J[j2]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      return line([add(a, u, -ext), add(b, u, ext)], 'bar');
    },
    barTo: (J, j, x, y, over = 5) => {
      const a = J[j];
      const len = Math.hypot(a[0] - x, a[1] - y) || 1;
      return line([[x, y], add(a, [(a[0] - x) / len, (a[1] - y) / len], over)], 'bar');
    },
    deck(J, j, angle, len) {
      const d = dir(angle);
      return line([add(J[j], d, len / 2), add(J[j], d, -len / 2)], 'eq-line thick');
    },
    orbit: (J, j, r = 5) => `<circle class="orbit" cx="${f(J[j][0])}" cy="${f(J[j][1])}" r="${r}"/>`,
  };

  function figure(J, front) {
    const near = [];
    const far = [];
    for (const i of [0, 1]) {
      const out = front || i === 0 ? near : far;
      out.push(line([J[`hp${i}`], J[`kn${i}`], J[`an${i}`], J[`to${i}`]], 'limb'));
      out.push(line(J[`fi${i}`] ? [J[`sh${i}`], J[`el${i}`], J[`ha${i}`], J[`fi${i}`]] : [J[`sh${i}`], J[`el${i}`], J[`ha${i}`]], 'limb'));
    }
    const torso = front
      ? [line([J.hp1, J.hp0], 'limb'), line([J.sh1, J.sh0], 'limb'), line([J.hip, J.neck], 'limb')]
      : [line([J.hip, J.neck], 'limb')];
    const head = `<circle class="head" cx="${f(J.head[0])}" cy="${f(J.head[1])}" r="${SEG.head}"/>`;
    return { back: `<g class="far">${far.join('')}</g>`, body: torso.join('') + line([J.neck, J.head], 'limb') + head, front: near.join('') };
  }

  function frameSVG(ex, fr) {
    const view = fr.view || ex.view || 'side';
    const front = view === 'front';
    const J = place(build(fr.p, front), fr.pin || ex.pin || ['an0', 50, null]);
    const props = [...(ex.props || []), ...(fr.props || [])];
    const draw = (list) => list.map(([type, ...args]) => PROPS[type](J, ...args)).join('');
    const statics = props.filter(([t]) => ['rect', 'line', 'wall'].includes(t));
    const attached = props.filter(([t]) => !['rect', 'line', 'wall'].includes(t));
    const fig = figure(J, front);
    return (
      `<svg viewBox="0 0 ${W} ${H}" class="fig" aria-hidden="true">` +
      `<line class="floor" x1="2" y1="${FLOOR}" x2="${W - 2}" y2="${FLOOR}"/>` +
      draw(statics) + fig.back + fig.body + fig.front + draw(attached) +
      '</svg>'
    );
  }

  /* ---------- the exercises ---------- */
  // Each entry: view, pin, props (drawn in every frame), frames [{ n: label, c: cue, p: pose, pin?, props?, view? }],
  // and r: how to return. A string entry is an alias for another exercise.

  const STAND = { t: 180 };
  const X = {
    'back-squat': {
      pin: ['an0', 58, null],
      frames: [
        { n: 'Start', c: 'Bar on your upper back, feet shoulder width, brace your core.', p: { t: 178, a: [[-40, 160]] }, props: [['plate', 'neck', -3, 1, 8]] },
        { n: 'Down', c: 'Sit hips back and down until thighs are level. Knees follow your toes, chest up.', p: { t: 138, a: [[-82, 118]], l: [[88, -22]] }, props: [['plate', 'neck', -3, 1, 8]] },
      ],
      r: 'Drive up through your whole foot to stand tall.',
    },
    'goblet-squat': {
      pin: ['an0', 58, null],
      frames: [
        { n: 'Start', c: 'Hold one dumbbell upright at your chest, elbows under it.', p: { t: 178, a: [{ to: [7, 9], bend: -1 }] }, props: [['db', 'ha0', 0]] },
        { n: 'Down', c: 'Squat between your knees, chest tall, elbows inside the knees.', p: { t: 145, a: [{ to: [8, 9], bend: -1 }], l: [[90, -22]] }, props: [['db', 'ha0', 0]] },
      ],
      r: 'Stand up through your whole foot.',
    },
    rdl: {
      pin: ['an0', 42, null],
      frames: [
        { n: 'Start', c: 'Stand tall, bar at your hips, knees soft.', p: { t: 180, l: [[3, -3]] }, props: [['plate', 'ha0', 0, 0, 8]] },
        { n: 'Hinge', c: 'Push hips back, bar slides down your thighs, back flat. Stop when hamstrings are tight.', p: { t: 104, a: [[-12, -12]], l: [[22, 0]] }, props: [['plate', 'ha0', 0, 0, 8]] },
      ],
      r: 'Squeeze your glutes to stand back up.',
    },
    'hip-abduction': {
      view: 'front',
      pin: ['hip', 50, 64],
      props: [['rect', 32, 66, 36, 5]],
      frames: [
        { n: 'Start', c: 'Sit tall against the back pad, knees together, pads on the outside of your knees.', p: { fs: 0.35, a: [[16, 0]], l: [[25, 0]] }, props: [['pad', 'kn0', 3, 0, 3, 9], ['pad', 'kn1', -3, 0, 3, 9]] },
        { n: 'Open', c: 'Push your knees out as far as you can, pause 1 s.', p: { fs: 0.35, a: [[16, 0]], l: [[82, 24]] }, props: [['pad', 'kn0', 3, 0, 3, 9], ['pad', 'kn1', -3, 0, 3, 9]] },
      ],
      r: 'Let the knees come back in slowly, without letting the weights touch.',
    },
    'hip-adduction': {
      view: 'front',
      pin: ['hip', 50, 64],
      props: [['rect', 32, 66, 36, 5]],
      frames: [
        { n: 'Start', c: 'Sit tall, knees wide, pads on the inside of your knees.', p: { fs: 0.35, a: [[16, 0]], l: [[82, 24]] }, props: [['pad', 'kn0', -3, 0, 3, 9], ['pad', 'kn1', 3, 0, 3, 9]] },
        { n: 'Squeeze', c: 'Squeeze your knees together, pause 1 s.', p: { fs: 0.35, a: [[16, 0]], l: [[25, 0]] }, props: [['pad', 'kn0', -3, 0, 3, 9], ['pad', 'kn1', 3, 0, 3, 9]] },
      ],
      r: 'Open back out slowly to a comfortable stretch.',
    },
    'standing-calf': {
      pin: ['to0', 57, 94],
      props: [['rect', 50, 94, 24, 10], ['pad', 'neck', -1, -2, 12, 4]],
      frames: [
        { n: 'Start', c: 'Balls of your feet on the edge, heels hanging low, knees soft.', p: { a: [[-18, 172]], l: [[0, 0, 118]] } },
        { n: 'Rise', c: 'Push up as high as you can onto your toes, pause at the top.', p: { a: [[-18, 172]], l: [[0, 0, 50]] } },
      ],
      r: 'Lower slowly into a full stretch.',
    },
    'dead-bug': {
      pin: ['hip', 62, null],
      frames: [
        { n: 'Start', c: 'On your back, low back pressed down, arms up, knees over hips.', p: { t: -90, a: [[180, 180]], l: [[180, 90]] } },
        { n: 'Reach', c: 'Reach one arm back and the opposite leg out, just above the floor.', p: { t: -90, a: [[-96, -96], [180, 180]], l: [[180, 90], [96, 96]] } },
      ],
      r: 'Bring them back to the start, then switch sides. Low back stays down the whole time.',
    },
    'leg-press': {
      pin: ['hip', 46, 80],
      props: [['line', 50, 84, 22, 61], ['line', 46, 84, 62, 84]],
      frames: [
        { n: 'Start', c: 'Back and hips flat on the pad, feet shoulder width on the platform.', p: { t: -128, a: [[40, 100]], l: [[152, 62]] }, props: [['deck', 'an0', 30, 28]] },
        { n: 'Press', c: 'Press until your legs are nearly straight, without locking the knees.', p: { t: -128, a: [[40, 100]], l: [[122, 120]] }, props: [['deck', 'an0', 30, 28]] },
      ],
      r: 'Lower until your knees come toward your chest, hips stay on the pad.',
    },
    'seated-leg-curl': {
      pin: ['hip', 36, 64],
      props: [['rect', 22, 66, 32, 5], ['line', 30, 66, 30, 30]],
      frames: [
        { n: 'Start', c: 'Knees lined up with the machine pivot, legs straight, thigh pad snug.', p: { a: [[25, 60]], l: [[90, 90, 180]] }, props: [['roller', 'an0', 0, 4.5, 3.5], ['pad', 'kn0', -4, -4, 10, 3]] },
        { n: 'Curl', c: 'Pull your heels down and under the seat, squeeze your hamstrings.', p: { a: [[25, 60]], l: [[90, -12, 90]] }, props: [['roller', 'an0', 4, 0, 3.5], ['pad', 'kn0', -4, -4, 10, 3]] },
      ],
      r: 'Straighten slowly, hips stay on the seat.',
    },
    'banded-lateral-walk': {
      view: 'front',
      props: [['band2', 'kn0', 'kn1']],
      frames: [
        { n: 'Start', c: 'Band around your knees, half squat, feet hip width.', p: { a: [[14, -40]], l: [[10, -6]] }, pin: ['an1', 38, null] },
        { n: 'Step', c: 'Step sideways with the lead foot, pushing the knees out.', p: { a: [[14, -40]], l: [[30, -4], [10, -6]] }, pin: ['an1', 38, null] },
        { n: 'Follow', c: 'Bring the other foot in, but keep tension on the band.', p: { a: [[14, -40]], l: [[10, -6]] }, pin: ['an0', 61, null] },
      ],
      r: 'Walk the planned steps one way, then come back the other way.',
    },
    'single-arm-row': {
      pin: ['an0', 22, null],
      props: [['rect', 14, 82, 50, 5], ['line', 18, 87, 18, 104], ['line', 60, 87, 60, 104]],
      frames: [
        { n: 'Start', c: 'Knee and hand on the bench, back flat, working arm hanging straight.', p: { t: 100, a: [[0, 0], [0, 0]], l: [[8, 0], [0, -90]] }, props: [['db', 'ha0']] },
        { n: 'Pull', c: 'Pull your elbow up toward your hip, squeeze the shoulder blade back.', p: { t: 100, a: [[-155, 8], [0, 0]], l: [[8, 0], [0, -90]] }, props: [['db', 'ha0']] },
      ],
      r: 'Lower until the arm is straight. Keep your chest square to the floor.',
    },
    'lat-pulldown': {
      view: 'front',
      pin: ['hip', 50, 70],
      props: [['rect', 34, 72, 32, 5], ['rect', 36, 63, 28, 3]],
      frames: [
        { n: 'Start', c: 'Thighs under the pad, hands a bit wider than shoulders, arms straight.', p: { fs: 0.3, l: [[20, 0]], a: [[160, 172]] }, props: [['bar', 'ha0', 'ha1'], ['cable', 'hm', 50, 3]] },
        { n: 'Pull', c: 'Pull the bar to your upper chest, driving elbows down and back.', p: { fs: 0.3, l: [[20, 0]], a: [[45, 168]] }, props: [['bar', 'ha0', 'ha1'], ['cable', 'hm', 50, 3]] },
      ],
      r: 'Let the bar rise until your arms are straight, shoulders stay down.',
    },
    'face-pull': {
      pin: ['an0', 30, null],
      frames: [
        { n: 'Start', c: 'Rope at face height, arms straight, step back until there is tension.', p: { a: [[93, 93]] }, props: [['cable', 'ha0', 94, 24]] },
        { n: 'Pull', c: 'Pull the rope toward your eyes, elbows high and wide, hands apart.', p: { as: [0.55], a: [[92, 170]] }, props: [['cable', 'ha0', 94, 24]] },
      ],
      r: 'Straighten your arms slowly.',
    },
    'lateral-raise': {
      view: 'front',
      pin: ['an0', 55.5, null],
      frames: [
        { n: 'Start', c: 'Dumbbells at your sides, slight bend in the elbows.', p: { a: [[8, 4]] }, props: [['db', 'ha0', 0], ['db', 'ha1', 0]] },
        { n: 'Raise', c: 'Raise out to the sides to shoulder height, leading with your elbows.', p: { a: [[86, 80]] }, props: [['db', 'ha0'], ['db', 'ha1']] },
      ],
      r: 'Lower over 2 to 3 s.',
    },
    'machine-lateral-raise': 'lateral-raise',
    'band-er': {
      view: 'front',
      pin: ['an0', 55.5, null],
      frames: [
        { n: 'Start', c: 'Elbow tucked at your side and bent 90°, band pulling across your body.', p: { a: [[0, -85], [0, 0]] }, props: [['band', 'ha0', 6, 46]] },
        { n: 'Rotate', c: 'Rotate the forearm out, keeping the elbow pinned to your side.', p: { a: [[0, 80], [0, 0]] }, props: [['band', 'ha0', 6, 46]] },
      ],
      r: 'Come back slowly.',
    },
    'cable-er': 'band-er',
    'seated-cable-row': {
      pin: ['hip', 28, 80],
      props: [['rect', 12, 82, 40, 5]],
      frames: [
        { n: 'Start', c: 'Sit tall, knees soft, feet on the plate, arms straight.', p: { t: 172, a: [[90, 90]], l: [[80, 100, 180]] }, props: [['cable', 'ha0', 96, 74], ['deck', 'an0', 0, 14]] },
        { n: 'Row', c: 'Pull the handle to your stomach, elbows back, squeeze your shoulder blades.', p: { t: 182, a: [[-60, 88]], l: [[80, 100, 180]] }, props: [['cable', 'ha0', 96, 74], ['deck', 'an0', 0, 14]] },
      ],
      r: 'Let your arms straighten without rounding forward.',
    },
    'seated-cable-row-light': 'seated-cable-row',
    'light-row': 'single-arm-row',
    'pull-up': {
      view: 'front',
      pin: ['hm', 50, 14],
      props: [['line', 16, 14, 84, 14]],
      frames: [
        { n: 'Hang', c: 'Hang with arms straight, hands shoulder width or a little wider.', p: { a: [[166, 174]], l: [[4, -8]] } },
        { n: 'Pull', c: 'Pull your chest toward the bar until your chin clears it.', p: { a: [[58, 178]], l: [[4, -8]] } },
      ],
      r: 'Lower all the way down with control. Use the assist machine or a band if needed.',
    },
    'rear-delt-fly': {
      frames: [
        { n: 'Hinge', c: 'Hinge forward until your chest faces the floor, knees soft, arms hanging.', p: { t: 102, l: [[18, 0]] }, props: [['db', 'ha0']], pin: ['an0', 40, null] },
        { n: 'Raise', view: 'front', c: 'Seen from the front: raise the dumbbells out to the sides, squeeze the back of your shoulders.', p: { ts: 0.4, nod: 0, a: [[84, 86]], l: [[10, -6]] }, props: [['db', 'ha0'], ['db', 'ha1']], pin: ['an0', 58, null] },
      ],
      r: 'Lower slowly. Keep the hinge the whole set.',
    },
    'med-ball-throw': {
      view: 'front',
      pin: ['an0', 66, null],
      frames: [
        { n: 'Load', c: 'Stand side-on to a wall, ball at your back hip, weight on the back leg.', p: { t: 176, a: [{ to: [18, 30], bend: 1 }, { to: [-18, 30], bend: -1 }], l: [[16, -2]] }, props: [['ball', 'hm', 6]] },
        { n: 'Throw', c: 'Drive the back hip through and whip the ball into the wall, arms following.', p: { t: 184, a: [{ to: [-24, 2], bend: -1 }, { to: [24, 2], bend: 1 }], l: [[16, -2]] }, props: [['ball', 'hm', 6, -6, -2]] },
      ],
      r: 'Catch it, reset and repeat. Switch sides.',
    },
    'cable-rotation-fast': {
      view: 'front',
      pin: ['an0', 66, null],
      frames: [
        { n: 'Load', c: 'Side-on to a chest height cable, arms long, turned toward the machine.', p: { t: 176, a: [{ to: [22, 12], bend: 1 }, { to: [-22, 12], bend: -1 }], l: [[16, -2]] }, props: [['cable', 'hm', 97, 44]] },
        { n: 'Rotate', c: 'Turn hard from your hips and trunk, arms long, hands finish past your far hip.', p: { t: 184, a: [{ to: [-22, 14], bend: -1 }, { to: [22, 14], bend: 1 }], l: [[16, -2]] }, props: [['cable', 'hm', 97, 44]] },
      ],
      r: 'Come back under control, then go fast again.',
    },
    woodchop: {
      view: 'front',
      pin: ['an0', 64, null],
      frames: [
        { n: 'Start', c: 'Cable set high, arms long, reaching up across your body.', p: { a: [{ to: [20, -14], bend: -1 }, { to: [-20, -14], bend: 1 }], l: [[16, -2]] }, props: [['cable', 'hm', 96, 6]] },
        { n: 'Chop', c: 'Pull down and across to the opposite knee, turning from the hips and trunk.', p: { a: [{ to: [-16, 42], bend: 1 }, { to: [16, 42], bend: -1 }], l: [[16, -2]] }, props: [['cable', 'hm', 96, 6]] },
      ],
      r: 'Let it rise back slowly, don’t let it pull you.',
    },
    'db-woodchop': {
      view: 'front',
      pin: ['an0', 64, null],
      frames: [
        { n: 'Start', c: 'One dumbbell in both hands, reach it up over one shoulder.', p: { a: [{ to: [18, -16], bend: -1 }, { to: [-18, -16], bend: 1 }], l: [[16, -2]] }, props: [['db', 'hm']] },
        { n: 'Chop', c: 'Chop down and across to the outside of the opposite knee.', p: { a: [{ to: [-16, 42], bend: 1 }, { to: [16, 42], bend: -1 }], l: [[16, -2]] }, props: [['db', 'hm']] },
      ],
      r: 'Lift it back up with control.',
    },
    'pallof-press': {
      pin: ['an0', 48, null],
      frames: [
        { n: 'Start', c: 'Stand side-on to a chest height cable, handle at your chest.', p: { a: [{ to: [9, 16], bend: -1 }] }, props: [['pad', 'ha0', 1, 0, 3, 6]] },
        { n: 'Press', c: 'Press straight out and hold 2 s. Don’t let it twist you.', p: { a: [[90, 90]] }, props: [['pad', 'ha0', 1, 0, 3, 6]] },
      ],
      r: 'Bring it back to your chest with control.',
    },
    'band-pallof-press': 'pallof-press',
    'box-step-over': {
      view: 'front',
      props: [['rect', 36, 84, 28, 20]],
      frames: [
        { n: 'Start', c: 'Stand beside a low box, lead foot up on top.', p: { l: [[0, 0], { to: [12, 23], bend: 1 }], a: [[14, -20]] }, pin: ['an0', 76, null] },
        { n: 'Up', c: 'Drive through the lead foot to stand on the box.', p: { a: [[14, -20]] }, pin: ['an0', 55.5, 82.4] },
        { n: 'Over', c: 'Step down on the far side, trail foot stays on the box.', p: { l: [{ to: [12, 23], bend: 1 }, [0, 0]], a: [[14, -20]] }, pin: ['an1', 24, null] },
      ],
      r: 'Step back up and over the other way.',
    },
    'side-plank': {
      view: 'front',
      pin: ['el1', 14, null],
      frames: [
        { n: 'Start', c: 'On your side, elbow under your shoulder, feet stacked.', p: { t: -108, a: [[180, 180], [0, 90]], l: [[88, 88], [-88, -88]] } },
        { n: 'Lift', c: 'Lift your hips into a straight line from head to feet. Hold.', p: { t: -102, a: [[180, 180], [0, 90]], l: [[78, 78], [-78, -78]] } },
      ],
      r: 'Lower with control, then switch sides.',
    },
    'copenhagen-plank': {
      view: 'front',
      pin: ['el1', 20, null],
      props: [['rect', 72, 72, 24, 32]],
      frames: [
        { n: 'Set up', c: 'Side plank position, top leg on the bench, bottom leg underneath.', p: { t: -96, a: [[180, 180], [0, 90]], l: [[94, 94], [-40, -10]] } },
        { n: 'Lift', c: 'Press through the top leg to lift your hips, bottom leg rises to meet the bench. Hold.', p: { t: -82, a: [[180, 180], [0, 90]], l: [[100, 100], [-100, -100]] } },
      ],
      r: 'Lower slowly. Shorten it by putting the knee on the bench instead of the foot.',
    },
    'bulgarian-split-squat': {
      pin: ['an0', 66, null],
      props: [['rect', 4, 78, 28, 5], ['line', 8, 83, 8, 104], ['line', 28, 83, 28, 104]],
      frames: [
        { n: 'Start', c: 'Rear foot laces-down on the bench, front foot well forward, dumbbells at your sides.', p: { a: [[2, 0]], l: [[10, -4], { to: [-34, 15], bend: 1, tip: -95 }] }, props: [['db', 'ha0']] },
        { n: 'Down', c: 'Lower straight down until the front thigh is level. Front knee over the foot.', p: { a: [[2, 0]], l: [[78, -10], { to: [-19, 2], bend: 1, tip: -95 }] }, props: [['db', 'ha0']] },
      ],
      r: 'Drive up through the front heel. Finish all reps, then switch legs.',
    },
    'single-leg-press': 'leg-press',
    'lateral-lunge': {
      view: 'front',
      frames: [
        { n: 'Start', c: 'Feet about twice shoulder width, toes forward, hands on your hips or a dumbbell at your chest.', p: { a: [[18, -20]], l: [[17, 17]] }, pin: ['an0', 67, null] },
        { n: 'Lunge', c: 'Sit your hips back and over one foot, that knee bends, the other leg stays straight.', p: { a: [[18, -20]], l: [{ to: [11, 30], bend: 1 }, { to: [25, 30], bend: -1 }] }, pin: ['hip', 57, 73] },
      ],
      r: 'Push off the bent leg back to the middle, then switch sides.',
    },
    'single-leg-rdl': {
      pin: ['an0', 42, null],
      frames: [
        { n: 'Start', c: 'Stand on one leg, knee soft, dumbbell in the opposite hand.', p: { l: [[3, -3], [2, -12]] }, props: [['db', 'ha0']] },
        { n: 'Hinge', c: 'Tip forward as the free leg reaches back, hips square, back flat.', p: { t: 96, l: [[14, -2], [-84, -84, -175]] }, props: [['db', 'ha0']] },
      ],
      r: 'Squeeze the glute of the standing leg to come back up.',
    },
    'cable-single-leg-rdl': 'single-leg-rdl',
    'seated-calf': {
      pin: ['to0', 68, 90],
      props: [['rect', 62, 90, 14, 14]],
      frames: [
        { n: 'Start', c: 'Balls of your feet on the block, pad on your lower thighs, heels low.', p: { a: [{ to: [22, 24], bend: -1 }], l: [[90, -4, 118]] }, props: [['pad', 'kn0', -3, -4, 12, 4], ['pad', 'hip', 2, 4, 22, 4]] },
        { n: 'Rise', c: 'Push up through the balls of your feet as high as you can, pause.', p: { a: [{ to: [22, 24], bend: -1 }], l: [[90, -4, 50]] }, props: [['pad', 'kn0', -3, -4, 12, 4], ['pad', 'hip', 2, 4, 22, 4]] },
      ],
      r: 'Lower slowly into a deep stretch.',
    },
    'seated-db-calf': 'seated-calf',
    'db-calf-raise': 'standing-calf',
    'db-bench': {
      pin: ['hip', 58, 66],
      props: [['rect', 14, 69, 52, 5], ['line', 20, 74, 20, 104], ['line', 60, 74, 60, 104]],
      frames: [
        { n: 'Start', c: 'Lie on the bench, feet flat, dumbbells over your chest, arms straight.', p: { t: -90, a: [[180, 180]], l: [{ to: [24, 36], bend: 1 }] }, props: [['db', 'ha0']] },
        { n: 'Lower', c: 'Lower until your elbows are just below the bench, about 45° from your body.', p: { t: -90, a: [[28, 180]], l: [{ to: [24, 36], bend: 1 }] }, props: [['db', 'ha0']] },
      ],
      r: 'Press back up over your chest.',
    },
    'chest-press-machine': {
      pin: ['hip', 34, 68],
      props: [['rect', 22, 70, 30, 5], ['line', 29, 70, 29, 32]],
      frames: [
        { n: 'Start', c: 'Seat set so the handles are at mid-chest, back on the pad.', p: { a: [{ to: [13, 9], bend: -1 }], l: [[90, 0]] }, props: [['pad', 'ha0', 1, 0, 3, 7]] },
        { n: 'Press', c: 'Press forward until your arms are nearly straight.', p: { a: [[88, 88]], l: [[90, 0]] }, props: [['pad', 'ha0', 1, 0, 3, 7]] },
      ],
      r: 'Let the handles come back slowly to chest level.',
    },
    'shoulder-press-neutral': {
      pin: ['hip', 40, 70],
      props: [['rect', 28, 72, 30, 5], ['line', 35, 72, 35, 26]],
      frames: [
        { n: 'Start', c: 'Back on the pad, handles at shoulder height, elbows under your hands.', p: { a: [{ to: [9, 1], bend: -1 }], l: [[90, 0]] }, props: [['pad', 'ha0', 0, 0, 3, 7]] },
        { n: 'Press', c: 'Press straight up until your arms are nearly straight.', p: { a: [[174, 176]], l: [[90, 0]] }, props: [['pad', 'ha0', 0, 0, 3, 7]] },
      ],
      r: 'Lower for 2 s back to shoulder height.',
    },
    'shoulder-press-wide': 'shoulder-press-neutral',
    'db-shoulder-press': {
      view: 'front',
      pin: ['an0', 55.5, null],
      frames: [
        { n: 'Start', c: 'Dumbbells at shoulder height, elbows under your wrists.', p: { a: [[72, 176]] }, props: [['db', 'ha0'], ['db', 'ha1']] },
        { n: 'Press', c: 'Press up until your arms are straight, without arching your back.', p: { a: [[164, 178]] }, props: [['db', 'ha0'], ['db', 'ha1']] },
      ],
      r: 'Lower for 2 s back to your shoulders.',
    },
    'db-shoulder-press-neutral': 'db-shoulder-press',
    'landmine-press': {
      pin: ['kn0', 42, null],
      frames: [
        { n: 'Start', c: 'Half kneeling, bar end at your shoulder on the same side as the down knee.', p: { a: [{ to: [6, 1], bend: -1 }], l: [[-4, -90], [90, 0]] }, props: [['barTo', 'ha0', 98, 102], ['plate', 'ha0', 3, -3, 5]] },
        { n: 'Press', c: 'Press up and forward until the arm is long. Ribs down, no leaning back.', p: { a: [[142, 142]], l: [[-4, -90], [90, 0]] }, props: [['barTo', 'ha0', 98, 102], ['plate', 'ha0', 3, -3, 5]] },
      ],
      r: 'Lower the bar back to your shoulder.',
    },
    'cable-press-kneeling': 'landmine-press',
    'bicep-curl': {
      pin: ['an0', 50, null],
      frames: [
        { n: 'Start', c: 'Stand tall, dumbbells at your sides, palms forward.', p: { a: [[0, 0]] }, props: [['db', 'ha0']] },
        { n: 'Curl', c: 'Curl up without moving your elbows forward.', p: { a: [[4, 168]] }, props: [['db', 'ha0']] },
      ],
      r: 'Lower over 3 s until the arm is straight.',
    },
    'cable-curl': 'bicep-curl',
    'wrist-curl': {
      pin: ['hip', 32, 70],
      props: [['rect', 18, 72, 30, 5]],
      frames: [
        { n: 'Start', c: 'Forearms on your thighs, palms up, wrists just past the knees. Let the weight roll down.', p: { t: 164, a: [{ to: [26, 28], bend: -1, tip: 40 }], l: [[90, 0]] }, props: [['db', 'fi0', 0]] },
        { n: 'Curl', c: 'Curl the wrist up as far as it goes, forearm stays on your leg.', p: { t: 164, a: [{ to: [26, 28], bend: -1, tip: 150 }], l: [[90, 0]] }, props: [['db', 'fi0', 0]] },
      ],
      r: 'Lower slowly.',
    },
    'reverse-wrist-curl': {
      pin: ['hip', 32, 70],
      props: [['rect', 18, 72, 30, 5]],
      frames: [
        { n: 'Start', c: 'Forearms on your thighs, palms down, wrists just past the knees.', p: { t: 164, a: [{ to: [26, 28], bend: -1, tip: 30 }], l: [[90, 0]] }, props: [['db', 'fi0', 0]] },
        { n: 'Lift', c: 'Lift the back of your hand up, forearm stays down.', p: { t: 164, a: [{ to: [26, 28], bend: -1, tip: 130 }], l: [[90, 0]] }, props: [['db', 'fi0', 0]] },
      ],
      r: 'Lower slowly. Use a light weight.',
    },
    'cable-wrist-curl': 'wrist-curl',
    'cable-reverse-wrist-curl': 'reverse-wrist-curl',
    'farmer-carry': {
      pin: ['hip', 50, null],
      frames: [
        { n: 'Pick up', c: 'Heavy dumbbells at your sides, stand tall, shoulders back.', p: { a: [[0, 0]] }, props: [['db', 'ha0']] },
        { n: 'Walk', c: 'Walk with short, steady steps. Don’t lean or let the weights swing.', p: { a: [[4, 4], [-4, -4]], l: [[18, 4], [-14, -26]] }, props: [['db', 'ha0']] },
      ],
      r: 'Set the weights down with a flat back.',
    },
    'footwork-drills': {
      view: 'front',
      frames: [
        { n: 'Ready', c: 'Low ready stance like at the table, weight on the balls of your feet.', p: { t: 180, a: [{ to: [10, 16], bend: 1 }], l: [{ to: [15, 40], bend: 1 }] }, pin: ['hip', 42, null] },
        { n: 'Shuffle', c: 'Push off the far foot and shuffle sideways. Feet never cross, stay low.', p: { t: 180, a: [{ to: [10, 16], bend: 1 }], l: [{ to: [24, 40], bend: 1 }, { to: [6, 40], bend: 1 }] }, pin: ['hip', 58, null] },
      ],
      r: 'Shuffle back the other way. Quick feet, quiet landings.',
    },
    'lateral-bounds': {
      view: 'front',
      frames: [
        { n: 'Load', c: 'Balance on your outside leg, knee bent, hips back.', p: { a: [[30, 50]], l: [{ to: [4, 38], bend: 1 }, [8, 40]] }, pin: ['an0', 72, null] },
        { n: 'Jump', c: 'Jump sideways off that leg as far as you can.', p: { a: [[60, 80], [20, 20]], l: [[38, 38], [30, 20]] }, pin: ['hip', 50, 50] },
        { n: 'Land', c: 'Land softly on the other leg and hold 1 s.', p: { a: [[50, 20]], l: [[8, 40], { to: [4, 38], bend: 1 }] }, pin: ['an1', 28, null] },
      ],
      r: 'Bound back the other way.',
    },
    'leg-press-light': 'leg-press',
    'hip-9090': {
      view: 'front',
      pin: ['hip', 50, 50],
      frames: [
        { n: 'From above', c: 'Seen from above: front leg bent 90° in front, back leg bent 90° to the side. Sit tall.', p: { ts: 0.45, a: [[40, 20]], l: [[40, -90], [135, -135]] } },
        { n: 'Switch', c: 'Keep your feet down and turn both knees to the other side, then turn your chest over the front shin.', p: { ts: 0.45, a: [[40, 20]], l: [[135, -135], [40, -90]] } },
      ],
      r: 'Move slowly side to side, then hold a few breaths on each side.',
    },
    'shoulder-stretch': 'doorway-pec',
    'foam-roll': {
      frames: [
        { n: 'Calves', c: 'Sit with the roller under your calves, hands behind you, lift your hips and roll slowly.', p: { t: -150, a: [[-20, -20]], l: [[90, 90, 180]] }, pin: ['hip', 34, 88], props: [['roller', 'an0', -8, 6, 5]] },
        { n: 'Quads', c: 'Face down on your forearms, roller under your thighs, roll hip to knee.', p: { t: 98, a: [[-10, 90]], l: [[-85, -88]] }, pin: ['el0', 74, 102], props: [['roller', 'hip', -12, 7, 5]] },
      ],
      r: 'Pause on tight spots for a few breaths. Avoid rolling right over joints.',
    },

    /* stretches */
    'leg-swing-front': {
      pin: ['an1', 46, null],
      props: [['wall', 24]],
      frames: [
        { n: 'Forward', c: 'Hand on a wall, swing the outside leg forward, relaxed.', p: { a: [[0, 0], { to: [-22, 4], bend: 1 }], l: [[70, 70], [0, 0]] } },
        { n: 'Back', c: 'Let it swing back behind you. Stay tall.', p: { a: [[0, 0], { to: [-22, 4], bend: 1 }], l: [[-35, -40], [0, 0]] } },
      ],
      r: 'Swing a little higher each time, then switch legs.',
    },
    'leg-swing-side': {
      view: 'front',
      pin: ['an1', 44, null],
      frames: [
        { n: 'Out', c: 'Hands on a wall in front of you, swing one leg out to the side.', p: { a: [[40, 150]], l: [[42, 42], [0, 0]] } },
        { n: 'Across', c: 'Swing it back across in front of the standing leg.', p: { a: [[40, 150]], l: [[-22, -22], [0, 0]] } },
      ],
      r: 'Keep the hips facing the wall, then switch legs.',
    },
    'worlds-greatest': {
      pin: ['an0', 72, null],
      frames: [
        { n: 'Lunge', c: 'Big step forward into a lunge, both hands on the floor inside the front foot.', p: { t: 128, a: [[10, 10]], l: [[78, -6], [-52, -60, -150]] } },
        { n: 'Elbow', c: 'Drop the inside elbow down toward the front ankle.', p: { t: 118, a: [[20, 0], [10, 10]], l: [[78, -6], [-52, -60, -150]] } },
        { n: 'Reach', c: 'Rotate and reach that arm up to the ceiling, eyes follow the hand.', p: { t: 128, a: [[178, 178], [10, 10]], l: [[78, -6], [-52, -60, -150]] } },
      ],
      r: 'Step back, then switch sides.',
    },
    inchworm: {
      frames: [
        { n: 'Fold', c: 'Stand, hinge down and put your hands on the floor, knees as straight as comfortable.', p: { t: 18, a: [[20, 20]], l: [[4, -4]] }, pin: ['an0', 34, null] },
        { n: 'Walk out', c: 'Walk your hands out to a plank, hands under shoulders.', p: { t: 113, a: [[0, 0]], l: [[-67, -67, 0]] }, pin: ['ha0', 72, null] },
        { n: 'Walk in', c: 'Walk your feet in toward your hands, then stand up.', p: { t: 30, a: [[8, 8]], l: [[-6, -6]] }, pin: ['ha0', 72, null] },
      ],
      r: 'Keep the movement slow and controlled.',
    },
    'arm-circles': {
      view: 'front',
      pin: ['an0', 55.5, null],
      frames: [
        { n: 'Small', c: 'Arms straight out to the sides, small circles forward.', p: { a: [[90, 90]] }, props: [['orbit', 'ha0', 4], ['orbit', 'ha1', 4]] },
        { n: 'Big', c: 'Make the circles bigger, then reverse direction.', p: { a: [[110, 110]] }, props: [['orbit', 'ha0', 8], ['orbit', 'ha1', 8]] },
      ],
      r: 'Relaxed shoulders, no shrugging.',
    },
    'wrist-circles': {
      pin: ['an0', 40, null],
      frames: [{ n: 'Circle', c: 'Arms in front, fists loose, circle the wrists both directions.', p: { a: [[70, 90, 90]] }, props: [['orbit', 'fi0', 4]] }],
      r: 'Open and close your hands a few times too.',
    },
    'hamstring-stretch': {
      pin: ['an1', 30, null],
      props: [['rect', 52, 90, 22, 14]],
      frames: [
        { n: 'Hold', c: 'Heel on a low step, leg straight, toes up. Hinge forward with a flat back until you feel the stretch.', p: { t: 125, a: [[70, 70]], l: [{ to: [40, 26], bend: 1, tip: 170 }, [3, -3]] } },
      ],
      r: 'Breathe and hold, then switch legs.',
    },
    'hip-flexor-stretch': {
      pin: ['kn0', 34, null],
      frames: [
        { n: 'Set up', c: 'Half kneeling, back knee under the hip.', p: { a: [[-20, 80]], l: [[0, -90], [90, 0]] } },
        { n: 'Hold', c: 'Squeeze the back glute and shift your hips forward until the front of the hip stretches.', p: { a: [[-20, 80]], l: [[-22, -90], [70, -8]] } },
      ],
      r: 'Keep the ribs down, then switch sides.',
    },
    'figure-four': {
      pin: ['hip', 56, null],
      frames: [
        { n: 'Hold', c: 'On your back, cross one ankle over the other knee. Pull the bottom thigh toward you.', p: { t: -90, a: [{ to: [36, -10], bend: -1 }], l: [{ to: [14, -21], bend: -1, tip: 150 }, [150, 30]] } },
      ],
      r: 'Hold, then switch legs.',
    },
    'calf-stretch': {
      pin: ['an1', 22, null],
      props: [['wall', 84]],
      frames: [
        { n: 'Hold', c: 'Hands on a wall, back leg straight with the heel down, lean in.', p: { t: 152, a: [[98, 98]], l: [[40, -8], [-32, -32]] } },
      ],
      r: 'Hold, then bend the back knee a little for a lower calf stretch. Switch legs.',
    },
    'doorway-pec': {
      pin: ['an0', 58, null],
      props: [['wall', 32]],
      frames: [
        { n: 'Hold', c: 'Forearm on the door frame at shoulder height, step through until the chest stretches.', p: { t: 176, a: [[-92, 180], [0, 0]], l: [[22, -4], [-12, -12]] } },
      ],
      r: 'Hold, then switch arms.',
    },
    'cross-body-shoulder': {
      view: 'front',
      pin: ['an0', 55.5, null],
      frames: [
        { n: 'Hold', c: 'Bring one arm across your chest and hug it in with the other hand above the elbow.', p: { a: [[-84, -88], { to: [-2, 14], bend: -1 }] } },
      ],
      r: 'Keep the shoulder down, then switch arms.',
    },
    'childs-pose': {
      pin: ['kn0', 36, null],
      frames: [
        { n: 'Hold', c: 'Knees down, sit back toward your heels, reach your arms forward on the floor.', p: { t: 80, a: [[96, 94]], l: [[62, -90]] } },
      ],
      r: 'Breathe into your back. Walk the hands to one side for a lat stretch.',
    },
    'wrist-flexor': {
      pin: ['an0', 40, null],
      frames: [
        { n: 'Palm out', c: 'Arm straight, palm facing away, gently pull the fingers back.', p: { a: [[88, 88, 175], { to: [30, 2], bend: -1 }] } },
        { n: 'Palm in', c: 'Flip it: fingers down, gently press the back of the hand toward you.', p: { a: [[88, 88, 5], { to: [30, 10], bend: -1 }] } },
      ],
      r: 'Hold each side, then switch arms.',
    },
  };

  const STRETCHES = {
    pre: [
      { id: 'leg-swing-front', name: 'Leg swings, front to back', target: 10, unit: 'reps', perSide: true },
      { id: 'leg-swing-side', name: 'Leg swings, side to side', target: 10, unit: 'reps', perSide: true },
      { id: 'worlds-greatest', name: 'World’s greatest stretch', target: 5, unit: 'reps', perSide: true },
      { id: 'inchworm', name: 'Inchworm', target: 5, unit: 'reps', perSide: false },
      { id: 'arm-circles', name: 'Arm circles, both directions', target: 10, unit: 'reps', perSide: false },
      { id: 'wrist-circles', name: 'Wrist circles, both directions', target: 10, unit: 'reps', perSide: false },
    ],
    post: [
      { id: 'hamstring-stretch', name: 'Hamstring stretch', target: 30, unit: 'sec', perSide: true },
      { id: 'hip-flexor-stretch', name: 'Half kneeling hip flexor stretch', target: 30, unit: 'sec', perSide: true },
      { id: 'figure-four', name: 'Figure 4 glute stretch', target: 30, unit: 'sec', perSide: true },
      { id: 'calf-stretch', name: 'Wall calf stretch', target: 30, unit: 'sec', perSide: true },
      { id: 'doorway-pec', name: 'Doorway chest stretch', target: 30, unit: 'sec', perSide: true },
      { id: 'cross-body-shoulder', name: 'Cross body shoulder stretch', target: 30, unit: 'sec', perSide: true },
      { id: 'childs-pose', name: 'Child’s pose', target: 30, unit: 'sec', perSide: false },
      { id: 'wrist-flexor', name: 'Forearm stretch', target: 20, unit: 'sec', perSide: true },
    ],
  };

  function resolve(id) {
    let entry = X[id];
    for (let hops = 0; typeof entry === 'string' && hops < 3; hops++) entry = X[entry];
    return entry && typeof entry === 'object' ? entry : null;
  }

  // Returns { frames: [{ label, cue, svg }], ret } or null when there is no diagram.
  function get(id) {
    const ex = resolve(id);
    if (!ex) return null;
    return { frames: ex.frames.map((fr) => ({ label: fr.n, cue: fr.c, svg: frameSVG(ex, fr) })), ret: ex.r };
  }

  window.Forms = { has: (id) => !!resolve(id), get, stretches: STRETCHES, ids: () => Object.keys(X) };
})();
