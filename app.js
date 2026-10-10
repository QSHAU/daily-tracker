const categories = {
  none: { name: "Без категории", color: "var(--none)" },
  study: { name: "Учёба", color: "var(--study)" },
  break: { name: "Перерыв", color: "var(--break)" },
  work: { name: "Работа", color: "var(--work)" },
};
const KEY = "temp-time-tracker-v1";
const THEME_KEY = "temp-theme";
const $ = (id) => document.getElementById(id);
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
let state = { sessions: [], active: null },
  selected = null;
try {
  const data = JSON.parse(localStorage.getItem(KEY));
  if (
    data &&
    Array.isArray(data.sessions) &&
    data.sessions.every(
      (s) =>
        typeof s.id === "string" &&
        Array.isArray(s.segments) &&
        s.segments.every(
          (x) =>
            Number.isFinite(x.start) &&
            (x.end === null || Number.isFinite(x.end)) &&
            categories[x.category],
        ),
    )
  ) {
    state = data;
    state.active = state.sessions.some(
      (s) => s.id === data.active && s.segments.at(-1)?.end === null,
    )
      ? data.active
      : null;
  }
} catch {
  $("error").hidden = false;
  $("error").textContent =
    "Не удалось прочитать сохранённые данные. Экспортируйте данные перед дальнейшей работой.";
}
selected = state.active || state.sessions.at(-1)?.id;
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    $("error").hidden = false;
    $("error").textContent =
      "Браузер не разрешил сохранение. Не закрывайте страницу и экспортируйте данные.";
  }
}

/* ---------- Тема ---------- */
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}
let themeTimer;
function applyTheme(theme, animate) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-anim");
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => root.classList.remove("theme-anim"), 500);
  }
  root.dataset.theme = theme;
  $("theme-toggle").setAttribute(
    "aria-label",
    theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему",
  );
}
applyTheme(storedTheme() || (darkQuery.matches ? "dark" : "light"));
$("theme-toggle").onclick = () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  applyTheme(next, true);
};
darkQuery.addEventListener("change", (e) => {
  if (!storedTheme()) applyTheme(e.matches ? "dark" : "light", true);
});

/* ---------- Форматирование ---------- */
function duration(ms) {
  const sec = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}
function human(ms) {
  const m = Math.floor(ms / 60000),
    h = Math.floor(m / 60);
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
}
function time(ts) {
  return new Date(ts).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function date(ts) {
  return new Date(ts).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}
// Пишет в DOM только если разметка изменилась — чтобы анимации не перезапускались каждую секунду
function setHTML(el, html) {
  if (el._html !== html) {
    el.innerHTML = html;
    el._html = html;
  }
}

/* ---------- Данные ---------- */
function active() {
  return state.sessions.find((s) => s.id === state.active);
}
function current() {
  return state.sessions.find((s) => s.id === selected);
}
function endOf(x, now) {
  return x.end ?? now;
}
function totals(from, to, now = Date.now()) {
  const result = { none: 0, study: 0, break: 0, work: 0 };
  for (const s of state.sessions)
    for (const x of s.segments)
      result[x.category] += Math.max(
        0,
        Math.min(endOf(x, now), to) - Math.max(x.start, from),
      );
  return result;
}
function rows(values) {
  return Object.entries(categories)
    .map(
      ([k, c]) =>
        `<div class="category-row"><span><i style="background:${c.color}"></i>${c.name}</span><b>${human(values[k])}</b></div>`,
    )
    .join("");
}
// at — момент переключения; таймер передаёт точное время окончания, а не «сейчас»
function transition(action, at = Date.now()) {
  const now = at;
  if (action === "start") {
    if (active()) return;
    const id = String(now);
    state.sessions.push({
      id,
      start: now,
      segments: [{ start: now, end: null, category: "none", kind: "focus" }],
    });
    state.active = id;
    selected = id;
  } else {
    const s = active();
    if (!s) return;
    const last = s.segments.at(-1);
    last.end = now;
    if (action === "finish") state.active = null;
    else {
      const paused = last.kind !== "pause";
      // После перерыва продолжаем то же занятие, что было до него
      s.segments.push({
        start: now,
        end: null,
        category: paused
          ? "break"
          : (s.segments.findLast((x) => x.kind === "focus")?.category ?? "none"),
        kind: paused ? "pause" : "focus",
      });
    }
  }
  save();
  render();
}

/* ---------- Таймер ----------
   Отсчёт идёт от начала текущего отрезка: в работе — до перерыва,
   в паузе — до конца перерыва. */
const TIMER_KEY = "temp-timer";
const minutes = (v) => Math.min(720, Math.max(1, Math.round(Number(v)) || 1));
let timer = { on: false, work: 25, rest: 5, auto: false };
try {
  const t = JSON.parse(localStorage.getItem(TIMER_KEY));
  if (t)
    timer = {
      on: !!t.on,
      work: minutes(t.work),
      rest: minutes(t.rest),
      auto: !!t.auto,
    };
} catch {}
function saveTimer() {
  try {
    localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  } catch {}
}
function timerTarget(s) {
  if (!timer.on || !s || s.id !== state.active) return null;
  const last = s.segments.at(-1),
    mins = last.kind === "pause" ? timer.rest : timer.work;
  return {
    at: last.start + mins * 60000,
    kind: last.kind,
    key: `${s.id}:${last.start}:${last.kind}:${mins}`,
  };
}
// Цели, время которых давно прошло на момент изменения состояния (загрузка, удаление,
// смена настроек), считаем отработанными — без звона и автопереключения
const handled = new Set();
function armTimer() {
  const t = timerTarget(active());
  if (t && Date.now() - t.at > 2000) handled.add(t.key);
  syncChime();
}

/* ---------- Звон ----------
   Звук синтезируется Web Audio и планируется заранее на точное время,
   поэтому звучит вовремя даже в фоновой вкладке. */
let audio = null,
  scheduled = null,
  idleTimer;
function getAudio() {
  if (!audio && window.AudioContext) audio = new AudioContext();
  return audio;
}
// kind — какой отрезок закончился: после работы звон нисходящий, после перерыва восходящий
function bell(when, kind) {
  const ctx = audio,
    notes =
      kind === "pause" ? [1046.5, 1318.5, 1568] : [1568, 1318.5, 1046.5],
    master = ctx.createGain(),
    nodes = [];
  master.gain.value = 0.2;
  master.connect(ctx.destination);
  notes.forEach((f, i) => {
    const t = when + i * 0.2;
    for (const [mult, amp, decay] of [
      [1, 0.5, 1.8],
      [2.76, 0.09, 0.7],
      [5.4, 0.03, 0.35],
    ]) {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + decay + 0.05);
      nodes.push(o);
    }
  });
  return nodes;
}
function chimeNow(kind) {
  if (!getAudio()) return;
  clearTimeout(idleTimer);
  audio.resume().then(
    () => {
      bell(audio.currentTime + 0.05, kind);
      idleSoon();
    },
    () => {},
  );
}
function cancelScheduled() {
  if (!scheduled) return;
  for (const o of scheduled.nodes)
    try {
      o.stop();
    } catch {}
  scheduled = null;
}
// Аудио простаивает — усыпляем, чтобы не тратить ресурсы
function idleSoon() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (audio && !scheduled) audio.suspend().catch(() => {});
  }, 4000);
}
function syncChime() {
  const t = timerTarget(active()),
    now = Date.now();
  if (scheduled && scheduled.key !== t?.key) {
    if (scheduled.at > now) cancelScheduled();
    else scheduled = null;
  }
  if (!audio) return;
  if (!t || t.at <= now) {
    idleSoon();
    return;
  }
  if (scheduled) return;
  clearTimeout(idleTimer);
  if (audio.state !== "running") {
    audio.resume().then(() => audio.state === "running" && syncChime(), () => {});
    return;
  }
  const when = audio.currentTime + (t.at - now) / 1000;
  scheduled = { key: t.key, at: t.at, when, nodes: bell(when, t.kind) };
}
// Звук можно включить только после действия пользователя
for (const type of ["pointerdown", "keydown"])
  document.addEventListener(
    type,
    () => {
      if (!audio && getAudio()) syncChime();
    },
    true,
  );
function timerDone(t) {
  handled.add(t.key);
  // Если звон не был запланирован (или компьютер спал и аудио отстало) — звоним сейчас
  const late = scheduled?.key === t.key && audio.currentTime < scheduled.when - 1;
  if (scheduled?.key !== t.key || late) {
    cancelScheduled();
    if (Date.now() - t.at < 60000) chimeNow(t.kind);
  } else scheduled = null;
  idleSoon();
  const text =
    t.kind === "pause"
      ? "Перерыв закончился — пора за дело."
      : `${timer.work} мин работы позади — время отдохнуть.`;
  if (
    document.hidden &&
    "Notification" in window &&
    Notification.permission === "granted"
  )
    new Notification("Темп", { body: text, silent: true });
  const el = $("timer");
  el.classList.remove("ring");
  el.offsetWidth; // перезапуск анимации
  el.classList.add("ring");
  if (timer.auto) transition("pause", t.at);
}
function renderTimerCard() {
  $("timer-on").checked = timer.on;
  $("timer-auto").checked = timer.auto;
  $("timer-card").classList.toggle("off", !timer.on);
  if (document.activeElement !== $("timer-work")) $("timer-work").value = timer.work;
  if (document.activeElement !== $("timer-rest")) $("timer-rest").value = timer.rest;
  document.querySelectorAll("[data-preset]").forEach((b) => {
    const [w, r] = b.dataset.preset.split(",").map(Number);
    b.classList.toggle("active", w === timer.work && r === timer.rest);
  });
}
function updateTimer(patch) {
  Object.assign(timer, patch);
  timer.work = minutes(timer.work);
  timer.rest = minutes(timer.rest);
  saveTimer();
  renderTimerCard();
  armTimer();
  tick();
}

/* ---------- Удаление отрезка ----------
   Соседний отрезок забирает освободившееся время:
   обычно предыдущий растягивается до конца удалённого,
   а если удаляется первый — следующий начинается раньше. */
let fx = null;
const FX_MS = 650;
function removeSegment(s, seg) {
  const i = s.segments.indexOf(seg);
  if (i < 0) return;
  fx = null;
  if (s.segments.length === 1) {
    state.sessions = state.sessions.filter((x) => x !== s);
    if (state.active === s.id) state.active = null;
    selected = state.active || state.sessions.at(-1)?.id;
  } else if (i > 0) {
    const prev = s.segments[i - 1];
    fx = { seg: prev, field: "end", from: prev.end, t0: performance.now() };
    prev.end = seg.end;
  } else {
    const next = s.segments[1];
    fx = { seg: next, field: "start", from: next.start, t0: performance.now() };
    next.start = seg.start;
  }
  s.segments.splice(i, 1);
  save();
  render();
  if (fx) requestAnimationFrame(runFx);
}
function runFx() {
  if (!fx) return;
  const done = performance.now() - fx.t0 >= FX_MS;
  if (done) fx = null;
  clock(current(), Date.now());
  if (!done) requestAnimationFrame(runFx);
}
// Границы отрезка для отрисовки с учётом анимации заполнения после удаления
function bounds(x, now) {
  let start = x.start,
    end = endOf(x, now);
  if (fx && fx.seg === x) {
    const t = Math.min(1, (performance.now() - fx.t0) / FX_MS),
      k = 1 - Math.pow(1 - t, 3);
    if (fx.field === "end") end = fx.from + (end - fx.from) * k;
    else start = fx.from + (start - fx.from) * k;
  }
  return [start, end];
}

/* ---------- Циферблат ---------- */
const R = 170,
  W = 26,
  PERIOD = 43200000;
const point = (r, a) => [
  (200 + r * Math.sin(a)).toFixed(2),
  (200 - r * Math.cos(a)).toFixed(2),
];
function angle(ts) {
  const d = new Date(ts);
  return (
    (((d.getHours() % 12) * 3600000 +
      d.getMinutes() * 60000 +
      d.getSeconds() * 1000 +
      d.getMilliseconds()) /
      PERIOD) *
    2 *
    Math.PI
  );
}
function buildDial() {
  let svg = `<circle class="dial-face" cx="200" cy="200" r="${R - W / 2}"/><circle class="dial-track" cx="200" cy="200" r="${R}" stroke-width="${W}"/>`;
  for (let n = 0; n < 60; n++) {
    const a = (n * Math.PI) / 30,
      major = n % 5 === 0,
      [x1, y1] = point(major ? 136 : 142, a),
      [x2, y2] = point(148, a);
    svg += `<line class="tick${major ? " major" : ""}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  for (let n = 1; n <= 12; n++) {
    const [x, y] = point(114, (n * Math.PI) / 6);
    svg += `<text class="dial-num" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${n}</text>`;
  }
  $("dial-static").innerHTML = svg;
}
function arc(r, from, to) {
  const a = angle(from),
    b = a + (Math.min(to - from, PERIOD - 1) / PERIOD) * 2 * Math.PI;
  const [x1, y1] = point(r, a),
    [x2, y2] = point(r, b);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}
function clock(s, now) {
  let svg = "";
  let end = now;
  if (s) {
    end = endOf(s.segments.at(-1), now);
    const windowStart = Math.max(s.start, end - PERIOD);
    for (const x of s.segments) {
      let [from, to] = bounds(x, now);
      from = Math.max(from, windowStart);
      if (to <= from) continue;
      svg += `<path class="arc" d="${arc(R, from, to)}" style="stroke:${categories[x.category].color}" stroke-width="${W}"/>`;
    }
    // Пунктир снаружи кольца — сколько осталось до сигнала таймера
    const t = timerTarget(s);
    if (t && t.at > now) {
      const [mx, my] = point(193, angle(t.at));
      svg += `<path class="plan-arc" d="${arc(193, now, t.at)}"/><circle class="plan-mark" cx="${mx}" cy="${my}" r="5" style="fill:${t.kind === "pause" ? "var(--accent)" : "var(--break)"}"/>`;
    }
  }
  const a = angle(end),
    [hx, hy] = point(150, a);
  svg += `<line class="hand" x1="200" y1="200" x2="${hx}" y2="${hy}"/><circle class="hand-hub" cx="200" cy="200" r="6"/><circle class="hand-hub-inner" cx="200" cy="200" r="2.2"/>`;
  if (s) {
    const last = s.segments.at(-1),
      [kx, ky] = point(R, a);
    svg += `<circle class="now-knob" cx="${kx}" cy="${ky}" r="8" style="fill:${categories[last.category].color}"/>`;
  }
  $("dial-live").innerHTML = svg;
}

/* ---------- Список отрезков ---------- */
let seenSegments = null;
function renderSegments(now) {
  const s = current();
  const seen = new WeakSet();
  $("segment-count").textContent = s?.segments.length || 0;
  $("segments").innerHTML = s
    ? s.segments
        .map((x, i) => {
          seen.add(x);
          const enter = seenSegments && !seenSegments.has(x) ? " enter" : "";
          const c = categories[x.category].color;
          const only = s.segments.length === 1;
          return `<div class="segment${enter}" style="--c:${c}"><span class="segment-number">${String(i + 1).padStart(2, "0")}</span><div class="segment-time"><span>${time(x.start)} — ${x.end === null ? 'сейчас<span class="live"></span>' : time(x.end)}</span><small>${date(x.start)} · ${x.kind === "pause" ? "Пауза" : "Основной отрезок"}${x.end !== null && date(x.end) !== date(x.start) ? " · окончание " + date(x.end) : ""}</small></div><span class="duration" data-duration="${i}">${duration(endOf(x, now) - x.start)}</span><div class="select-wrap"><i></i><select aria-label="Деятельность для отрезка ${i + 1}" data-segment="${i}">${Object.entries(
            categories,
          )
            .map(
              ([k, c]) =>
                `<option value="${k}" ${k === x.category ? "selected" : ""}>${c.name}</option>`,
            )
            .join(
              "",
            )}</select></div><button class="delete" data-delete="${i}" aria-label="Удалить отрезок ${i + 1}" title="${only ? "Удалить сессию" : "Удалить отрезок — его время перейдёт соседнему"}">${icon("trash")}<span class="delete-label">${only ? "Удалить сессию?" : "Удалить?"}</span></button></div>`;
        })
        .join("")
    : '<div class="empty">Здесь появится ваш первый отрезок.<br>Нажмите «Начать», когда будете готовы.</div>';
  seenSegments = seen;
}
function render() {
  const s = active(),
    now = Date.now(),
    paused = s?.segments.at(-1).kind === "pause";
  $("start").hidden = !!s;
  $("pause").hidden = !s;
  $("finish").hidden = !s;
  setHTML(
    $("pause"),
    paused
      ? `${icon("play")}<span>Продолжить</span>`
      : `${icon("pause")}<span>Остановить</span>`,
  );
  $("status").textContent = s
    ? paused
      ? "Пауза идёт"
      : "Время идёт"
    : "Готовы начать";
  $("status").className = `badge${s ? (paused ? " paused" : " running") : ""}`;
  $("session-select").innerHTML = state.sessions
    .slice()
    .reverse()
    .map(
      (s) =>
        `<option value="${s.id}">${date(s.start)} · ${time(s.start)}${s.id === state.active ? " · текущая" : ""}</option>`,
    )
    .join("");
  $("session-select").parentElement.hidden = !state.sessions.length;
  $("session-select").value = selected || "";
  renderSegments(now);
  armTimer();
  tick();
  renderStats();
}
function tick() {
  const due = timerTarget(active());
  if (due && due.at <= Date.now() && !handled.has(due.key)) {
    timerDone(due);
    if (timer.auto) return; // переключение уже перерисовало экран
  }
  const now = Date.now(),
    s = current(),
    running = s?.id === state.active ? s : null;
  const last = running?.segments.at(-1),
    t = timerTarget(running),
    left = t ? t.at - now : 0;
  $("timer").classList.toggle("countdown", !!t && left > 0);
  $("timer").classList.toggle("rest", last?.kind === "pause");
  $("timer").classList.toggle("over", !!t && left <= 0);
  $("timer-label").textContent = t
    ? left > 0
      ? last.kind === "pause"
        ? "ДО КОНЦА ПЕРЕРЫВА"
        : "ДО ПЕРЕРЫВА"
      : last.kind === "pause"
        ? "ПЕРЕРЫВ ЗАКОНЧИЛСЯ"
        : "ПОРА ОТДОХНУТЬ"
    : last?.kind === "pause"
      ? "ВРЕМЯ ПАУЗЫ"
      : running
        ? "ТЕКУЩИЙ ОТРЕЗОК"
        : s
          ? "ВСЯ СЕССИЯ"
          : "ВАШЕ ВРЕМЯ";
  $("elapsed").textContent = t
    ? left > 0
      ? duration(left + 999)
      : "+" + duration(-left)
    : duration(
        running
          ? now - last.start
          : s
            ? endOf(s.segments.at(-1), now) - s.start
            : 0,
      );
  $("start-time").textContent = t
    ? `${last.kind === "pause" ? "Перерыв" : "Отрезок"} ${duration(now - last.start)} · вся сессия ${duration(now - s.start)}`
    : running
      ? `Старт в ${time(last.start)} · вся сессия ${duration(now - s.start)}`
      : s
        ? `${date(s.start)}, ${time(s.start)} — ${time(endOf(s.segments.at(-1), now))}`
        : "Начните с одной минуты";
  clock(s, now);
  $("clock-note").textContent = t
    ? "Один круг — 12 часов. Пунктир снаружи — время до сигнала таймера."
    : s
      ? "Один круг — 12 часов. Для длинных сессий показаны последние 12 часов."
      : "Один круг — 12 часов. Всё начинается с «Начать».";
  document.querySelectorAll("[data-duration]").forEach((el) => {
    const x = s?.segments[Number(el.dataset.duration)];
    if (x) el.textContent = duration(endOf(x, now) - x.start);
  });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const values = totals(+start, now, now);
  $("today-total").textContent = human(
    Object.values(values).reduce((a, b) => a + b, 0),
  );
  setHTML($("today-categories"), rows(values));
  if (!$("stats").hidden) renderStats();
}
function renderStats() {
  const [year, month] = $("month").value.split("-").map(Number);
  if (!year || !month) return;
  const from = new Date(year, month - 1, 1),
    to = new Date(year, month, 1),
    values = totals(+from, +to),
    total = Object.values(values).reduce((a, b) => a + b, 0);
  setHTML(
    $("stat-cards"),
    [
      ["Всего учтено", total],
      ["Учёба", values.study],
      ["Перерыв", values.break],
      ["Работа", values.work],
    ]
      .map(
        ([title, value]) =>
          `<div class="stat-card"><p>${title}</p><strong>${human(value)}</strong></div>`,
      )
      .join(""),
  );
  setHTML(
    $("distribution"),
    Object.entries(categories)
      .map(
        ([k, c]) =>
          `<div class="category-row"><span><i style="background:${c.color}"></i>${c.name}</span><b>${human(values[k])} · ${total ? Math.round((values[k] / total) * 100) : 0}%</b></div><div class="bar-track"><div class="bar-fill" style="width:${total ? (values[k] / total) * 100 : 0}%;background:${c.color}"></div></div>`,
      )
      .join(""),
  );
  const days = new Date(year, month, 0).getDate(),
    data = Array.from({ length: days }, (_, i) =>
      totals(
        +new Date(year, month - 1, i + 1),
        +new Date(year, month - 1, i + 2),
      ),
    ),
    max = Math.max(
      3600000,
      ...data.map((v) => Object.values(v).reduce((a, b) => a + b, 0)),
    );
  setHTML(
    $("daily-chart"),
    data
      .map((v, i) => {
        const sum = Object.values(v).reduce((a, b) => a + b, 0);
        return `<div class="day" title="${i + 1} ${from.toLocaleDateString("ru-RU", { month: "long" })}: ${human(sum)}; ${Object.entries(
          categories,
        )
          .map(([k, c]) => c.name + ": " + human(v[k]))
          .join(
            "; ",
          )}"><div class="day-bar" style="height:${Math.max(1, (sum / max) * 100)}%;animation-delay:${i * 12}ms">${Object.entries(
          categories,
        )
          .map(
            ([k, c]) =>
              `<span style="height:${sum ? (v[k] / sum) * 100 : 0}%;background:${c.color}"></span>`,
          )
          .join(
            "",
          )}</div><small>${i === 0 || (i + 1) % 5 === 0 || i === days - 1 ? i + 1 : ""}</small></div>`;
      })
      .join(""),
  );
}

/* ---------- События ---------- */
$("start").onclick = () => transition("start");
$("pause").onclick = () => transition("pause");
$("finish").onclick = () => transition("finish");
$("session-select").onchange = (e) => {
  selected = e.target.value;
  render();
};
$("segments").onchange = (e) => {
  if (e.target.dataset.segment !== undefined) {
    current().segments[Number(e.target.dataset.segment)].category =
      e.target.value;
    e.target
      .closest(".segment")
      .style.setProperty("--c", categories[e.target.value].color);
    save();
    tick();
    renderStats();
  }
};
// Удаление в два клика: первый показывает «Удалить?», второй удаляет
$("segments").onclick = (e) => {
  const btn = e.target.closest("[data-delete]");
  if (!btn) return;
  if (!btn.classList.contains("confirm")) {
    document
      .querySelectorAll(".delete.confirm")
      .forEach((b) => b.classList.remove("confirm"));
    btn.classList.add("confirm");
    clearTimeout(btn._timer);
    btn._timer = setTimeout(() => btn.classList.remove("confirm"), 3000);
    return;
  }
  clearTimeout(btn._timer);
  const s = current(),
    seg = s?.segments[Number(btn.dataset.delete)];
  if (!seg) return;
  const row = btn.closest(".segment");
  row.style.height = row.offsetHeight + "px";
  row.offsetHeight; // фиксируем высоту перед анимацией схлопывания
  row.classList.add("leaving");
  setTimeout(() => removeSegment(s, seg), 320);
};
document.addEventListener("click", (e) => {
  if (!e.target.closest(".delete"))
    document
      .querySelectorAll(".delete.confirm")
      .forEach((b) => b.classList.remove("confirm"));
});
// Волна от нажатия на кнопки
document.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".btn");
  if (!btn) return;
  const r = btn.getBoundingClientRect(),
    d = Math.max(r.width, r.height) * 2;
  const wave = document.createElement("span");
  wave.className = "ripple";
  wave.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  btn.appendChild(wave);
  wave.addEventListener("animationend", () => wave.remove());
});
$("timer-on").onchange = (e) => {
  if (
    e.target.checked &&
    "Notification" in window &&
    Notification.permission === "default"
  )
    Notification.requestPermission().catch(() => {});
  updateTimer({ on: e.target.checked });
};
$("timer-auto").onchange = (e) => updateTimer({ auto: e.target.checked });
for (const field of ["work", "rest"]) {
  const input = $("timer-" + field);
  input.onchange = () => updateTimer({ [field]: input.value });
  input.onkeydown = (e) => e.key === "Enter" && input.blur();
}
$("timer-card").onclick = (e) => {
  const step = e.target.closest("[data-step]"),
    preset = e.target.closest("[data-preset]");
  if (step) {
    const [field, delta] = step.dataset.step.split(":");
    const v = timer[field] + Number(delta);
    // Шаг 5 минут, но с выравниванием: 7 → 10 или 5, а не 12 или 2
    updateTimer({
      [field]: Number(delta) > 0 ? Math.floor(v / 5) * 5 : Math.ceil(v / 5) * 5,
    });
  } else if (preset) {
    const [work, rest] = preset.dataset.preset.split(",").map(Number);
    updateTimer({ work, rest });
  }
};
$("timer-test").onclick = () => chimeNow("focus");
for (const name of ["tracker", "stats"])
  $(name + "-tab").onclick = () => {
    for (const n of ["tracker", "stats"]) {
      $(n).hidden = n !== name;
      $(n + "-tab").classList.toggle("active", n === name);
      $(n + "-tab").setAttribute("aria-selected", String(n === name));
    }
    if (name === "stats") renderStats();
  };
const now = new Date();
$("month").value =
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
$("today").textContent = now.toLocaleDateString("ru-RU", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
$("month").onchange = renderStats;
$("export").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "temp-data.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    try {
      const next = JSON.parse(e.newValue);
      if (next && Array.isArray(next.sessions)) {
        state = next;
        fx = null;
        seenSegments = null;
        selected = state.active || state.sessions.at(-1)?.id;
        render();
      }
    } catch {}
  }
});
buildDial();
renderTimerCard();
render();
setInterval(tick, 1000);
