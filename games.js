'use strict';

// Minigames for the rest between sets: Rally (pong), Drop (merge the balls) and React.
// Everything draws on one canvas in a fixed 360 × 600 space that is scaled to fit,
// so the games play the same on any phone. Best scores stay on this device only.
(() => {
  const W = 360;
  const H = 600;
  const STORE_KEY = 'tt.games';
  const C = {
    deep: '#0E2A4B', net: '#0B2340', table: '#1A477C', tableHi: '#22578F',
    line: '#F3F6FA', mist: '#A7BEDB', rubber: '#C8102E', black: '#15171A', ball: '#FF9F1C',
  };
  const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const store = (() => {
    let data = { last: 'rally', best: {} };
    try {
      data = { ...data, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
    } catch {
      /* storage blocked: bests just won't persist */
    }
    return {
      data,
      save() {
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(data));
        } catch {
          /* ignore */
        }
      },
    };
  })();
  const best = store.data.best;

  /* ================= drawing helpers ================= */

  function text(ctx, str, x, y, size, color = C.line, align = 'center', weight = 600) {
    ctx.font = `${weight} ${size}px ${DISPLAY}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  function ball(ctx, x, y, r, color = C.ball) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (color === C.line) {
      ctx.strokeStyle = 'rgba(14, 42, 75, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r, color) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function panel(ctx, lines) {
    ctx.fillStyle = 'rgba(11, 35, 64, 0.88)';
    ctx.fillRect(0, H / 2 - 90, W, 180);
    lines.forEach(([str, size, color], i) => text(ctx, str, W / 2, H / 2 - 50 + i * 42, size, color));
  }

  /* ================= Rally: first to 11 against the robot ================= */

  function Rally() {
    const PW = 74, PH = 12, R = 7, ME_Y = H - 44, AI_Y = 44, AI_SPEED = 260, MAX_SPEED = 760;
    let me, ai, b, score, serveIn, over, rally, aiErr, won;

    function reset() {
      me = W / 2;
      ai = W / 2;
      score = [0, 0]; // [you, robot]
      over = false;
      newPoint();
    }
    function newPoint() {
      b = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
      serveIn = 0.9;
      rally = 0;
      aiErr = (Math.random() - 0.5) * 30;
    }
    function hit(paddleX, dir, y) {
      rally++;
      const off = clamp((b.x - paddleX) / (PW / 2 + R), -1, 1);
      const speed = Math.min(MAX_SPEED, Math.hypot(b.vx, b.vy) * 1.05);
      const angle = off * 1.05;
      b.vx = Math.sin(angle) * speed;
      b.vy = dir * Math.cos(angle) * speed;
      b.y = y;
      if (dir > 0) aiErr = 0;
      else aiErr = (Math.random() - 0.5) * (24 + rally * 6); // the robot gets sloppier in long rallies
      if (navigator.vibrate && dir < 0) navigator.vibrate(12);
    }
    function point(winner) {
      score[winner]++;
      if (rally > (best.rally || 0)) best.rally = rally, store.save();
      const [a, c] = [score[winner], score[1 - winner]];
      if (a >= 11 && a - c >= 2) {
        over = true;
        won = winner === 0;
      } else newPoint();
    }

    return {
      reset,
      down(p) {
        if (over) return reset();
        me = p.x;
      },
      move(p) {
        me = p.x;
      },
      up() {},
      update(dt) {
        if (over) return;
        me = clamp(me, PW / 2, W - PW / 2);
        if (serveIn > 0) {
          serveIn -= dt;
          if (serveIn <= 0) {
            const a = (Math.random() - 0.5) * 0.9;
            b.vx = Math.sin(a) * 290;
            b.vy = Math.cos(a) * 290;
          }
        }
        const target = b.vy < 0 ? b.x + aiErr : W / 2;
        ai = clamp(ai + clamp(target - ai, -AI_SPEED * dt, AI_SPEED * dt), PW / 2, W - PW / 2);

        const py = b.y;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < R) (b.x = R), (b.vx = Math.abs(b.vx));
        if (b.x > W - R) (b.x = W - R), (b.vx = -Math.abs(b.vx));
        if (b.vy > 0 && py + R <= ME_Y && b.y + R >= ME_Y && Math.abs(b.x - me) <= PW / 2 + R) hit(me, -1, ME_Y - R);
        if (b.vy < 0 && py - R >= AI_Y && b.y - R <= AI_Y && Math.abs(b.x - ai) <= PW / 2 + R) hit(ai, 1, AI_Y + R);
        if (b.y > H + 30) point(1);
        if (b.y < -30) point(0);
      },
      draw(ctx) {
        ctx.fillStyle = C.table;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 4;
        ctx.strokeRect(10, 10, W - 20, H - 20);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(W / 2, 10);
        ctx.lineTo(W / 2, H - 10);
        ctx.stroke();
        ctx.fillStyle = C.net;
        ctx.fillRect(0, H / 2 - 4, W, 8);
        ctx.fillStyle = C.line;
        ctx.fillRect(0, H / 2 - 5, W, 2);

        text(ctx, String(score[1]), W / 2, H / 4, 96, 'rgba(243, 246, 250, 0.16)', 'center', 700);
        text(ctx, String(score[0]), W / 2, (H * 3) / 4, 96, 'rgba(243, 246, 250, 0.16)', 'center', 700);
        text(ctx, 'Robot', 20, 26, 15, C.mist, 'left', 500);
        text(ctx, 'You', 20, H - 26, 15, C.mist, 'left', 500);
        text(ctx, `Rally ${rally}  ·  Best ${best.rally || 0}`, W - 20, H - 26, 15, C.mist, 'right', 500);

        roundRect(ctx, ai - PW / 2, AI_Y - PH, PW, PH, 6, C.black);
        roundRect(ctx, me - PW / 2, ME_Y, PW, PH, 6, C.rubber);
        ball(ctx, b.x, b.y, R);

        if (over) {
          panel(ctx, [
            [won ? 'You win' : 'Robot wins', 40],
            [`${score[0]} to ${score[1]}`, 26, C.mist],
            ['Tap to play again', 22, C.ball],
          ]);
        } else if (score[0] + score[1] === 0 && serveIn > 0) {
          text(ctx, 'Drag anywhere to move', W / 2, H / 2 + 60, 22);
          text(ctx, 'First to 11', W / 2, H / 2 + 88, 18, C.mist, 'center', 500);
        }
      },
    };
  }

  /* ================= Drop: merge matching balls, don't cross the line ================= */

  function Drop() {
    const RAD = [12, 16, 21, 27, 34, 42, 51, 61, 73];
    const COL = ['#F3F6FA', '#FF9F1C', '#FFD23F', '#3BB273', '#2EC4B6', '#3A86FF', '#8338EC', '#FF5D8F', '#C8102E'];
    const PTS = [1, 3, 6, 10, 15, 21, 28, 36, 45];
    const LEFT = 14, RIGHT = W - 14, FLOOR = H - 14, DANGER = 118, DROP_Y = 72, GRAVITY = 1100;
    const START = [0, 0, 0, 1, 1, 2, 3];
    let balls, aimX, cur, next, cool, score, over, dangerT, newRecord;

    const pickStart = () => START[Math.floor(Math.random() * START.length)];

    function reset() {
      balls = [];
      aimX = W / 2;
      cur = pickStart();
      next = pickStart();
      cool = 0;
      score = 0;
      over = false;
      dangerT = 0;
      newRecord = false;
    }
    function release() {
      if (over || cool > 0) return;
      const r = RAD[cur];
      balls.push({ x: clamp(aimX, LEFT + r, RIGHT - r), y: DROP_Y, vx: 0, vy: 0, t: cur, r, age: 0 });
      cur = next;
      next = pickStart();
      cool = 0.45;
    }

    function step(h) {
      for (const b of balls) {
        b.vy += GRAVITY * h;
        b.vx *= 0.998;
        b.x += b.vx * h;
        b.y += b.vy * h;
        b.age += h;
      }
      const born = [];
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < balls.length; i++) {
          const a = balls[i];
          if (a.dead) continue;
          for (let j = i + 1; j < balls.length; j++) {
            const c = balls[j];
            if (c.dead) continue;
            const dx = c.x - a.x, dy = c.y - a.y;
            const min = a.r + c.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            if (a.t === c.t) {
              a.dead = c.dead = true;
              score += PTS[Math.min(a.t + 1, PTS.length - 1)];
              if (a.t + 1 < RAD.length) {
                const t = a.t + 1;
                born.push({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, vx: (a.vx + c.vx) / 2, vy: (a.vy + c.vy) / 2 - 60, t, r: RAD[t], age: 1, pop: 1 });
              } else score += 100; // two of the biggest clear the board a little
              if (navigator.vibrate) navigator.vibrate(15);
              break;
            }
            const d = Math.sqrt(d2) || 0.01;
            const nx = dx / d, ny = dy / d;
            const ma = a.r * a.r, mc = c.r * c.r, total = ma + mc;
            const overlap = min - d;
            a.x -= nx * overlap * (mc / total);
            a.y -= ny * overlap * (mc / total);
            c.x += nx * overlap * (ma / total);
            c.y += ny * overlap * (ma / total);
            const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
            if (rel < 0) {
              const imp = (-1.1 * rel) / (1 / ma + 1 / mc);
              a.vx -= (imp * nx) / ma;
              a.vy -= (imp * ny) / ma;
              c.vx += (imp * nx) / mc;
              c.vy += (imp * ny) / mc;
            }
          }
        }
        for (const b of balls) {
          if (b.x - b.r < LEFT) (b.x = LEFT + b.r), (b.vx = Math.abs(b.vx) * 0.2);
          if (b.x + b.r > RIGHT) (b.x = RIGHT - b.r), (b.vx = -Math.abs(b.vx) * 0.2);
          if (b.y + b.r > FLOOR) {
            b.y = FLOOR - b.r;
            if (b.vy > 0) b.vy *= -0.1;
            b.vx *= 0.97;
          }
        }
      }
      balls = balls.filter((b) => !b.dead).concat(born);
    }

    return {
      reset,
      down(p) {
        if (over) return reset();
        aimX = p.x;
      },
      move(p) {
        aimX = p.x;
      },
      up(p) {
        aimX = p.x;
        release();
      },
      update(dt) {
        if (over) return;
        cool -= dt;
        for (let i = 0; i < 6; i++) step(dt / 6);
        for (const b of balls) if (b.pop) b.pop = Math.max(0, b.pop - dt * 5);
        const high = balls.some((b) => b.age > 1.2 && b.y - b.r < DANGER);
        dangerT = high ? dangerT + dt : Math.max(0, dangerT - dt * 2);
        if (dangerT > 1.6) {
          over = true;
          if (score > (best.drop || 0)) (best.drop = score), (newRecord = true), store.save();
        }
      },
      draw(ctx) {
        ctx.fillStyle = C.table;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(LEFT - 2, DANGER - 30);
        ctx.lineTo(LEFT - 2, FLOOR + 2);
        ctx.lineTo(RIGHT + 2, FLOOR + 2);
        ctx.lineTo(RIGHT + 2, DANGER - 30);
        ctx.stroke();

        ctx.setLineDash([8, 8]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = dangerT > 0 ? `rgba(222, 35, 64, ${0.5 + 0.5 * Math.abs(Math.sin(dangerT * 10))})` : 'rgba(243, 246, 250, 0.3)';
        ctx.beginPath();
        ctx.moveTo(LEFT, DANGER);
        ctx.lineTo(RIGHT, DANGER);
        ctx.stroke();

        const r = RAD[cur];
        const x = clamp(aimX, LEFT + r, RIGHT - r);
        if (!over) {
          ctx.strokeStyle = 'rgba(243, 246, 250, 0.22)';
          ctx.beginPath();
          ctx.moveTo(x, DROP_Y + r);
          ctx.lineTo(x, FLOOR);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        for (const b of balls) ball(ctx, b.x, b.y, b.r * (1 + (b.pop || 0) * 0.15), COL[b.t]);
        if (!over) {
          ctx.globalAlpha = cool > 0 ? 0.35 : 1;
          ball(ctx, x, DROP_Y, r, COL[cur]);
          ctx.globalAlpha = 1;
        }

        text(ctx, String(score), 20, 28, 34, C.line, 'left', 700);
        text(ctx, `Best ${best.drop || 0}`, 20, 56, 15, C.mist, 'left', 500);
        text(ctx, 'Next', W - 52, 28, 15, C.mist, 'right', 500);
        ball(ctx, W - 32, 28, RAD[next], COL[next]);

        if (over) {
          panel(ctx, [
            [newRecord ? 'New best' : 'Game over', 40],
            [`Score ${score}`, 26, C.mist],
            ['Tap to play again', 22, C.ball],
          ]);
        } else if (!balls.length) {
          text(ctx, 'Drag to aim, let go to drop', W / 2, H / 2, 22);
          text(ctx, 'Two of the same color merge', W / 2, H / 2 + 30, 18, C.mist, 'center', 500);
          const lx = W / 2 - ((RAD.length - 1) * 30) / 2;
          COL.forEach((col, i) => ball(ctx, lx + i * 30, H / 2 + 80, 9, col));
        }
      },
    };
  }

  /* ================= React: tap the moment the ball appears ================= */

  function React() {
    const ROUNDS = 5;
    let phase, wait, t0, pos, times, shownFor, last, newRecord;

    function reset() {
      phase = 'idle';
      times = [];
    }
    function arm() {
      phase = 'wait';
      wait = 1 + Math.random() * 2.5;
    }
    const avg = () => Math.round(times.reduce((a, b) => a + b, 0) / times.length);

    return {
      reset,
      down() {
        const now = performance.now();
        if (phase === 'idle' || phase === 'done') {
          times = [];
          newRecord = false;
          arm();
        } else if (phase === 'wait') {
          phase = 'early';
          shownFor = 1;
          if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
        } else if (phase === 'go') {
          last = Math.round(now - t0);
          times.push(last);
          if (last < (best.reactOne || Infinity)) best.reactOne = last;
          phase = 'shown';
          shownFor = 0.9;
        }
      },
      move() {},
      up() {},
      update(dt) {
        if (phase === 'wait') {
          wait -= dt;
          if (wait <= 0) {
            phase = 'go';
            t0 = performance.now();
            pos = { x: 60 + Math.random() * (W - 120), y: 150 + Math.random() * (H - 300) };
          }
        } else if (phase === 'early' || phase === 'shown') {
          shownFor -= dt;
          if (shownFor > 0) return;
          if (times.length >= ROUNDS) {
            phase = 'done';
            const a = avg();
            if (a < (best.react || Infinity)) (best.react = a), (newRecord = true);
            store.save();
          } else arm();
        }
      },
      draw(ctx) {
        ctx.fillStyle = phase === 'go' ? C.tableHi : C.table;
        ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < ROUNDS; i++) {
          ball(ctx, W / 2 - (ROUNDS - 1) * 14 + i * 28, 36, 7, i < times.length ? C.ball : 'rgba(243, 246, 250, 0.2)');
        }
        text(ctx, `Best average ${best.react ? best.react + ' ms' : '—'}`, W / 2, H - 30, 15, C.mist, 'center', 500);

        if (phase === 'idle') {
          text(ctx, 'Tap anywhere', W / 2, H / 2 - 20, 40, C.line, 'center', 700);
          text(ctx, 'the instant the ball appears', W / 2, H / 2 + 20, 22, C.mist, 'center', 500);
          text(ctx, 'Tap to start', W / 2, H / 2 + 80, 22, C.ball);
        } else if (phase === 'wait') {
          text(ctx, 'Wait for it', W / 2, H / 2, 30, C.mist, 'center', 500);
        } else if (phase === 'go') {
          ball(ctx, pos.x, pos.y, 36);
        } else if (phase === 'early') {
          text(ctx, 'Too soon', W / 2, H / 2, 44, '#FFC6CE', 'center', 700);
        } else if (phase === 'shown') {
          text(ctx, `${last} ms`, W / 2, H / 2, 64, C.line, 'center', 700);
        } else if (phase === 'done') {
          panel(ctx, [
            [newRecord ? 'New best' : 'Average', 30, C.mist],
            [`${avg()} ms`, 48],
            ['Tap to go again', 22, C.ball],
          ]);
        }
      },
    };
  }

  /* ================= shell: overlay, canvas, loop, rest timer ================= */

  const GAMES = { rally: Rally(), drop: Drop(), react: React() };
  const root = $('#games');
  const canvas = $('#games-canvas');
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  let current = null;
  let raf = 0;
  let lastT = 0;
  let paused = false;
  let restState = 'none';

  function fit() {
    const stage = canvas.parentElement;
    const cw = stage.clientWidth;
    const ch = stage.clientHeight;
    view.dpr = window.devicePixelRatio || 1;
    view.scale = Math.min(cw / W, ch / H);
    view.ox = (cw - W * view.scale) / 2;
    view.oy = (ch - H * view.scale) / 2;
    canvas.width = Math.round(cw * view.dpr);
    canvas.height = Math.round(ch * view.dpr);
  }

  function toGame(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left - view.ox) / view.scale, y: (e.clientY - rect.top - view.oy) / view.scale };
  }

  function readRest() {
    const t = $('#timer');
    if (t.hidden) return 'none';
    return t.classList.contains('over') ? 'over' : 'running';
  }

  function updateStatus() {
    const now = readRest();
    if (restState === 'running' && now !== 'running' && !paused) {
      paused = true;
      $('#games-over').hidden = false;
    }
    restState = now;
    $('#games-rest').textContent = now === 'running' ? `Rest ${$('#timer-time').textContent}` : now === 'over' ? 'Rest is over' : 'No rest timer';
    $('#games-more').hidden = now === 'none';
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;
    if (!paused) current.update(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.deep;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);
    current.draw(ctx);
    updateStatus();
    raf = requestAnimationFrame(frame);
  }

  function choose(name) {
    if (!GAMES[name]) name = 'rally';
    store.data.last = name;
    store.save();
    current = GAMES[name];
    current.reset();
    for (const btn of root.querySelectorAll('[data-game]')) btn.setAttribute('aria-pressed', String(btn.dataset.game === name));
  }

  function open() {
    root.hidden = false;
    document.documentElement.classList.add('games-open');
    paused = false;
    $('#games-over').hidden = true;
    restState = readRest();
    fit();
    if (!current) choose(store.data.last);
    lastT = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function close() {
    cancelAnimationFrame(raf);
    root.hidden = true;
    document.documentElement.classList.remove('games-open');
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    if (!paused) current.down(toGame(e));
  });
  canvas.addEventListener('pointermove', (e) => !paused && current.move(toGame(e)));
  canvas.addEventListener('pointerup', (e) => !paused && current.up(toGame(e)));
  window.addEventListener('resize', () => !root.hidden && fit());

  for (const btn of root.querySelectorAll('[data-game]')) btn.addEventListener('click', () => choose(btn.dataset.game));
  $('#games-close').addEventListener('click', close);
  $('#games-more').addEventListener('click', () => {
    $('#timer-more').click();
    paused = false;
    $('#games-over').hidden = true;
  });
  $('#games-back').addEventListener('click', close);
  $('#games-keep').addEventListener('click', () => {
    paused = false;
    $('#games-over').hidden = true;
    lastT = performance.now();
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && !root.hidden && close());

  $('#timer-play').addEventListener('click', open);
  $('#m-games').addEventListener('click', () => {
    $('#menu').close();
    open();
  });
})();
