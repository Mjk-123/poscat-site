/* Arcade page: lists the games and mounts one when the hash names it (game.html#merge). */
import { GameHost } from './engine.js';
import { GAMES } from './registry.js';

const dev = new URLSearchParams(location.search).has('dev');
const games = GAMES.filter(g => dev || !g.dev);

const list = document.getElementById('arcade-list');
const play = document.getElementById('arcade-play');
const mount = document.getElementById('arcade-mount');
const title = document.getElementById('arcade-title');

list.innerHTML = games.map((g, i) => `
  <article class="game-card${g.load ? '' : ' soon'}">
    <div class="stage-name">No. ${i + 1}</div>
    <h3>${g.title}</h3>
    <p>${g.blurb}</p>
    ${g.load ? `<a class="btn" href="#${g.id}">Play</a>` : '<span class="tag">Coming soon</span>'}
  </article>`).join('');

let host = null;
let token = 0;

async function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  const g = games.find(x => x.id === id && x.load);
  const mine = ++token;
  host?.destroy();
  host = null;

  if (!g) {
    document.body.dataset.view = 'list';
    document.title = 'Mini game — POSCAT AI Study';
    play.hidden = true;
    return;
  }
  document.body.dataset.view = 'play';
  play.hidden = false;
  title.textContent = g.title;
  document.title = `${g.title} — POSCAT AI Study`;
  scrollTo({ top: 0, behavior: 'instant' });

  let mod;
  try { mod = await g.load(); }
  catch (err) {
    console.error(err);
    mount.innerHTML = '<p class="gh-error">Could not load this game. Reload to try again.</p>';
    return;
  }
  if (mine !== token) return;
  const { width = 360, height = 560 } = mod.default.meta || {};
  play.style.setProperty('--ar', width / height); // title bar tracks the stage width
  play.classList.remove('settled');
  requestAnimationFrame(() => requestAnimationFrame(() => play.classList.add('settled')));
  host = new GameHost(mount, mod.default);
  if (dev) window.arcade = host;
  host.mount();
}

addEventListener('hashchange', route);
route();
