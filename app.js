/* =========================================================
   Margin — task planner
   Plain JavaScript, no dependencies.
   ========================================================= */
(() => {
  "use strict";

  /* ---------- Constants ---------- */
  const STORE_KEY = "margin.tasks.v1";
  const PREFS_KEY = "margin.prefs.v1";
  const THEME_KEY = "margin.color-scheme";
  const PRIORITY = { 4: "Urgent", 3: "High", 2: "Medium", 1: "Low" };
  const STATUS = { todo: "To do", doing: "In progress", done: "Done" };
  const SMART_LISTS = [
    { id: "all", label: "All tasks", icon: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>' },
    { id: "today", label: "Today", icon: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>' },
    { id: "upcoming", label: "Next 7 days", icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
    { id: "overdue", label: "Overdue", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    { id: "nodate", label: "No date", icon: '<path d="M4 7h16M4 12h10M4 17h6"/>' },
    { id: "done", label: "Completed", icon: '<path d="m5 12 5 5L20 7"/>' },
  ];
  const DAY_START = 7, DAY_END = 22; // agenda hours shown in day view

  /* ---------- Tiny helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const icon = (paths, cls = "icon") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/>',
    list: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  /* ---------- Dates (all local, keyed as YYYY-MM-DD) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfWeek = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -d.getDay()); // Sunday start
  const todayKey = () => keyOf(new Date());
  const isValidKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(parseKey(k).getTime());
  const isValidTime = (t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t);
  const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);
  const fmtTime = (t) => {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  };
  const fmtMinutes = (min) => {
    if (!min) return "0m";
    const h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  };
  function relativeDue(task) {
    if (!task.due) return null;
    const t = todayKey();
    const diff = Math.round((parseKey(task.due) - parseKey(t)) / 86400000);
    let label;
    if (diff === 0) label = "Today";
    else if (diff === 1) label = "Tomorrow";
    else if (diff === -1) label = "Yesterday";
    else if (diff > 1 && diff < 7) label = fmt(parseKey(task.due), { weekday: "long" });
    else label = fmt(parseKey(task.due), { month: "short", day: "numeric", ...(parseKey(task.due).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
    if (task.time) label += ` · ${fmtTime(task.time)}`;
    return { label, overdue: diff < 0 && task.status !== "done", today: diff === 0 };
  }

  /* ---------- Storage ---------- */
  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    },
  };

  /* ---------- Task model ---------- */
  function normalizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    const title = String(raw.title ?? "").trim().slice(0, 140);
    if (!title) return null;
    const status = ["todo", "doing", "done"].includes(raw.status) ? raw.status : (raw.done ? "done" : "todo");
    const priority = [1, 2, 3, 4].includes(Number(raw.priority)) ? Number(raw.priority) : 2;
    const estimate = Number.isFinite(Number(raw.estimate)) && Number(raw.estimate) > 0 ? Math.min(1440, Math.round(Number(raw.estimate))) : null;
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
      title,
      notes: String(raw.notes ?? "").slice(0, 2000),
      status,
      priority,
      due: isValidKey(raw.due) ? raw.due : null,
      time: isValidTime(raw.time) ? raw.time : null,
      estimate,
      tag: String(raw.tag ?? "").trim().replace(/^#/, "").toLowerCase().slice(0, 24),
      subtasks: Array.isArray(raw.subtasks)
        ? raw.subtasks.filter((s) => s && String(s.text ?? "").trim()).map((s) => ({ id: s.id || uid(), text: String(s.text).trim().slice(0, 120), done: !!s.done }))
        : [],
      createdAt: Number(raw.createdAt) || Date.now(),
      completedAt: status === "done" ? Number(raw.completedAt) || Date.now() : null,
    };
  }

  function sampleTasks() {
    const t = new Date();
    const k = (n) => keyOf(addDays(t, n));
    const now = Date.now();
    const raw = [
      { title: "Submit MIS project proposal", priority: 4, due: k(0), time: "17:00", estimate: 60, tag: "school", status: "doing", notes: "Final read-through, then upload the PDF to Canvas.",
        subtasks: [{ text: "Write problem statement", done: true }, { text: "Add data sources", done: true }, { text: "Proofread", done: false }] },
      { title: "Review pull request for the dashboard", priority: 3, due: k(0), time: "10:30", estimate: 45, tag: "work" },
      { title: "Email professor about office hours", priority: 2, due: k(-1), estimate: 10, tag: "school" },
      { title: "Grocery run", priority: 1, due: k(1), time: "18:30", estimate: 40, tag: "home" },
      { title: "Prepare slides for Thursday meeting", priority: 3, due: k(2), time: "09:00", estimate: 90, tag: "work", status: "doing",
        subtasks: [{ text: "Outline", done: true }, { text: "Charts", done: false }, { text: "Speaker notes", done: false }, { text: "Rehearse", done: false }] },
      { title: "Renew car registration", priority: 3, due: k(4), estimate: 20, tag: "home" },
      { title: "Read chapter 7 for data mining", priority: 2, due: k(3), time: "20:00", estimate: 60, tag: "school" },
      { title: "Plan weekend study session", priority: 1, due: k(5), estimate: 15, tag: "school" },
      { title: "Update résumé with internship", priority: 3, due: k(9), estimate: 45, tag: "career" },
      { title: "Book dentist appointment", priority: 2, estimate: 5, tag: "home" },
      { title: "Research summer internships", priority: 2, estimate: 60, tag: "career" },
      { title: "Back up laptop", priority: 1, estimate: 15, tag: "home" },
      { title: "Send weekly status update", priority: 2, due: k(-2), estimate: 15, tag: "work", status: "done" },
      { title: "Pay phone bill", priority: 3, due: k(-3), estimate: 5, tag: "home", status: "done" },
    ];
    return raw.map((r, i) => normalizeTask({
      ...r,
      createdAt: now - (raw.length - i) * 60000,
      completedAt: r.status === "done" && r.due ? parseKey(r.due).getTime() + 12 * 3600000 : null,
    }));
  }

  /* ---------- State ---------- */
  const savedPrefs = storage.get(PREFS_KEY, {});
  const state = {
    tasks: (() => {
      const stored = storage.get(STORE_KEY, null);
      if (Array.isArray(stored)) return stored.map(normalizeTask).filter(Boolean);
      return sampleTasks();
    })(),
    list: "all",
    tag: null,
    query: "",
    statusFilter: "any",
    sort: ["priority", "due", "created", "title"].includes(savedPrefs.sort) ? savedPrefs.sort : "priority",
    layout: savedPrefs.layout === "board" ? "board" : "list",
    calMode: ["day", "week", "month"].includes(savedPrefs.calMode) ? savedPrefs.calMode : "week",
    calCursor: new Date(),
    editingId: null,      // id of task in the dialog, or null when creating
    draftSubtasks: [],    // subtasks being edited in the dialog
    lastDeleted: null,
  };

  const save = () => storage.set(STORE_KEY, state.tasks);
  const savePrefs = () => storage.set(PREFS_KEY, { sort: state.sort, layout: state.layout, calMode: state.calMode });
  const findTask = (id) => state.tasks.find((t) => t.id === id);

  function updateTask(id, patch) {
    const task = findTask(id);
    if (!task) return;
    const wasDone = task.status === "done";
    Object.assign(task, patch);
    if (task.status === "done" && !wasDone) task.completedAt = Date.now();
    if (task.status !== "done") task.completedAt = null;
    save();
    renderAll();
  }

  function deleteTask(id) {
    const index = state.tasks.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [task] = state.tasks.splice(index, 1);
    state.lastDeleted = { task, index };
    save();
    renderAll();
    toast(`Deleted “${task.title.length > 40 ? task.title.slice(0, 40) + "…" : task.title}”`, "Undo", () => {
      if (!state.lastDeleted) return;
      state.tasks.splice(Math.min(state.lastDeleted.index, state.tasks.length), 0, state.lastDeleted.task);
      state.lastDeleted = null;
      save();
      renderAll();
      toast("Task restored");
    });
  }

  /* ---------- Filtering & sorting ---------- */
  function inList(task, list) {
    const t = todayKey();
    switch (list) {
      case "today": return task.due === t && task.status !== "done";
      case "upcoming": {
        if (!task.due || task.status === "done") return false;
        const diff = (parseKey(task.due) - parseKey(t)) / 86400000;
        return diff >= 0 && diff <= 7;
      }
      case "overdue": return !!task.due && task.due < t && task.status !== "done";
      case "nodate": return !task.due && task.status !== "done";
      case "done": return task.status === "done";
      default: return true;
    }
  }

  function visibleTasks() {
    const q = state.query.trim().toLowerCase();
    let out = state.tasks.filter((task) => inList(task, state.list));
    if (state.tag) out = out.filter((t) => t.tag === state.tag);
    if (state.statusFilter !== "any" && state.layout === "list") out = out.filter((t) => t.status === state.statusFilter);
    if (q) out = out.filter((t) => [t.title, t.notes, t.tag, ...t.subtasks.map((s) => s.text)].join(" ").toLowerCase().includes(q));
    return sortTasks(out, state.sort);
  }

  function sortTasks(arr, how) {
    const dueVal = (t) => (t.due ? t.due + (t.time || "99:99") : "9999-99-99");
    const statusRank = { doing: 0, todo: 1, done: 2 };
    const cmp = {
      priority: (a, b) => b.priority - a.priority || dueVal(a).localeCompare(dueVal(b)),
      due: (a, b) => dueVal(a).localeCompare(dueVal(b)) || b.priority - a.priority,
      created: (a, b) => b.createdAt - a.createdAt,
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    }[how];
    // done tasks always sink to the bottom of the list view
    return [...arr].sort((a, b) => (statusRank[a.status] === 2) - (statusRank[b.status] === 2) || cmp(a, b));
  }

  /* ---------- Rendering: shared pieces ---------- */
  const prioHTML = (p) => `<span class="prio" data-p="${p}" title="Priority: ${PRIORITY[p]}"><span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${PRIORITY[p]}</span>`;

  function metaHTML(task) {
    const parts = [prioHTML(task.priority)];
    const due = relativeDue(task);
    if (due) parts.push(`<span class="meta-item ${due.overdue ? "is-overdue" : due.today ? "is-today" : ""}">${icon(ICONS.cal)}${due.overdue ? "Overdue · " : ""}${esc(due.label)}</span>`);
    if (task.estimate) parts.push(`<span class="meta-item" title="Estimated time">${icon(ICONS.clock)}${fmtMinutes(task.estimate)}</span>`);
    if (task.subtasks.length) {
      const done = task.subtasks.filter((s) => s.done).length;
      parts.push(`<span class="meta-item" title="Subtasks">${icon(ICONS.list)}${done}/${task.subtasks.length}</span>`);
    }
    if (task.tag) parts.push(`<span class="meta-item meta-tag">${icon(ICONS.tag)}${esc(task.tag)}</span>`);
    return parts.join("");
  }

  const statusSelectHTML = (task) => `
    <select class="status-select" data-action="status" data-status="${task.status}" aria-label="Status for ${esc(task.title)}">
      ${Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${task.status === v ? "selected" : ""}>${l}</option>`).join("")}
    </select>`;

  const actionsHTML = (task) => `
    <div class="task-actions">
      <button class="icon-btn" type="button" data-action="edit" aria-label="Edit ${esc(task.title)}">${icon(ICONS.edit)}</button>
      <button class="icon-btn del" type="button" data-action="delete" aria-label="Delete ${esc(task.title)}">${icon(ICONS.trash)}</button>
    </div>`;

  /* ---------- Rendering: list ---------- */
  function taskRowHTML(task) {
    const done = task.status === "done";
    return `
      <li class="task" data-id="${task.id}" data-status="${task.status}">
        <button class="check" type="button" role="checkbox" aria-checked="${done}" data-action="toggle" aria-label="Mark “${esc(task.title)}” ${done ? "not done" : "done"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
        </button>
        <div class="task-body">
          <button class="task-title" type="button" data-action="edit">${esc(task.title)}</button>
          ${task.notes ? `<p class="task-notes">${esc(task.notes)}</p>` : ""}
          <div class="task-meta">${statusSelectHTML(task)}${metaHTML(task)}</div>
        </div>
        ${actionsHTML(task)}
      </li>`;
  }

  /* ---------- Rendering: board ---------- */
  function boardHTML(tasks) {
    return Object.entries(STATUS).map(([status, label]) => {
      const col = tasks.filter((t) => t.status === status);
      return `
        <section class="column" data-status="${status}" data-drop="status" aria-label="${label}">
          <header class="column-head"><span class="dot" aria-hidden="true"></span>${label}<span class="count">${col.length}</span></header>
          ${col.length ? col.map((task) => `
            <article class="card" draggable="true" data-id="${task.id}" data-status="${task.status}">
              <span class="task-title" role="button" tabindex="0" data-action="edit">${esc(task.title)}</span>
              <div class="task-meta">${metaHTML(task)}</div>
              <div class="card-foot">${statusSelectHTML(task)}${actionsHTML(task)}</div>
            </article>`).join("") : `<p class="column-empty">Drop tasks here</p>`}
        </section>`;
    }).join("");
  }

  /* ---------- Rendering: planner section ---------- */
  function renderSidebar() {
    const counts = Object.fromEntries(SMART_LISTS.map((l) => [l.id, state.tasks.filter((t) => inList(t, l.id)).length]));
    $("#smart-lists").innerHTML = SMART_LISTS.map((l) => `
      <li><button type="button" data-list="${l.id}" aria-pressed="${state.list === l.id}" class="${l.id === "overdue" && counts.overdue ? "is-alert" : ""}">
        ${icon(l.icon)}<span>${l.label}</span><span class="count">${counts[l.id]}</span>
      </button></li>`).join("");

    const tags = [...new Set(state.tasks.map((t) => t.tag).filter(Boolean))].sort();
    if (state.tag && !tags.includes(state.tag)) state.tag = null;
    $("#tag-list").innerHTML = tags.length
      ? tags.map((tag) => `<li><button type="button" data-tag="${esc(tag)}" aria-pressed="${state.tag === tag}">#${esc(tag)}</button></li>`).join("")
      : `<li class="muted">No tags yet</li>`;
    $("#clear-tag").hidden = !state.tag;
    $("#tag-options").innerHTML = tags.map((t) => `<option value="${esc(t)}"></option>`).join("");

    const total = state.tasks.length;
    const done = state.tasks.filter((t) => t.status === "done").length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $("#ring-fill").style.strokeDashoffset = String(113.1 * (1 - pct / 100));
    $("#progress-pct").textContent = `${pct}%`;
    $("#progress-ring").setAttribute("aria-label", `${pct}% of tasks complete`);
    $("#progress-note").textContent = total ? `${done} of ${total} tasks done` : "No tasks yet";
  }

  function renderStats() {
    const open = state.tasks.filter((t) => t.status !== "done");
    const t = todayKey();
    const doing = state.tasks.filter((x) => x.status === "doing").length;
    const doneToday = state.tasks.filter((x) => x.status === "done" && x.completedAt && keyOf(new Date(x.completedAt)) === t).length;
    const overdue = open.filter((x) => x.due && x.due < t).length;
    const planned = open.reduce((sum, x) => sum + (x.estimate || 0), 0);
    const cells = [
      ["Open", open.length],
      ["In progress", doing],
      ["Done today", doneToday],
      ["Overdue", overdue, overdue > 0],
      ["Planned work", fmtMinutes(planned).replace(/(\d+)([hm])/g, "$1<small>$2</small>")],
    ];
    $("#stats").innerHTML = cells.map(([label, value, alert]) => `<div class="${alert ? "is-alert" : ""}"><dt>${label}</dt><dd>${value}</dd></div>`).join("");

    $("#tab-count-tasks").textContent = open.length ? String(open.length) : "";
  }

  function renderTasks() {
    const tasks = visibleTasks();
    const listLabel = SMART_LISTS.find((l) => l.id === state.list)?.label ?? "Tasks";
    $("#list-title").textContent = state.tag ? `${listLabel} · #${state.tag}` : listLabel;

    const list = $("#task-list"), board = $("#task-board");
    list.hidden = state.layout !== "list";
    board.hidden = state.layout !== "board";
    $("#status-filter").hidden = state.layout === "board";
    $("#clear-done").hidden = !state.tasks.some((t) => t.status === "done");

    if (state.layout === "list") {
      list.innerHTML = tasks.map(taskRowHTML).join("");
      board.innerHTML = "";
    } else {
      board.innerHTML = boardHTML(tasks);
      list.innerHTML = "";
    }

    const empty = $("#empty-state");
    empty.hidden = !(state.layout === "list" && tasks.length === 0);
    if (!empty.hidden) {
      const filtered = state.query || state.tag || state.statusFilter !== "any" || state.list !== "all";
      $("#empty-title").textContent = !state.tasks.length ? "A clean slate" : filtered ? "No matching tasks" : "Nothing here yet";
      $("#empty-text").textContent = !state.tasks.length ? "Type a task above and press Enter." : filtered ? "Try another list, tag, or search." : "Add a task above.";
    }
  }

  /* ---------- Rendering: calendar ---------- */
  const tasksOn = (key) => sortTasks(state.tasks.filter((t) => t.due === key), "due");

  const chipHTML = (task, { time = true } = {}) => `
    <div class="chip" role="button" tabindex="0" draggable="true" data-id="${task.id}" data-p="${task.priority}" data-status="${task.status}" data-action="edit"
      title="${esc(task.title)} — ${PRIORITY[task.priority]}, ${STATUS[task.status]}">
      <span class="chip-title">${esc(task.title)}</span>${time && task.time ? `<time>${fmtTime(task.time)}</time>` : ""}
    </div>`;

  const addBtnHTML = (key) => `<button class="add-btn" type="button" data-add="${key}" aria-label="Add task on ${fmt(parseKey(key), { weekday: "long", month: "long", day: "numeric" })}">${icon(ICONS.plus)}</button>`;

  function renderMonth() {
    const c = state.calCursor;
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = startOfWeek(first);
    const t = todayKey();
    const head = Array.from({ length: 7 }, (_, i) => `<div>${fmt(addDays(start, i), { weekday: "short" })}</div>`).join("");
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const k = keyOf(d);
      const list = tasksOn(k);
      const shown = list.slice(0, 3);
      const outside = d.getMonth() !== c.getMonth();
      cells += `
        <div class="day-cell ${outside ? "is-outside" : ""} ${k === t ? "is-today" : ""}" data-drop="date" data-date="${k}">
          <div class="day-cell-head">
            <button class="day-num" type="button" data-goto-day="${k}" aria-label="${fmt(d, { weekday: "long", month: "long", day: "numeric" })}, ${list.length} ${list.length === 1 ? "task" : "tasks"}">${d.getDate()}</button>
            ${addBtnHTML(k)}
          </div>
          ${shown.map((x) => chipHTML(x, { time: false })).join("")}
          ${list.length > 3 ? `<button class="more-btn" type="button" data-goto-day="${k}">+${list.length - 3} more</button>` : ""}
          ${list.length ? `<button class="more-btn cell-count" type="button" data-goto-day="${k}">${list.length} ${list.length === 1 ? "task" : "tasks"}</button>` : ""}
        </div>`;
    }
    $("#cal-range").textContent = fmt(c, { month: "long", year: "numeric" });
    return `<div class="month"><div class="month-head">${head}</div><div class="month-grid">${cells}</div></div>`;
  }

  function renderWeek() {
    const start = startOfWeek(state.calCursor);
    const end = addDays(start, 6);
    const t = todayKey();
    let cols = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const k = keyOf(d);
      const list = tasksOn(k);
      const mins = list.filter((x) => x.status !== "done").reduce((s, x) => s + (x.estimate || 0), 0);
      cols += `
        <div class="week-col ${k === t ? "is-today" : ""} ${i === 0 || i === 6 ? "is-weekend" : ""}" data-drop="date" data-date="${k}">
          <div class="week-col-head">
            <span class="week-day">${fmt(d, { weekday: "short" })}</span>
            <button class="week-date" type="button" data-goto-day="${k}" aria-label="Open ${fmt(d, { weekday: "long", month: "long", day: "numeric" })}">${d.getDate()}</button>
            ${addBtnHTML(k)}
          </div>
          <div class="week-list">${list.map((x) => chipHTML(x)).join("")}</div>
          ${list.length ? `<div class="week-load">${list.length} ${list.length === 1 ? "task" : "tasks"}${mins ? ` · ${fmtMinutes(mins)}` : ""}</div>` : ""}
        </div>`;
    }
    const sameMonth = start.getMonth() === end.getMonth();
    $("#cal-range").textContent = sameMonth
      ? `${fmt(start, { month: "long", day: "numeric" })} – ${end.getDate()}, ${end.getFullYear()}`
      : `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric", year: "numeric" })}`;
    return `<div class="week">${cols}</div>`;
  }

  function renderDay() {
    const d = state.calCursor;
    const k = keyOf(d);
    const list = tasksOn(k);
    const anytime = list.filter((x) => !x.time);
    const timed = list.filter((x) => x.time);
    const open = list.filter((x) => x.status !== "done");
    const mins = open.reduce((s, x) => s + (x.estimate || 0), 0);
    const nowHour = k === todayKey() ? new Date().getHours() : -1;

    const bucket = (h) => timed.filter((x) => {
      const hr = Number(x.time.slice(0, 2));
      return h === DAY_START ? hr <= DAY_START : h === DAY_END ? hr >= DAY_END : hr === h;
    });

    let rows = "";
    for (let h = DAY_START; h <= DAY_END; h++) {
      const label = new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
      rows += `<div class="hour-row ${h === nowHour ? "is-now" : ""}"><time>${label}</time><div class="hour-tasks">${bucket(h).map((x) => chipHTML(x)).join("")}</div></div>`;
    }
    $("#cal-range").textContent = fmt(d, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    return `
      <div class="day-agenda" data-drop="date" data-date="${k}">
        <div class="agenda-summary">
          <span><strong>${list.length}</strong> ${list.length === 1 ? "task" : "tasks"}</span>
          <span><strong>${list.length - open.length}</strong> done</span>
          <span><strong>${fmtMinutes(mins)}</strong> planned</span>
          <button class="btn btn-ghost btn-sm" type="button" data-add="${k}">${icon(ICONS.plus)}Add task</button>
        </div>
        <div class="agenda-anytime">
          <span class="agenda-label">Anytime</span>
          ${anytime.length ? anytime.map((x) => chipHTML(x)).join("") : `<span class="empty-note">No untimed tasks.</span>`}
        </div>
        ${rows}
      </div>`;
  }

  function renderCalendar() {
    const view = state.calMode === "month" ? renderMonth() : state.calMode === "week" ? renderWeek() : renderDay();
    $("#cal-view").innerHTML = view;
    $$('#cal-mode input').forEach((r) => (r.checked = r.value === state.calMode));
    const tray = sortTasks(state.tasks.filter((t) => !t.due && t.status !== "done"), "priority");
    $("#tray-list").innerHTML = tray.length
      ? tray.map((x) => `<li>${chipHTML(x)}</li>`).join("")
      : `<li class="empty-note">Everything has a date.</li>`;
  }

  function renderAll() {
    renderSidebar();
    renderStats();
    renderTasks();
    renderCalendar();
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(message, actionLabel, onAction) {
    const el = $("#toast"), btn = $("#toast-action");
    $("#toast-text").textContent = message;
    btn.hidden = !actionLabel;
    btn.textContent = actionLabel || "";
    btn.onclick = onAction ? () => { onAction(); } : null;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; if (actionLabel) state.lastDeleted = null; }, actionLabel ? 6000 : 2600);
  }

  /* ---------- Dialog helpers ---------- */
  function openDialog(dlg) { if (!dlg.open) dlg.showModal(); }
  // light-dismiss fallback where <dialog closedby> isn't supported
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    $$('dialog[closedby="any"]').forEach((dlg) => {
      dlg.addEventListener("click", (e) => {
        if (e.target !== dlg) return;
        const r = dlg.getBoundingClientRect();
        const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
        if (!inside) dlg.close();
      });
    });
  }
  document.addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close]");
    if (closer) closer.closest("dialog")?.close();
    const opener = e.target.closest("[data-open]");
    if (opener) openDialog(document.getElementById(opener.dataset.open));
  });

  let confirmCallback = null;
  function confirmAction(title, text, okLabel, cb) {
    $("#confirm-title").textContent = title;
    $("#confirm-text").textContent = text;
    $("#confirm-ok").textContent = okLabel;
    confirmCallback = cb;
    openDialog($("#confirm-dialog"));
  }
  $("#confirm-dialog").addEventListener("close", () => {
    const ok = $("#confirm-dialog").returnValue === "ok";
    $("#confirm-dialog").returnValue = "";
    const cb = confirmCallback; confirmCallback = null;
    if (ok && cb) cb();
  });

  /* ---------- Task dialog (create + edit) ---------- */
  const taskDialog = $("#task-dialog");
  const editForm = $("#edit-form");

  function openTaskDialog(id, presetDue) {
    const task = id ? findTask(id) : null;
    state.editingId = task ? task.id : null;
    state.draftSubtasks = task ? task.subtasks.map((s) => ({ ...s })) : [];
    editForm.reset();
    const f = editForm.elements;
    $("#task-dialog-title").textContent = task ? "Edit task" : "New task";
    $("#dialog-save").textContent = task ? "Save" : "Add task";
    $("#dialog-delete").hidden = !task;
    f.title.value = task?.title ?? "";
    f.status.value = task?.status ?? "todo";
    f.priority.value = String(task?.priority ?? 2);
    f.due.value = task?.due ?? presetDue ?? "";
    f.time.value = task?.time ?? "";
    f.estimate.value = task?.estimate ?? "";
    f.tag.value = task?.tag ?? "";
    f.notes.value = task?.notes ?? "";
    $("#subtask-input").value = "";
    renderSubtasks();
    openDialog(taskDialog);
    f.title.focus();
    if (task) f.title.select();
  }

  function renderSubtasks() {
    $("#subtasks").innerHTML = state.draftSubtasks.map((s) => `
      <li class="${s.done ? "is-done" : ""}" data-sub="${s.id}">
        <input type="checkbox" id="sub-${s.id}" ${s.done ? "checked" : ""}>
        <label for="sub-${s.id}">${esc(s.text)}</label>
        <button class="icon-btn" type="button" data-remove-sub aria-label="Remove subtask ${esc(s.text)}">${icon(ICONS.x)}</button>
      </li>`).join("");
  }

  function addSubtask() {
    const input = $("#subtask-input");
    const text = input.value.trim();
    if (!text) return;
    state.draftSubtasks.push({ id: uid(), text: text.slice(0, 120), done: false });
    input.value = "";
    renderSubtasks();
    input.focus();
  }
  $("#subtask-add-btn").addEventListener("click", addSubtask);
  $("#subtask-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addSubtask(); }
  });
  $("#subtasks").addEventListener("change", (e) => {
    const li = e.target.closest("[data-sub]");
    const sub = state.draftSubtasks.find((s) => s.id === li?.dataset.sub);
    if (sub) { sub.done = e.target.checked; li.classList.toggle("is-done", sub.done); }
  });
  $("#subtasks").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-sub]");
    if (!btn) return;
    const id = btn.closest("[data-sub]").dataset.sub;
    state.draftSubtasks = state.draftSubtasks.filter((s) => s.id !== id);
    renderSubtasks();
    $("#subtask-input").focus();
  });

  editForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = editForm.elements;
    if (!f.title.value.trim()) {
      f.title.setAttribute("aria-invalid", "true");
      f.title.focus();
      f.title.reportValidity?.();
      return;
    }
    f.title.setAttribute("aria-invalid", "false");
    // pick up a subtask that was typed but not yet added
    if ($("#subtask-input").value.trim()) addSubtask();
    const data = normalizeTask({
      id: state.editingId || undefined,
      title: f.title.value,
      status: f.status.value,
      priority: f.priority.value,
      due: f.due.value,
      time: f.time.value,
      estimate: f.estimate.value,
      tag: f.tag.value,
      notes: f.notes.value,
      subtasks: state.draftSubtasks,
    });
    if (state.editingId) {
      const { id, createdAt, completedAt, ...patch } = data;
      updateTask(state.editingId, patch);
      toast("Changes saved");
    } else {
      state.tasks.push(data);
      save();
      renderAll();
      toast("Task added");
    }
    taskDialog.close();
  });

  $("#dialog-delete").addEventListener("click", () => {
    const id = state.editingId;
    taskDialog.close();
    if (id) deleteTask(id);
  });

  /* ---------- Composer (quick add) ---------- */
  const form = $("#task-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = form.elements;
    const title = f.title.value.trim();
    if (!title) {
      form.classList.add("show-error");
      f.title.setAttribute("aria-invalid", "true");
      f.title.focus();
      return;
    }
    const task = normalizeTask({
      title,
      priority: f.priority.value,
      due: f.due.value,
      time: f.time.value,
      estimate: f.estimate.value,
      tag: f.tag.value,
      createdAt: Date.now(),
    });
    state.tasks.push(task);
    save();
    // make sure the new task is visible in the current view
    if (!inList(task, state.list) || (state.tag && state.tag !== task.tag) || (state.statusFilter !== "any" && state.statusFilter !== "todo")) {
      state.list = "all"; state.tag = null; state.statusFilter = "any";
      $$('#status-filter input').forEach((r) => (r.checked = r.value === "any"));
    }
    state.query = ""; $("#search").value = "";
    form.reset();
    form.classList.remove("show-error");
    f.title.setAttribute("aria-invalid", "false");
    f.priority.value = "2";
    renderAll();
    toast("Task added");
    f.title.focus();
  });
  form.elements.title.addEventListener("input", () => {
    if (form.elements.title.value.trim()) {
      form.classList.remove("show-error");
      form.elements.title.setAttribute("aria-invalid", "false");
    }
  });
  form.elements.title.setAttribute("aria-invalid", "false");
  editForm.elements.title.setAttribute("aria-invalid", "false");
  editForm.elements.title.addEventListener("input", (e) => {
    e.target.setAttribute("aria-invalid", String(e.target.matches(":user-invalid")));
  });

  /* ---------- Delegated task actions (list, board, calendar) ---------- */
  function handleTaskClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el || el.dataset.action === "status") return;
    const id = el.closest("[data-id]")?.dataset.id;
    if (!id) return;
    const task = findTask(id);
    if (!task) return;
    if (el.dataset.action === "toggle") updateTask(id, { status: task.status === "done" ? "todo" : "done" });
    else if (el.dataset.action === "edit") openTaskDialog(id);
    else if (el.dataset.action === "delete") deleteTask(id);
  }
  function handleStatusChange(e) {
    const sel = e.target.closest('select[data-action="status"]');
    if (!sel) return;
    const id = sel.closest("[data-id]").dataset.id;
    updateTask(id, { status: sel.value });
    toast(`Moved to ${STATUS[sel.value]}`);
  }
  ["#task-list", "#task-board", "#cal-view", "#tray-list"].forEach((sel) => {
    $(sel).addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches('[role="button"][data-action]')) { e.preventDefault(); handleTaskClick(e); }
    });
    $(sel).addEventListener("click", handleTaskClick);
    $(sel).addEventListener("change", handleStatusChange);
  });

  /* ---------- Sidebar, toolbar ---------- */
  $("#smart-lists").addEventListener("click", (e) => {
    const b = e.target.closest("[data-list]");
    if (!b) return;
    state.list = b.dataset.list;
    renderSidebar(); renderTasks();
  });
  $("#tag-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tag]");
    if (!b) return;
    state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag;
    renderSidebar(); renderTasks();
  });
  $("#clear-tag").addEventListener("click", () => { state.tag = null; renderSidebar(); renderTasks(); });

  $("#search").addEventListener("input", (e) => { state.query = e.target.value; renderTasks(); });
  $("#status-filter").addEventListener("change", (e) => { state.statusFilter = e.target.value; renderTasks(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; savePrefs(); renderTasks(); });
  $("#layout-toggle").addEventListener("change", (e) => setLayout(e.target.value));

  function setLayout(layout) {
    state.layout = layout;
    $$('#layout-toggle input').forEach((r) => (r.checked = r.value === layout));
    savePrefs();
    renderTasks();
  }

  $("#clear-done").addEventListener("click", () => {
    const n = state.tasks.filter((t) => t.status === "done").length;
    if (!n) return;
    confirmAction("Clear completed tasks?", `This permanently removes ${n} completed ${n === 1 ? "task" : "tasks"}.`, "Clear", () => {
      state.tasks = state.tasks.filter((t) => t.status !== "done");
      save(); renderAll();
      toast(`Cleared ${n} ${n === 1 ? "task" : "tasks"}`);
    });
  });

  /* ---------- Calendar controls ---------- */
  function setCalMode(mode) {
    state.calMode = mode;
    savePrefs();
    renderCalendar();
  }
  $("#cal-mode").addEventListener("change", (e) => setCalMode(e.target.value));
  function shiftCal(dir) {
    const c = state.calCursor;
    if (state.calMode === "month") state.calCursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
    else state.calCursor = addDays(c, state.calMode === "week" ? 7 * dir : dir);
    renderCalendar();
  }
  $("#cal-prev").addEventListener("click", () => shiftCal(-1));
  $("#cal-next").addEventListener("click", () => shiftCal(1));
  $("#cal-today").addEventListener("click", () => { state.calCursor = new Date(); renderCalendar(); });
  $("#cal-view").addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto-day]");
    if (goto) { state.calCursor = parseKey(goto.dataset.gotoDay); setCalMode("day"); return; }
    const add = e.target.closest("[data-add]");
    if (add) openTaskDialog(null, add.dataset.add);
  });

  /* ---------- Drag and drop (board columns + calendar days) ---------- */
  let dragId = null;
  document.addEventListener("dragstart", (e) => {
    const el = e.target.closest?.("[draggable='true'][data-id]");
    if (!el) return;
    dragId = el.dataset.id;
    el.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
  });
  document.addEventListener("dragend", (e) => {
    e.target.closest?.("[data-id]")?.classList.remove("is-dragging");
    $$(".is-over").forEach((x) => x.classList.remove("is-over"));
    dragId = null;
  });
  document.addEventListener("dragover", (e) => {
    const zone = e.target.closest?.("[data-drop]");
    if (!zone || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    $$(".is-over").forEach((x) => x !== zone && x.classList.remove("is-over"));
    zone.classList.add("is-over");
  });
  document.addEventListener("dragleave", (e) => {
    const zone = e.target.closest?.("[data-drop]");
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove("is-over");
  });
  document.addEventListener("drop", (e) => {
    const zone = e.target.closest?.("[data-drop]");
    if (!zone || !dragId) return;
    e.preventDefault();
    const task = findTask(dragId);
    zone.classList.remove("is-over");
    if (!task) return;
    if (zone.dataset.drop === "status" && task.status !== zone.dataset.status) {
      updateTask(task.id, { status: zone.dataset.status });
      toast(`Moved to ${STATUS[zone.dataset.status]}`);
    } else if (zone.dataset.drop === "date" && task.due !== zone.dataset.date) {
      updateTask(task.id, { due: zone.dataset.date });
      toast(`Rescheduled to ${fmt(parseKey(zone.dataset.date), { weekday: "short", month: "short", day: "numeric" })}`);
    }
  });

  /* ---------- Export / import / reset ---------- */
  $("#export-btn").addEventListener("click", () => {
    $("#export-text").value = JSON.stringify(state.tasks, null, 2);
    $("#export-status").textContent = `${state.tasks.length} ${state.tasks.length === 1 ? "task" : "tasks"}. Copy this text and keep it somewhere safe.`;
    openDialog($("#export-dialog"));
    $("#export-text").select();
  });
  $("#export-copy").addEventListener("click", async () => {
    const text = $("#export-text").value;
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
      ]);
      $("#export-status").textContent = "Copied to your clipboard.";
    } catch {
      $("#export-text").select();
      $("#export-status").textContent = "Couldn’t copy automatically — the text is selected, press Ctrl+C (⌘C on Mac).";
    }
  });

  $("#import-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const err = $("#import-error");
    let parsed;
    try { parsed = JSON.parse(f.json.value); } catch { parsed = null; }
    const list = Array.isArray(parsed) ? parsed.map(normalizeTask).filter(Boolean) : [];
    if (!list.length) {
      err.textContent = "That doesn’t look like an exported task list. Paste the text from Export.";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    if (f.mode.value === "replace") state.tasks = list;
    else {
      const ids = new Set(state.tasks.map((t) => t.id));
      list.forEach((t) => { if (ids.has(t.id)) t.id = uid(); state.tasks.push(t); });
    }
    save(); renderAll();
    $("#import-dialog").close();
    e.target.reset();
    toast(`Imported ${list.length} ${list.length === 1 ? "task" : "tasks"}`);
  });
  $("#import-dialog").addEventListener("close", () => { $("#import-error").hidden = true; });

  $("#reset-btn").addEventListener("click", () => {
    confirmAction("Reset to sample tasks?", "This replaces all of your tasks with the starter set.", "Reset", () => {
      state.tasks = sampleTasks();
      state.list = "all"; state.tag = null;
      save(); renderAll();
      toast("Sample tasks restored");
    });
  });

  /* ---------- Theme toggle (two-state: system ↔ opposite) ---------- */
  const themeMeta = document.querySelector('meta[name="color-scheme"]');
  const systemDark = matchMedia("(prefers-color-scheme: dark)");
  $("#theme-toggle").addEventListener("click", () => {
    const current = themeMeta.content === "light dark" ? (systemDark.matches ? "dark" : "light") : themeMeta.content;
    const target = current === "dark" ? "light" : "dark";
    const system = systemDark.matches ? "dark" : "light";
    try {
      if (target === system) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, target);
    } catch {}
    themeMeta.content = target === system ? "light dark" : target;
  });
  addEventListener("storage", (e) => {
    if (e.key === THEME_KEY) themeMeta.content = e.newValue ?? "light dark";
    if (e.key === STORE_KEY) { state.tasks = (storage.get(STORE_KEY, []) || []).map(normalizeTask).filter(Boolean); renderAll(); }
  });

  /* ---------- Views (hash routing: #tasks, #calendar) ---------- */
  const VIEWS = ["tasks", "calendar"];
  function showView(view, { updateHash = true } = {}) {
    if (!VIEWS.includes(view)) view = "tasks";
    VIEWS.forEach((v) => { document.getElementById(v).hidden = v !== view; });
    $$("[data-view-link]").forEach((a) => {
      if (a.dataset.viewLink === view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
    scrollTo(0, 0);
  }
  addEventListener("hashchange", () => showView(location.hash.slice(1), { updateHash: false }));
  $$("[data-view-link]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    showView(a.dataset.viewLink);
  }));
  $(".brand").addEventListener("click", (e) => { e.preventDefault(); showView("tasks"); });

  /* ---------- More options panel ---------- */
  const panel = $("#more-panel");
  // close the panel before a panel item opens a dialog
  panel.addEventListener("click", (e) => {
    if (e.target.closest("[data-panel-item]")) { try { panel.hidePopover(); } catch {} }
  }, true);
  panel.addEventListener("toggle", (e) => {
    $("#more-btn").setAttribute("aria-expanded", String(e.newState === "open"));
    if (e.newState === "open") panel.querySelector("button")?.focus();
  });

  /* ---------- Keyboard shortcuts ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open], :popover-open")) return;
    const k = e.key.toLowerCase();
    if (k === "n") { e.preventDefault(); showView("tasks"); $("#new-title").focus(); }
    else if (e.key === "/") { e.preventDefault(); showView("tasks"); $("#search").focus(); }
    else if (k === "t") showView("tasks");
    else if (k === "c") showView("calendar");
    else if (k === "d" || k === "w" || k === "m") { setCalMode({ d: "day", w: "week", m: "month" }[k]); showView("calendar"); }
    else if (k === "b") { showView("tasks"); setLayout(state.layout === "list" ? "board" : "list"); }
    else if (e.key === "?") openDialog($("#shortcuts-dialog"));
  });

  /* ---------- Init ---------- */
  $("#sort").value = state.sort;
  $$('#layout-toggle input').forEach((r) => (r.checked = r.value === state.layout));
  $("#today-label").textContent = fmt(new Date(), { weekday: "short", month: "short", day: "numeric" });
  if (!Array.isArray(storage.get(STORE_KEY, null))) save();
  renderAll();
  showView(location.hash.slice(1) || "tasks", { updateHash: !!location.hash });

  // keep "today" accurate if the tab stays open past midnight
  let lastDay = todayKey();
  setInterval(() => {
    if (todayKey() !== lastDay) {
      lastDay = todayKey();
      $("#today-label").textContent = fmt(new Date(), { weekday: "short", month: "short", day: "numeric" });
      renderAll();
    }
  }, 60000);
})();
