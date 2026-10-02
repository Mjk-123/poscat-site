/*
 * Starter module. Copy this file, change meta.id, add an entry in registry.js.
 * Tap the dots before the 20 seconds run out; reach 10 to win.
 */
import { Game } from './engine.js';

const TIME = 20;
const GOAL = 10;

export default class Template extends Game {
  static meta = {
    id: 'template',
    title: 'Template',
    width: 360,
    height: 480,
    howto: `Tap the dots. ${GOAL} before the timer runs out wins.`,
  };

  start() {
    this.left = TIME;
    this.dot = this.spawn();
  }

  spawn() {
    const r = 22;
    return { x: r + Math.random() * (this.host.width - 2 * r), y: 60 + r + Math.random() * (this.host.height - 60 - 2 * r), r };
  }

  update(dt) {
    this.left -= dt;
    if (this.left <= 0) { this.left = 0; this.host.gameOver(); }
  }

  pointer(p) {
    if (p.type !== 'down') return;
    const d = this.dot;
    if (Math.hypot(p.x - d.x, p.y - d.y) > d.r + 8) return;
    this.host.addScore(1);
    this.dot = this.spawn();
    if (this.host.score === GOAL) this.host.win();
  }

  render(ctx, w, h) {
    ctx.fillStyle = '#EDEFF7';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#7C86E6';
    ctx.fillRect(0, 0, w * (this.left ?? TIME) / TIME, 6);
    if (!this.dot) return;
    ctx.fillStyle = '#D8774F';
    ctx.beginPath();
    ctx.arc(this.dot.x, this.dot.y, this.dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}
