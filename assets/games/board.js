/*
 * Leaderboard storage. Every method is async so a shared backend can replace
 * the local one later without touching the host: implement top() and submit()
 * against the service and swap `board` below.
 *
 * Entry: { id, name, score, won, at }  — id is one per round, so submitting
 * the same round again (pause, then game over) updates it instead of adding.
 */

const key = game => `poscat.arcade.${game}.board`;
const MAX = 100;

function read(game) {
  try { return JSON.parse(localStorage.getItem(key(game))) || []; } catch { return []; }
}
function write(game, list) {
  try { localStorage.setItem(key(game), JSON.stringify(list)); } catch {}
}
const order = (a, b) => b.score - a.score || a.at - b.at;

export const localBoard = {
  shared: false,

  async top(game, n = 5) {
    return read(game).sort(order).slice(0, n);
  },

  // Returns { entry, rank } with rank counted from 1.
  async submit(game, { id, name, score, won }) {
    const list = read(game);
    let entry = list.find(e => e.id === id);
    if (entry) {
      entry.name = name;
      entry.won = entry.won || won;
      if (score > entry.score) { entry.score = score; entry.at = Date.now(); }
    } else {
      entry = { id, name, score, won, at: Date.now() };
      list.push(entry);
    }
    list.sort(order);
    write(game, list.slice(0, MAX));
    return { entry, rank: list.indexOf(entry) + 1 };
  },
};

export const board = localBoard;
