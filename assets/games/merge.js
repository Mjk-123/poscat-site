/*
 * Frontier Merge — drop AI labs into the jar; two of a kind merge into the next tier.
 * Two OpenAIs make the POSCAT cat, which wins the round.
 */
import { Game, loadImage, loadScript } from './engine.js';
import { Stroll } from './merge/stroll.js';

const MATTER = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js';
const logo = f => new URL(`./merge/logos/${f}`, import.meta.url).href;

// Smallest to largest. r is the radius in logical units. The jar is 316 wide, so
// two OpenAIs (2 × 160) can't sit side by side and always end up touching.
const TIERS = [
  { name: 'DeepSeek',   src: logo('deepseek-color.svg'),   r: 16, fill: '#FFFFFF', ring: '#4D6BFE', size: .70 },
  { name: 'Perplexity', src: logo('perplexity-color.svg'), r: 22, fill: '#FFFFFF', ring: '#22B8CD', size: .62 },
  { name: 'Mistral',    src: logo('mistral-color.svg'),    r: 29, fill: '#FFFFFF', ring: '#FA520F', size: .60 },
  { name: 'xAI',        src: logo('xai.svg'),              r: 37, fill: '#141414', ring: '#141414', size: .56, tint: '#FFFFFF' },
  { name: 'Meta',       src: logo('meta-color.svg'),       r: 46, fill: '#FFFFFF', ring: '#0668E1', size: .66 },
  { name: 'Google',     src: logo('google-color.svg'),     r: 56, fill: '#FFFFFF', ring: 'google', size: .56 },
  { name: 'NVIDIA',     src: logo('nvidia-color.svg'),     r: 61, fill: '#FFFFFF', ring: '#76B900', size: .62 },
  { name: 'Anthropic',  src: logo('anthropic.svg'),        r: 67, fill: '#D97757', ring: '#C0623F', size: .52, tint: '#141413' },
  { name: 'OpenAI',     src: logo('openai.svg'),           r: 80, fill: '#FFFFFF', ring: '#10A37F', size: .58, tint: '#0D0D0D' },
  { name: 'POSCAT',     src: new URL('../poscat.png', import.meta.url).href, r: 92, fill: '#F6F7FB', ring: '#7C86E6', size: .78 },
];
const CAT = TIERS.length - 1;
const POINTS = [0, 1, 3, 6, 10, 15, 21, 25, 30, 40, 60]; // awarded for creating tier i
const DROPPABLE = [0, 1, 2, 3];
const WEIGHTS = [35, 30, 20, 15]; // higher tiers fall a little less often

const W = 360, H = 640;
const L = 22, R = 338, RIM = 124, FLOOR = 592;
const DROP_Y = 72;
const COOLDOWN = 0.5;
const GRACE = 1.2;     // seconds a new ball may sit above the rim
const OVER_AFTER = 2;  // seconds above the rim before game over
const SPRITE = 3;      // sprite resolution per logical unit
const COMBO_WINDOW = 1.1; // seconds between merges that still count as one chain
const SHAKE_FROM = 6;     // creating NVIDIA or higher shakes the jar
const CRACK = 0.8, JUMP = 0.95, LAND = 0.9; // cat break-out phases (seconds)
const PERCH = 92;         // width of the cat once it sits on the rim
const STAR = new URL('../star.png', import.meta.url).href;
const STROLL = false;     // background cat crawling along a line (merge/stroll.js); off for now
const still = matchMedia('(prefers-reduced-motion: reduce)');

const ease = t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2; // ease-out-back

export default class FrontierMerge extends Game {
  static meta = {
    id: 'merge',
    title: 'Frontier Merge',
    width: W,
    height: H,
    howto: 'Aim above the jar and release to drop. Two of the same lab merge into the next one. Merge two OpenAIs to make the POSCAT cat.',
  };

  async preload() {
    await loadScript(MATTER);
    this.M = window.Matter;
    const imgs = await Promise.all(TIERS.map(t => (t.tint ? tinted(t.src, t.tint) : svgOrImage(t.src))));
    this.sprites = TIERS.map((t, i) => sprite(t, imgs[i]));
    this.catImg = imgs[CAT];
    this.starImg = await loadImage(STAR);
  }

  start() {
    const { Engine, Bodies, Composite, Events } = this.M;
    if (this.engine) Engine.clear(this.engine);
    this.engine = Engine.create({ gravity: { y: 1.15 } });
    this.engine.positionIterations = 10;
    const wall = { isStatic: true, friction: 0.02, frictionStatic: 0.02, restitution: 0.15 };
    Composite.add(this.engine.world, [
      Bodies.rectangle((L + R) / 2, FLOOR + 50, R - L + 200, 100, wall),
      Bodies.rectangle(L - 50, (RIM + FLOOR) / 2 - 200, 100, FLOOR - RIM + 600, wall),
      Bodies.rectangle(R + 50, (RIM + FLOOR) / 2 - 200, 100, FLOOR - RIM + 600, wall),
    ]);
    this.balls = new Set();
    this.merges = [];
    const collect = e => {
      for (const { bodyA: a, bodyB: b } of e.pairs) {
        if (a.tier == null || a.tier !== b.tier || a.tier >= CAT || a.merging || b.merging) continue;
        a.merging = b.merging = true;
        this.merges.push([a, b]);
      }
    };
    Events.on(this.engine, 'collisionStart', collect);
    Events.on(this.engine, 'collisionActive', collect);

    this.time = 0;
    this.x = W / 2;
    this.cool = 0;
    this.overT = 0;
    this.danger = false;
    this.flashes = [];
    this.popups = [];
    this.shards = [];
    this.combo = 0;
    this.lastMerge = -Infinity;
    this.comboText = null;
    this.shake = 0;
    this.escape = null;
    this.perches = [];
    // the background line stays in the upper half of the jar, clear of the pile
    this.stroll = new Stroll({ width: W, top: RIM + 60, bottom: RIM + 240, star: this.starImg });
    this.won = false;
    this.cur = this.roll();
    this.next = this.roll();
  }

  // Highest tier allowed to fall, decided when a ball is rolled (a ball already
  // shown as NEXT never changes). Empty jar, or nothing above DeepSeek: DeepSeek.
  // Otherwise strictly below the highest tier in the jar, capped by DROPPABLE.
  cap() {
    let top = -1;
    for (const b of this.balls) if (b.tier > top) top = b.tier;
    return top <= 0 ? 0 : Math.min(top - 1, DROPPABLE.length - 1);
  }

  roll() {
    const top = this.cap();
    let n = Math.random() * WEIGHTS.slice(0, top + 1).reduce((a, b) => a + b);
    for (let i = 0; i <= top; i++) if ((n -= WEIGHTS[i]) < 0) return DROPPABLE[i];
    return 0;
  }

  aim(x) {
    const r = TIERS[this.cur].r;
    this.x = Math.min(Math.max(x, L + r + 1), R - r - 1);
  }

  addBall(tier, x, y, vx = 0, vy = 0) {
    const { Bodies, Body, Composite } = this.M;
    const b = Bodies.circle(x, y, TIERS[tier].r, {
      restitution: 0.2, friction: 0.01, frictionStatic: 0.02, frictionAir: 0.006, density: 0.0012,
    });
    b.tier = tier;
    b.born = this.time;
    b.pop = 0;
    Body.setVelocity(b, { x: vx, y: vy });
    Composite.add(this.engine.world, b);
    this.balls.add(b);
    return b;
  }

  drop() {
    if (this.cool > 0 || this.escape) return;
    this.aim(this.x);
    this.addBall(this.cur, this.x, DROP_Y);
    this.cur = this.next;
    this.next = this.roll();
    this.cool = COOLDOWN;
    this.aim(this.x);
  }

  update(dt) {
    const { Engine, Composite } = this.M;
    this.time += dt;
    this.cool = Math.max(0, this.cool - dt);
    Engine.update(this.engine, dt * 1000);

    for (const [a, b] of this.merges) {
      if (!this.balls.has(a) || !this.balls.has(b)) continue;
      Composite.remove(this.engine.world, [a, b]);
      this.balls.delete(a); this.balls.delete(b);
      const t = a.tier + 1;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      const nb = this.addBall(t, x, y, (a.velocity.x + b.velocity.x) / 4, (a.velocity.y + b.velocity.y) / 4);
      nb.born = this.time - GRACE; // merged balls are never "just dropped"
      this.flashes.push({ x, y, r: TIERS[t].r, t: 0 });

      // merges in quick succession form a chain; each link adds 50% to the points
      this.combo = this.time - this.lastMerge < COMBO_WINDOW ? this.combo + 1 : 1;
      this.lastMerge = this.time;
      const pts = Math.round(POINTS[t] * (1 + 0.5 * (this.combo - 1)));
      this.host.addScore(pts);
      this.popups.push({ x, y: y - TIERS[t].r * 0.3, text: `+${pts}`, hot: this.combo > 1, t: 0 });
      if (this.combo > 1) this.comboText = { n: this.combo, t: 0 };
      if (t >= SHAKE_FROM) this.shake = Math.max(this.shake, 2 + (t - SHAKE_FROM) * 2.2);
      if (t === CAT) this.breakOut(nb);
    }
    this.merges.length = 0;
    this.updateEscape(dt);

    let over = false, danger = false;
    for (const b of this.balls) {
      b.pop = Math.min(1, b.pop + dt / 0.18);
      if (this.time - b.born < GRACE) continue;
      const top = b.position.y - TIERS[b.tier].r;
      if (top < RIM) over = true;
      if (top < RIM + 36) danger = true;
    }
    this.danger = danger;
    this.overT = over && !this.escape ? this.overT + dt : 0;
    if (this.overT > OVER_AFTER) this.host.gameOver();

    if (STROLL && !still.matches) this.stroll.update(dt);
    this.flashes = this.flashes.filter(f => (f.t += dt) < 0.35);
    this.popups = this.popups.filter(p => (p.t += dt) < 0.9);
    if (this.comboText && (this.comboText.t += dt) > 1.1) this.comboText = null;
    this.shake = this.shake > 0.1 ? this.shake * Math.exp(-dt * 7) : 0;
    this.shards = this.shards.filter(sh => {
      sh.vy += 900 * dt;
      sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.rot += sh.vr * dt;
      return (sh.t += dt) < 1.3;
    });
  }

  /* ---- the cat breaks out of its ball and jumps onto the rim ---- */

  breakOut(ball) {
    this.M.Body.setStatic(ball, true);
    const cracks = Array.from({ length: 6 }, (_, i) => {
      let a = (i / 6) * Math.PI * 2 + Math.random() * 0.6, d = 0;
      const pts = [[0, 0]];
      while (d < 1) { d += 0.2 + Math.random() * 0.15; a += (Math.random() - 0.5) * 0.9; pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
      return pts;
    });
    this.escape = { phase: 'crack', t: 0, ball, x: ball.position.x, y: ball.position.y, cracks };
  }

  updateEscape(dt) {
    const e = this.escape;
    if (!e) return;
    e.t += dt;
    if (e.phase === 'crack' && e.t >= CRACK) {
      this.M.Composite.remove(this.engine.world, e.ball);
      this.balls.delete(e.ball);
      const r = TIERS[CAT].r;
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2, v = 160 + Math.random() * 260;
        this.shards.push({
          x: e.x + Math.cos(a) * r * 0.7, y: e.y + Math.sin(a) * r * 0.7,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 220,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 16,
          size: 6 + Math.random() * 12, color: i % 3 ? '#7C86E6' : '#FFFFFF', t: 0,
        });
      }
      this.shake = 10;
      const size = TIERS[CAT].r * 2 * TIERS[CAT].size;
      e.from = { x: e.x, y: e.y + size / 2, size };
      e.to = this.perchSpot();
      e.phase = 'jump'; e.t = 0;
    } else if (e.phase === 'jump' && e.t >= JUMP) {
      e.phase = 'land'; e.t = 0;
      this.shake = Math.max(this.shake, 3);
    } else if (e.phase === 'land' && e.t >= LAND) {
      if (e.to.keep) this.perches.push(e.to);
      this.escape = null;
      if (!this.won) { this.won = true; this.host.win('POSCAT broke out of the jar!'); }
    }
  }

  // The first two cats sit side by side on the left rim; any more jump off the top.
  perchSpot() {
    const y = RIM - 14;
    const slot = this.perches.length;
    if (slot < 2) return { x: L + PERCH / 2 - 4 + slot * (PERCH + 6), y, keep: true };
    return { x: W / 2, y: -140, keep: false };
  }

  pointer(p) {
    this.aim(p.x);
    if (p.type === 'up') this.drop();
  }

  key(e) {
    if (e.key === 'ArrowLeft') { this.aim(this.x - 10); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { this.aim(this.x + 10); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') { this.drop(); e.preventDefault(); }
  }

  render(ctx) {
    // background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#F6F7FB'); bg.addColorStop(1, '#E9ECF6');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (this.shake && !still.matches) ctx.translate((Math.random() - 0.5) * 2 * this.shake, (Math.random() - 0.5) * 2 * this.shake);
    if (STROLL && !still.matches) this.stroll.draw(ctx);
    this.drawJar(ctx);
    if (!this.balls) { ctx.restore(); this.drawStrip(ctx); return; }

    // aim guide
    const cur = TIERS[this.cur];
    ctx.save();
    ctx.strokeStyle = 'rgba(63,71,168,.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(this.x, DROP_Y + cur.r + 4);
    ctx.lineTo(this.x, FLOOR);
    ctx.stroke();
    ctx.restore();

    const e = this.escape;
    for (const b of this.balls) {
      let x = b.position.x;
      if (e && e.ball === b) x += Math.sin(e.t * 70) * 2.5 * (e.t / CRACK);
      this.drawBall(ctx, b.tier, x, b.position.y, b.angle, 0.55 + 0.45 * ease(b.pop));
    }
    if (e && e.phase === 'crack') this.drawCracks(ctx, e);

    for (const f of this.flashes) {
      const k = f.t / 0.35;
      ctx.strokeStyle = `rgba(124,134,230,${0.6 * (1 - k)})`;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1 + 0.35 * k), 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const sh of this.shards) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, 1.6 * (1 - sh.t / 1.3));
      ctx.translate(sh.x, sh.y); ctx.rotate(sh.rot);
      ctx.fillStyle = sh.color;
      ctx.strokeStyle = 'rgba(35,33,35,.18)';
      ctx.beginPath(); ctx.moveTo(0, -sh.size / 2); ctx.lineTo(sh.size / 2, sh.size / 3); ctx.lineTo(-sh.size / 2, sh.size / 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    for (const p of this.perches) this.drawCat(ctx, p.x, p.y, PERCH, 0, 1, 1);
    if (e && e.phase !== 'crack') this.drawEscape(ctx, e);

    this.drawPopups(ctx);
    ctx.restore();

    // held ball
    ctx.globalAlpha = this.cool > 0 || e ? 0.35 : 1;
    this.drawBall(ctx, this.cur, this.x, DROP_Y, 0, 1);
    ctx.globalAlpha = 1;

    // next
    ctx.fillStyle = '#55535A';
    ctx.font = '600 11px Figtree, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('NEXT', R, 24);
    this.drawBall(ctx, this.next, R - 16, 46, 0, 16 / TIERS[this.next].r);

    // rim warning
    if (this.danger) {
      const a = 0.45 + 0.35 * Math.sin(this.time * 10);
      ctx.save();
      ctx.strokeStyle = `rgba(216,119,79,${a})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(L, RIM); ctx.lineTo(R, RIM); ctx.stroke();
      ctx.restore();
    }

    this.drawStrip(ctx);
  }

  drawCracks(ctx, e) {
    const r = TIERS[CAT].r, k = Math.min(1, e.t / CRACK);
    ctx.save();
    ctx.translate(e.x + Math.sin(e.t * 70) * 2.5 * k, e.y);
    ctx.beginPath(); ctx.arc(0, 0, r - 2, 0, Math.PI * 2); ctx.clip();
    ctx.strokeStyle = 'rgba(35,33,35,.75)';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    for (const pts of e.cracks) {
      const n = Math.max(2, Math.ceil(pts.length * k));
      ctx.beginPath();
      pts.slice(0, n).forEach(([x, y], i) => (i ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r)));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawEscape(ctx, e) {
    const { from, to } = e;
    if (e.phase === 'jump') {
      const p = e.t / JUMP, q = p * p * (3 - 2 * p);
      // the arc peaks with the cat's feet just low enough that its ears stay on screen
      const peak = PERCH * this.catImg.naturalHeight / this.catImg.naturalWidth + 8;
      const H = arcHeight(from.y, to.y, Math.min(peak, to.y - 10));
      const x = from.x + (to.x - from.x) * q;
      const y = from.y + (to.y - from.y) * p - 4 * H * p * (1 - p);
      const size = from.size + (PERCH - from.size) * Math.min(1, p * 1.8);
      const dir = to.x < from.x ? -1 : 1;
      this.drawCat(ctx, x, y, size, Math.sin(p * Math.PI) * 0.35 * dir, 1, 1);
    } else {
      const k = Math.min(1, e.t / 0.3), sq = Math.sin(k * Math.PI) * 0.2;
      this.drawCat(ctx, to.x, to.y, PERCH, 0, 1 + sq * 0.6, 1 - sq);
    }
  }

  // x, y is the bottom centre of the cat
  drawCat(ctx, x, y, size, rot, sx, sy) {
    const img = this.catImg, h = size * img.naturalHeight / img.naturalWidth;
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -size / 2, -h, size, h);
    ctx.restore();
  }

  drawPopups(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const k = p.t / 0.9;
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      ctx.fillStyle = p.hot ? '#3F47A8' : '#232123';
      ctx.font = `700 ${p.hot ? 19 : 16}px Figtree, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      const y = p.y - 34 * (1 - (1 - k) ** 2);
      ctx.strokeText(p.text, p.x, y);
      ctx.fillText(p.text, p.x, y);
    }
    const c = this.comboText;
    if (c) {
      const k = c.t / 1.1, pop = ease(Math.min(1, c.t / 0.25));
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.translate(W / 2, RIM + 54);
      ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      ctx.font = '800 34px Figtree, system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.fillStyle = '#3F47A8';
      ctx.strokeText(`Combo ×${c.n}`, 0, 0);
      ctx.fillText(`Combo ×${c.n}`, 0, 0);
    }
    ctx.restore();
  }

  drawJar(ctx) {
    const x = L - 7, y = RIM - 14, w = R - L + 14, h = FLOOR - RIM + 21;
    ctx.save();
    ctx.fillStyle = 'rgba(35,33,35,.06)';
    ctx.beginPath(); ctx.ellipse(W / 2, FLOOR + 10, w / 2 + 6, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.78)';
    ctx.strokeStyle = 'rgba(35,33,35,.14)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, [6, 6, 12, 12]); ctx.fill(); ctx.stroke();
    // rim lip
    ctx.fillStyle = '#D9DCEA';
    ctx.beginPath(); ctx.roundRect(x - 5, y - 4, 16, 8, 4); ctx.fill();
    ctx.beginPath(); ctx.roundRect(x + w - 11, y - 4, 16, 8, 4); ctx.fill();
    ctx.restore();
  }

  drawStrip(ctx) {
    if (!this.sprites) return;
    const r = 12, gap = 35, x0 = W / 2 - gap * (TIERS.length - 1) / 2;
    for (let i = 0; i < TIERS.length; i++) this.drawBall(ctx, i, x0 + gap * i, 618, 0, r / TIERS[i].r);
  }

  drawBall(ctx, tier, x, y, angle, scale) {
    const r = TIERS[tier].r * scale;
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(this.sprites[tier], -r, -r, r * 2, r * 2);
    ctx.restore();
  }

  destroy() {
    if (this.engine) this.M.Engine.clear(this.engine);
  }
}

// Height H for y(p) = y0 + (y1 - y0)p - 4Hp(1 - p) whose lowest y is exactly top.
function arcHeight(y0, y1, top) {
  const b = 8 * (y1 - y0) + 16 * (y0 - top);
  return (b + Math.sqrt(Math.max(0, b * b - 64 * (y1 - y0) ** 2))) / 32;
}

/* ---- sprites ---- */

async function svgOrImage(src) {
  return src.endsWith('.svg') ? tinted(src, null) : loadImage(src);
}

// Load an SVG at a large intrinsic size, optionally replacing currentColor.
async function tinted(src, color) {
  let text = await (await fetch(src)).text();
  text = text.replace(/\swidth="1em"/, ' width="256"').replace(/\sheight="1em"/, ' height="256"');
  if (color) text = text.replace(/currentColor/g, color);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try { return await loadImage(url); }
  finally { URL.revokeObjectURL(url); }
}

function sprite(t, img) {
  const px = Math.ceil(t.r * 2 * SPRITE);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  const m = px / 2, ring = Math.max(2, t.r * 0.09) * SPRITE;
  g.fillStyle = t.fill;
  g.beginPath(); g.arc(m, m, m - 1, 0, Math.PI * 2); g.fill();
  if (t.ring === 'google' && g.createConicGradient) {
    const cg = g.createConicGradient(-Math.PI / 2, m, m);
    ['#EA4335', '#FBBC05', '#34A853', '#4285F4', '#EA4335'].forEach((col, i) => cg.addColorStop(i / 4, col));
    g.strokeStyle = cg;
  } else {
    g.strokeStyle = t.ring === 'google' ? '#4285F4' : t.ring;
  }
  g.lineWidth = ring;
  g.beginPath(); g.arc(m, m, m - ring / 2 - 1, 0, Math.PI * 2); g.stroke();
  const s = px * t.size;
  const ar = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
  const w = ar >= 1 ? s : s * ar, h = ar >= 1 ? s / ar : s;
  g.drawImage(img, m - w / 2, m - h / 2, w, h);
  return c;
}
