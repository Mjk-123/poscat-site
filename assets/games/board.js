/*
 * Leaderboard storage, shared through Supabase when config.js has a project,
 * otherwise kept in this browser. Both expose the same async API:
 *
 *   top(game, n, runId)  → [{ name, score, won, at, mine }]
 *   submit(game, { id, name, score, won }) → { rank }
 *
 * id is one per round, so submitting the same round again (pause, then game
 * over) updates that round instead of adding a new row.
 */
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const order = (a, b) => b.score - a.score || a.at - b.at;

/* ---- this browser only ---- */

const key = game => `poscat.arcade.${game}.board`;
const MAX = 100;
const read = game => { try { return JSON.parse(localStorage.getItem(key(game))) || []; } catch { return []; } };
const write = (game, list) => { try { localStorage.setItem(key(game), JSON.stringify(list)); } catch {} };

export const localBoard = {
  shared: false,

  async top(game, n = 5, runId = null) {
    return read(game).sort(order).slice(0, n).map(e => ({ ...e, mine: e.id === runId }));
  },

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
    return { rank: list.indexOf(entry) + 1 };
  },
};

/* ---- shared through Supabase (see supabase/setup.sql) ---- */

async function rpc(fn, body) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_KEY}`; // legacy anon JWT
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// The server only reveals a short hash of each round id, so "mine" is matched by hash.
async function tag(id) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export const sharedBoard = {
  shared: true,

  async top(game, n = 5, runId = null) {
    const [rows, mineTag] = await Promise.all([
      rpc('top_scores', { p_game: game, p_limit: n }),
      runId ? tag(runId) : null,
    ]);
    return rows.map(r => ({ name: r.name, score: r.score, won: r.won, at: Date.parse(r.at), mine: r.tag === mineTag }));
  },

  async submit(game, { id, name, score, won }) {
    const rank = await rpc('submit_score', { p_id: id, p_game: game, p_name: name, p_score: score, p_won: won });
    return { rank };
  },
};

export const board = SUPABASE_URL && SUPABASE_KEY ? sharedBoard : localBoard;
