/*
 * Background scene for Frontier Merge: now and then a thin line draws itself
 * across the back of the jar, and POSCAT crawls along it rolling the Claude star.
 * Phases: draw the line → crawl → fade the line out → wait.
 */

const INK = '#232123', FAR = '#4A4850';
const DRAW = 1.4, FADE = 0.9;   // seconds
const SPEED = 30;               // crawl speed along the line (units / s)
const STRIDE = 20;              // distance per full gait cycle, so feet don't slide
const STAR_R = 11;
const STAR_CENTER = [0.45975 * 800, 0.2465 * 615], STAR_SPAN = 310; // in star.png

export class Stroll {
  constructor({ width, top, bottom, star }) {
    this.w = width; this.top = top; this.bottom = bottom; this.star = star;
    this.wait = 5 + Math.random() * 5;
    this.scene = null;
  }

  update(dt) {
    if (!this.scene) {
      if ((this.wait -= dt) <= 0) this.scene = { phase: 'draw', t: 0, s: 0, path: this.makePath() };
      return;
    }
    const sc = this.scene;
    sc.t += dt;
    if (sc.phase === 'draw' && sc.t >= DRAW) { sc.phase = 'crawl'; sc.t = 0; }
    else if (sc.phase === 'crawl') {
      sc.s += SPEED * dt;
      if (sc.s > sc.path.length + 10) { sc.phase = 'fade'; sc.t = 0; }
    } else if (sc.phase === 'fade' && sc.t >= FADE) {
      this.scene = null;
      this.wait = 14 + Math.random() * 14;
    }
  }

  // A gentle random curve from off-canvas left to off-canvas right.
  makePath() {
    const n = 5, pts = [];
    let y = this.top + Math.random() * (this.bottom - this.top);
    for (let i = 0; i < n; i++) {
      const x = -90 + (this.w + 180) * (i / (n - 1));
      if (i) y = Math.min(this.bottom, Math.max(this.top, y + (Math.random() - 0.5) * 110));
      pts.push([x, y]);
    }
    // sample a Catmull-Rom spline into a polyline with cumulative length
    const poly = [];
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      for (let k = 0; k < 40; k++) {
        const t = k / 40, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        poly.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    poly.push(pts[n - 1]);
    const len = [0];
    for (let i = 1; i < poly.length; i++) len.push(len[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    return { poly, len, length: len[len.length - 1] };
  }

  // Position and tangent angle at arc length s (extrapolates past the ends).
  at(path, s) {
    const { poly, len } = path;
    let i = 1;
    while (i < poly.length - 1 && len[i] < s) i++;
    const [x0, y0] = poly[i - 1], [x1, y1] = poly[i];
    const seg = len[i] - len[i - 1] || 1, k = (s - len[i - 1]) / seg;
    return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, a: Math.atan2(y1 - y0, x1 - x0) };
  }

  draw(ctx) {
    const sc = this.scene;
    if (!sc) return;
    const { path } = sc;

    // the line
    const shown = sc.phase === 'draw' ? path.length * easeInOut(sc.t / DRAW) : path.length;
    const alpha = sc.phase === 'fade' ? 1 - sc.t / FADE : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(path.poly[0][0], path.poly[0][1]);
    for (let i = 1; i < path.poly.length && path.len[i] <= shown; i++) ctx.lineTo(path.poly[i][0], path.poly[i][1]);
    const tip = this.at(path, shown);
    ctx.lineTo(tip.x, tip.y);
    ctx.strokeStyle = 'rgba(124,134,230,.16)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = 'rgba(63,71,168,.55)'; ctx.lineWidth = 1.3; ctx.stroke();
    if (sc.phase === 'draw') {
      ctx.fillStyle = '#3F47A8';
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (sc.phase !== 'crawl') return;

    // the star rolls just ahead of the cat's nose
    const sStar = sc.s + 36 + STAR_R;
    const b = this.at(path, sStar);
    ctx.save();
    ctx.translate(b.x + Math.sin(b.a) * STAR_R, b.y - Math.cos(b.a) * STAR_R);
    ctx.rotate(sStar / STAR_R);
    const d = STAR_R * 2.3, [cx, cy] = STAR_CENTER;
    ctx.drawImage(this.star, cx - STAR_SPAN / 2, cy - STAR_SPAN / 2, STAR_SPAN, STAR_SPAN, -d / 2, -d / 2, d, d);
    ctx.restore();

    const c = this.at(path, sc.s);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    crawlingCat(ctx, (sc.s / STRIDE) * Math.PI * 2, sc.t);
    ctx.restore();
  }
}

const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/*
 * A low, stalking cat silhouette facing +x with its feet on y = 0.
 * phase advances one full cycle per stride; t drives the tail.
 */
function crawlingCat(ctx, phase, t) {
  const bob = Math.sin(phase * 2) * 0.7;
  const SHOULDER = [11, -11 + bob], HIP = [-15, -12 - bob * 0.5];
  // walk gait: each foot a quarter cycle apart; far legs drawn first and lighter
  const legs = [
    { at: HIP, off: 0.5, far: true, front: false },
    { at: SHOULDER, off: 0.0, far: true, front: true },
    { at: HIP, off: 0.0, far: false, front: false },
    { at: SHOULDER, off: 0.5, far: false, front: true },
  ];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const leg of legs.filter(l => l.far)) drawLeg(ctx, leg, phase);

  // tail
  const wave = Math.sin(t * 2.6) * 3;
  ctx.strokeStyle = INK; ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(-21, -14 - bob * 0.5);
  ctx.bezierCurveTo(-32, -15, -38, -22 + wave, -44, -30 + wave * 1.4);
  ctx.stroke();

  // body, low and long
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(-23, -11 - bob * 0.5);
  ctx.bezierCurveTo(-22, -21, 2, -21 + bob, 15, -17 + bob);
  ctx.bezierCurveTo(21, -14 + bob, 20, -7, 13, -6);
  ctx.bezierCurveTo(3, -4.5, -12, -4.5, -19, -6.5);
  ctx.bezierCurveTo(-24, -7.5, -25, -9, -23, -11 - bob * 0.5);
  ctx.fill();

  // head, held low and forward
  const hx = 23, hy = -12 + bob * 1.2;
  ctx.beginPath(); ctx.ellipse(hx, hy, 7.6, 6.6, 0.15, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(hx + 6, hy + 1.8, 3.8, 3, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx - 5.5, hy - 3.5); ctx.lineTo(hx - 3.5, hy - 12); ctx.lineTo(hx + 0.5, hy - 5.5);
  ctx.moveTo(hx + 0.5, hy - 5.8); ctx.lineTo(hx + 4.5, hy - 12.5); ctx.lineTo(hx + 6.5, hy - 3.8);
  ctx.fill();
  // neck joining head and shoulders
  ctx.beginPath(); ctx.ellipse(16, -12 + bob, 6, 5.5, 0.4, 0, Math.PI * 2); ctx.fill();

  for (const leg of legs.filter(l => !l.far)) drawLeg(ctx, leg, phase);
}

function drawLeg(ctx, { at, off, far, front }, phase) {
  const p = phase + off * Math.PI * 2;
  const reach = front ? 7 : 6.5, lift = 4.5;
  const foot = [at[0] + 2 + reach * Math.cos(p), -Math.max(0, -Math.sin(p)) * lift];
  // two-bone leg: the knee bends back on the front legs and forward on the hind legs
  const A = 8.2, dx = foot[0] - at[0], dy = foot[1] - at[1];
  const d = Math.min(Math.hypot(dx, dy), A * 2 - 0.01);
  const h = Math.sqrt(A * A - (d / 2) ** 2);
  const mx = at[0] + dx / 2, my = at[1] + dy / 2, nx = -dy / d, ny = dx / d;
  const side = front ? 1 : -1;
  const knee = [mx + nx * h * side, my + ny * h * side];
  ctx.strokeStyle = far ? FAR : INK;
  ctx.lineWidth = far ? 3.6 : 4.2;
  ctx.beginPath();
  ctx.moveTo(at[0], at[1]); ctx.lineTo(knee[0], knee[1]); ctx.lineTo(foot[0], foot[1]);
  ctx.stroke();
}
