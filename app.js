(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const LS = {
  get(k, d) { try { const v = localStorage.getItem('tsai:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tsai:' + k, JSON.stringify(v)); } catch {} }
};
const fmtInt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const GAMES = {
  flappy: { name: 'Болжмор', better: 'high', fmt: v => fmtInt(v) + ' оноо', hud: 'Оноо' },
  race:   { name: 'Карьерын зам', better: 'high', fmt: v => fmtInt(v) + ' м', hud: 'Зай' },
  puzzle: { name: 'Таавар 3×3', better: 'low', fmt: v => Number(v).toFixed(1) + ' сек', hud: 'Хугацаа' },
  quiz:   { name: 'Мэдлэгийн сорил', better: 'high', fmt: v => fmtInt(v) + ' оноо', hud: 'Оноо' },
  chess:  { name: 'Шатар', better: 'high', fmt: v => fmtInt(v) + ' оноо', hud: 'Нүүдэл' },   // running total of wins vs the computer
};
const WHERE = { hub: 'Нүүр', flappy: 'Болжмор', race: 'Карьерын зам', puzzle: 'Таавар', quiz: 'Сорил', live: 'Хамтдаа сорил', chess: 'Шатар' };
const isBetter = (g, a, b) => b == null || (GAMES[g].better === 'high' ? a > b : a < b);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
const dayOf = ms => { const d = new Date(ms); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };

/* ---------- sound ---------- */
let actx = null, muted = LS.get('mute', false);
function sfx(kind) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    const f = { flap: 560, point: 900, tick: 320, hit: 110, good: 700, bad: 170, win: 1040 }[kind] || 440;
    o.type = (kind === 'hit' || kind === 'bad') ? 'sawtooth' : 'triangle';
    o.frequency.setValueAtTime(f, t);
    if (kind === 'win' || kind === 'good') o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.15);
    const len = kind === 'hit' ? 0.35 : 0.14;
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + len + 0.05);
  } catch {}
}
const muteBtn = $('#mute');
const paintMute = () => { muteBtn.textContent = muted ? 'Дуу: унтраалттай' : 'Дуу: асаалттай'; };
muteBtn.onclick = () => { muted = !muted; LS.set('mute', muted); paintMute(); if (!muted) sfx('tick'); };
paintMute();

/* ---------- capabilities (absent outside Claude, e.g. GitHub Pages) ---------- */
const inClaude = !!(window.claude && typeof window.claude.use === 'function');
let user = null, db = null, room = null;
const me = { uid: null, name: '', avatar: '', color: '#888' };
let canWrite = true, dbState = 'wait';     // wait | on | off
let scores = new Map();                     // uid -> {flappy:{best,at}, ...}
let tab = LS.get('tab', 'flappy'); if (!GAMES[tab]) tab = 'flappy';

function localBest(g) { return LS.get('best', {})[g]; }
function paintBests() {
  for (const b of $$('[data-best]')) {
    const g = b.dataset.best; const mine = me.uid && scores.get(me.uid)?.[g]?.best;
    const lb = localBest(g); let v = lb;
    if (mine != null && isBetter(g, mine, v)) v = mine;
    b.textContent = v == null ? '—' : GAMES[g].fmt(v);
  }
}

let wq = Promise.resolve();
function queued(fn) { const p = wq.then(fn); wq = p.catch(() => {}); return p; }

async function saveScore(g, v) {
  const out = { localRecord: false, teamRecord: false, team: false, prev: null };
  const lb = LS.get('best', {}); out.prev = lb[g] ?? null;
  const mineTeam = me.uid ? scores.get(me.uid)?.[g]?.best : null;
  if (mineTeam != null && (out.prev == null || isBetter(g, mineTeam, out.prev))) out.prev = mineTeam;
  if (isBetter(g, v, lb[g])) { lb[g] = v; LS.set('best', lb); }
  out.localRecord = isBetter(g, v, out.prev);
  if (db && me.uid && canWrite) {
    const cur = scores.get(me.uid);
    const prevTeam = cur?.[g]?.best;
    if (isBetter(g, v, prevTeam)) {
      const body = cur ? JSON.parse(JSON.stringify(cur)) : {};
      body[g] = { best: v, at: Date.now() };
      try {
        await queued(() => db.doc('scores/' + me.uid).set(body));
        out.teamRecord = true; out.team = true;
      } catch (e) {
        if (e && e.code === 'invalid_argument') { canWrite = false; renderBoard(); }
      }
    } else out.team = true;
  }
  paintBests();
  return out;
}

function localRows(g) { const v = localBest(g); return v == null ? [] : [{ uid: 'local', best: v, at: 0, local: true }]; }
function rankOf(g, uid) {
  const list = boardList(g);
  const i = list.findIndex(r => r.uid === uid);
  return i < 0 ? null : { pos: i + 1, of: list.length };
}
function boardList(g) {
  const list = [];
  for (const [uid, d] of scores) { const s = d && d[g]; if (s && typeof s.best === 'number' && isFinite(s.best)) list.push({ uid, best: s.best, at: s.at || 0 }); }
  list.sort((a, b) => GAMES[g].better === 'high' ? b.best - a.best || a.at - b.at : a.best - b.best || a.at - b.at);
  return list;
}

let boardTok = 0;
async function renderBoard() {
  const tok = ++boardTok;
  for (const b of $$('#tabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  const rows = $('#rows'), empty = $('#boardEmpty'), note = $('#boardNote');
  const list = dbState === 'off' ? localRows(tab) : boardList(tab).slice(0, 10);
  let ps = {};
  if (user && list.length) ps = await user.profiles(list.map(r => r.uid));
  if (tok !== boardTok) return;
  rows.replaceChildren();
  const td = today();
  list.forEach((r, i) => {
    const li = el('li'); if (r.uid === me.uid || r.local) li.classList.add('me');
    li.append(el('span', 'rk', String(i + 1)));
    const p = r.local ? null : ps[r.uid];
    if (p && p.avatarUrl) { const im = el('img'); im.src = p.avatarUrl; im.alt = ''; li.append(im); } else li.append(el('span', 'av'));
    const nm = el('span', 'nm', r.local ? 'Та (энэ төхөөрөмж)' : (p && p.name) || (r.uid === me.uid ? (me.name || 'Та') : 'Хамт олны гишүүн'));
    if (r.at && dayOf(r.at) === td) nm.append(el('small', '', 'өнөөдөр'));
    li.append(nm);
    li.append(el('span', 'sc num', GAMES[tab].fmt(r.best)));
    rows.append(li);
  });
  empty.hidden = list.length > 0;
  empty.textContent = dbState === 'off' ? 'Одоогоор амжилт алга. Тоглоод эхний оноогоо аваарай.' : 'Одоогоор оноо алга. Эхлээд тоглоод самбарт гараарай.';
  if (dbState === 'wait') note.textContent = 'Багийн самбар холбогдож байна…';
  else if (dbState === 'off' && !inClaude) note.textContent = 'Нийтийн онооны самбар болон «Хамтдаа сорил» зөвхөн Claude дээрх хувилбарт (Artifact линк) ажиллана. Энд таны амжилт энэ төхөөрөмжид хадгалагдана.';
  else if (dbState === 'off') note.textContent = 'Багийн самбар энэ харагдацад ажиллахгүй байна (claude.ai-д нэвтэрч нээнэ үү). Оноо тань энэ төхөөрөмжид хадгалагдана.';
  else if (!canWrite) note.textContent = 'Таны эрх зөвхөн үзэх тул оноо тань энэ төхөөрөмжид л хадгалагдана. Самбарт гарахын тулд эзэмшигчээс Contributor эрх аваарай.';
  else note.textContent = tab === 'chess'
    ? 'Шатрын оноо нь компьютерийг ялж цуглуулсан нийлбэр: Амархан 1, Дунд 3, Хүнд 5.'
    : 'Хүн бүрийн хамгийн сайн амжилт харагдана. Самбар шууд шинэчлэгддэг.';
}
$('#tabs').onclick = e => { const b = e.target.closest('button[data-tab]'); if (!b) return; tab = b.dataset.tab; LS.set('tab', tab); renderBoard(); };

/* lobby presence: who is online and where */
let where = 'hub';
function setWhere(w) { where = w; if (room) room.presence({ where: w }).catch(() => {}); }
let onlineTok = 0;
async function renderOnline() {
  const tok = ++onlineTok;
  const box = $('#online'), faces = $('#faces'), txt = $('#onlineTxt');
  if (!room) { box.classList.remove('live'); txt.textContent = 'Ганцаараа'; faces.replaceChildren(); return; }
  const people = new Map();
  for (const p of room.peers()) { if (p.kind !== 'viewer') continue; const k = p.by || p.peer; if (!people.has(k) || !p.isMe) people.set(k, p); }
  const arr = [...people.values()];
  const ids = arr.map(p => p.by).filter(Boolean);
  let ps = {}; if (user && ids.length) ps = await user.profiles(ids);
  if (tok !== onlineTok) return;
  box.classList.toggle('live', arr.length > 1);
  txt.textContent = arr.length > 1 ? 'Онлайн: ' + arr.length : 'Ганцаараа';
  faces.replaceChildren();
  const titles = [];
  for (const p of arr.slice(0, 6)) {
    const pr = p.by && ps[p.by];
    if (pr && pr.avatarUrl) { const im = el('img'); im.src = pr.avatarUrl; im.alt = ''; faces.append(im); } else faces.append(el('span'));
    const w = WHERE[p.presence && p.presence.where] || 'Нүүр';
    titles.push(((pr && pr.name) || (p.isMe ? 'Та' : 'Хамт олны гишүүн')) + ' — ' + w);
  }
  box.title = titles.length ? titles.join('\n') : 'Энэ хуудсыг яг одоо нээсэн хүмүүс';
}

function autoStart() {
  const s = (document.body && document.body.dataset.start) || location.hash.slice(1);
  if (s && (GAMES[s] || s === 'live')) openAny(s);
}
function use(name) { try { return Promise.resolve(window.claude.use(name)); } catch { return Promise.resolve(null); } }
async function boot() {
  renderBoard(); paintBests(); renderOnline();
  if (!inClaude) { dbState = 'off'; $('#liveFoot').textContent = 'Зөвхөн Claude дээрх хувилбарт ажиллана'; renderBoard(); autoStart(); return; }
  autoStart();
  use('user').then(async u => {
    user = u;
    if (u) {
      const m = await u.me();
      me.uid = m.id; me.name = m.name; me.avatar = m.avatarUrl; me.color = m.color;
      const cw = await u.can('data.write'); if (cw === false) canWrite = false;
    }
    renderBoard(); paintBests(); renderOnline(); chRefresh();
  }).catch(() => {});
  use('db').then(d => {
    db = d;
    if (!d) { dbState = 'off'; renderBoard(); chRefresh(); return; }
    dbState = 'on';
    if (!chessv.hidden && chCfg.mode === 'tour') chTourList();
    chRefresh();
    d.collection('scores').onSnapshot(snap => {
      scores = new Map(snap.docs.map(x => [x.id, x.data()]));
      renderBoard(); paintBests();
    }, () => { dbState = 'off'; renderBoard(); });
    renderBoard();
  }).catch(() => { dbState = 'off'; renderBoard(); });
  use('room').then(r => {
    room = r;
    if (!r) { renderOnline(); $('#liveFoot').textContent = 'Энэ харагдацад холбогдохгүй байна'; return; }
    r.presence({ where }).catch(() => {});
    r.onPeers(() => renderOnline(), () => { room = null; renderOnline(); });
    if (!chessv.hidden) chJoinRoom();
  }).catch(() => {});
}

/* ---------- views ---------- */
const hub = $('#hub'), play = $('#play'), quizv = $('#quizv');
function showView(v) {
  hub.hidden = v !== 'hub'; play.hidden = v !== 'play'; quizv.hidden = v !== 'quiz'; chessv.hidden = v !== 'chess';
  document.documentElement.style.overflow = v === 'hub' ? '' : 'hidden';
}
$$('[data-open]').forEach(b => b.onclick = () => openAny(b.dataset.open));
function openAny(k) {
  sfx('tick');
  if (k === 'quiz') return openQuiz(false);
  if (k === 'live') return openQuiz(true);
  if (k === 'chess') return openChess();
  openGame(k);
}
document.addEventListener('click', e => { if (e.target.closest('[data-back]')) goHub(); });
function goHub() {
  stopGame(); stopQuiz(); stopChess();
  showView('hub'); setWhere('hub'); renderBoard(); paintBests();
}

/* ---------- canvas runner ---------- */
const stage = $('#stage'), cv = $('#cv'), cx = cv.getContext('2d');
const W = 360, H = 600;
let game = null, mode = 'idle', raf = 0, last = 0;
function fit() {
  if (play.hidden || !game || game.dom) return;
  const r = stage.getBoundingClientRect();
  const s = Math.max(0.3, Math.min((r.width) / W, (r.height - 12) / H));
  const d = Math.min(2.5, window.devicePixelRatio || 1);
  cv.style.width = (W * s) + 'px'; cv.style.height = (H * s) + 'px';
  cv.width = Math.round(W * s * d); cv.height = Math.round(H * s * d);
  cx.setTransform(s * d, 0, 0, s * d, 0, 0);
  game.draw(cx);
}
window.addEventListener('resize', fit);

const READY = {
  flappy: ['Болжмор', 'Товших, хулганы товч эсвэл Space — дээш нисэх. Хадны завсраар нисч, нэг ч хаданд бүү мөргө.'],
  race: ['Карьерын зам', '← → (A / D) эсвэл дэлгэцийн зүүн, баруун талд товшиж эгнээ солино. Чулуу, БелАЗ-аас зайлсхий. Улаан шатахууны сав +50 м.'],
  puzzle: ['Таавар 3×3', 'Хоосон нүдний хажуугийн дугаар дээр товшиж зөөнө. Сумаар ч болно. 1–8 дараалуулахад цаг зогсоно.'],
};
function openGame(k) {
  game = k === 'flappy' ? Flappy : k === 'race' ? Race : Puzzle;
  showView('play'); setWhere(k);
  $('#playTitle').textContent = GAMES[k].name; $('#hudLabel').textContent = GAMES[k].hud;
  cv.hidden = !!game.dom; $('#pzWrap').hidden = !game.dom;
  game.reset(); setHud();
  $('#rdTitle').textContent = READY[k][0]; $('#rdHow').textContent = READY[k][1];
  $('#ovReady').hidden = false; $('#ovOver').hidden = true;
  mode = 'ready';
  requestAnimationFrame(() => { fit(); $('#rdGo').focus({ preventScroll: true }); });
  cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop);
}
function startRun() {
  if (mode === 'run') return;
  $('#ovReady').hidden = true; $('#ovOver').hidden = true;
  if (mode === 'over') game.reset();
  mode = 'run'; last = performance.now();
  game.begin && game.begin();
}
function stopGame() { cancelAnimationFrame(raf); raf = 0; mode = 'idle'; game = null; }
function setHud() { if (game) $('#hud').textContent = game.hud(); }
function loop(ts) {
  raf = requestAnimationFrame(loop);
  if (!game) return;
  const dt = Math.min(0.034, Math.max(0, (ts - last) / 1000)); last = ts;
  if (document.hidden) return;
  if (mode === 'run') {
    const alive = game.update(dt);
    setHud();
    if (alive === false) over();
  } else if (game.idle) game.idle(dt);
  if (!game.dom) game.draw(cx);
}
async function over() {
  mode = 'over'; const k = game.key; const v = game.result();
  sfx(game.won ? 'win' : 'hit');
  $('#ovTitle').textContent = game.won ? 'Шийдлээ!' : 'Тоглоом дууслаа';
  $('#ovScore').textContent = GAMES[k].fmt(v);
  $('#ovBest').textContent = ''; $('#ovSaved').textContent = 'Хадгалж байна…';
  $('#ovOver').hidden = false;
  setTimeout(() => { if (mode === 'over') $('#ovAgain').focus({ preventScroll: true }); }, 350);
  const r = await saveScore(k, v);
  if (!game || game.key !== k) return;
  const bestNow = r.localRecord ? v : r.prev;
  $('#ovBest').replaceChildren();
  if (r.localRecord && r.prev != null) $('#ovBest').append(el('span', 'rec', 'Шинэ дээд амжилт! '), document.createTextNode('Өмнөх: ' + GAMES[k].fmt(r.prev)));
  else if (r.localRecord) $('#ovBest').append(el('span', 'rec', 'Анхны амжилт тань бүртгэгдлээ.'));
  else $('#ovBest').textContent = 'Таны дээд: ' + GAMES[k].fmt(bestNow);
  if (r.team) {
    const rk = rankOf(k, me.uid);
    $('#ovSaved').textContent = rk ? 'Багийн самбарт ' + rk.pos + '-р байр (' + rk.of + ' хүнээс).' : 'Багийн самбарт хадгалагдлаа.';
  } else $('#ovSaved').textContent = 'Энэ төхөөрөмжид хадгалагдлаа.';
}
$('#rdGo').onclick = e => { e.stopPropagation(); startRun(); if (game && game.key === 'flappy') game.input('up'); };
$('#ovAgain').onclick = e => { e.stopPropagation(); sfx('tick'); startRun(); };

stage.addEventListener('pointerdown', e => {
  if (!game || game.dom) return;
  if (e.target.closest('.card')) return;
  e.preventDefault();
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * W;
  if (mode === 'ready') { startRun(); if (game.key === 'flappy') game.input('up'); return; }
  if (mode !== 'run') return;
  if (game.key === 'flappy') game.input('up');
  else game.input(x < W / 2 ? 'left' : 'right');
});
document.addEventListener('keydown', e => {
  if (!chessv.hidden) return chessKey(e);
  if (!quizv.hidden) return quizKey(e);
  if (play.hidden || !game) return;
  if (e.key === 'Escape') { goHub(); return; }
  const k = e.key;
  const dir = (k === 'ArrowLeft' || k === 'a' || k === 'A') ? 'left' : (k === 'ArrowRight' || k === 'd' || k === 'D') ? 'right'
    : (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') ? 'up' : (k === 'ArrowDown' || k === 's' || k === 'S') ? 'down' : null;
  if (k === 'Enter' && mode !== 'run') { e.preventDefault(); startRun(); return; }
  if (!dir) return;
  e.preventDefault();
  if (mode === 'ready' && !game.dom) { startRun(); if (game.key === 'flappy') game.input('up'); return; }
  if (game.dom) { if (mode === 'ready') startRun(); if (mode === 'run') game.input(dir); return; }
  if (mode === 'run') game.input(dir);
});

/* ---------- Болжмор ---------- */
const GROUND = 540, BX = 96, BR = 13, PW = 58;
function ridge(c, off, base, amp, step, color) {
  c.fillStyle = color; c.beginPath(); c.moveTo(0, H);
  const s = -((off % (step * 4)) + step * 4) % (step * 4);
  for (let x = s - step * 4, i = 0; x <= W + step * 4; x += step, i++) {
    const hgt = [0.55, 1, 0.35, 0.8][((i % 4) + 4) % 4] * amp;
    c.lineTo(x, base - hgt);
  }
  c.lineTo(W, H); c.closePath(); c.fill();
}
function rock(c, x, y, w, h, capBottom) {
  if (h <= 0) return;
  c.fillStyle = '#9C6B45'; c.fillRect(x, y, w, h);
  c.fillStyle = '#B88156'; c.fillRect(x + 6, y, 10, h);
  c.fillStyle = '#7F5536'; c.fillRect(x + w - 12, y, 8, h);
  c.fillStyle = 'rgba(0,0,0,.12)';
  for (let yy = y + 18; yy < y + h; yy += 26) c.fillRect(x, yy, w, 3);
  c.fillStyle = '#8A5D3B';
  const cy = capBottom ? y + h - 16 : y; c.fillRect(x - 5, cy, w + 10, 16);
}
const Flappy = {
  key: 'flappy',
  reset() { this.y = 280; this.v = 0; this.pipes = []; this.score = 0; this.spawn = 0.9; this.gx = 0; this.t = 0; this.won = false; },
  begin() {},
  hud() { return String(this.score); },
  result() { return this.score; },
  input(d) { if (d === 'up') { this.v = -330; sfx('flap'); } },
  idle(dt) { this.t += dt; this.y = 280 + Math.sin(this.t * 3) * 8; this.gx += 60 * dt; },
  update(dt) {
    this.t += dt;
    this.v = Math.min(this.v + 1150 * dt, 540); this.y += this.v * dt;
    const sp = 150 + Math.min(90, this.score * 3);
    this.gx += sp * dt;
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const gap = Math.max(132, 172 - this.score * 1.6);
      const top = 60 + Math.random() * (GROUND - 60 - gap - 50);
      this.pipes.push({ x: W + 10, top, gap, passed: false });
      this.spawn = Math.max(1.2, 1.65 - this.score * 0.015);
    }
    for (const p of this.pipes) {
      p.x -= sp * dt;
      if (!p.passed && p.x + PW < BX - BR) { p.passed = true; this.score++; sfx('point'); }
    }
    if (this.pipes.length && this.pipes[0].x < -PW - 20) this.pipes.shift();
    if (this.y - BR < 0) { this.y = BR; this.v = 0; }
    if (this.y + BR >= GROUND) { this.y = GROUND - BR; return false; }
    for (const p of this.pipes) {
      if (BX + BR - 3 > p.x - 5 && BX - BR + 3 < p.x + PW + 5) {
        if (this.y - BR + 3 < p.top || this.y + BR - 3 > p.top + p.gap) return false;
      }
    }
    return true;
  },
  draw(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2B3A67'); g.addColorStop(0.6, '#E8865A'); g.addColorStop(1, '#F6C48B');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,238,196,.9)'; c.beginPath(); c.arc(262, 360, 36, 0, Math.PI * 2); c.fill();
    ridge(c, this.gx * 0.15, 470, 90, 46, '#6E5163');
    ridge(c, this.gx * 0.4, 515, 60, 38, '#8C5D58');
    for (const p of this.pipes) { rock(c, p.x, 0, PW, p.top, true); rock(c, p.x, p.top + p.gap, PW, GROUND - p.top - p.gap, false); }
    c.fillStyle = '#C99B5E'; c.fillRect(0, GROUND, W, H - GROUND);
    c.fillStyle = '#A97D45'; c.fillRect(0, GROUND, W, 5);
    c.fillStyle = '#B4884F';
    for (let x = -(this.gx % 48); x < W; x += 48) c.fillRect(x, GROUND + 18, 24, 5);
    // bird
    c.save(); c.translate(BX, this.y); c.rotate(Math.max(-0.5, Math.min(1.1, this.v / 600)));
    c.fillStyle = '#7B5C3E'; c.beginPath(); c.ellipse(0, 0, 16, 12, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#E9D6B5'; c.beginPath(); c.ellipse(2, 5, 10, 6, 0, 0, Math.PI * 2); c.fill();
    const w = Math.sin(this.t * 22) * 7;
    c.fillStyle = '#5E432B'; c.beginPath(); c.moveTo(-4, -2); c.lineTo(-18, -8 + w); c.lineTo(-10, 4); c.closePath(); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(7, -4, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(8.5, -4, 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#F29A1A'; c.beginPath(); c.moveTo(14, -1); c.lineTo(23, 2); c.lineTo(14, 5); c.closePath(); c.fill();
    c.restore();
    if (mode === 'run' || mode === 'over') {
      c.font = '800 46px Unbounded, "Arial Black", sans-serif'; c.textAlign = 'center';
      c.fillStyle = 'rgba(0,0,0,.25)'; c.fillText(this.score, W / 2 + 2, 92);
      c.fillStyle = '#fff'; c.fillText(this.score, W / 2, 90);
    }
  }
};

/* ---------- Карьерын зам ---------- */
const RL = 48, RW = 264, LW = 88, PY = H - 110;
const laneX = i => RL + LW * i + LW / 2;
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const Race = {
  key: 'race',
  reset() {
    this.lane = 1; this.x = laneX(1); this.t = 0; this.speed = 240; this.dist = 0; this.bonus = 0;
    this.obs = []; this.gap = 160; this.off = 0; this.won = false; this.flash = 0;
    this.shrubs = Array.from({ length: 14 }, () => ({ x: Math.random() < 0.5 ? 6 + Math.random() * 30 : W - 36 + Math.random() * 30, y: Math.random() * H, r: 3 + Math.random() * 4 }));
  },
  begin() {},
  hud() { return fmtInt(this.dist + this.bonus) + ' м'; },
  result() { return Math.round(this.dist + this.bonus); },
  input(d) { if (d === 'left' && this.lane > 0) { this.lane--; sfx('tick'); } if (d === 'right' && this.lane < 2) { this.lane++; sfx('tick'); } },
  idle(dt) { this.off = (this.off + 80 * dt) % 60; },
  spawnRow() {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const two = this.t > 12 && Math.random() < 0.35;
    const blocked = two ? lanes.slice(0, 2) : lanes.slice(0, 1);
    for (const l of blocked) {
      const truck = !two && this.t > 5 && Math.random() < 0.4;
      this.obs.push(truck ? { type: 'truck', x: laneX(l), y: -70, v: 70 + Math.random() * 60 } : { type: 'rock', x: laneX(l), y: -30, s: 0.85 + Math.random() * 0.35 });
    }
    if (Math.random() < 0.3) { const free = lanes[2]; this.obs.push({ type: 'fuel', x: laneX(free), y: -140 }); }
  },
  box(o) {
    if (o.type === 'truck') return { x: o.x - 28, y: o.y - 50, w: 56, h: 100 };
    if (o.type === 'fuel') return { x: o.x - 12, y: o.y - 15, w: 24, h: 30 };
    return { x: o.x - 17 * o.s, y: o.y - 14 * o.s, w: 34 * o.s, h: 28 * o.s };
  },
  update(dt) {
    this.t += dt;
    this.speed = Math.min(640, 240 + this.t * 9);
    const dy = this.speed * dt;
    this.dist += dy / 8; this.off = (this.off + dy) % 60;
    this.x += (laneX(this.lane) - this.x) * Math.min(1, dt * 16);
    for (const s of this.shrubs) { s.y += dy; if (s.y > H + 10) { s.y = -10; s.x = Math.random() < 0.5 ? 6 + Math.random() * 30 : W - 36 + Math.random() * 30; } }
    this.gap -= dy;
    if (this.gap <= 0) { this.spawnRow(); this.gap = Math.max(210, 330 - this.t * 2) + Math.random() * 110; }
    for (const o of this.obs) o.y += dy + (o.type === 'truck' ? o.v * dt : 0);
    this.obs = this.obs.filter(o => o.y < H + 120 && !o.taken);
    this.flash = Math.max(0, this.flash - dt);
    const pb = { x: this.x - 19, y: PY - 36, w: 38, h: 74 };
    for (const o of this.obs) {
      if (!hit(pb, this.box(o))) continue;
      if (o.type === 'fuel') { o.taken = true; this.bonus += 50; this.flash = 0.25; sfx('good'); continue; }
      return false;
    }
    return true;
  },
  draw(c) {
    c.fillStyle = '#D8B67E'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#9AA36A'; for (const s of this.shrubs) { c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#8E6F49'; c.fillRect(RL - 12, 0, 12, H); c.fillRect(RL + RW, 0, 12, H);
    c.fillStyle = '#A8865C'; c.fillRect(RL, 0, RW, H);
    c.fillStyle = 'rgba(255,240,210,.5)';
    for (let i = 1; i < 3; i++) for (let y = -60 + this.off; y < H; y += 60) c.fillRect(RL + LW * i - 2, y, 4, 30);
    for (const o of this.obs) {
      c.save(); c.translate(o.x, o.y);
      if (o.type === 'rock') {
        c.scale(o.s, o.s); c.fillStyle = '#7D7A74'; c.beginPath(); c.moveTo(-17, 4); c.lineTo(-9, -13); c.lineTo(6, -14); c.lineTo(17, -2); c.lineTo(12, 13); c.lineTo(-10, 13); c.closePath(); c.fill();
        c.fillStyle = '#9A968F'; c.beginPath(); c.moveTo(-9, -13); c.lineTo(6, -14); c.lineTo(2, -4); c.lineTo(-8, -3); c.closePath(); c.fill();
      } else if (o.type === 'fuel') {
        c.fillStyle = '#D03C3C'; c.fillRect(-11, -13, 22, 28); c.fillStyle = '#A82C2C'; c.fillRect(-6, -18, 12, 6);
        c.strokeStyle = '#F7D9D9'; c.lineWidth = 2; c.beginPath(); c.moveTo(-6, -6); c.lineTo(6, 8); c.moveTo(6, -6); c.lineTo(-6, 8); c.stroke();
      } else {
        c.fillStyle = '#222'; for (const [wx, wy] of [[-31, -38], [25, -38], [-31, 20], [25, 20]]) c.fillRect(wx, wy, 6, 22);
        c.fillStyle = '#F2C230'; c.fillRect(-27, -50, 54, 80);
        c.fillStyle = '#D9A91F'; for (let y = -42; y < 28; y += 12) c.fillRect(-27, y, 54, 3);
        c.fillStyle = '#E9EEF2'; c.fillRect(-27, 30, 30, 20); c.fillStyle = '#2B3A4A'; c.fillRect(-24, 42, 24, 5);
        c.fillStyle = '#F2C230'; c.fillRect(5, 32, 22, 16);
      }
      c.restore();
    }
    // player HOWO, top-down, facing up
    c.save(); c.translate(this.x, PY);
    c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(-20, -34, 44, 78);
    c.fillStyle = '#222'; for (const [wx, wy] of [[-24, -30], [19, -30], [-24, 8], [19, 8], [-24, 24], [19, 24]]) c.fillRect(wx, wy, 5, 13);
    c.fillStyle = '#F29A1A'; c.fillRect(-20, -14, 40, 52);
    c.fillStyle = '#D07E0E'; for (let y = -8; y < 36; y += 9) c.fillRect(-20, y, 40, 2);
    c.fillStyle = '#E9EEF2'; c.fillRect(-18, -38, 36, 22);
    c.fillStyle = '#2B3A4A'; c.fillRect(-15, -35, 30, 6);
    c.restore();
    if (this.flash > 0) { c.fillStyle = 'rgba(60,197,122,' + (this.flash * 1.2) + ')'; c.fillRect(0, 0, W, H); }
    c.fillStyle = 'rgba(23,32,43,.55)'; c.fillRect(0, 0, W, 34);
    c.fillStyle = '#fff'; c.font = '700 15px Unbounded, "Arial Black", sans-serif'; c.textAlign = 'left';
    c.fillText(fmtInt(this.dist + this.bonus) + ' м', 12, 23);
    c.textAlign = 'right'; c.font = '600 13px "Golos Text", sans-serif';
    c.fillText(Math.round(this.speed / 6) + ' км/ц', W - 12, 22);
  }
};

/* ---------- Таавар 3×3 ---------- */
const pzEl = $('#pz');
const Puzzle = {
  key: 'puzzle', dom: true,
  reset() {
    this.cells = [1, 2, 3, 4, 5, 6, 7, 8, 0];
    let blank = 8, prev = -1;
    for (let i = 0; i < 160 || this.solved(); i++) {
      const nb = this.neighbors(blank).filter(n => n !== prev);
      const n = nb[Math.floor(Math.random() * nb.length)];
      this.cells[blank] = this.cells[n]; this.cells[n] = 0; prev = blank; blank = n;
    }
    this.moves = 0; this.t0 = 0; this.time = 0; this.won = false;
    this.build(); this.paint();
  },
  neighbors(i) { const r = Math.floor(i / 3), c = i % 3, out = []; if (r > 0) out.push(i - 3); if (r < 2) out.push(i + 3); if (c > 0) out.push(i - 1); if (c < 2) out.push(i + 1); return out; },
  solved() { for (let i = 0; i < 8; i++) if (this.cells[i] !== i + 1) return false; return true; },
  build() {
    pzEl.replaceChildren();
    this.btns = {};
    for (let v = 1; v <= 8; v++) {
      const b = el('button'); b.type = 'button'; b.dataset.v = v; b.setAttribute('aria-label', 'Дугаар ' + v);
      b.append(el('span', '', String(v)));
      b.onclick = () => this.tap(v);
      pzEl.append(b); this.btns[v] = b;
    }
  },
  paint() {
    this.cells.forEach((v, i) => {
      if (!v) return; const b = this.btns[v];
      b.style.transform = 'translate(' + (i % 3) * 100 + '%,' + Math.floor(i / 3) * 100 + '%)';
      b.classList.toggle('ok', v === i + 1);
    });
    $('#pzInfo').textContent = 'Нүүдэл: ' + this.moves + (this.moves ? '' : ' · Хоосон нүдний хажуугийн дугаар дээр товш. Сумаар ч болно.');
  },
  tap(v) {
    if (mode === 'ready') startRun();
    if (mode !== 'run') return;
    const i = this.cells.indexOf(v), z = this.cells.indexOf(0);
    if (!this.neighbors(z).includes(i)) return;
    this.cells[z] = v; this.cells[i] = 0; this.moves++;
    if (!this.t0) this.t0 = performance.now();
    sfx('tick'); this.paint();
    if (this.solved()) { this.time = (performance.now() - this.t0) / 1000; this.won = true; }
  },
  input(dir) {
    const z = this.cells.indexOf(0), r = Math.floor(z / 3), c = z % 3;
    let from = -1;
    if (dir === 'left' && c < 2) from = z + 1;
    if (dir === 'right' && c > 0) from = z - 1;
    if (dir === 'up' && r < 2) from = z + 3;
    if (dir === 'down' && r > 0) from = z - 3;
    if (from >= 0) this.tap(this.cells[from]);
  },
  hud() { const s = this.won ? this.time : this.t0 ? (performance.now() - this.t0) / 1000 : 0; return s.toFixed(1) + ' сек'; },
  result() { return Math.round(this.time * 10) / 10; },
  update() { return !this.won; },
  draw() {},
};

/* ---------- quiz bank ---------- */
// [ангилал, асуулт, зөв хариулт, буруу1, буруу2, буруу3]
const BANK = [
  ['Монгол', 'Монгол Улсын хамгийн өндөр оргил аль нь вэ?', 'Хүйтэн оргил', 'Отгонтэнгэр', 'Сутай хайрхан', 'Мөнххайрхан'],
  ['Монгол', 'Талбайгаараа Монголын хамгийн том нуур аль нь вэ?', 'Увс нуур', 'Хөвсгөл нуур', 'Хяргас нуур', 'Хар-Ус нуур'],
  ['Монгол', 'Монголын хамгийн гүн нуур аль нь вэ?', 'Хөвсгөл нуур', 'Увс нуур', 'Хар нуур', 'Буйр нуур'],
  ['Монгол', 'Бүхэлдээ Монголын нутгаар урсдаг хамгийн урт гол аль нь вэ?', 'Орхон гол', 'Туул гол', 'Хэрлэн гол', 'Завхан гол'],
  ['Монгол', 'Улаанбаатар хотыг дайран урсдаг гол аль нь вэ?', 'Туул гол', 'Сэлэнгэ гол', 'Орхон гол', 'Хэрлэн гол'],
  ['Монгол', 'Их Монгол Улс хэдэн онд байгуулагдсан бэ?', '1206 он', '1162 он', '1227 он', '1240 он'],
  ['Монгол', 'Нийслэл Хүрээг хэдэн онд Улаанбаатар хот гэж нэрлэсэн бэ?', '1924 он', '1911 он', '1921 он', '1940 он'],
  ['Монгол', 'Монгол Улс хэдэн аймагтай вэ?', '21', '18', '22', '24'],
  ['Монгол', 'Монгол Улсын төрийн далбаан дээрх бэлгэдэл юу вэ?', 'Соёмбо', 'Хас тэмдэг', 'Өлзий хээ', 'Түмэн наст'],
  ['Монгол', 'Төгрөг анх хэдэн онд гүйлгээнд гарсан бэ?', '1925 он', '1921 он', '1936 он', '1955 он'],
  ['Монгол', 'Монгол Улс хэдэн улстай хиллэдэг вэ?', '2', '3', '4', '1'],
  ['Монгол', 'Эрийн гурван наадамд аль нь ордоггүй вэ?', 'Шатар', 'Бөх', 'Морь уралдаан', 'Сур харваа'],
  ['Монгол', 'Монгол бичгийг ямар чиглэлд бичдэг вэ?', 'Дээрээс доош, зүүнээс баруун тийш', 'Зүүнээс баруун тийш, хэвтээ', 'Баруунаас зүүн тийш, хэвтээ', 'Доороос дээш'],
  ['Монгол', 'Ухаа худгийн нүүрсний уурхай аль аймагт байдаг вэ?', 'Өмнөговь', 'Дорноговь', 'Дундговь', 'Говь-Алтай'],
  ['Монгол', 'Оюу толгой ямар төрлийн орд вэ?', 'Зэс, алтны', 'Нүүрсний', 'Төмрийн хүдрийн', 'Уранын'],
  ['Монгол', 'Хархорум хотод 1235 онд хэрэм, ордон бариулсан хаан хэн бэ?', 'Өгөдэй хаан', 'Чингис хаан', 'Хубилай хаан', 'Мөнх хаан'],
  ['Ерөнхий', 'Дэлхийн хамгийн өндөр уул аль нь вэ?', 'Эверест (Жомолунгма)', 'К2', 'Канченжанга', 'Монблан'],
  ['Ерөнхий', 'Нарны аймгийн хамгийн том гариг аль нь вэ?', 'Бархасбадь', 'Санчир', 'Тэнгэрван', 'Дэлхий'],
  ['Ерөнхий', '«Улаан гариг» гэж аль гаригийг нэрлэдэг вэ?', 'Ангараг', 'Сугар', 'Буд', 'Санчир'],
  ['Ерөнхий', 'Хүний биеийн хамгийн том эрхтэн аль нь вэ?', 'Арьс', 'Элэг', 'Уушги', 'Тархи'],
  ['Ерөнхий', 'Насанд хүрсэн хүн хэдэн ястай вэ?', '206', '186', '226', '300'],
  ['Ерөнхий', 'Шатрын хөлөг хэдэн нүдтэй вэ?', '64', '81', '100', '49'],
  ['Ерөнхий', 'Олимпийн тэмдэг хэдэн цагирагтай вэ?', '5', '4', '6', '7'],
  ['Ерөнхий', 'Нэг хоногт хэдэн секунд байдаг вэ?', '86 400', '36 000', '24 000', '72 000'],
  ['Ерөнхий', 'Дэлхийн хамгийн том далай аль нь вэ?', 'Номхон далай', 'Атлантын далай', 'Энэтхэгийн далай', 'Хойд мөсөн далай'],
  ['Ерөнхий', 'Гэрэл секундэд ойролцоогоор хэдэн км явдаг вэ?', '300 000 км', '30 000 км', '3 000 км', '3 000 000 км'],
  ['Техник', 'Дизель хөдөлгүүрт түлш юуны нөлөөгөөр асдаг вэ?', 'Шахалтаар халсан агаар', 'Оч лаа', 'Цахилгаан нум', 'Галын хошуу'],
  ['Техник', '12.00R20 дугуйн тэмдэглэгээнд «R» юуг заадаг вэ?', 'Радиал бүтэц', 'Резин', 'Даацын индекс', 'Хурдны индекс'],
  ['Техник', '12.00R20 дугуйн «20» юуг заадаг вэ?', 'Обудын диаметр, инчээр', 'Дугуйн өргөн, см-ээр', 'Давхаргын тоо', 'Хийн даралт'],
  ['Техник', '15W-40 тосны «W» юуг илэрхийлдэг вэ?', 'Өвлийн (хүйтэнд асах) зуурамтгай чанар', 'Жин', 'Усанд тэсвэртэй', 'Ажлын температур'],
  ['Техник', '1 бар даралт ойролцоогоор хэдэн psi вэ?', '14.5 psi', '10 psi', '32 psi', '1 psi'],
  ['Техник', 'Строп, гинжин дээрх «WLL» юуг заадаг вэ?', 'Ажлын зөвшөөрөгдөх ачаалал', 'Утасны урт', 'Тасрах ачаалал', 'Үйлдвэрлэсэн он'],
  ['Техник', 'Стропын салаа хоорондын өнцөг томрох тусам салаа бүрийн ачаалал яах вэ?', 'Нэмэгдэнэ', 'Буурна', 'Өөрчлөгдөхгүй', 'Тэг болно'],
  ['Техник', 'ABC гал унтраагуурын «B» ангилал юунд зориулагдсан бэ?', 'Шатамхай шингэн', 'Хатуу эд зүйл', 'Хий', 'Металл'],
  ['Техник', 'LOTO (Lockout/Tagout) гэж юу вэ?', 'Эрчим хүчийг тасалж, түгжиж, пайзлах', 'Ачаа өргөх дохио', 'Дугуй солих журам', 'Тосолгооны хуваарь'],
  ['Техник', 'Тоормосны ABS систем юунаас сэргийлдэг вэ?', 'Тоормослоход дугуй түгжрэхээс', 'Хөдөлгүүр халахаас', 'Дугуйн хий гарахаас', 'Түлш хэт зарцуулахаас'],
  ['Техник', 'Турбо хөдөлгүүрийн турбиныг юу эргүүлдэг вэ?', 'Яндангийн хий', 'Сэнсний бүс', 'Цахилгаан мотор', 'Түлшний насос'],
  ['Техник', 'Хар тугалгат аккумуляторт ямар хүчил байдаг вэ?', 'Хүхрийн хүчил', 'Давсны хүчил', 'Азотын хүчил', 'Цууны хүчил'],
  ['Техник', 'HOWO самосвалын үндсэн тоормос ямар төрлийн вэ?', 'Пневматик (хийн)', 'Механик (тросс)', 'Цахилгаан', 'Зөвхөн гидравлик'],
  ['Техник', 'Техник рүү авирахдаа хэдэн цэгээр тулах ёстой вэ?', '3', '1', '2', '4'],
  ['Техник', 'Ямар дуу чимээнээс эхлэн чихний хамгаалалт заавал хэрэглэх вэ?', '85 дБ', '50 дБ', '65 дБ', '120 дБ'],
  ['Техник', 'Дугуйн хийн даралтыг хэзээ шалгах нь зөв бэ?', 'Дугуй хүйтэн үед', 'Удаан явсны дараа шууд', 'Халуун үдээр', 'Хамаагүй'],
  ['Техник', 'Нүүрстөрөгчийн дутуу исэл (CO) ямар шинжтэй вэ?', 'Өнгөгүй, үнэргүй', 'Шар өнгөтэй', 'Хурц үнэртэй', 'Хөх утаатай'],
  ['Логик', 'Дараагийн тоо аль нь вэ? 2, 4, 8, 16, …', '32', '24', '20', '64'],
  ['Логик', 'Дараагийн тоо аль нь вэ? 1, 1, 2, 3, 5, 8, …', '13', '11', '12', '16'],
  ['Логик', '200-ийн 15% хэд вэ?', '30', '15', '20', '35'],
  ['Логик', '3 машин 3 минутад 3 ачаа зөөдөг. 100 машин 100 ачааг хэдэн минутад зөөх вэ?', '3 минут', '100 минут', '33 минут', '1 минут'],
  ['Логик', 'Цаг яг 3:00 болоход цагийн хоёр зүүний хоорондох өнцөг хэд вэ?', '90°', '45°', '120°', '180°'],
  ['Логик', 'Өнөөдөр Лхагва гараг бол 10 хоногийн дараа ямар гараг вэ?', 'Бямба', 'Баасан', 'Ням', 'Даваа'],
  ['Логик', '48 км/ц хурдтай машин 15 минутад хэдэн км явах вэ?', '12 км', '8 км', '16 км', '24 км'],
  ['Логик', 'Хайрцагт 12 шүүр байдаг. 7 машинд 3 шүүр хэрэгтэй бол хамгийн багадаа хэдэн хайрцаг авах вэ?', '2', '1', '3', '4'],
];
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pickQs(seed, n) {
  const r = rng(seed);
  return shuffle(BANK.map((_, i) => i), r).slice(0, n).map(i => {
    const row = BANK[i]; const order = shuffle([0, 1, 2, 3], r);
    return { cat: row[0], q: row[1], opts: order.map(k => row[2 + k]), k: order.indexOf(0) };
  });
}

/* ---------- quiz UI (shared by solo and live) ---------- */
const QMS = 15000, RMS = 5000, QN = 10;
const qMain = $('#qMain'), qSide = $('#qSide');
let Q = null;  // active controller
function qPoints(remain, qms = QMS) { return 500 + Math.round(500 * Math.max(0, remain) / qms); }
function drawQuestion(q, i, n, onPick) {
  qMain.replaceChildren();
  const meta = el('div', 'qmeta'); meta.append(el('span', 'cat', q.cat), el('span', 'num', (i + 1) + ' / ' + n));
  const timer = el('div', 'timer'); const bar = el('i'); timer.append(bar);
  const text = el('h2', 'qtext', q.q);
  const opts = el('div', 'opts');
  const btns = q.opts.map((o, j) => {
    const b = el('button', 'opt'); b.type = 'button';
    b.append(el('kbd', '', String(j + 1)), el('span', '', o));
    b.onclick = () => onPick(j);
    opts.append(b); return b;
  });
  const status = el('div', 'qstatus');
  qMain.append(meta, timer, text, opts, status);
  return { bar, btns, status };
}
function setBar(ui, frac) { ui.bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, frac)) + ')'; }
function showReveal(ui, q, picked) {
  ui.btns.forEach((b, j) => { b.disabled = true; b.classList.remove('picked'); if (j === q.k) b.classList.add('right'); else if (j === picked) b.classList.add('wrong'); else b.classList.add('dim'); });
}
function quizKey(e) {
  if (e.key === 'Escape') { goHub(); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 4 && Q && Q.pickKey) { e.preventDefault(); Q.pickKey(n - 1); }
  if (e.key === 'Enter' && Q && Q.enter) { e.preventDefault(); Q.enter(); }
}
function openQuiz(live) {
  stopQuiz(); showView('quiz'); setWhere(live ? 'live' : 'quiz');
  $('#qTitle').textContent = live ? 'Хамтдаа сорил' : 'Мэдлэгийн сорил';
  $('#qHud').textContent = '0';
  Q = live ? makeLive() : makeSolo();
  Q.start();
}
function stopQuiz() { if (Q) { Q.stop(); Q = null; } qMain.replaceChildren(); qSide.replaceChildren(); qSide.hidden = true; }

function makeSolo() {
  let qs, i, pts, ok, ui, t0, timer = 0, next = 0, answered = false;
  const S = {
    start() { qs = pickQs((Math.random() * 2 ** 31) | 0, QN); i = 0; pts = 0; ok = 0; qSide.hidden = true; S.show(); },
    show() {
      answered = false;
      ui = drawQuestion(qs[i], i, QN, j => S.pick(j));
      t0 = performance.now(); setBar(ui, 1);
      cancelAnimationFrame(timer);
      const tick = () => { const rem = QMS - (performance.now() - t0); setBar(ui, rem / QMS); if (rem <= 0) S.pick(-1); else timer = requestAnimationFrame(tick); };
      timer = requestAnimationFrame(tick);
    },
    pick(j) {
      if (answered) return; answered = true; cancelAnimationFrame(timer);
      const rem = QMS - (performance.now() - t0); const q = qs[i];
      showReveal(ui, q, j);
      if (j === q.k) { const p = qPoints(rem); pts += p; ok++; ui.status.textContent = 'Зөв! +' + p; ui.status.className = 'qstatus good'; sfx('good'); }
      else { ui.status.textContent = j < 0 ? 'Хугацаа дууслаа.' : 'Буруу.'; ui.status.className = 'qstatus bad'; sfx('bad'); }
      $('#qHud').textContent = fmtInt(pts);
      next = setTimeout(() => { i++; if (i < QN) S.show(); else S.end(); }, 1500);
    },
    pickKey(j) { if (ui && !answered) S.pick(j); },
    async end() {
      qMain.replaceChildren();
      const box = el('div', 'lobby');
      box.append(el('p', 'big', 'Үр дүн: ' + fmtInt(pts) + ' оноо'), el('p', '', QN + ' асуултаас ' + ok + ' зөв.'));
      const saved = el('p', 'note', 'Хадгалж байна…'); box.append(saved);
      const bt = el('div', 'btns'); bt.style.justifyContent = 'flex-start';
      const again = el('button', 'btn', 'Дахин тоглох'); again.type = 'button'; again.onclick = () => { sfx('tick'); S.start(); };
      const back = el('button', 'btn ghost', 'Буцах'); back.type = 'button'; back.dataset.back = '';
      bt.append(again, back); box.append(bt); qMain.append(box); again.focus({ preventScroll: true });
      S.enter = () => S.start();
      sfx('win');
      const r = await saveScore('quiz', pts);
      if (Q !== S) return;
      const rk = r.team ? rankOf('quiz', me.uid) : null;
      saved.textContent = (r.localRecord ? 'Шинэ дээд амжилт! ' : 'Таны дээд: ' + GAMES.quiz.fmt(r.prev) + '. ') + (rk ? 'Багийн самбарт ' + rk.pos + '-р байр.' : r.team ? 'Багийн самбарт хадгалагдлаа.' : 'Энэ төхөөрөмжид хадгалагдлаа.');
    },
    stop() { cancelAnimationFrame(timer); clearTimeout(next); },
  };
  return S;
}

/* ---------- live team quiz over the room ---------- */
function makeLive() {
  let lq = null, iv = 0, g = null, qs = null, key = '', ui = null, my = null, peersCache = [], names = () => 'Тоглогч', stopped = false;
  let nick = LS.get('nick', '');
  // own question sets live in db quizsets/<uid>/sets/<id>; a game names one by path and every player reads it
  let mySets = [], setsOff = null, setsReady = false, pickSet = LS.get('liveSet', '') || '', editing = null, delArm = false;
  const left = new Set();
  const SET_RE = /^quizsets\/[A-Za-z0-9_\-.~:@+]{1,128}\/sets\/[A-Za-z0-9_\-.~:@+]{1,64}$/;
  const SECS = [10, 15, 20, 30];
  const per = () => g.qms + RMS;
  const valid = x => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length < 40 && Number.isFinite(x.seed) && Number.isFinite(x.start)
    && Number.isInteger(x.n) && x.n >= 1 && x.n <= 40 && (x.qms == null || SECS.includes(x.qms / 1000))
    && (x.set == null || (typeof x.set === 'string' && SET_RE.test(x.set)));
  const players = () => {
    const best = new Map();
    for (const p of peersCache) {
      const s = p.presence && p.presence.s;
      if (!g || !s || s.gid !== g.id || !Number.isFinite(s.pts)) continue;
      const k = p.by || p.peer; const prev = best.get(k);
      if (!prev || s.pts > prev.s.pts) best.set(k, { p, s });
    }
    return [...best.values()].sort((a, b) => b.s.pts - a.s.pts);
  };
  async function refreshNames() {
    const ids = [...new Set(peersCache.map(p => p.by).filter(Boolean))];
    let ps = {}; if (user && ids.length) ps = await user.profiles(ids);
    names = p => { const pr = p.by && ps[p.by]; const nk = p.presence && typeof p.presence.nick === 'string' ? p.presence.nick.slice(0, 24) : ''; return (pr && pr.name) || nk || (p.isMe ? 'Та' : 'Тоглогч'); };
    renderSide(); if (!g) renderLobby();
  }
  function pickGame() {
    let best = null; const now = Date.now();
    for (const p of peersCache) { const x = p.presence && p.presence.g; if (valid(x) && !left.has(x.id) && now < x.start + x.n * ((x.qms || QMS) + RMS) + 180000 && (!best || x.start > best.start)) best = x; }
    return best;
  }
  function adopt(x) {
    g = { id: x.id, seed: x.seed, start: x.start, n: x.n, qms: x.qms || QMS, set: x.set || null, title: typeof x.title === 'string' ? x.title.slice(0, 60) : null };
    qs = g.set ? null : pickQs(g.seed, g.n); key = '';
    if (g.set) loadSet(g);
    my = { gid: g.id, pts: 0, ok: 0, ans: {} };
    $('#qHud').textContent = '0';
    lq.presence({ g, s: { gid: g.id, pts: 0, ok: 0 }, a: null, nick: nick || null }).catch(() => {});
  }
  function startNew() {
    if (!lq || editing) return;
    const src = pickSet ? mySets.find(s => s.path === pickSet) : null;
    if (pickSet && !src) return;
    sfx('tick');
    const x = { id: Math.random().toString(36).slice(2, 10), seed: (Math.random() * 2 ** 31) | 0, start: Date.now() + (src ? 8000 : 6000),
      n: src ? src.qs.length : QN, qms: (src ? src.sec : QMS / 1000) * 1000, set: src ? src.path : null, title: src ? src.title : null };
    adopt(x);
  }
  async function loadSet(gg) {
    let out = 'err';
    try {
      const d = db ? await db.doc(gg.set).get() : null, v = d && d.exists ? d.data() : null;
      const list = v && Array.isArray(v.qs) ? v.qs : [], r = rng(gg.seed);
      const mapped = list.slice(0, gg.n).map(x => {
        const o = Array.isArray(x && x.o) ? x.o.map(s => String(s).slice(0, 120)) : [], ord = shuffle(o.map((_, i) => i), r);
        return { cat: gg.title || 'Өөрийн асуулт', q: String((x && x.q) || '').slice(0, 300), opts: ord.map(i => o[i]), k: ord.indexOf(x && x.k) };
      });
      if (mapped.length === gg.n && mapped.every(q => q.q && q.opts.length >= 2 && q.k >= 0)) out = mapped;
    } catch {}
    if (g === gg) { qs = out; key = ''; }
  }
  function normSet(id, v) {
    if (!v || !Array.isArray(v.qs)) return null;
    const list = v.qs.filter(x => x && typeof x.q === 'string' && Array.isArray(x.o) && x.o.length >= 2 && Number.isInteger(x.k) && x.k >= 0 && x.k < x.o.length).slice(0, 40);
    if (!list.length) return null;
    return { id, path: 'quizsets/' + me.uid + '/sets/' + id, title: typeof v.title === 'string' && v.title.trim() ? v.title.slice(0, 60) : 'Миний асуултууд', sec: SECS.includes(v.sec) ? v.sec : 15, qs: list, at: v.at || 0 };
  }
  function ensureSets() {
    if (setsOff || !db || !me.uid) return;
    setsOff = db.collection('quizsets/' + me.uid + '/sets').onSnapshot(s => {
      mySets = s.docs.map(d => normSet(d.id, d.data())).filter(Boolean).sort((a, b) => b.at - a.at);
      setsReady = true;
      if (!g && !editing) renderLobby();
    }, () => { setsOff = null; });
  }
  function renderLobby() {
    if (g || !lq || editing) return;
    ensureSets();
    if (setsReady && pickSet && !mySets.some(s => s.path === pickSet)) { pickSet = ''; LS.set('liveSet', ''); }
    const act = document.activeElement, fid = act && qMain.contains(act) && act.id, sel = fid ? act.selectionStart : null;
    qMain.replaceChildren();
    const box = el('div', 'lobby');
    box.append(el('p', 'big', 'Багаараа нэг дор тоглоё'));
    box.append(el('p', '', 'Хамт олон энэ хуудсыг нээгээд энд ирнэ. Хэн нэг нь «Эхлүүлэх» дарахад хэдэн секундын дараа бүгдэд ижил асуулт зэрэг гарна. Зөв бас хурдан хариулбал илүү оноо (асуулт бүрт 500–1000). Өөрийн асуултаар тэмцээн ч зохиож болно.'));
    const f = el('div', 'field');
    const inp = el('input'); inp.id = 'nick'; inp.maxLength = 24; inp.placeholder = 'Нэр (заавал биш)'; inp.value = nick;
    inp.onchange = () => { nick = inp.value.trim().slice(0, 24); LS.set('nick', nick); lq && lq.presence({ nick: nick || null }).catch(() => {}); };
    f.append(inp); box.append(f);
    const src = el('div', 'chopts qsrc'), seg = el('div', 'seg');
    const opt = (label, path) => { const b = chBtn(label, '', () => { pickSet = path; LS.set('liveSet', path); sfx('tick'); renderLobby(); }); b.setAttribute('aria-pressed', String(pickSet === path)); seg.append(b); };
    opt('Бэлэн асуулт · ' + QN, '');
    for (const s of mySets) opt(s.title + ' · ' + s.qs.length, s.path);
    src.append(el('span', 'seglbl', 'Асуултууд'), seg);
    const cur = mySets.find(s => s.path === pickSet);
    if (db && me.uid && canWrite) {
      const tools = chBtns(chBtn('＋ Өөрийн асуулт бэлдэх', 'btn ghost', () => openEditor(null)), cur ? chBtn('Засах', 'btn ghost', () => openEditor(cur)) : null);
      tools.style.justifyContent = 'flex-start'; src.append(tools);
    } else if (inClaude) src.append(el('p', 'note', 'Өөрийн асуултаар тэмцээн зохиоход claude.ai дээр нэвтэрсэн, Contributor эрхтэй байх хэрэгтэй.'));
    box.append(src);
    const here = peersCache.filter(p => p.kind === 'viewer');
    box.append(el('p', 'note', 'Одоо энд: ' + here.length + ' хүн' + (here.length < 2 ? '. Бусдыгаа дуудаарай!' : '.')));
    const bt = chBtns(chBtn(cur ? 'Эхлүүлэх: ' + cur.title : 'Эхлүүлэх', 'btn', startNew)); bt.style.justifyContent = 'flex-start';
    box.append(bt);
    qMain.append(box);
    Q.enter = startNew;
    if (fid) { const e = document.getElementById(fid); if (e) { e.focus({ preventScroll: true }); try { if (sel != null) e.setSelectionRange(sel, sel); } catch {} } }
  }
  /* own question set editor: question, up to 4 answers, circle the right one */
  function openEditor(set) {
    sfx('tick'); delArm = false;
    editing = set
      ? { path: set.path, title: set.title, sec: set.sec, qs: set.qs.map(x => ({ q: x.q, o: [0, 1, 2, 3].map(i => x.o[i] || ''), k: x.k })) }
      : { path: null, title: '', sec: 15, qs: [{ q: '', o: ['', '', '', ''], k: 0 }] };
    renderEditor();
  }
  function closeEditor() { editing = null; delArm = false; renderLobby(); renderSide(); }
  function renderEditor(focusLast) {
    const E = editing; Q.enter = null; Q.pickKey = null;
    qMain.replaceChildren();
    const box = el('div', 'lobby qed');
    box.append(el('p', 'big', E.path ? 'Асуултын багц засах' : 'Шинэ асуултын багц'));
    box.append(el('p', '', 'Асуулт, хариултуудаа бичээд зөв хариултынхаа өмнөх дугуйг сонгоно. Тоглох үед хариултын байрыг холино.'));
    const title = el('input'); title.id = 'qsTitle'; title.maxLength = 60; title.placeholder = 'Багцын нэр, жишээ нь «Аюулгүй ажиллагаа»'; title.value = E.title;
    title.oninput = () => { E.title = title.value; };
    box.append(title);
    const seg = el('div', 'seg'); seg.style.justifyContent = 'flex-start';
    for (const s of SECS) {
      const b = chBtn(s + ' сек', '', () => { E.sec = s; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); });
      b.setAttribute('aria-pressed', String(E.sec === s)); seg.append(b);
    }
    box.append(el('span', 'seglbl', 'Асуулт бүрийн хугацаа'), seg);
    E.qs.forEach((x, i) => {
      const c = el('div', 'qcard'), head = el('div', 'qhead');
      head.append(el('b', '', (i + 1) + '-р асуулт'));
      if (E.qs.length > 1) head.append(chBtn('Устгах', 'linkbtn', () => { E.qs.splice(i, 1); renderEditor(); }));
      const ta = el('textarea'); ta.rows = 2; ta.maxLength = 300; ta.placeholder = 'Асуулт'; ta.value = x.q;
      ta.oninput = () => { x.q = ta.value; };
      c.append(head, ta);
      const name = 'qk' + i + '-' + rid(), rows = [];
      x.o.forEach((v, j) => {
        const row = el('div', 'qopt' + (x.k === j ? ' ok' : ''));
        const r = el('input'); r.type = 'radio'; r.name = name; r.checked = x.k === j;
        r.setAttribute('aria-label', (j + 1) + '-р хариулт зөв');
        r.onchange = () => { x.k = j; rows.forEach((rw, n) => rw.classList.toggle('ok', n === j)); };
        const inp = el('input'); inp.maxLength = 120; inp.placeholder = (j + 1) + '-р хариулт' + (j > 1 ? ' (заавал биш)' : ''); inp.value = v;
        inp.oninput = () => { x.o[j] = inp.value; };
        row.append(r, inp); rows.push(row); c.append(row);
      });
      box.append(c);
      if (focusLast && i === E.qs.length - 1) requestAnimationFrame(() => { ta.focus({ preventScroll: true }); c.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
    });
    if (E.qs.length < 40) box.append(chBtns(chBtn('＋ Асуулт нэмэх', 'btn ghost', () => { E.qs.push({ q: '', o: ['', '', '', ''], k: 0 }); renderEditor(true); })));
    const err = el('p', 'note bad'); err.id = 'qsErr';
    box.append(err);
    const bt = chBtns(chBtn('Хадгалах', 'btn', () => saveSet(err)), chBtn('Болих', 'btn ghost', () => { sfx('tick'); closeEditor(); }),
      E.path ? chBtn('Багцыг устгах', 'linkbtn', async b => {
        if (!delArm) { delArm = true; err.textContent = 'Дахин дарвал багц бүрмөсөн устна.'; return; }
        try { await db.doc(E.path).delete(); mySets = mySets.filter(s => s.path !== E.path); if (pickSet === E.path) { pickSet = ''; LS.set('liveSet', ''); } closeEditor(); }
        catch { err.textContent = 'Устгаж чадсангүй. Дахин оролдоно уу.'; }
      }) : null);
    bt.style.justifyContent = 'flex-start';
    box.append(bt);
    qMain.append(box);
  }
  async function saveSet(err) {
    const E = editing, out = [];
    for (const [i, x] of E.qs.entries()) {
      const q = x.q.trim(), o = []; let k = -1;
      x.o.forEach((v, j) => { const s = v.trim(); if (s) { if (j === x.k) k = o.length; o.push(s); } });
      if (!q && !o.length) continue;
      if (!q) { err.textContent = (i + 1) + '-р асуултын текст хоосон байна.'; return; }
      if (o.length < 2) { err.textContent = (i + 1) + '-р асуултад дор хаяж 2 хариулт бичнэ үү.'; return; }
      if (k < 0) { err.textContent = (i + 1) + '-р асуултын зөв хариултыг дугуйлна уу.'; return; }
      out.push({ q, o, k });
    }
    if (!out.length) { err.textContent = 'Дор хаяж нэг асуулт бичнэ үү.'; return; }
    const path = E.path || 'quizsets/' + me.uid + '/sets/' + rid();
    err.textContent = 'Хадгалж байна…';
    try {
      const body = { title: E.title.trim().slice(0, 60) || 'Миний асуултууд', sec: E.sec, qs: out, at: Date.now() };
      await db.doc(path).set(body);
      if (editing !== E) return;
      mySets = [normSet(path.split('/').pop(), body), ...mySets.filter(s => s.path !== path)];   // before the snapshot arrives
      pickSet = path; LS.set('liveSet', path); sfx('good');
      closeEditor();
    } catch (e) {
      err.textContent = 'Хадгалж чадсангүй' + (e && e.code === 'invalid_argument' ? ': эрх хүрэхгүй эсвэл хэт урт байна.' : '. Дахин оролдоно уу.');
    }
  }
  function renderSide() {
    if (!lq) return;
    qSide.hidden = false; qSide.replaceChildren();
    const list = g ? players() : peersCache.filter(p => p.kind === 'viewer').map(p => ({ p, s: null }));
    qSide.append(el('h4', '', g ? 'Онооны самбар' : 'Энд байгаа хүмүүс'));
    const ol = el('ol', 'rows');
    list.slice(0, 12).forEach((r, i) => {
      const li = el('li'); if (r.p.isMe) li.classList.add('me');
      li.append(el('span', 'rk', String(i + 1)), el('span', 'av'));
      li.append(el('span', 'nm', names(r.p) + (r.p.isMe ? ' (та)' : '')));
      li.append(el('span', 'sc num', r.s ? fmtInt(r.s.pts) : ''));
      ol.append(li);
    });
    qSide.append(ol);
    if (!list.length) qSide.append(el('p', 'empty', 'Хүлээж байна…'));
  }
  function answeredCount(i) {
    const seen = new Set();
    for (const p of peersCache) { const a = p.presence && p.presence.a; if (a && g && a.gid === g.id && a.q === i) seen.add(p.by || p.peer); }
    return seen.size;
  }
  function pick(i, j) {
    if (!g || !my || my.ans[i] != null || !Array.isArray(qs) || !qs[i] || j >= qs[i].opts.length) return;
    const now = Date.now(); const w = now - g.start - i * per();
    if (w < 0 || w >= g.qms) return;
    my.ans[i] = j;
    const ok = j === qs[i].k;
    if (ok) { my.pts += qPoints(g.qms - w, g.qms); my.ok++; }
    ui.btns.forEach((b, k) => { b.disabled = true; if (k === j) b.classList.add('picked'); });
    ui.status.textContent = 'Хариулт илгээгдлээ. Бусдыг хүлээж байна…'; ui.status.className = 'qstatus';
    sfx('tick');
    lq.presence({ s: { gid: g.id, pts: my.pts, ok: my.ok }, a: { gid: g.id, q: i } }).catch(() => {});
  }
  function phaseAt(now) {
    const t = now - g.start;
    if (t < 0) return { ph: 'count', i: -1, rem: -t };
    const i = Math.floor(t / per());
    if (i >= g.n) return { ph: 'final', i: g.n, rem: 0 };
    const w = t - i * per();
    return w < g.qms ? { ph: 'q', i, rem: g.qms - w } : { ph: 'r', i, rem: per() - w };
  }
  function renderPhase(st) {
    if (st.ph === 'count') {
      qMain.replaceChildren();
      const box = el('div', 'lobby');
      box.append(el('p', 'big', g.title ? '«' + g.title + '»' : 'Бэлдээрэй!'), el('div', 'count', String(Math.ceil(st.rem / 1000))),
        el('p', '', g.n + ' асуулт · асуулт бүрт ' + g.qms / 1000 + ' секунд.' + (qs === 'err' ? ' Асуултыг ачаалж чадсангүй.' : !qs ? ' Асуулт ачаалж байна…' : '')));
      qMain.append(box); ui = null; Q.enter = null; return;
    }
    if ((st.ph === 'q' || st.ph === 'r') && !Array.isArray(qs)) {
      qMain.replaceChildren(el('p', 'empty', qs === 'err' ? 'Энэ асуултын багцыг уншиж чадсангүй. Зохион байгуулагчаас шалгуулаарай.' : 'Асуулт ачаалж байна…'));
      ui = null; return;
    }
    if (st.ph === 'q' || st.ph === 'r') {
      if (!ui || ui.i !== st.i) { ui = drawQuestion(qs[st.i], st.i, g.n, j => pick(st.i, j)); ui.i = st.i; Q.pickKey = j => pick(st.i, j); }
      if (my.ans[st.i] != null && st.ph === 'q') { ui.btns.forEach((b, k) => { b.disabled = true; if (k === my.ans[st.i]) b.classList.add('picked'); }); }
      if (st.ph === 'r') {
        const j = my.ans[st.i] ?? -1; showReveal(ui, qs[st.i], j);
        const ok = j === qs[st.i].k;
        ui.status.textContent = ok ? 'Зөв! Нийт ' + fmtInt(my.pts) + ' оноо.' : (j < 0 ? 'Хариулаагүй. ' : 'Буруу. ') + 'Зөв хариулт: ' + qs[st.i].opts[qs[st.i].k];
        ui.status.className = 'qstatus ' + (ok ? 'good' : 'bad'); sfx(ok ? 'good' : 'bad');
        $('#qHud').textContent = fmtInt(my.pts);
      }
      return;
    }
    // final
    ui = null; Q.pickKey = null;
    qMain.replaceChildren();
    const box = el('div', 'lobby');
    const top = players();
    box.append(el('p', 'big', 'Үр дүн'));
    const pod = el('div', 'podium');
    [1, 0, 2].forEach(ix => { const r = top[ix]; const d = el('div', 'p' + (ix + 1)); d.append(el('b', '', String(ix + 1))); d.append(el('span', '', r ? names(r.p) : '—')); d.append(el('span', 'num', r ? fmtInt(r.s.pts) : '')); pod.append(d); });
    box.append(pod);
    const myRank = top.findIndex(r => r.p.isMe);
    box.append(el('p', '', 'Та ' + (myRank >= 0 ? (myRank + 1) + '-р байр, ' : '') + fmtInt(my.pts) + ' оноо, ' + g.n + ' асуултаас ' + my.ok + ' зөв.'));
    const bt = el('div', 'btns'); bt.style.justifyContent = 'flex-start';
    const again = el('button', 'btn', 'Дахин эхлүүлэх'); again.type = 'button'; again.onclick = startNew;
    const pickOther = chBtn('Асуулт сонгох', 'btn ghost', () => {
      sfx('tick'); left.add(g.id); g = null; qs = null; ui = null; my = null; key = '';
      lq.presence({ g: null, s: null, a: null }).catch(() => {});
      renderLobby(); renderSide();
    });
    const back = el('button', 'btn ghost', 'Буцах'); back.type = 'button'; back.dataset.back = '';
    bt.append(again, pickOther, back); box.append(bt); qMain.append(box);
    Q.enter = startNew; sfx('win');
  }
  function tick() {
    if (stopped || !lq) return;
    const cand = editing ? null : pickGame();
    if (cand && (!g || (cand.id !== g.id && cand.start > g.start))) adopt(cand);
    if (!g) return;
    const st = phaseAt(Date.now());
    const k = st.ph + ':' + st.i + (st.ph === 'count' ? ':' + Math.ceil(st.rem / 1000) : '');
    if (k !== key) { key = k; renderPhase(st); renderSide(); }
    if (ui && (st.ph === 'q')) {
      setBar(ui, st.rem / g.qms);
      if (my.ans[st.i] != null) {
        const n = answeredCount(st.i), tot = Math.max(1, players().length);
        ui.status.textContent = 'Хариулт илгээгдлээ. ' + n + '/' + tot + ' хариулсан.';
      }
    } else if (ui && st.ph === 'r') setBar(ui, 0);
  }
  const L = {
    async start() {
      qSide.hidden = false;
      qMain.replaceChildren(el('p', 'empty', 'Багийн өрөөнд холбогдож байна…'));
      if (!room) {
        qMain.replaceChildren(el('p', 'empty', inClaude
          ? 'Хамтдаа горим энэ харагдацад ажиллахгүй байна. Хуудсыг claude.ai дээр нэвтэрч нээгээрэй. Ганцаараа «Мэдлэгийн сорил» тоглож болно.'
          : 'Хамтдаа сорил зөвхөн Claude дээрх хувилбарт (Artifact линк) ажиллана. Энд ганцаараа «Мэдлэгийн сорил» тоглоорой.'));
        qSide.hidden = true; return;
      }
      try { lq = await room.join('quiz'); } catch { lq = null; }
      if (stopped) { lq && lq.leave().catch(() => {}); return; }
      if (!lq) { qMain.replaceChildren(el('p', 'empty', 'Багийн өрөөнд холбогдож чадсангүй. Түр хүлээгээд дахин нээнэ үү.')); qSide.hidden = true; return; }
      lq.presence({ nick: nick || null, g: null, s: null, a: null }).catch(() => {});
      peersCache = lq.peers();
      lq.onPeers(ch => { peersCache = ch.peers; refreshNames(); }, () => {});
      renderLobby(); renderSide(); refreshNames();
      iv = setInterval(tick, 120);
    },
    stop() { stopped = true; clearInterval(iv); if (setsOff) { setsOff(); setsOff = null; } if (lq) { lq.leave().catch(() => {}); lq = null; } },
  };
  return L;
}

/* ---------- Шатар: дүрэм ба компьютер (a8 = 0 … h1 = 63, цагаан = том үсэг) ---------- */
const CH = (() => {
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const jumps = d => Array.from({ length: 64 }, (_, s) => d.filter(([a, b]) => on((s >> 3) + a, (s & 7) + b)).map(([a, b]) => s + a * 8 + b));
  const NT = jumps([[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]);
  const KT = jumps([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]);
  // RAY[s][0–3] diagonals, [4–7] straight lines, nearest square first
  const RAY = Array.from({ length: 64 }, (_, s) => [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]].map(([a, b]) => {
    const o = []; for (let r = (s >> 3) + a, c = (s & 7) + b; on(r, c); r += a, c += b) o.push(r * 8 + c); return o;
  }));
  const isW = p => p < 'a';
  const sq = s => 'abcdefgh'[s & 7] + (8 - (s >> 3));
  const uci = m => sq(m.f) + sq(m.t) + (m.promo ? m.promo.toLowerCase() : '');
  const key = st => st.b.map(p => p || '.').join('') + st.turn + st.cs + st.ep;
  const kingAt = (b, w) => b.indexOf(w ? 'K' : 'k');

  function fromFen(f) {
    const [pos, turn, cs = '-', ep = '-'] = f.split(' '), b = [];
    for (const ch of pos.replace(/\//g, '')) {
      if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) b.push('');
      else b.push(ch);
    }
    return { b, turn, ep: ep === '-' ? -1 : 'abcdefgh'.indexOf(ep[0]) + (8 - +ep[1]) * 8, half: 0, full: 1,
      cs: (cs.includes('K') ? 1 : 0) | (cs.includes('Q') ? 2 : 0) | (cs.includes('k') ? 4 : 0) | (cs.includes('q') ? 8 : 0) };
  }
  const start = () => fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');

  function attacked(b, s, byW) {
    const r = s >> 3, c = s & 7;
    if (byW) { if (r < 7 && ((c > 0 && b[s + 7] === 'P') || (c < 7 && b[s + 9] === 'P'))) return true; }
    else if (r > 0 && ((c > 0 && b[s - 9] === 'p') || (c < 7 && b[s - 7] === 'p'))) return true;
    const N = byW ? 'N' : 'n', K = byW ? 'K' : 'k', B = byW ? 'B' : 'b', R = byW ? 'R' : 'r', Q = byW ? 'Q' : 'q';
    for (const t of NT[s]) if (b[t] === N) return true;
    for (const t of KT[s]) if (b[t] === K) return true;
    const rays = RAY[s];
    for (let d = 0; d < 8; d++) {
      for (const t of rays[d]) { const p = b[t]; if (!p) continue; if (p === Q || p === (d < 4 ? B : R)) return true; break; }
    }
    return false;
  }
  // moves that may still leave the own king in check (castling is checked here already)
  function pseudo(st) {
    const b = st.b, w = st.turn === 'w', out = [];
    for (let s = 0; s < 64; s++) {
      const p = b[s]; if (!p || isW(p) !== w) continue;
      const t = w ? p.toLowerCase() : p;
      if (t === 'p') {
        const dir = w ? -8 : 8, one = s + dir, r = s >> 3, c = s & 7, promo = r === (w ? 1 : 6);
        const add = (to, cap, flag) => {
          if (promo) for (const q of 'qrbn') out.push({ f: s, t: to, p, cap, promo: w ? q.toUpperCase() : q });
          else out.push({ f: s, t: to, p, cap, flag });
        };
        if (!b[one]) { add(one, ''); if (r === (w ? 6 : 1) && !b[one + dir]) add(one + dir, '', 'dbl'); }
        for (const dc of [-1, 1]) {
          if (c + dc < 0 || c + dc > 7) continue;
          const to = one + dc, q = b[to];
          if (q && isW(q) !== w) add(to, q);
          else if (to === st.ep) add(to, w ? 'p' : 'P', 'ep');
        }
      } else if (t === 'n' || t === 'k') {
        for (const to of (t === 'n' ? NT : KT)[s]) { const q = b[to]; if (!q || isW(q) !== w) out.push({ f: s, t: to, p, cap: q }); }
        if (t === 'k' && s === (w ? 60 : 4) && (st.cs & (w ? 3 : 12)) && !attacked(b, s, !w)) {
          const R = w ? 'R' : 'r';
          if ((st.cs & (w ? 1 : 4)) && !b[s + 1] && !b[s + 2] && b[s + 3] === R && !attacked(b, s + 1, !w) && !attacked(b, s + 2, !w)) out.push({ f: s, t: s + 2, p, cap: '', flag: 'ck' });
          if ((st.cs & (w ? 2 : 8)) && !b[s - 1] && !b[s - 2] && !b[s - 3] && b[s - 4] === R && !attacked(b, s - 1, !w) && !attacked(b, s - 2, !w)) out.push({ f: s, t: s - 2, p, cap: '', flag: 'cq' });
        }
      } else {
        const rays = RAY[s], d0 = t === 'r' ? 4 : 0, d1 = t === 'b' ? 4 : 8;
        for (let d = d0; d < d1; d++) for (const to of rays[d]) { const q = b[to]; if (q && isW(q) === w) break; out.push({ f: s, t: to, p, cap: q }); if (q) break; }
      }
    }
    return out;
  }
  function make(st, m) {
    const b = st.b.slice(), w = st.turn === 'w';
    b[m.t] = m.promo || m.p; b[m.f] = '';
    if (m.flag === 'ep') b[m.t + (w ? 8 : -8)] = '';
    else if (m.flag === 'ck') { b[m.f + 1] = b[m.f + 3]; b[m.f + 3] = ''; }
    else if (m.flag === 'cq') { b[m.f - 1] = b[m.f - 4]; b[m.f - 4] = ''; }
    let cs = st.cs;
    if (cs) {
      if (m.p === 'K') cs &= 12; else if (m.p === 'k') cs &= 3;
      for (const x of [m.f, m.t]) cs &= x === 63 ? ~1 : x === 56 ? ~2 : x === 7 ? ~4 : x === 0 ? ~8 : 15;
    }
    return { b, turn: w ? 'b' : 'w', cs, ep: m.flag === 'dbl' ? (m.f + m.t) >> 1 : -1,
      half: m.cap || m.p === 'P' || m.p === 'p' ? 0 : st.half + 1, full: st.full + (w ? 0 : 1) };
  }
  const inCheck = st => attacked(st.b, kingAt(st.b, st.turn === 'w'), st.turn !== 'w');
  function legal(st) {
    const w = st.turn === 'w', K = w ? 'K' : 'k', ks = kingAt(st.b, w);
    return pseudo(st).filter(m => !attacked(make(st, m).b, m.p === K ? m.t : ks, !w));
  }
  const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
  function san(st, m, all) {
    let s;
    if (m.flag === 'ck') s = 'O-O';
    else if (m.flag === 'cq') s = 'O-O-O';
    else {
      const t = m.p.toUpperCase();
      if (t === 'P') s = (m.cap ? 'abcdefgh'[m.f & 7] + 'x' : '') + sq(m.t) + (m.promo ? '=' + FIG[m.promo.toUpperCase()] : '');
      else {
        const amb = all.filter(o => o.p === m.p && o.t === m.t && o.f !== m.f);
        let dis = '';
        if (amb.length) dis = !amb.some(o => (o.f & 7) === (m.f & 7)) ? 'abcdefgh'[m.f & 7] : !amb.some(o => (o.f >> 3) === (m.f >> 3)) ? String(8 - (m.f >> 3)) : sq(m.f);
        s = FIG[t] + dis + (m.cap ? 'x' : '') + sq(m.t);
      }
    }
    const n = make(st, m);
    if (inCheck(n)) s += legal(n).length ? '+' : '#';
    return s;
  }
  function outcome(st, counts, ms) {
    if (!ms.length) return inCheck(st) ? { end: 'mate', win: st.turn === 'w' ? 'b' : 'w' } : { end: 'stale', win: null };
    if (st.half >= 100) return { end: 'fifty', win: null };
    if ((counts.get(key(st)) || 0) >= 3) return { end: 'rep', win: null };
    const rest = st.b.filter(p => p && p !== 'K' && p !== 'k');
    if (!rest.length || (rest.length === 1 && 'nNbB'.includes(rest[0]))) return { end: 'mat', win: null };
    return null;
  }

  // computer: material + piece-square tables, alpha-beta with captures-only tail
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const T = s => s.trim().split(/\s+/).map(Number);
  const PST = {
    p: T(`0 0 0 0 0 0 0 0  50 50 50 50 50 50 50 50  10 10 20 30 30 20 10 10  5 5 10 25 25 10 5 5  0 0 0 20 20 0 0 0  5 -5 -10 0 0 -10 -5 5  5 10 10 -20 -20 10 10 5  0 0 0 0 0 0 0 0`),
    n: T(`-50 -40 -30 -30 -30 -30 -40 -50  -40 -20 0 0 0 0 -20 -40  -30 0 10 15 15 10 0 -30  -30 5 15 20 20 15 5 -30  -30 0 15 20 20 15 0 -30  -30 5 10 15 15 10 5 -30  -40 -20 0 5 5 0 -20 -40  -50 -40 -30 -30 -30 -30 -40 -50`),
    b: T(`-20 -10 -10 -10 -10 -10 -10 -20  -10 0 0 0 0 0 0 -10  -10 0 5 10 10 5 0 -10  -10 5 5 10 10 5 5 -10  -10 0 10 10 10 10 0 -10  -10 10 10 10 10 10 10 -10  -10 5 0 0 0 0 5 -10  -20 -10 -10 -10 -10 -10 -10 -20`),
    r: T(`0 0 0 0 0 0 0 0  5 10 10 10 10 10 10 5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  -5 0 0 0 0 0 0 -5  0 0 0 5 5 0 0 0`),
    q: T(`-20 -10 -10 -5 -5 -10 -10 -20  -10 0 0 0 0 0 0 -10  -10 0 5 5 5 5 0 -10  -5 0 5 5 5 5 0 -5  0 0 5 5 5 5 0 -5  -10 5 5 5 5 5 0 -10  -10 0 5 0 0 0 0 -10  -20 -10 -10 -5 -5 -10 -10 -20`),
    k: T(`-30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30  -30 -40 -40 -50 -50 -40 -40 -30  -20 -30 -30 -40 -40 -30 -30 -20  -10 -20 -20 -20 -20 -20 -20 -10  20 20 0 0 0 0 20 20  20 30 10 0 0 10 30 20`),
    e: T(`-50 -40 -30 -20 -20 -30 -40 -50  -30 -20 -10 0 0 -10 -20 -30  -30 -10 20 30 30 20 -10 -30  -30 -10 30 40 40 30 -10 -30  -30 -10 30 40 40 30 -10 -30  -30 -10 20 30 30 20 -10 -30  -30 -30 0 0 0 0 -30 -30  -50 -30 -30 -30 -30 -30 -30 -50`),
  };
  function evaluate(b) {   // + = white is better
    let wm = 0, bm = 0, ps = 0, np = 0, wk = 0, bk = 0;
    for (let s = 0; s < 64; s++) {
      const p = b[s]; if (!p) continue;
      if (p === 'K') { wk = s; continue; }
      if (p === 'k') { bk = s; continue; }
      const w = isW(p), t = w ? p.toLowerCase() : p, v = VAL[t];
      if (t !== 'p') np += v;
      if (w) { wm += v; ps += PST[t][s]; } else { bm += v; ps -= PST[t][s ^ 56]; }
    }
    const end = np <= 1300, kt = end ? PST.e : PST.k;
    let e = wm - bm + ps + kt[wk] - kt[bk ^ 56];
    if (end && Math.abs(wm - bm) >= 400 && Math.min(wm, bm) <= 100) {   // drive a bare king to the edge
      const ww = wm > bm, lk = ww ? bk : wk, sk = ww ? wk : bk, lr = lk >> 3, lc = lk & 7;
      const edge = Math.max(3 - lr, lr - 4) + Math.max(3 - lc, lc - 4);
      const near = 14 - Math.abs(lr - (sk >> 3)) - Math.abs(lc - (sk & 7));
      e += (ww ? 1 : -1) * (edge * 12 + near * 5);
    }
    return e;
  }
  const MATE = 100000;
  function order(ms) {
    for (const m of ms) m.o = (m.cap ? 1000 + 10 * VAL[m.cap.toLowerCase()] - VAL[m.p.toLowerCase()] : 0) + (m.promo ? 800 : 0);
    return ms.sort((a, b) => b.o - a.o);
  }
  function tick(ctx) { if ((++ctx.n & 1023) === 0 && performance.now() > ctx.end) throw ctx; }
  function quiesce(st, alpha, beta, ctx, qd) {
    tick(ctx);
    const w = st.turn === 'w', stand = (w ? 1 : -1) * evaluate(st.b);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd >= ctx.q) return alpha;
    const K = w ? 'K' : 'k', ks = kingAt(st.b, w);
    for (const m of order(pseudo(st).filter(x => x.cap || (x.promo && x.promo.toLowerCase() === 'q')))) {
      const n = make(st, m);
      if (attacked(n.b, m.p === K ? m.t : ks, !w)) continue;
      const v = -quiesce(n, -beta, -alpha, ctx, qd + 1);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }
  function nega(st, depth, alpha, beta, ply, ctx) {
    tick(ctx);
    if (st.half >= 100 || ctx.seen.has(key(st))) return 0;
    if (depth <= 0) return quiesce(st, alpha, beta, ctx, 0);
    const w = st.turn === 'w', K = w ? 'K' : 'k', ks = kingAt(st.b, w);
    let best = -Infinity, any = false;
    for (const m of order(pseudo(st))) {
      const n = make(st, m);
      if (attacked(n.b, m.p === K ? m.t : ks, !w)) continue;
      any = true;
      const v = -nega(n, depth - 1, -beta, -alpha, ply + 1, ctx);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (!any) return attacked(st.b, ks, !w) ? -MATE + ply : 0;
    return best;
  }
  // levels: depth, captures tail, random spread (centipawns), chance of a random move, time budget
  const LEVELS = [{ d: 1, q: 1, nz: 240, rnd: 0.1, ms: 300 }, { d: 2, q: 4, nz: 40, rnd: 0, ms: 900 }, { d: 5, q: 8, nz: 8, rnd: 0, ms: 1500 }];
  function think(st, lvl, seen) {
    const L = LEVELS[lvl] || LEVELS[1], ctx = { n: 0, end: performance.now() + L.ms, seen, q: L.q };
    let ms = order(legal(st));
    if (ms.length < 2) return ms[0] || null;
    if (Math.random() < L.rnd) return ms[Math.floor(Math.random() * ms.length)];
    const nz = new Map(ms.map(m => [m, Math.random() * L.nz]));
    let best = ms[0];
    for (let d = 1; d <= L.d; d++) {
      const sc = new Map(); let top = -Infinity, pick = null;
      try {
        for (const m of ms) {
          const v = -nega(make(st, m), d - 1, -Infinity, L.nz - top, 1, ctx);
          sc.set(m, v);
          if (v + nz.get(m) > top) { top = v + nz.get(m); pick = m; }
        }
      } catch (e) { if (e !== ctx) throw e; break; }
      best = pick;
      ms = ms.slice().sort((a, b) => sc.get(b) - sc.get(a));
      if (top > MATE - 1000) break;
    }
    return best;
  }
  return { start, fromFen, legal, make, inCheck, san, outcome, think, key, uci, sq };
})();

/* ---------- Шатар: хөлөг ба горимууд ---------- */
const chessv = $('#chessv'), chb = $('#chb');
const GL = { k: '♚︎', q: '♛︎', r: '♜︎', b: '♝︎', n: '♞︎', p: '♟︎' };
const PN = { k: 'ноён', q: 'бэрс', r: 'тэрэг', b: 'тэмээ', n: 'морь', p: 'хүү' };
const LVL = ['Амархан', 'Дунд', 'Хүнд'], WIN_PTS = [1, 3, 5];
const INIT = { q: 1, r: 2, b: 2, n: 2, p: 8 }, PV = { q: 9, r: 5, b: 3, n: 3, p: 1 };
const END_TXT = { mate: 'Мат.', stale: 'Пат: нүүх нүүдэл алга.', fifty: '50 нүүдлийн дүрэм.', rep: 'Нэг байрлал 3 удаа давтагдлаа.', mat: 'Мат хийх хүч үлдсэнгүй.', resign: 'Бууж өглөө.', agree: 'Тэнцээг зөвшөөрөв.' };
let chCfg = Object.assign({ mode: 'ai', lvl: 1, col: 'w' }, LS.get('chessCfg', {}));
if (!['ai', 'two', 'net', 'tour'].includes(chCfg.mode)) chCfg.mode = 'ai';
if (![0, 1, 2].includes(chCfg.lvl)) chCfg.lvl = 1;
if (!['w', 'b', 'r'].includes(chCfg.col)) chCfg.col = 'w';
let chs = null, chTimer = 0, resignArm = 0, chDrag = -1, chWasSel = false;
const chSq = Array.from({ length: 64 }, () => { const b = el('button'); b.type = 'button'; chb.append(b); return b; });
const chCur = (g = chs) => g.hist[g.hist.length - 1];
const shown = id => !$('#' + id).hidden;
const rid = () => Math.random().toString(36).slice(2, 10);
const chRunning = () => !!(chs && chs.started && !chs.over && chs.mode !== 'watch');
const nameCache = {};
async function loadNames(ids) {
  const need = [...new Set(ids)].filter(id => typeof id === 'string' && id && !(id in nameCache));
  if (!user || !need.length) return false;
  for (const id of need) nameCache[id] = '';
  try { const ps = await user.profiles(need); for (const id of need) nameCache[id] = (ps[id] && ps[id].name) || ''; } catch {}
  return true;
}
const nameOf = id => (id && id === me.uid ? (me.name || 'Та') : nameCache[id]) || 'Тоглогч';

function chNew(mode, lvl, col, flip) {
  const st = CH.start();
  return { mode, lvl, me: col, flip: !!flip, tb: false, started: false, hist: [st], moves: [], counts: new Map([[CH.key(st), 1]]), legal: CH.legal(st), over: null, thinking: false, sel: -1, net: null };
}
function chApply(g, m) {
  const st = chCur(g), san = CH.san(st, m, g.legal), n = CH.make(st, m), k = CH.key(n);
  g.hist.push(n); g.moves.push({ m, san }); g.counts.set(k, (g.counts.get(k) || 0) + 1);
  g.legal = CH.legal(n); g.over = CH.outcome(n, g.counts, g.legal);
  if (g.over) g.legal = [];
  g.sel = -1;
}
function chReplay(g, list) {
  for (const u of list) { const m = g.legal.find(x => CH.uci(x) === u); if (!m) return false; chApply(g, m); if (g.over) break; }
  return true;
}
const chUcis = g => g.moves.map(x => CH.uci(x.m));
function chSave() {
  const g = chs; if (!g || !g.started || (g.mode !== 'ai' && g.mode !== 'two')) return;
  LS.set('chess', !g.over && g.moves.length ? { mode: g.mode, lvl: g.lvl, me: g.me, flip: g.flip, tb: g.tb, ms: chUcis(g) } : null);
}
function chRestore(sv) {
  if (!sv || !Array.isArray(sv.ms)) return null;
  const g = chNew(sv.mode === 'two' ? 'two' : 'ai', [0, 1, 2].includes(sv.lvl) ? sv.lvl : 1, sv.me === 'b' ? 'b' : 'w', sv.flip);
  g.tb = !!sv.tb; g.started = true;
  chReplay(g, sv.ms.filter(u => typeof u === 'string'));
  return g.over ? null : g;
}

function openChess() {
  showView('chess'); setWhere('chess');
  if (!chs) chs = chNew('ai', chCfg.lvl, 'w', false);
  chJoinRoom();
  if (chCfg.mode === 'tour') chTourList();
  if (!chs.started || chs.over) chSetup(); else { chHide(); chPaint(); chAI(); }
}
function stopChess() { clearTimeout(chTimer); chDrag = -1; if (chs) chs.thinking = false; chLeaveRoom(); chTourStop(); }
function chSetup() {
  $('#chSetup').hidden = false; $('#chEnd').hidden = true; $('#chPromo').hidden = true;
  chSetupPaint(); chPaint();
}
function chHide() { $('#chSetup').hidden = true; $('#chEnd').hidden = true; $('#chPromo').hidden = true; }
function chRefresh() { if (chessv.hidden) return; if (shown('chSetup')) chSetupPaint(); if (chs) chPaint(); }

/* setup card */
function chBtn(label, cls, fn) { const b = el('button', cls, label); b.type = 'button'; b.onclick = fn; return b; }
function chBtns(...bs) { const d = el('div', 'btns'); d.append(...bs.filter(Boolean)); return d; }
function chRow(text, sub, ...btns) {
  const r = el('div', 'lrow'), t = el('span', 'nm', text);
  if (sub) t.append(el('small', '', sub));
  r.append(t, ...btns.filter(Boolean)); return r;
}
function chSeg(items, cur, set) {
  const d = el('div', 'seg');
  for (const [label, v] of items) {
    const b = chBtn(label, '', () => { set(v); LS.set('chessCfg', chCfg); sfx('tick'); chSetupPaint(); });
    b.setAttribute('aria-pressed', String(v === cur)); d.append(b);
  }
  return d;
}
$('#chModes').onclick = e => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  chCfg.mode = b.dataset.mode; LS.set('chessCfg', chCfg); sfx('tick');
  if (chCfg.mode === 'tour') chTourList();
  chSetupPaint();
};
function chSetupPaint() {
  const body = $('#chBody'), act = document.activeElement;
  const fid = act && body.contains(act) && act.id, sel = fid ? act.selectionStart : null;
  for (const b of $$('#chModes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === chCfg.mode));
  body.replaceChildren();
  ({ ai: bodyAi, two: bodyTwo, net: bodyNet, tour: bodyTour })[chCfg.mode](body);
  if (chRunning()) body.append(chBtns(chBtn('Тоглолт руу буцах', 'btn ghost', () => { sfx('tick'); chHide(); chPaint(); chAI(); })));
  if (fid) { const e = document.getElementById(fid); if (e) { e.focus({ preventScroll: true }); try { if (sel != null) e.setSelectionRange(sel, sel); } catch {} } }
}
function bodyAi(box) {
  box.append(el('span', 'seglbl', 'Түвшин'), chSeg(LVL.map((t, i) => [t, i]), chCfg.lvl, v => { chCfg.lvl = v; }));
  box.append(el('span', 'seglbl', 'Таны өнгө'), chSeg([['Цагаан', 'w'], ['Хар', 'b'], ['Санамсаргүй', 'r']], chCfg.col, v => { chCfg.col = v; }));
  const w = WIN_PTS[chCfg.lvl];
  box.append(el('p', 'note', 'Ялбал ' + w + ' оноо, тэнцвэл ' + Math.floor(w / 2) + ' оноо «Шатар» самбарт нэмэгдэнэ. Буцаалт хийсэн тоглолтын ялалт 1 оноо.'));
  box.append(chBtns(chBtn('Эхлэх', 'btn', () => chStartLocal('ai')), chResumeBtn()));
  chNetWarn(box);
}
function bodyTwo(box) {
  box.append(el('p', 'note', 'Нэг утас эсвэл компьютер дээр ээлжилж нүүнэ. Оноо тооцохгүй.'));
  box.append(chBtns(chBtn('Эхлэх', 'btn', () => chStartLocal('two')), chResumeBtn()));
  chNetWarn(box);
}
function chNetWarn(box) { if (chs && chs.mode === 'net' && !chs.over) box.append(el('p', 'note bad', 'Онлайн тоглолт тань үргэлжилж байна. Шинээр эхэлбэл бууж өгснөөр тооцогдоно.')); }
function chResumeBtn() {
  if (chRunning()) return null;
  const sv = LS.get('chess', null);
  if (!sv || !Array.isArray(sv.ms) || !sv.ms.length) return null;
  return chBtn('Өмнөхийг үргэлжлүүлэх', 'btn ghost', () => {
    const g = chRestore(sv);
    if (!g) { LS.set('chess', null); chSetupPaint(); return; }
    chs = g; sfx('tick'); chHide(); chPaint(); chAI();
  });
}
function chStartLocal(mode) {
  sfx('tick'); chQuitNet(); clearTimeout(chTimer);
  const col = mode === 'two' ? 'w' : chCfg.col === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : chCfg.col;
  chs = chNew(mode, chCfg.lvl, col, mode === 'ai' && col === 'b'); chs.started = true;
  LS.set('chess', null);
  chHide(); chPaint(); chAI();
}

/* turns */
function chAI() {
  const g = chs;
  if (!g || !g.started || g.over || g.mode !== 'ai' || chCur(g).turn === g.me || chessv.hidden) return;
  g.thinking = true; chPaint();
  clearTimeout(chTimer);
  chTimer = setTimeout(() => {
    if (chs !== g || chessv.hidden || g.over) { g.thinking = false; return; }
    const m = CH.think(chCur(g), g.lvl, new Set(g.counts.keys()));
    g.thinking = false;
    if (m) chMove(m); else chPaint();
  }, 250);
}
function chMove(m) {
  const g = chs;
  chApply(g, m);
  sfx(m.cap ? 'point' : 'tick');
  if (g.mode === 'net') { g.net.myDraw = false; chNetPub(g); }
  chSave(); chPaint();
  if (g.over) chFinish(); else chAI();
}
function chOppName(g) { return cqName(g.me === 'w' ? g.net.b : g.net.w); }
function chResult(g) {
  const o = g.over; if (!o) return '';
  if (!o.win) return 'Тэнцлээ.';
  if (g.mode === 'ai') return o.win === g.me ? 'Та яллаа!' : 'Компьютер яллаа.';
  if (g.mode === 'net') return o.win === g.me ? 'Та яллаа!' : chOppName(g) + ' яллаа.';
  if (g.mode === 'watch') return cqName(o.win === 'w' ? g.net.w : g.net.b) + ' яллаа.';
  return (o.win === 'w' ? 'Цагаан' : 'Хар') + ' яллаа!';
}
async function chFinish() {
  const g = chs, o = g.over;
  chSave();
  $('#chEndT').textContent = chResult(g);
  $('#chEndD').textContent = END_TXT[o.end] + ' ' + Math.ceil(g.moves.length / 2) + ' нүүдэл' + (g.mode === 'ai' ? ' · ' + LVL[g.lvl] : '') + '.';
  const P = $('#chEndP'); P.textContent = '';
  $('#chEnd').hidden = false; $('#chPromo').hidden = true;
  setTimeout(() => { if (shown('chEnd')) $('#chAgain').focus({ preventScroll: true }); }, 300);
  sfx(!o.win ? 'tick' : (g.mode === 'two' || o.win === g.me) ? 'win' : 'hit');
  if (g.mode === 'net') {
    if (!g.net.end) { g.net.end = { why: o.end, win: o.win }; chNetPub(g); }
    cqNo.add(g.net.id);
    if (g.net.tour) {
      P.textContent = 'Тэмцээний хүснэгтэд бүртгэж байна…';
      const ok = await tourOnlineResult(g);
      if (chs === g) P.textContent = ok ? 'Тэмцээний хүснэгтэд бүртгэгдлээ.' : 'Тэмцээний дүнг «Тэмцээн» хэсэгт шалгаарай.';
    }
    return;
  }
  if (g.mode !== 'ai') return;
  const pts = o.win === g.me ? (g.tb ? 1 : WIN_PTS[g.lvl]) : o.win ? 0 : (g.tb ? 0 : Math.floor(WIN_PTS[g.lvl] / 2));
  if (!pts) { P.textContent = o.win ? 'Дахиад оролдоорой!' : ''; return; }
  P.textContent = 'Хадгалж байна…';
  const prev = Math.max(localBest('chess') || 0, (me.uid && scores.get(me.uid)?.chess?.best) || 0);
  const r = await saveScore('chess', prev + pts);
  if (chs !== g) return;
  const rk = r.team ? rankOf('chess', me.uid) : null;
  P.textContent = '+' + pts + ' оноо, нийт ' + fmtInt(prev + pts) + '. ' + (rk ? 'Багийн самбарт ' + rk.pos + '-р байр.' : r.team ? 'Багийн самбарт хадгалагдлаа.' : 'Энэ төхөөрөмжид хадгалагдлаа.');
}
function chCanUndo(g) {
  if (!g || !g.started || g.over) return false;
  if (g.mode === 'two') return g.moves.length > 0;
  if (g.mode !== 'ai') return false;
  return (g.me === 'w' ? Math.ceil(g.moves.length / 2) : Math.floor(g.moves.length / 2)) > 0;
}

/* painting */
function chWho(box, col, st) {
  const g = chs;
  let name;
  if (g.mode === 'ai') name = col === g.me ? 'Та' : 'Компьютер · ' + LVL[g.lvl];
  else if (g.mode === 'net' || g.mode === 'watch') {
    const k = col === 'w' ? g.net.w : g.net.b;
    name = g.mode === 'net' && col === g.me ? 'Та' : cqName(k) + (cqPeers.some(p => pkey(p) === k) ? '' : ' · гарсан');
  } else name = col === 'w' ? 'Цагаан' : 'Хар';
  const cnt = {}; for (const p of st.b) if (p) cnt[p] = (cnt[p] || 0) + 1;
  let caps = '', mat = 0;
  for (const t of 'qrbnp') {
    const own = col === 'w' ? t.toUpperCase() : t, opp = col === 'w' ? t : t.toUpperCase();
    caps += GL[t].repeat(Math.max(0, INIT[t] - (cnt[opp] || 0)));
    mat += PV[t] * ((cnt[own] || 0) - (cnt[opp] || 0));
  }
  box.replaceChildren(el('span', 'turn'), el('span', 'nm', name));
  box.classList.toggle('on', !!(g.started && !g.over && st.turn === col));
  if (caps) box.append(el('span', 'caps pc ' + (col === 'w' ? 'b' : 'w'), caps));
  if (mat > 0) box.append(el('span', 'adv', '+' + mat));
}
function chPaint() {
  const g = chs; if (!g) return;
  const st = chCur(g), last = g.moves.length ? g.moves[g.moves.length - 1].m : null;
  const tg = new Map(); if (g.sel >= 0) for (const m of g.legal) if (m.f === g.sel) tg.set(m.t, m);
  const check = CH.inCheck(st), ck = check && (!g.over || g.over.end === 'mate') ? st.b.indexOf(st.turn === 'w' ? 'K' : 'k') : -1;
  for (let i = 0; i < 64; i++) {
    const s = g.flip ? 63 - i : i, r = s >> 3, c = s & 7, p = st.b[s], b = chSq[i];
    let cls = (r + c) & 1 ? 'dk' : 'lt';
    if (last && (s === last.f || s === last.t)) cls += ' last';
    if (s === g.sel) cls += ' sel';
    if (tg.has(s)) cls += p || tg.get(s).flag === 'ep' ? ' cap' : ' mv';
    if (s === ck) cls += ' chk';
    b.className = cls;
    const kids = [];
    if (p) kids.push(el('span', 'pc ' + (p < 'a' ? 'w' : 'b'), GL[p.toLowerCase()]));
    if (i >= 56) kids.push(el('span', 'co f', 'abcdefgh'[c]));
    if (i % 8 === 0) kids.push(el('span', 'co r', String(8 - r)));
    b.replaceChildren(...kids);
    b.setAttribute('aria-label', CH.sq(s) + (p ? ', ' + (p < 'a' ? 'цагаан ' : 'хар ') + PN[p.toLowerCase()] : ''));
  }
  chb.classList.toggle('wait', !!g.thinking);
  chWho($('#chTop'), g.flip ? 'w' : 'b', st); chWho($('#chBot'), g.flip ? 'b' : 'w', st);
  let s;
  if (!g.started) s = 'Тохиргоогоо сонгоод эхлүүлээрэй.';
  else if (g.over) s = chResult(g) + ' ' + END_TXT[g.over.end];
  else if (g.thinking) s = 'Компьютер бодож байна…';
  else if (g.mode === 'watch') s = 'Үзэж байна: ' + (st.turn === 'w' ? 'цагаан' : 'хар') + ' нүүнэ.';
  else if (g.mode === 'net') s = (st.turn === g.me ? 'Таны ээлж.' : chOppName(g) + ' бодож байна…') + (g.net.oppDraw ? ' Өрсөлдөгч тэнцээ санал болгож байна.' : '');
  else if (g.mode === 'ai') s = 'Таны ээлж.';
  else s = (st.turn === 'w' ? 'Цагаан' : 'Хар') + ' нүүнэ.';
  if (g.started && !g.over && check) s += ' Шаг!';
  $('#chStatus').textContent = s;
  $('#chStatus').classList.toggle('bad', !!(g.started && !g.over && check));
  $('#chHud').textContent = String(st.full);
  const ol = $('#chMoves'), n = g.moves.length;
  ol.replaceChildren();
  for (let i = 0; i < n; i += 2) {
    const li = el('li');
    li.append(el('span', 'n', (i / 2 + 1) + '.'), el('span', i === n - 1 ? 'cur' : '', g.moves[i].san), el('span', i + 1 === n - 1 ? 'cur' : '', g.moves[i + 1] ? g.moves[i + 1].san : ''));
    ol.append(li);
  }
  ol.hidden = !n; ol.scrollTop = ol.scrollHeight;
  const undo = $('#chUndo'), resign = $('#chResign');
  undo.hidden = resign.hidden = g.mode === 'watch';
  if (g.mode === 'net') {
    undo.textContent = g.net.oppDraw ? 'Тэнцээг зөвшөөрөх' : g.net.myDraw ? 'Тэнцээ санал болгосон' : '½ Тэнцээ санал болгох';
    undo.disabled = !g.started || !!g.over || (g.net.myDraw && !g.net.oppDraw);
  } else { undo.textContent = '↶ Буцаах'; undo.disabled = !chCanUndo(g); }
  resign.disabled = !g.started || !!g.over;
  resign.textContent = resignArm ? 'Итгэлтэй юу?' : 'Бууж өгөх';
  const inv = cq && !chRunning() && !shown('chSetup') ? chIncoming()[0] : null, ib = $('#chInvite');
  ib.hidden = !inv;
  if (inv) ib.replaceChildren(el('span', 'nm', cqName(inv.k) + ' таныг шатар тоглохыг урьж байна.'), chBtn('Харах', 'btn', () => { chCfg.mode = 'net'; chSetup(); }));
}

/* input: tap a piece then a square, or drag */
function chHumanTurn() {
  const g = chs;
  return !!g && g.started && !g.over && !g.thinking && (g.mode === 'two' || ((g.mode === 'ai' || g.mode === 'net') && chCur(g).turn === g.me))
    && !shown('chSetup') && !shown('chPromo') && !shown('chEnd');
}
function chAt(x, y) {
  const r = chb.getBoundingClientRect();
  const c = Math.floor((x - r.left) / r.width * 8), w = Math.floor((y - r.top) / r.height * 8);
  if (c < 0 || c > 7 || w < 0 || w > 7) return -1;
  return chs.flip ? 63 - (w * 8 + c) : w * 8 + c;
}
function chOwn(s) { const st = chCur(), p = st.b[s]; return !!p && (p < 'a') === (st.turn === 'w'); }
function chTry(f, t) {
  const c = chs.legal.filter(m => m.f === f && m.t === t);
  if (!c.length) return false;
  if (c.length > 1) chPromoPick(c); else chMove(c[0]);
  return true;
}
function chTap(s) {   // true when a piece got selected
  const g = chs;
  if (g.sel >= 0 && g.sel !== s && chTry(g.sel, s)) return false;
  if (chOwn(s) && g.legal.some(m => m.f === s)) { g.sel = s; chPaint(); return true; }
  g.sel = -1; chPaint(); return false;
}
chb.addEventListener('pointerdown', e => {
  if (!chHumanTurn() || e.button > 0) return;
  const s = chAt(e.clientX, e.clientY); if (s < 0) return;
  e.preventDefault();
  chWasSel = chs.sel === s;
  chDrag = chTap(s) ? s : -1;
  if (chDrag >= 0) try { chb.setPointerCapture(e.pointerId); } catch {}
});
chb.addEventListener('pointerup', e => {
  if (chDrag < 0) return;
  const from = chDrag; chDrag = -1;
  if (!chHumanTurn()) return;
  const s = chAt(e.clientX, e.clientY);
  if (s === from) { if (chWasSel) { chs.sel = -1; chPaint(); } return; }
  if (s >= 0) chTry(from, s);
});
chb.addEventListener('click', e => {   // keyboard: Enter / Space on a square
  if (e.detail !== 0 || !chHumanTurn()) return;
  const i = chSq.indexOf(e.target.closest('button')); if (i < 0) return;
  chTap(chs.flip ? 63 - i : i);
});
function chPromoPick(cands) {
  const box = $('#chPromoBtns'), w = cands[0].p === 'P';
  box.replaceChildren();
  for (const t of 'qrbn') {
    const m = cands.find(x => x.promo.toLowerCase() === t);
    const b = chBtn('', '', () => { $('#chPromo').hidden = true; chMove(m); });
    b.setAttribute('aria-label', PN[t]); b.title = PN[t];
    b.append(el('span', 'pc ' + (w ? 'w' : 'b'), GL[t]));
    box.append(b);
  }
  $('#chPromo').hidden = false;
}
$('#chPromoX').onclick = () => { $('#chPromo').hidden = true; if (chs) { chs.sel = -1; chPaint(); } };
$('#chFlip').onclick = () => { if (!chs) return; chs.flip = !chs.flip; chSave(); sfx('tick'); chPaint(); };
$('#chNew').onclick = () => { sfx('tick'); chSetup(); };
$('#chAgain').onclick = () => { sfx('tick'); chSetup(); };
$('#chLook').onclick = () => { $('#chEnd').hidden = true; chPaint(); };
$('#chUndo').onclick = () => {
  const g = chs; if (!g) return;
  if (g.mode === 'net') {
    if (!g.started || g.over) return;
    if (g.net.oppDraw) { g.over = { end: 'agree', win: null }; g.legal = []; g.net.end = { why: 'draw', win: null }; chNetPub(g); chPaint(); chFinish(); }
    else if (!g.net.myDraw) { g.net.myDraw = true; chNetPub(g); sfx('tick'); chPaint(); }
    return;
  }
  if (!chCanUndo(g)) return;
  clearTimeout(chTimer); g.thinking = false;
  let k = 1;
  if (g.mode === 'ai') { k = chCur(g).turn === g.me ? 2 : 1; g.tb = true; }
  g.hist.length -= k; g.moves.length -= k;
  g.counts = new Map(); for (const s of g.hist) { const key = CH.key(s); g.counts.set(key, (g.counts.get(key) || 0) + 1); }
  g.legal = CH.legal(chCur(g)); g.over = null; g.sel = -1;
  sfx('tick'); chSave(); chPaint(); chAI();
};
$('#chResign').onclick = () => {
  const g = chs; if (!g || !g.started || g.over) return;
  if (!resignArm) { resignArm = setTimeout(() => { resignArm = 0; chPaint(); }, 3000); chPaint(); return; }
  clearTimeout(resignArm); resignArm = 0;
  clearTimeout(chTimer); g.thinking = false;
  const loser = g.mode === 'two' ? chCur(g).turn : g.me, win = loser === 'w' ? 'b' : 'w';
  g.over = { end: 'resign', win }; g.legal = []; g.sel = -1;
  if (g.mode === 'net') g.net.end = { why: 'resign', win };
  chPaint(); chFinish();
};
function chessKey(e) {
  if (e.key !== 'Escape') return;
  if (shown('chPromo')) { $('#chPromoX').click(); return; }
  goHub();
}

/* ---------- Шатар: онлайн (өрөө «chess»; тоглолтын байдал presence-д) ---------- */
let cq = null, cqPeers = [], cqJoining = false;
const cqMe = { nick: null, inv: null, g: null }, cqNo = new Set();
const pkey = p => p.by || p.peer;
function cqKey() { const p = cqPeers.find(x => x.isMe); return p ? pkey(p) : (me.uid || ''); }
function cqName(k) {
  if (k && k === cqKey()) return 'Та';
  const p = cqPeers.find(x => pkey(x) === k), nk = p && p.presence && typeof p.presence.nick === 'string' ? p.presence.nick.slice(0, 24) : '';
  return nameCache[k] || nk || 'Тоглогч';
}
const isId = (s, n = 64) => typeof s === 'string' && s.length > 0 && s.length <= n;
const validNet = x => !!x && isId(x.id, 12) && isId(x.w) && isId(x.b) && x.w !== x.b && typeof x.mv === 'string' && x.mv.length < 3000;
const validInv = x => !!x && isId(x.id, 12) && isId(x.to) && isId(x.w) && (x.tour == null || isId(x.tour, 12)) && (x.pair == null || /^\d{1,2}-\d{1,2}$/.test(x.pair));
async function chJoinRoom() {
  if (cq || cqJoining || !room) return;
  cqJoining = true;
  let r = null; try { r = await room.join('chess'); } catch {}
  cqJoining = false;
  if (!r) { chRefresh(); return; }
  if (chessv.hidden) { r.leave().catch(() => {}); return; }
  cq = r; cqPeers = r.peers();
  r.onPeers(ch => { cqPeers = ch.peers; chNetSync(); }, () => { cq = null; cqPeers = []; chRefresh(); });
  cqMe.nick = LS.get('nick', '') || null;
  chPub(); chNetSync();
}
function chLeaveRoom() { if (cq) { cq.leave().catch(() => {}); cq = null; cqPeers = []; } }
function chPub() { if (cq) cq.presence(cqMe).catch(() => {}); }
function chNetPub(g) {
  cqMe.g = { id: g.net.id, w: g.net.w, b: g.net.b, mv: chUcis(g).join(' '), tour: g.net.tour, pair: g.net.pair, end: g.net.end || null, draw: !!g.net.myDraw };
  chPub();
}
function chNetSync() {
  if (!cq) return;
  const myK = cqKey(), g = chs;
  loadNames(cqPeers.map(p => p.by)).then(n => { if (n) chRefresh(); });
  for (const p of cqPeers) {
    const x = p.presence && p.presence.g, k = pkey(p);
    if (p.isMe || !validNet(x) || (x.w !== k && x.b !== k) || (x.w !== myK && x.b !== myK)) continue;
    if (g && g.mode === 'net' && g.net.id === x.id) chNetMerge(g, x);
    else if (!x.end && !cqNo.has(x.id) && ((cqMe.inv && cqMe.inv.id === x.id) || !chRunning())) { chNetAdopt(x); return; }
  }
  if (g && g.mode === 'watch') chWatchSync(g);
  chRefresh();
}
function chNetAdopt(x) {
  const myK = cqKey(), col = x.w === myK ? 'w' : 'b';
  const g = chNew('net', 1, col, col === 'b');
  g.started = true;
  g.net = { id: x.id, w: x.w, b: x.b, tour: x.tour || null, pair: x.pair || null, end: null, myDraw: false, oppDraw: false };
  if (!chReplay(g, x.mv ? x.mv.split(' ') : []) || g.over) { cqNo.add(x.id); return; }
  clearTimeout(chTimer);
  chs = g; cqMe.inv = null; chNetPub(g);
  chHide(); chPaint(); sfx('good');
}
function chNetMerge(g, x) {
  g.net.oppDraw = !!x.draw && !x.end;
  if (g.over) return;
  const theirs = x.mv ? x.mv.split(' ') : [], n = g.moves.length;
  if (theirs.length === n + 1 && chCur(g).turn !== g.me && theirs.slice(0, n).join(' ') === chUcis(g).join(' ')) {
    const m = g.legal.find(y => CH.uci(y) === theirs[n]);
    if (m) { chMove(m); return; }
  }
  if (x.end && theirs.length === n) {
    if (x.end.why === 'resign' && x.end.win === g.me) g.over = { end: 'resign', win: g.me };
    else if (x.end.why === 'draw' && g.net.myDraw) g.over = { end: 'agree', win: null };
    if (g.over) { g.legal = []; g.net.end = x.end; chNetPub(g); chPaint(); chFinish(); }
  }
}
function chQuitNet() {
  const g = chs;
  if (!g || g.mode !== 'net' || g.over) return;
  const win = g.me === 'w' ? 'b' : 'w';
  g.over = { end: 'resign', win }; g.legal = []; g.net.end = { why: 'resign', win };
  cqNo.add(g.net.id); chNetPub(g);
  if (g.net.tour) tourOnlineResult(g);
}
function chIncoming() {
  const myK = cqKey(), out = [];
  for (const p of cqPeers) {
    const inv = p.presence && p.presence.inv, k = pkey(p);
    if (p.isMe || !validInv(inv) || inv.to !== myK || cqNo.has(inv.id) || (inv.w !== myK && inv.w !== k)) continue;
    if (chs && chs.mode === 'net' && chs.net.id === inv.id) continue;
    if (!out.some(o => o.inv.id === inv.id)) out.push({ inv, k });
  }
  return out;
}
function chInvite(k, tour, pair, wk) {
  const myK = cqKey();
  cqMe.inv = { to: k, id: rid(), w: wk || (Math.random() < 0.5 ? myK : k), tour: tour || null, pair: pair || null };
  chPub(); sfx('tick'); chSetupPaint();
}
function chAccept(inv, fromK) {
  const myK = cqKey();
  chQuitNet();
  chNetAdopt({ id: inv.id, w: inv.w, b: inv.w === myK ? fromK : myK, mv: '', tour: inv.tour || null, pair: inv.pair || null });
}
function chWatch(x) {
  const g = chNew('watch', 1, 'w', false);
  g.started = true; g.net = { id: x.id, w: x.w, b: x.b };
  chReplay(g, x.mv ? x.mv.split(' ') : []);
  chs = g; chHide(); chPaint();
}
function chWatchSync(g) {
  let best = null;
  for (const p of cqPeers) {
    const x = p.presence && p.presence.g, k = pkey(p);
    if (validNet(x) && x.id === g.net.id && (x.w === k || x.b === k) && (!best || x.mv.length > best.mv.length)) best = x;
  }
  if (!best) return;
  const cur = chUcis(g).join(' ');
  if (best.mv.length > cur.length && best.mv.startsWith(cur)) chReplay(g, best.mv.slice(cur.length).trim().split(' ').filter(Boolean));
  if (best.end && !g.over && (best.end.why === 'resign' || best.end.why === 'draw')) { g.over = best.end.why === 'resign' ? { end: 'resign', win: best.end.win } : { end: 'agree', win: null }; g.legal = []; }
}
function chInvitesInto(box) {
  for (const { inv, k } of chIncoming()) {
    const meWhite = inv.w !== k;
    box.append(chRow(cqName(k) + ' таныг урьж байна', (inv.tour ? 'Тэмцээний тоглолт · ' : '') + 'Та ' + (meWhite ? 'цагаанаар' : 'хараар') + ' тоглоно',
      chBtn('Зөвшөөрөх', 'btn', () => chAccept(inv, k)), chBtn('Татгалзах', 'btn ghost', () => { cqNo.add(inv.id); chRefresh(); })));
  }
}
function bodyNet(box) {
  if (!inClaude || !room) { box.append(el('p', 'note', inClaude ? 'Онлайн тоглолт энэ харагдацад холбогдохгүй байна. claude.ai дээр нэвтэрч нээгээрэй.' : 'Онлайн тоглолт зөвхөн Claude дээрх хувилбарт (Artifact линк) ажиллана.')); return; }
  if (!cq) { box.append(el('p', 'note', 'Шатрын өрөөнд холбогдож байна…')); chJoinRoom(); return; }
  const myK = cqKey();
  chInvitesInto(box);
  box.append(el('h4', 'chh', 'Шатрыг нээсэн хүмүүс'));
  const seen = new Set();
  for (const p of cqPeers) {
    const k = pkey(p);
    if (p.isMe || k === myK || seen.has(k) || p.kind !== 'viewer') continue;
    seen.add(k);
    const x = p.presence && p.presence.g, busy = validNet(x) && !x.end && (x.w === k || x.b === k), mine = cqMe.inv && cqMe.inv.to === k;
    box.append(chRow(cqName(k), mine ? 'Урилга илгээсэн, хүлээж байна…' : busy ? 'Тоглож байна' : 'Чөлөөтэй',
      mine ? chBtn('Цуцлах', 'btn ghost', () => { cqMe.inv = null; chPub(); chSetupPaint(); }) : chBtn('Урих', 'btn', () => chInvite(k))));
  }
  if (!seen.size) box.append(el('p', 'note', 'Одоогоор өөр хүн алга. Хамт олондоо «Шатар → Онлайн»-ыг нээхийг хэлээрэй. Хүн орж ирэхэд энд гарна.'));
  const games = new Map();
  for (const p of cqPeers) {
    const x = p.presence && p.presence.g, k = pkey(p);
    if (validNet(x) && !x.end && (x.w === k || x.b === k) && x.w !== myK && x.b !== myK && (!games.has(x.id) || x.mv.length > games.get(x.id).mv.length)) games.set(x.id, x);
  }
  if (games.size) {
    box.append(el('h4', 'chh', 'Явагдаж буй тоглолт'));
    for (const x of games.values()) box.append(chRow(cqName(x.w) + ' – ' + cqName(x.b), Math.ceil((x.mv ? x.mv.split(' ').length : 0) / 2) + ' нүүдэл', chBtn('Үзэх', 'btn ghost', () => { sfx('tick'); chWatch(x); })));
  }
  box.append(el('p', 'note', 'Урьсан хүн тань зөвшөөрөхөд тоглолт шууд эхэлнэ. Өнгийг санамсаргүй хуваарилна, цаг хэмжихгүй.'));
}

/* ---------- Шатрын тэмцээн (db: tours/<id>, …/players/<uid>, …/games/<pair>) ---------- */
let tours = [], toursOff = null, tour = null, tourDraft = '', tourErr = '', tourEdit = '', tourDel = '';
const T_ST = { join: 'Бүртгэл явагдаж байна', play: 'Явагдаж байна', done: 'Дууссан' };
const pairId = (i, j) => 'p' + Math.min(i, j) + '-' + Math.max(i, j);
const fmtPts = p => p % 1 ? (Math.floor(p) || '') + '½' : String(p);
function rrRounds(n) {   // round robin (circle method); [i, j] = i plays white
  const a = Array.from({ length: n + (n & 1) }, (_, i) => i < n ? i : -1), m = a.length, out = [];
  for (let r = 0; r < m - 1; r++) {
    const ps = [];
    for (let k = 0; k < m / 2; k++) {
      let x = a[k], y = a[m - 1 - k];
      if (x < 0 || y < 0) continue;
      if ((r + k) & 1) [x, y] = [y, x];
      ps.push([x, y]);
    }
    out.push(ps); a.splice(1, 0, a.pop());
  }
  return out;
}
function chTourList() {
  if (toursOff || !db) return;
  toursOff = db.collection('tours').onSnapshot(s => {
    tours = s.docs.map(d => Object.assign({}, d.data(), { id: d.id })).filter(t => typeof t.name === 'string' && T_ST[t.status]).sort((a, b) => (b.at || 0) - (a.at || 0));
    loadNames(tours.map(t => t.by)).then(n => { if (n) tourRepaint(); });
    tourRepaint();
  }, () => { toursOff = null; });
}
function chTourStop() { if (toursOff) { toursOff(); toursOff = null; } chTourClose(); }
function chTourOpen(id) {
  chTourClose();
  const t = { id, players: new Map(), games: new Map(), offs: [] }, base = 'tours/' + id;
  tour = t;
  t.offs.push(db.collection(base + '/players').onSnapshot(s => {
    if (tour !== t) return;
    t.players = new Map(s.docs.map(d => [d.id, d.data()]));
    loadNames([...t.players.keys()]).then(n => { if (n) tourRepaint(); });
    tourRepaint();
  }, () => {}));
  t.offs.push(db.collection(base + '/games').onSnapshot(s => {
    if (tour !== t) return;
    t.games = new Map(s.docs.map(d => [d.id, d.data()]));
    tourRepaint();
  }, () => {}));
  tourRepaint();
}
function chTourClose() { if (tour) { for (const off of tour.offs) try { off(); } catch {} tour = null; } tourEdit = ''; tourDel = ''; }
function tourRepaint() { if (!chessv.hidden && shown('chSetup') && chCfg.mode === 'tour') chSetupPaint(); }
async function tourDo(fn) {
  tourErr = '';
  try { await fn(); } catch (e) { tourErr = 'Хадгалж чадсангүй' + (e && e.code === 'invalid_argument' ? ': эрх хүрэхгүй байна (Contributor эрх хэрэгтэй).' : '. Дахин оролдоно уу.'); }
  tourRepaint();
}
function tourTable(order) {
  const rows = order.map(uid => ({ uid, pts: 0, w: 0, n: 0 })), idx = new Map(order.map((u, i) => [u, i]));
  for (const g of tour.games.values()) {
    const a = idx.get(g.w), b = idx.get(g.b);
    if (a == null || b == null || a === b || !['w', 'b', 'd'].includes(g.res)) continue;
    rows[a].n++; rows[b].n++;
    if (g.res === 'd') { rows[a].pts += 0.5; rows[b].pts += 0.5; }
    else { const W = g.res === 'w' ? a : b; rows[W].pts++; rows[W].w++; }
  }
  return rows.sort((x, y) => y.pts - x.pts || y.w - x.w);
}
async function tourOnlineResult(g) {
  const tid = g.net.tour, pr = g.net.pair;
  if (!db || !tid || !pr || !canWrite) return false;
  const [i, j] = pr.split('-').map(Number);
  const res = g.over.win === 'w' ? 'w' : g.over.win === 'b' ? 'b' : 'd';
  try {
    const t = await db.doc('tours/' + tid).get(), d = t.exists && t.data();
    if (!d || d.status !== 'play' || !Array.isArray(d.order) || d.order[i] !== g.net.w || d.order[j] !== g.net.b) return false;
    const ref = db.doc('tours/' + tid + '/games/' + pairId(i, j)), ex = await ref.get();
    if (!ex.exists) await ref.set({ w: g.net.w, b: g.net.b, res, how: 'online', by: me.uid, at: Date.now(), n: g.moves.length });
    return true;
  } catch { return false; }
}
function bodyTour(box) {
  chInvitesInto(box);
  if (!db || !me.uid) {
    box.append(el('p', 'note', !inClaude ? 'Тэмцээн зөвхөн Claude дээрх хувилбарт (Artifact линк) ажиллана.' : dbState === 'wait' ? 'Холбогдож байна…' : 'Тэмцээн зохиоход claude.ai дээр нэвтэрч нээх хэрэгтэй.'));
    return;
  }
  chTourList();
  if (tourErr) box.append(el('p', 'note bad', tourErr));
  if (tour) return bodyTourOne(box, tours.find(x => x.id === tour.id));
  if (canWrite) {
    const f = el('div', 'field'), inp = el('input');
    inp.id = 'tourName'; inp.maxLength = 60; inp.placeholder = 'Тэмцээний нэр'; inp.value = tourDraft;
    inp.oninput = () => { tourDraft = inp.value; };
    const go = chBtn('Үүсгэх', 'btn', () => {
      const name = tourDraft.trim().slice(0, 60); if (!name) { inp.focus(); return; }
      tourDraft = ''; const id = rid();
      tourDo(async () => {
        await db.doc('tours/' + id).set({ name, by: me.uid, status: 'join', at: Date.now() });
        await db.doc('tours/' + id + '/players/' + me.uid).set({ at: Date.now() });
        chTourOpen(id);
      });
    });
    inp.onkeydown = e => { if (e.key === 'Enter') go.click(); };
    f.append(inp, go);
    box.append(el('h4', 'chh', 'Шинэ тэмцээн зохиох'), f);
  } else box.append(el('p', 'note', 'Тэмцээн үүсгэх, нэгдэхэд Contributor эрх хэрэгтэй. Эзэмшигчээс эрх аваарай.'));
  box.append(el('h4', 'chh', 'Тэмцээнүүд'));
  if (!tours.length) box.append(el('p', 'note', 'Одоогоор тэмцээн алга. Эхнийхийг нь зохиогоорой!'));
  for (const x of tours.slice(0, 20)) box.append(chRow(x.name, T_ST[x.status] + ' · ' + nameOf(x.by), chBtn('Нээх', 'btn ghost', () => { sfx('tick'); tourErr = ''; chTourOpen(x.id); })));
}
function bodyTourOne(box, t) {
  box.append(chBtns(chBtn('← Бүх тэмцээн', 'btn ghost', () => { chTourClose(); tourErr = ''; chSetupPaint(); })));
  if (!t) { box.append(el('p', 'note', 'Тэмцээн олдсонгүй эсвэл устгагдсан.')); return; }
  const org = t.by === me.uid, P = tour.players, joined = P.has(me.uid), base = 'tours/' + t.id;
  box.append(el('h4', 'chh big', t.name), el('p', 'note', T_ST[t.status] + ' · Зохион байгуулагч: ' + nameOf(t.by)));
  const list = (rows, score) => {
    const ol = el('ol', 'rows');
    rows.forEach((r, i) => { const li = el('li'); if (r.uid === me.uid) li.classList.add('me'); li.append(el('span', 'rk', String(i + 1)), el('span', 'av'), el('span', 'nm', nameOf(r.uid)), el('span', 'sc num', score(r))); ol.append(li); });
    return ol;
  };
  if (t.status === 'join') {
    const ids = [...P.keys()];
    box.append(el('h4', 'chh', 'Бүртгүүлсэн: ' + ids.length + ' хүн'), list(ids.map(uid => ({ uid })), () => ''));
    box.append(el('p', 'note', 'Хүн бүр бусад бүх хүнтэй нэг удаа тоглоно. Ялалт 1, тэнцээ ½ оноо. Тоглолтоо энд онлайнаар, эсвэл жинхэнэ хөлөг дээр тоглоод дүнгээ оруулна.'));
    box.append(chBtns(
      canWrite && !joined ? chBtn('Нэгдэх', 'btn', () => tourDo(() => db.doc(base + '/players/' + me.uid).set({ at: Date.now() }))) : null,
      canWrite && joined && !org ? chBtn('Гарах', 'btn ghost', () => tourDo(() => db.doc(base + '/players/' + me.uid).delete())) : null,
      org && ids.length >= 2 ? chBtn('Эхлүүлэх (' + ids.length + ' тоглогч)', 'btn', () => tourDo(() => db.doc(base).update({ status: 'play', order: shuffle(ids, Math.random), started: Date.now() }))) : null,
      org ? chBtn(tourDel === t.id ? 'Итгэлтэй юу? Устгах' : 'Устгах', 'btn ghost', () => {
        if (tourDel !== t.id) { tourDel = t.id; chSetupPaint(); return; }
        tourDel = ''; tourDo(async () => { await db.doc(base).delete(); chTourClose(); });
      }) : null));
    return;
  }
  const order = Array.isArray(t.order) ? t.order.filter(x => typeof x === 'string') : [];
  loadNames(order).then(n => { if (n) tourRepaint(); });
  const table = tourTable(order);
  box.append(el('h4', 'chh', 'Онооны хүснэгт (оноо / тоглосон)'), list(table, r => fmtPts(r.pts) + ' / ' + r.n));
  if (t.status === 'done' && table.length) box.append(el('p', 'rec', 'Аварга: ' + nameOf(table[0].uid) + ', ' + fmtPts(table[0].pts) + ' оноо.'));
  let left = 0;
  rrRounds(order.length).forEach((ps, r) => {
    box.append(el('h4', 'chh', (r + 1) + '-р тойрог'));
    for (const [i, j] of ps) {
      const k = pairId(i, j), wU = order[i], bU = order[j], res = tour.games.get(k);
      const ok = !!res && res.w === wU && res.b === bU && ['w', 'b', 'd'].includes(res.res);
      if (!ok) left++;
      const inPair = me.uid === wU || me.uid === bU, can = canWrite && t.status === 'play' && (inPair || org);
      const label = nameOf(wU) + ' (цагаан) – ' + nameOf(bU);
      if (can && tourEdit === k) {
        const put = v => tourDo(async () => { await db.doc(base + '/games/' + k).set({ w: wU, b: bU, res: v, how: 'board', by: me.uid, at: Date.now() }); tourEdit = ''; });
        box.append(chRow(label, 'Дүнгээ сонгоно уу (цагаан – хар)', chBtn('1–0', 'btn ghost', () => put('w')), chBtn('½–½', 'btn ghost', () => put('d')), chBtn('0–1', 'btn ghost', () => put('b')), chBtn('Болих', 'linkbtn', () => { tourEdit = ''; chSetupPaint(); })));
        continue;
      }
      const sent = cqMe.inv && cqMe.inv.tour === t.id && cqMe.inv.pair === i + '-' + j;
      const oppK = me.uid === wU ? bU : wU;
      const resTxt = ok ? (res.res === 'w' ? '1–0' : res.res === 'b' ? '0–1' : '½–½') + (res.how === 'online' ? ' · онлайн' : '') : sent ? 'Урилга илгээсэн, хүлээж байна…' : 'Тоглоогүй';
      box.append(chRow(label, resTxt,
        can && !ok && inPair && cq ? (sent
          ? chBtn('Цуцлах', 'btn ghost', () => { cqMe.inv = null; chPub(); chSetupPaint(); })
          : chBtn('Онлайн тоглох', 'btn', () => {
            if (!cqPeers.some(p => !p.isMe && pkey(p) === oppK)) { tourErr = nameOf(oppK) + ' одоогоор Шатрыг нээгээгүй байна. Нээсний дараа дахин дараарай.'; chSetupPaint(); return; }
            tourErr = ''; chInvite(oppK, t.id, i + '-' + j, wU);
          })) : null,
        can && (!ok || org) ? chBtn(ok ? 'Засах' : 'Дүн оруулах', 'btn ghost', () => { tourEdit = k; chSetupPaint(); }) : null));
    }
  });
  if (org && t.status === 'play') box.append(chBtns(chBtn(left ? 'Дуусгах (' + left + ' тоглолт үлдсэн)' : 'Тэмцээнийг дуусгах', left ? 'btn ghost' : 'btn', () => tourDo(() => db.doc(base).update({ status: 'done', ended: Date.now() })))));
}

/* ---------- boot ---------- */
const H0 = window.claude && window.claude.hot;
if (H0 && typeof H0.ready === 'function') H0.ready(() => boot()); else boot();
})();
