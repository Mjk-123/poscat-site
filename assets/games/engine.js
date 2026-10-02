/*
 * POSCAT arcade engine.
 *
 * A game module default-exports a class that extends Game:
 *
 *   export default class MyGame extends Game {
 *     static meta = { id: 'my-game', width: 360, height: 560, howto: 'One line on how to play.' };
 *     async preload() {}            // load images and libraries (host.image, loadScript)
 *     start() {}                    // reset everything for a fresh round
 *     update(dt) {}                 // advance one fixed step (dt in seconds)
 *     render(ctx, w, h) {}          // draw in logical units (w × h from meta)
 *     pointer(p) {}                 // { type: 'down' | 'move' | 'up', x, y, id }
 *     key(e) {}                     // KeyboardEvent while playing
 *     destroy() {}                  // free anything the game created
 *   }
 *
 * Inside a game, this.host gives score (setScore / addScore), round endings
 * (gameOver / win), and the logical size. The host owns the canvas, the loop,
 * resizing, input, pause on tab switch, the overlays, the best score, and the
 * leaderboard (submit from pause / game over / win, "View dashboard" panel).
 * Register the module in registry.js to put it on the arcade page.
 */

import { board } from './board.js';

const STEP = 1 / 60;
const NAME_KEY = 'poscat.arcade.name';
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export class Game {
  static meta = { id: 'game', width: 360, height: 560, howto: '' };
  constructor(host) { this.host = host; }
  async preload() {}
  start() {}
  update(dt) {}
  render(ctx, w, h) {}
  pointer(p) {}
  key(e) {}
  destroy() {}
}

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const scripts = new Map();
export function loadScript(src) {
  if (scripts.has(src)) return scripts.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { scripts.delete(src); reject(new Error(`Could not load ${src}`)); };
    document.head.appendChild(s);
  });
  scripts.set(src, p);
  return p;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export class GameHost {
  constructor(root, GameClass) {
    this.root = root;
    this.meta = { width: 360, height: 560, howto: '', ...GameClass.meta };
    this.width = this.meta.width;
    this.height = this.meta.height;
    this.state = 'loading';
    this.score = 0;
    this.bestKey = `poscat.arcade.${this.meta.id}.best`;
    this.best = store.get(this.bestKey, 0);
    this._images = new Map();
    this._acc = 0; this._last = 0; this._raf = 0;
    this.runId = null;       // one leaderboard entry per round
    this.runWon = false;
    this.submitted = null;   // { score, rank } for this round, once sent

    root.innerHTML = `
      <div class="gh" style="--ar:${this.width / this.height}">
        <div class="gh-layout">
          <div class="gh-play">
            <div class="gh-bar">
              <div class="gh-stat"><span>Score</span><b data-score>0</b></div>
              <div class="gh-stat"><span>Best</span><b data-best>${this.best}</b></div>
              <div class="gh-tools">
                <button class="gh-btn" type="button" data-board aria-expanded="false">View dashboard</button>
                <button class="gh-btn" type="button" data-pause>Pause</button>
              </div>
            </div>
            <div class="gh-stage">
              <canvas></canvas>
              <div class="gh-overlay" role="dialog" aria-live="polite"><div class="gh-card"></div></div>
            </div>
          </div>
          <aside class="gh-board" aria-label="Leaderboard" aria-hidden="true">
            <div class="gh-board-in">
              <div class="gh-board-head"><h3>Leaderboard</h3><span>Top 5</span></div>
              <ol class="gh-rank" data-rank></ol>
              <p class="gh-board-note">${board.shared ? 'Scores are shared with everyone.' : 'Scores are saved in this browser.'}</p>
            </div>
          </aside>
        </div>
      </div>`;
    this.$gh = root.querySelector('.gh');
    this.$board = root.querySelector('.gh-board');
    this.$rank = root.querySelector('[data-rank]');
    this.$boardBtn = root.querySelector('[data-board]');
    this.stage = root.querySelector('.gh-stage');
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.overlay = root.querySelector('.gh-overlay');
    this.card = root.querySelector('.gh-card');
    this.$score = root.querySelector('[data-score]');
    this.$best = root.querySelector('[data-best]');
    this.$pause = root.querySelector('[data-pause]');

    this.game = new GameClass(this);
    this._bind();
  }

  async mount() {
    this._show({ title: this.meta.title || '', text: 'Loading…', actions: [] });
    this._resize();
    this._loop(performance.now());
    try {
      await this.game.preload();
    } catch (err) {
      console.error(err);
      this._show({ title: 'Could not load', text: 'Check your connection and reload the page.', actions: [] });
      return;
    }
    if (this.state === 'destroyed') return;
    this.state = 'ready';
    this._show({
      title: this.meta.title || '',
      text: this.meta.howto,
      actions: [{ label: 'Start', primary: true, fn: () => this.start() }],
    });
  }

  /* ---- called by games ---- */
  image(src) {
    if (!this._images.has(src)) this._images.set(src, loadImage(src));
    return this._images.get(src);
  }
  setScore(n) {
    this.score = n;
    this.$score.textContent = n;
    if (n > this.best) this._saveBest();
  }
  addScore(n) { this.setScore(this.score + n); }
  gameOver(text) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this._saveBest();
    this._show({
      title: 'Game over',
      text: text || `Score ${this.score} · Best ${this.best}`,
      submit: true,
      actions: [{ label: 'Play again', primary: true, fn: () => this.start() }],
    });
  }
  win(text) {
    if (this.state !== 'playing') return;
    this.state = 'won';
    this.runWon = true;
    this._saveBest();
    this._show({
      title: 'You win!',
      text: text || `Score ${this.score}`,
      submit: true,
      actions: [
        { label: 'Keep playing', primary: true, fn: () => this._resume() },
        { label: 'New game', fn: () => this.start() },
      ],
    });
  }

  /* ---- lifecycle ---- */
  start() {
    this.runId = newId();
    this.runWon = false;
    this.submitted = null;
    this.setScore(0);
    this.game.start();
    this._acc = 0;
    this._resume();
  }
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._show({
      title: 'Paused',
      text: `Score ${this.score}`,
      submit: true,
      actions: [
        { label: 'Resume', primary: true, fn: () => this._resume() },
        { label: 'Restart', fn: () => this.start() },
      ],
    });
  }
  destroy() {
    this.state = 'destroyed';
    cancelAnimationFrame(this._raf);
    this._unbind.forEach(off => off());
    try { this.game.destroy(); } catch (err) { console.error(err); }
    this.root.innerHTML = '';
  }

  /* ---- internals ---- */
  toggleBoard(open = !this.$gh.classList.contains('board-open')) {
    this.$gh.classList.toggle('board-open', open);
    this.$board.setAttribute('aria-hidden', String(!open));
    this.$boardBtn.setAttribute('aria-expanded', String(open));
    this.$boardBtn.textContent = open ? 'Hide dashboard' : 'View dashboard';
    if (!open) return;
    this.refreshBoard();
    // stacked layout: the panel opens below the stage, so bring it into view
    if (matchMedia('(max-width: 880px)').matches) {
      setTimeout(() => this.$board.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 380);
    }
  }

  async refreshBoard() {
    const rows = await board.top(this.meta.id, 5);
    if (this.state === 'destroyed') return;
    const date = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    this.$rank.innerHTML = rows.length
      ? rows.map((r, i) => `
        <li class="gh-row${r.id === this.runId ? ' me' : ''}" style="--i:${i}">
          <span class="gh-pos">${i + 1}</span>
          <span class="gh-who"><b>${esc(r.name)}</b><small>${r.won ? 'Won · ' : ''}${date(r.at)}</small></span>
          <span class="gh-pts">${r.score}</span>
        </li>`).join('')
      : '<li class="gh-empty">No scores yet. Finish a round and submit your score to get on the board.</li>';
  }

  async _submit(form) {
    const name = form.elements.name.value.trim().slice(0, 16);
    if (!name || !this.runId || this.score <= 0) return;
    const btn = form.querySelector('button'), note = this.card.querySelector('.gh-note');
    btn.disabled = true;
    store.set(NAME_KEY, name);
    try {
      const { rank } = await board.submit(this.meta.id, { id: this.runId, name, score: this.score, won: this.runWon });
      this.submitted = { score: this.score, rank };
      btn.textContent = 'Saved';
      note.textContent = `#${rank} on the board`;
      note.classList.add('on');
      this.refreshBoard();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      note.textContent = 'Could not save. Try again.';
      note.classList.add('on');
    }
  }

  _resume() {
    this.state = 'playing';
    this.overlay.classList.remove('on');
    this.$pause.disabled = false;
    this._last = performance.now();
    this.canvas.focus({ preventScroll: true });
  }
  _saveBest() {
    if (this.score <= this.best) return;
    this.best = this.score;
    this.$best.textContent = this.best;
    store.set(this.bestKey, this.best);
  }
  _show({ title, text, actions, submit = false }) {
    this.$pause.disabled = true;
    const done = this.submitted && this.submitted.score === this.score;
    const canSubmit = submit && this.runId && this.score > 0;
    this.card.innerHTML = `${title ? `<h2>${title}</h2>` : ''}${text ? `<p>${text}</p>` : ''}${canSubmit ? `
      <form class="gh-submit">
        <input name="name" maxlength="16" placeholder="Your name" autocomplete="nickname" aria-label="Your name" required value="${esc(store.get(NAME_KEY, ''))}">
        <button class="btn ghost" type="submit"${done ? ' disabled' : ''}>${done ? 'Saved' : this.submitted ? 'Update score' : 'Submit score'}</button>
      </form>
      <p class="gh-note${done ? ' on' : ''}" aria-live="polite">${done ? `#${this.submitted.rank} on the board` : ''}</p>` : ''}<div class="gh-actions"></div>`;
    this.card.querySelector('.gh-submit')?.addEventListener('submit', e => { e.preventDefault(); this._submit(e.target); });
    const row = this.card.querySelector('.gh-actions');
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.primary ? 'btn' : 'btn ghost';
      b.textContent = a.label;
      b.addEventListener('click', a.fn);
      row.appendChild(b);
    });
    this.overlay.classList.add('on');
    row.querySelector('button')?.focus({ preventScroll: true });
  }
  _loop = now => {
    this._raf = requestAnimationFrame(this._loop);
    if (this.state === 'playing') {
      this._acc += Math.min((now - this._last) / 1000, 0.25);
      while (this._acc >= STEP) { this.game.update(STEP); this._acc -= STEP; }
    }
    this._last = now;
    this._draw();
  };
  _draw() {
    const { ctx, canvas } = this;
    const k = canvas.width / this.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    this.game.render(ctx, this.width, this.height);
  }
  _resize() {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.width * dpr * this.height / this.width);
    this._draw();
  }
  _point(e, type) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.width / r.width;
    return { type, x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, id: e.pointerId, pointerType: e.pointerType };
  }
  _bind() {
    const offs = [];
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); };
    const c = this.canvas;
    c.tabIndex = 0;
    const send = type => e => {
      if (this.state !== 'playing') return;
      if (type === 'down') c.setPointerCapture?.(e.pointerId);
      this.game.pointer(this._point(e, type));
    };
    on(c, 'pointerdown', send('down'));
    on(c, 'pointermove', send('move'));
    on(c, 'pointerup', send('up'));
    on(c, 'pointercancel', send('up'));
    on(this.$pause, 'click', () => this.pause());
    on(this.$boardBtn, 'click', () => this.toggleBoard());
    on(window, 'keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.state === 'playing') { this.pause(); e.preventDefault(); }
        else if (this.state === 'paused') { this._resume(); e.preventDefault(); }
        return;
      }
      if (this.state === 'playing') this.game.key(e);
    });
    on(document, 'visibilitychange', () => { if (document.hidden) this.pause(); });
    on(window, 'blur', () => this.pause());
    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.stage);
    offs.push(() => ro.disconnect());
    this._unbind = offs;
  }
}
