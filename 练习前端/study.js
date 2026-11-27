"use strict";

const $ = (id) => document.getElementById(id);
const data = Array.isArray(window.questionBank) ? window.questionBank : [];
const subjects = ["药理学", "药剂学", "药物分析", "药物化学"];
const settings = {
  featured: { title: "精选题库", description: "全部考点载入所选范围的所有题目。选择单个考点时练习精选题。", action: "开始精选" },
  study: { title: "强化题库", description: "按科目、章节或考点筛选整套题库，顺序做题。", action: "开始专项" },
  mock: { title: "冲刺模拟", description: "随机抽题，可选限时。交卷后查看得分并逐题核对。", action: "生成试卷" },
  exam: { title: "按年份练真题", description: "选择年份，按原资料中的顺序作答。", action: "开始真题" },
  knowledge: { title: "知识导航", description: "", action: "" },
  favorites: { title: "收藏", description: "把想回看的题收在一起，按科目筛选后重做。", action: "复习收藏", empty: "在答题页选择「收藏本题」，题目会显示在这里。" },
  wrong: { title: "错题库", description: "重做答错的客观题，掌握后可将它移出错题库。", action: "重做错题", empty: "客观题判错后会自动加入这里。你也可以在核对主观题时手动加入。" },
  notes: { title: "笔记", description: "按原题回看笔记，也可以搜索自己记过的内容。", action: "回看笔记", empty: "在答题页写下解题方法或易错点，保存后可在这里回看。" },
};

let mode = "featured";
let savedPage = 0;
let favoriteKind = "questions";
const sessions = Object.fromEntries(Object.keys(settings).map((name) => [name, null]));
const session = () => sessions[mode];
const isExam = (q) => q.source.kind === "exam";
const isRecall = (q) => q.source.kind === "recall";
const usable = (q) => q.complete !== false;
const isPersonal = () => Boolean(settings[mode].empty);
const isTimedMode = () => mode === "mock" || mode === "exam";
const isQuestionBank = () => ["featured", "study", "mock", "exam"].includes(mode);
const storageKey = "kunming349:review:v1";
const preferenceKey = "kunming349:preferences:v1";
const preferenceDefaults = {
  skipCorrect: true, shuffleOptions: false, showExclusions: true,
  wrongThreshold: "1", textSize: "standard", pageWidth: "standard", examDate: "",
  rubricThreshold: defaultRubricThreshold, paneSplit: 54,
};
let preferences = readPreferences();
let storageFailed = false;
let records = readRecords() ?? {};
const dayPrefix = "kunming349:day:v1:";
const choicePrefix = "kunming349:choice:v1:";
const subjectivePrefix = "kunming349:subjective:v1:";
const studyDateFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai",
});
let lastStatsDay = studyDate();
let answerScrollBeforeNote = 0;

function studyDate() {
  const parts = Object.fromEntries(studyDateFormat.formatToParts(new Date()).map(({type,value}) => [type,value]));
  return [parts.year,parts.month,parts.day].join("-");
}

function validStudyDate(text) {
  if (!/^\d{4}-\d\d-\d\d$/.test(text)) return false;
  const date = new Date(text + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === text;
}

function renderStudyStats() {
  const today = studyDate();
  const days = userProfile.list(dayPrefix).filter(([, studied]) => studied === true).length;
  const remaining = preferences.examDate ? Math.round((Date.parse(preferences.examDate) - Date.parse(today)) / 86_400_000) : null;
  $("exam-countdown").textContent = remaining === null ? "设置考研日期" : remaining === 0 ? "今天考研"
    : remaining > 0 ? "距离考研还有 " + remaining + " 天" : "考研日期已过 " + Math.abs(remaining) + " 天";
  $("study-days").textContent = "已学习 " + days + " 天";
  for (const [id, prefix, label] of [
    ["choice-accuracy", choicePrefix, "客观题正确率"],
    ["subjective-accuracy", subjectivePrefix, "主观题正确率"],
  ]) {
    const grades = userProfile.list(prefix).map(([, value]) => value).filter((value) => typeof value === "boolean");
    const right = grades.filter(Boolean).length;
    $(id).textContent = label + " " + accuracyText({right, graded: grades.length}) +
      (grades.length ? `（${right}/${grades.length}）` : "");
  }
}

function accuracyText({right, graded}) {
  return graded ? Number((100 * right / graded).toFixed(1)) + "%" : "—";
}

function markStudyDay() {
  const key = dayPrefix + studyDate();
  if (!userProfile.get(key)) {
    userProfile.set(key, true);
    renderStudyStats();
  }
}

function readPreferences() {
  const saved = userProfile.get(preferenceKey, {});
  const result = { ...preferenceDefaults };
  for (const name of ["skipCorrect", "shuffleOptions", "showExclusions"]) {
    if (typeof saved[name] === "boolean") result[name] = saved[name];
  }
  if (["1", "3"].includes(saved.wrongThreshold)) result.wrongThreshold = saved.wrongThreshold;
  if (["small", "standard", "large"].includes(saved.textSize)) result.textSize = saved.textSize;
  if (["compact", "standard", "wide"].includes(saved.pageWidth)) result.pageWidth = saved.pageWidth;
  if (rubricThresholds.includes(saved.rubricThreshold)) result.rubricThreshold = saved.rubricThreshold;
  if (typeof saved.examDate === "string" && validStudyDate(saved.examDate)) result.examDate = saved.examDate;
  if (Number.isFinite(saved.paneSplit)) result.paneSplit = clampPaneSplit(saved.paneSplit);
  return result;
}

function applyPreferences() {
  document.documentElement.dataset.textSize = preferences.textSize;
  document.documentElement.dataset.pageWidth = preferences.pageWidth;
  renderPaneSplit(preferences.paneSplit);
  for (const control of $("preferences-form").elements) {
    if (!Object.hasOwn(preferences, control.name)) continue;
    if (control.type === "checkbox") control.checked = preferences[control.name];
    else control.value = preferences[control.name];
  }
  renderStudyStats();
  fitStudyPane();
  const q = currentQuestion();
  if (q && !$("question").hidden && q.options.length) {
    renderOptions(session(), q);
    renderSolution(session(), q);
  }
}

function clampPaneSplit(value) {
  return Math.min(70, Math.max(30, Math.round(value)));
}

function renderPaneSplit(value) {
  const panel = document.querySelector("main.wrap");
  panel.style.setProperty("--question-track", value + "fr");
  panel.style.setProperty("--solution-track", (100 - value) + "fr");
  $("study-splitter").setAttribute("aria-valuenow", String(value));
  $("study-splitter").setAttribute("aria-valuetext", `题目区 ${value}%，解析区 ${100 - value}%`);
}

function fitStudyPane() {
  const shell = document.querySelector(".study-shell");
  const top = shell.getBoundingClientRect().top + window.scrollY;
  shell.style.setProperty("--study-top", top + "px");
}

function setupPaneSplitter() {
  const handle = $("study-splitter");
  const panel = $("exercise-panel");
  let drag = null;
  const store = (value) => {
    const split = clampPaneSplit(value);
    renderPaneSplit(split);
    preferences.paneSplit = split;
    userProfile.set(preferenceKey, preferences);
  };
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const question = $("question-workspace").getBoundingClientRect();
    const solution = $("solution-panel").getBoundingClientRect();
    drag = {
      id: event.pointerId, x: event.clientX, original: preferences.paneSplit,
      width: question.width + solution.width,
    };
    handle.setPointerCapture(event.pointerId);
    panel.classList.add("is-resizing");
    handle.focus({preventScroll: true});
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.id) return;
    renderPaneSplit(clampPaneSplit(drag.original + 100 * (event.clientX - drag.x) / drag.width));
  });
  const finish = (event) => {
    if (event.pointerId !== drag?.id) return;
    const value = event.type === "pointercancel" ? drag.original : Number(handle.getAttribute("aria-valuenow"));
    drag = null;
    panel.classList.remove("is-resizing");
    store(value);
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) handle.addEventListener(event, finish);
  handle.addEventListener("dblclick", () => store(preferenceDefaults.paneSplit));
  handle.addEventListener("keydown", (event) => {
    const values = {
      ArrowLeft: preferences.paneSplit - 2, ArrowRight: preferences.paneSplit + 2,
      Home: 30, End: 70,
    };
    if (!Object.hasOwn(values, event.key)) return;
    event.preventDefault();
    store(values[event.key]);
  });
  window.addEventListener("resize", fitStudyPane);
  const header = new ResizeObserver(fitStudyPane);
  header.observe(document.querySelector(".masthead"));
}

function readRecords() {
  const parsed = userProfile.get(storageKey, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function mutateRecords(update) {
  records = readRecords();
  update(records);
  storageFailed = !userProfile.set(storageKey, records);
  renderCounts();
}

function updateRecord(id, update) {
  mutateRecords((store) => {
    const entry = update(store[id] ?? {});
    if (entry.favoriteAt || entry.wrong || entry.note) store[id] = entry;
    else delete store[id];
  });
}

function personalDate(q, name = mode) {
  const entry = records[q.id];
  if (name === "favorites") return entry?.favoriteAt || 0;
  if (name === "wrong") return entry?.wrong?.active ? entry.wrong.at : 0;
  return entry?.note?.text ? entry.note.at : 0;
}

function renderCounts() {
  for (const name of ["favorites", "wrong", "notes"]) {
    const n = data.filter((q) => personalDate(q, name)).length + (name === "favorites" ? knowledgeUI.favorites().length : 0);
    $(`${name}-count`).textContent = n ? String(n) : "";
  }
  $("storage-note").hidden = !storageFailed;
  $("storage-note").textContent = storageFailed ? "浏览器无法保存本地记录，本次更改只保留在当前标签页。" : "";
}

function featuredQuestions() {
  return data.filter((q) => usable(q) && (isExam(q) || (
    q.source.kind === "practice" && q.answer &&
    !/未载|缺答|答案待核|未提供/.test(q.answer.slice(0, 30)) &&
    (q.reasoning?.text || q.analysisOriginal?.length || q.analysis.length ||
      Object.keys(q.optionExplanations?.reasons ?? {}).length) &&
    (!q.options.length || correctLabels(q).length)
  )));
}
const fill = (select, choices) => {
  const current = select.value;
  select.replaceChildren(...choices.map(([value, label]) => new Option(label, value)));
  if (choices.some(([value]) => value === current)) select.value = current;
};
const unique = (arr) => [...new Set(arr.filter(Boolean))];
const featured = featuredQuestions();
const featuredIds = new Set(featured.map((q) => q.id));
const sourceRows = () => isPersonal()
  ? data.filter((q) => personalDate(q)).sort((a,b) => personalDate(b) - personalDate(a))
  : data;
const subjectRows = () => {
  const rows = sourceRows();
  return mode === "exam" || !$("subject").value ? rows : rows.filter((q) => q.subject === $("subject").value);
};
const chapterRows = () => $("chapter").value
  ? subjectRows().filter((q) => q.chapter === $("chapter").value) : subjectRows();
const exactText = (x) => x.trim().normalize("NFKC").toLowerCase();
const hasFilters = () => !isTimedMode();
const isFavoriteTerms = () => mode === "favorites" && favoriteKind === "terms";
const studyRank = (q) => (subjects.indexOf(q.subject) + 1) * 1_000_000 +
  (q.textbook?.chapterOrder ?? 999) * 1_000;

function refreshFilters() {
  if (hasFilters()) {
    const chapterOptions = unique(subjectRows().slice().sort((a, b) => studyRank(a)-studyRank(b)).map((q) => q.chapter));
    fill($("chapter"), [["", "全部章节"], ...chapterOptions.map((v) => [v, v])]);
    const points = new Map();
    for (const q of chapterRows()) {
      if (mode === "featured" && !featuredIds.has(q.id)) continue;
      for (const topic of q.topics) {
        const rank = studyRank(q) + (q.textbook?.topicOrder[topic] ?? 999);
        const previous = points.get(topic);
        points.set(topic, { count: (previous?.count ?? 0) + 1, rank: Math.min(previous?.rank ?? Infinity, rank) });
      }
    }
    const topics = [...points].sort((a, b) => a[1].rank - b[1].rank || a[0].localeCompare(b[0], "zh-CN"));
    fill($("topic"), [["", "全部考点"], ...topics.map(([t, value]) => [t, `${t}（${value.count}）`])]);
  }
  if (mode === "exam") {
    const years = unique(data.filter((q) => isExam(q) || ($("include-recall").checked && isRecall(q)))
      .map((q) => q.source.year)).sort((a, b) => b - a);
    fill($("year"), years.map((y) => [String(y), `${y} 年`]));
  }
  const typeSource = mode === "exam" ? scopedRows() : subjectRows();
  for (const id of ["type-calculation", "type-other-choice"]) {
    const visible = typeSource.some((q) => questionType(q) === id);
    $(id).disabled = !visible;
    $(id).parentElement.hidden = !visible;
  }
  const pool = candidateRows();
  renderScopeProgress(pool);
  $("availability").textContent = `可选 ${pool.length.toLocaleString("zh-CN")} 题`;
  $("start").disabled = pool.length === 0;
  $("scope-note").textContent = scopeMessage(pool);
  if (isPersonal()) renderPersonalLibrary(pool);
}

function renderScopeProgress(pool = candidateRows()) {
  const {done, objective, subjective, total} = studyProgress.summary(pool);
  $("scope-progress").hidden = !total || isFavoriteTerms();
  const pct = total ? Math.round(100 * done / total) : 0;
  const text = done + "/" + total;
  $("scope-fill").style.width = pct + "%";
  $("scope-score").textContent = text;
  $("scope-objective").textContent = "客观题正确率 " + accuracyText(objective);
  $("scope-subjective").textContent = "主观题正确率 " + accuracyText(subjective);
  $("scope-fill").parentElement.setAttribute("aria-valuenow", String(pct));
  $("scope-fill").parentElement.setAttribute("aria-valuetext",
    [text, $("scope-objective").textContent, $("scope-subjective").textContent].join("，"));
}

function renderPersonalLibrary(pool) {
  const terms = isFavoriteTerms();
  $("saved-library").hidden = terms;
  $("saved-terms").hidden = !terms;
  $("export-saved").disabled = terms ? !knowledgeUI.favorites().length : !sourceRows().length;
  if (terms) knowledgeUI.renderFavorites();
  else renderSavedLibrary(pool);
}

function scopeMessage(pool) {
  if (!data.length) return "题库数据未载入。请从解压后的完整目录打开本页。";
  if (!pool.length && !studyProgress.typeIds.some((id) => $(id).checked && !$(id).disabled))
    return "勾选至少一种题型后开始练习。";
  if (hasFilters() && !pool.length && sourceRows().length) return "当前条件没有匹配题目，可扩大题型或考点范围，或清空搜索。";
  if (mode === "exam") {
    const year = $("year").value;
    const skipped = data.filter((q) => String(q.source.year) === year && !usable(q)
      && (isExam(q) || ($("include-recall").checked && isRecall(q)))).length;
    const details = skipped ? `另有 ${skipped} 道题面残缺，见强化题库或元信息。` : "";
    const objective = ["2023", "2024"].includes(year) ? "原资料的 120 道选择题没有保留题干。" : "";
    return `收录范围以该年材料可辨认的题目为准。${details}${objective}`;
  }
  if (mode === "mock" && pool.length) {
    const exams = pool.filter(isExam).length;
    return `题池含 ${exams} 道历年题、${pool.length - exams} 道习题，抽题不重复。`;
  }
  return "";
}

const isPractice = (q) => q.source.kind === "practice";

function questionType(q) {
  if (q.type === "计算题") return "type-calculation";
  if (q.type === "单选题") return "type-single";
  if (q.type === "多选题") return "type-multiple";
  return isObjective(q) ? "type-other-choice" : "type-written";
}

function candidateRows() {
  const selectedTypes = new Set(studyProgress.typeIds.filter((id) => $(id).checked && !$(id).disabled));
  return scopedRows().filter((q) => selectedTypes.has(questionType(q)));
}

function scopedRows() {
  if (hasFilters()) {
    const topic = $("topic").value;
    const query = exactText($("query").value);
    const rows = chapterRows().filter((q) => !topic ||
      (q.topics.includes(topic) && (mode !== "featured" || featuredIds.has(q.id))));
    return query ? rows.filter((q) => exactText([
      q.stem, ...q.options.map((o) => o.text), mode === "notes" ? records[q.id]?.note?.text ?? "" : "",
    ].join(" ")).includes(query)) : rows;
  }
  if (mode === "exam") {
    return data.filter((q) => usable(q) && String(q.source.year) === $("year").value
      && (isExam(q) || ($("include-recall").checked && isRecall(q))))
      .sort((a, b) => (a.source.order ?? 1000) - (b.source.order ?? 1000));
  }
  const mix = $("mix").value;
  return subjectRows().filter((q) => usable(q) && (
    mix === "mixed" ? isPractice(q) || isExam(q) : mix === "practice" ? isPractice(q) : isExam(q)
  ));
}

function shuffled(rows) {
  const copy = rows.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function drawMock(rows) {
  const n = Math.min(rows.length, Number($("size").value) || 20);
  if ($("mix").value !== "mixed" || n < 2) return shuffled(rows).slice(0, n);
  const trueRows = shuffled(rows.filter(isExam));
  const practiceRows = shuffled(rows.filter(isPractice));
  if (!trueRows.length || !practiceRows.length) return shuffled(rows).slice(0, n);
  const nExam = Math.max(1, Math.min(n - 1, trueRows.length,
    Math.round(n * .35)));
  const pick = [...trueRows.slice(0, nExam), ...practiceRows.slice(0, n - nExam)];
  const used = new Set(pick.map((q) => q.id));
  return shuffled([...pick, ...shuffled(rows.filter((q) => !used.has(q.id))).slice(0, n - pick.length)]);
}

function renderSavedLibrary(pool) {
  const container = $("saved-library");
  container.replaceChildren();
  if (!pool.length) {
    const message = document.createElement("p");
    message.textContent = sourceRows().length ? "此筛选范围内没有记录。" : settings[mode].empty;
    container.append(message);
    return;
  }
  const pageSize = 12;
  const pages = Math.ceil(pool.length / pageSize);
  savedPage = Math.min(savedPage, pages - 1);
  const list = document.createElement("ul");
  list.className = "saved-list";
  pool.slice(savedPage * pageSize, (savedPage + 1) * pageSize).forEach((q, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const stem = document.createElement("strong");
    const detail = document.createElement("span");
    button.type = "button";
    stem.textContent = q.stem.replace(/\s+/g, " ").slice(0, 135);
    const entry = records[q.id];
    const context = mode === "notes" ? entry.note.text.slice(0, 180)
      : mode === "wrong" ? `记录 ${entry.wrong.count} 次` : q.chapter;
    detail.textContent = `${q.subject} · ${context}`;
    button.append(stem, detail);
    button.addEventListener("click", () => openSession(pool, savedPage * pageSize + index));
    li.append(button);
    list.append(li);
  });
  container.append(list);
  if (pages < 2) return;
  const footer = document.createElement("div");
  footer.className = "saved-pagination";
  const previous = document.createElement("button");
  const next = document.createElement("button");
  const label = document.createElement("span");
  previous.textContent = "上一页";
  next.textContent = "下一页";
  label.textContent = `${savedPage + 1} / ${pages} 页`;
  for (const [button, delta] of [[previous, -1], [next, 1]]) {
    button.type = "button";
    button.className = "button secondary";
    button.disabled = savedPage + delta < 0 || savedPage + delta >= pages;
    button.addEventListener("click", () => {
      savedPage += delta;
      renderSavedLibrary(pool);
      container.querySelector("button")?.focus();
    });
  }
  footer.append(previous, label, next);
  container.append(footer);
}

function switchMode(next) {
  const changedMode = next !== mode;
  if (next !== mode) {
    if (!isTimedMode()) {
      finishAttempt();
      pausePractice();
    }
    studyProgress.checkpoint(session(), mode);
    setNoteOpen(false);
    delete $("solution-panel").dataset.questionId;
  }
  mode = next;
  if (!document.hidden) resumePractice();
  savedPage = 0;
  for (const button of document.querySelectorAll("#modes button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }
  $("knowledge-panel").hidden = mode !== "knowledge";
  $("exercise-panel").hidden = mode === "knowledge";
  $("scope-panel").hidden = mode === "knowledge" || isFavoriteTerms();
  if (mode === "knowledge") {
    document.body.classList.add("study-wide");
    fitStudyPane();
    knowledgeUI.refresh();
    $("knowledge-query").focus({preventScroll:true});
    return;
  }
  for (const name of Object.keys(settings)) {
    for (const node of document.querySelectorAll(`.${name}-only`)) node.hidden = name !== mode;
  }
  for (const node of document.querySelectorAll(".filter-field")) node.hidden = !hasFilters();
  $("query-label").textContent = mode === "notes" ? "搜索题目与笔记" : "搜索题干";
  $("query").placeholder = mode === "notes" ? "输入题干或笔记关键词" : "输入药名或关键词";
  $("query").value = "";
  if (changedMode && isPersonal()) {
    $("subject").value = "";
    $("chapter").value = "";
    $("topic").value = "";
  }
  $("subject-field").hidden = mode === "exam";
  $("mode-title").textContent = settings[mode].title;
  $("mode-description").textContent = settings[mode].description;
  $("start").textContent = settings[mode].action;
  $("saved-library").hidden = !isPersonal();
  $("saved-terms").hidden = !isFavoriteTerms();
  $("favorite-kinds").hidden = mode !== "favorites";
  $("saved-export").hidden = !["favorites", "wrong"].includes(mode);
  refreshFilters();
  showWorkspace(false);
}

function start(event) {
  event.preventDefault();
  let pool = candidateRows();
  if (!pool.length) return;
  if (mode === "mock") pool = drawMock(pool);
  openSession(pool);
}

function openSession(pool, index = 0) {
  finishAttempt();
  studyProgress.checkpoint(session(), mode);
  setNoteOpen(false);
  delete $("solution-panel").dataset.questionId;
  const startedAt = Date.now();
  const minutes = mode === "mock" ? Number($("time-limit").value) : 0;
  sessions[mode] = {
    questions: pool, index, scope: studyProgress.captureFilters(), responses: {}, optionDrafts: {}, attempts: {}, outcomes: {}, skipped: {}, revealed: {}, noteDrafts: {},
    shuffledOptions: {}, exclusions: {},
    startedAt, deadline: minutes ? startedAt + minutes * 60_000 : null,
    pausedAt: null, endedAt: null, submitted: false, reviewing: false,
  };
  showWorkspace(true);
}

function showWorkspace(focus) {
  const current = session();
  $("idle").hidden = Boolean(current);
  $("summary").hidden = !current?.submitted || current.reviewing;
  $("question").hidden = !current || (current.submitted && !current.reviewing);
  const answering = !$("question").hidden;
  const paired = isQuestionBank() || answering;
  $("study-navigation").hidden = !answering;
  $("jump-panel").hidden = !answering;
  $("solution-panel").hidden = !paired;
  $("study-splitter").hidden = !paired;
  $("exercise-panel").classList.toggle("is-answering", answering);
  $("exercise-panel").classList.toggle("has-study-panels", paired);
  document.body.classList.toggle("study-wide", paired);
  if (!answering) {
    setNoteOpen(false);
    $("solution").hidden = true;
    $("attempt-history").hidden = true;
    $("solution-number").textContent = "";
    delete $("solution-panel").dataset.questionId;
    $("solution-veil").hidden = false;
    $("solution-veil-label").textContent = current?.submitted ? "选择题号查看本题解析"
      : isTimedMode() ? "交卷后可查看解析" : "开始练习后可查看本题解析";
  }
  fitStudyPane();
  if (!$("summary").hidden) {
    renderResult(current);
    if (focus) {
      $("summary").focus({preventScroll: true});
      $("summary").scrollIntoView({block: "nearest"});
    }
  }
  if (!$("question").hidden) renderQuestion(current, focus);
}

function renderFigures(container, q, section) {
  const images = q.images.filter((image) => image.section === section);
  container.replaceChildren(...images.map((image) => {
    const el = document.createElement("img");
    el.className = "figure";
    el.src = "../" + image.path;
    el.alt = image.alt || `原资料中的${section === "stem" ? "题目" : "答案"}图示`;
    return el;
  }));
}

function isMultiple(q) { return q.type === "多选题"; }

function optionOrder(current, q) {
  const mentionsPosition = /(?:以上|上述|上列|以下各|前[一二两三四五]项).{0,7}(?:均|都|是|非|对|错|正确|错误|之中|$)/;
  if (!preferences.shuffleOptions || q.options.some((option) => mentionsPosition.test(option.text)) || mentionsPosition.test(q.stem)) {
    return q.options;
  }
  return current.shuffledOptions[q.id] ??= shuffled(q.options);
}

function renderOptions(current, q) {
  $("options").hidden = !q.options.length;
  const response = current.responses[q.id] ?? [];
  const selected = current.submitted ? response : current.optionDrafts[q.id] ?? response;
  const editable = !current.submitted && !current.revealed[q.id] && !response.length && !current.skipped[q.id];
  const excluded = current.exclusions[q.id] ??= new Set();
  $("option-list").replaceChildren(...optionOrder(current, q).map((option) => {
    const display = option.label;
    const line = document.createElement("div");
    line.className = "option";
    line.dataset.option = option.label;
    line.dataset.display = display;
    const label = document.createElement("label");
    label.className = "option-label";
    const input = document.createElement("input");
    input.type = isMultiple(q) ? "checkbox" : "radio";
    input.name = "response";
    input.value = option.label;
    input.checked = selected.includes(option.label);
    input.addEventListener("change", () => {
      current.optionDrafts[q.id] = Array.from($("option-list").querySelectorAll("input:checked"), (el) => el.value);
      renderChoiceActions(current, q);
    });
    const letter = document.createElement("b");
    letter.textContent = display;
    const content = document.createElement("span");
    content.className = "option-content";
    content.textContent = option.text;
    const outcome = document.createElement("span");
    outcome.className = "option-state";
    outcome.hidden = true;
    label.append(input, letter, content, outcome);
    const exclude = document.createElement("button");
    exclude.type = "button";
    exclude.className = "exclude-option";
    exclude.hidden = !preferences.showExclusions || !editable;
    const updateExclusion = () => {
      const active = preferences.showExclusions && editable && excluded.has(option.label);
      input.disabled = !editable || active;
      line.dataset.excluded = String(active);
      exclude.setAttribute("aria-pressed", String(active));
      const action = (active ? "恢复" : "排除") + "选项 " + display;
      exclude.setAttribute("aria-label", action);
      exclude.title = action;
    };
    exclude.addEventListener("click", () => {
      if (!excluded.delete(option.label)) {
        excluded.add(option.label);
        input.checked = false;
        current.optionDrafts[q.id] = (current.optionDrafts[q.id] ?? []).filter((key) => key !== option.label);
      }
      updateExclusion();
      renderChoiceActions(current, q);
    });
    updateExclusion();
    line.append(label, exclude);
    return line;
  }));
  renderChoiceActions(current, q);
}

function renderChoiceActions(current, q) {
  const confirmed = Boolean(current.responses[q.id]?.length);
  const editable = !current.submitted && !current.skipped[q.id] && (!current.revealed[q.id] || isTimedMode());
  const canEditConfirmation = confirmed && editable && isTimedMode();
  $("choice-actions").hidden = !q.options.length;
  $("choice-status").hidden = !canEditConfirmation;
  $("choice-status").textContent = "选项已确认";
  $("check-options").hidden = canEditConfirmation;
  $("check-options").disabled = !editable || confirmed || !current.optionDrafts[q.id]?.length;
  $("edit-options").hidden = !canEditConfirmation;
  $("dont-know").disabled = !canMarkUnknown(current, q);
}

function renderResponseControls(current, q) {
  const shown = current.submitted || current.revealed[q.id];
  const noteOpen = !$("note-editor").hidden;
  const attempt = current.attempts[q.id];
  const editable = !q.options.length && !current.submitted;
  $("response").readOnly = current.submitted || Boolean(attempt?.completed) || Boolean(current.skipped[q.id]);
  $("retry-response").hidden = !editable || !attempt?.completed || isTimedMode() || Boolean(current.skipped[q.id]);
  const status = !editable ? "" : attemptStorageFailed ? "当前浏览器无法保存记录，作答暂存在此标签页。"
    : attempt ? "已保存到答题记录。" : "输入内容后自动保存。";
  if ($("attempt-status").textContent !== status) $("attempt-status").textContent = status;
  $("reveal").setAttribute("aria-expanded", String(Boolean(shown) && !noteOpen));
  $("reveal").textContent = noteOpen ? "看答案"
    : attempt && !current.skipped[q.id] && (!shown || !attempt.completed) ? "核对作答"
    : shown ? "收起答案" : "看答案";
}

function finishAttempt(current = session(), q = current?.questions[current.index]) {
  const attempt = current?.attempts[q?.id];
  if (attempt) attempt.completed = true;
}

function gradeSubjective(current, q) {
  const response = current.responses[q.id];
  if (!hasResponse(response) || !q.rubric?.points.length) return null;
  const attempt = current.attempts[q.id];
  const grade = attempt?.grade ?? gradeRubric(q, response, preferences.rubricThreshold);
  if (attempt && !attempt.grade) {
    attempt.grade = grade;
    saveAttempt(q.id, {id: attempt.id, at: attempt.at, text: response, grade});
  }
  return grade.hits === grade.total;
}

function recordResponse(current, q, text) {
  current.responses[q.id] = text;
  if (!text.trim()) return;
  markStudyDay();
  studyProgress.complete(q);
  const stamp = Date.now();
  const attempt = current.attempts[q.id] ??= {
    id: globalThis.crypto?.randomUUID?.() ?? `${stamp}-${Math.random().toString(36).slice(2)}`,
    at: stamp,
    completed: false,
  };
  saveAttempt(q.id, { id: attempt.id, at: attempt.at, text });
  studyProgress.schedule(current, mode);
  renderScopeProgress();
}

function renderQuestion(current, focus) {
  const q = current.questions[current.index];
  const response = current.responses[q.id] ?? (q.options.length ? [] : "");
  $("number").textContent = `第 ${current.index + 1} / ${current.questions.length} 题`;
  $("progress").setAttribute("aria-label", "题目进度");
  $("progress").max = current.questions.length;
  $("progress").value = current.index + 1;
  $("elapsed").hidden = !isTimedMode();
  updateTime();
  $("where").textContent = [q.subject, q.chapter, q.textbook?.section, q.type].filter(Boolean).join(" · ");
  $("origin").textContent = q.source.label;
  $("origin-locator").textContent = q.source.locator;
  const prefix = ["单选题", "多选题"].includes(q.type) ? "（" + q.type + "）" : "";
  $("stem").textContent = prefix + q.stem;
  renderFigures($("stem-images"), q, "stem");
  renderOptions(current, q);
  const showText = !q.options.length;
  $("response-field").hidden = !showText;
  $("response").value = showText ? response : "";
  $("prev").disabled = current.index === 0;
  $("next").disabled = current.index === current.questions.length - 1;
  renderFinish(current);
  $("reveal").hidden = isTimedMode() || current.submitted;
  $("back-to-library").hidden = !isPersonal();
  $("back-to-result").hidden = !current.reviewing;
  $("tool-status").textContent = "";
  const sameQuestion = $("solution-panel").dataset.questionId === q.id;
  setNoteOpen(sameQuestion ? !$("note-editor").hidden : mode === "notes" && Boolean(records[q.id]?.note?.text));
  renderTools(q, current);
  renderSolution(current, q);
  renderNav(current);
  if (focus) {
    $("question-workspace").scrollTop = 0;
    if (narrowStudyLayout()) $("question").scrollIntoView({block: "start"});
    $("question").focus({preventScroll: true});
  }
}

function renderFinish(current) {
  const timed = isTimedMode();
  const atEnd = current.index === current.questions.length - 1;
  const allAnswered = current.questions.every((q) => hasAttempt(current, q));
  $("finish").hidden = current.submitted || (!timed && !atEnd && !allAnswered);
  $("finish").textContent = timed ? "提交试卷" : "查看练习结果";
}

function paintOptionResults(labels, response) {
  for (const line of $("option-list").querySelectorAll(".option")) {
    const key = line.dataset.option;
    const state = labels.includes(key) ? "correct" : labels.length && response?.includes(key) ? "wrong" : "";
    line.dataset.result = state;
    const outcome = line.querySelector(".option-state");
    outcome.hidden = !state;
    outcome.textContent = state === "correct" ? "正确" : state === "wrong" ? "误选" : "";
  }
}

function confirmOptions() {
  const current = session();
  const q = currentQuestion();
  const draft = current.optionDrafts[q.id];
  if (current.submitted || current.skipped[q.id] || current.revealed[q.id] || current.responses[q.id] || !draft?.length) return;
  current.responses[q.id] = draft;
  delete current.optionDrafts[q.id];
  markStudyDay();
  studyProgress.complete(q);
  const labels = correctLabels(q);
  if (isTimedMode() || !labels.length) {
    renderQuestion(current, false);
    studyProgress.checkpoint(current, mode);
    renderScopeProgress();
    ($("edit-options").hidden ? $("reveal") : $("edit-options")).focus({ preventScroll: true });
    return;
  }
  const correct = matches(labels, draft);
  current.outcomes[q.id] = correct;
  registerOutcomes([[q, correct]]);
  renderScopeProgress();
  if (isPersonal()) refreshFilters();
  if (correct && preferences.skipCorrect && current.index < current.questions.length - 1) {
    go(current.index + 1);
    const top = $("question").getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.65) $("question").scrollIntoView({ block: "start" });
    return;
  }
  if (!correct) current.revealed[q.id] = true;
  renderQuestion(current, false);
  studyProgress.checkpoint(current, mode);
  if (correct) {
    $("reveal").focus({preventScroll: true});
    return;
  }
  refreshRecordView("已加入错题库。");
  bringAnswerIntoView($("answer-feedback"));
}

function canMarkUnknown(current, q) {
  return !current.submitted && !current.skipped[q.id] && typeof current.outcomes[q.id] !== "boolean" &&
    !(q.options.length && hasResponse(current.responses[q.id]));
}

function markUnknown() {
  const current = session();
  const q = currentQuestion();
  if (!q || !canMarkUnknown(current, q)) return;
  delete current.optionDrafts[q.id];
  finishAttempt(current, q);
  current.skipped[q.id] = true;
  current.outcomes[q.id] = false;
  if (!isTimedMode()) current.revealed[q.id] = true;
  markStudyDay();
  registerOutcomes([[q, false]], true);
  renderQuestion(current, false);
  studyProgress.checkpoint(current, mode);
  renderScopeProgress();
  refreshRecordView("已标为不会，并加入错题库。");
  if (!isTimedMode()) bringAnswerIntoView($("answer-feedback"));
}

const narrowStudyLayout = () => window.matchMedia("(max-width: 760px)").matches;

function bringAnswerIntoView(focusTarget) {
  if (!$("note-editor").hidden) return;
  $("solution-scroll").scrollTop = 0;
  if (narrowStudyLayout()) $("solution-panel").scrollIntoView({block: "start"});
  focusTarget?.focus({preventScroll: true});
}

function renderSolution(current, q) {
  const shown = current.submitted || Boolean(current.revealed[q.id]);
  const panel = $("solution-panel");
  const changed = panel.dataset.questionId !== q.id;
  panel.dataset.questionId = q.id;
  $("solution-number").textContent = `第 ${current.index + 1} 题`;
  $("solution-veil-label").textContent = isTimedMode() && !current.submitted ? "交卷后可核对本题" : "点击「看答案」展开解析";
  $("solution-veil").hidden = shown;
  if (changed || !shown) $("solution-scroll").scrollTop = 0;
  paintOptionResults(shown ? correctLabels(q) : [], current.responses[q.id]);
  $("solution").hidden = !shown;
  renderResponseControls(current, q);
  renderAttemptHistory(q, shown);
  if (!shown) {
    for (const id of ["answer", "answer-feedback", "answer-images", "reasoning-text", "reasoning-supplement", "reasoning-note",
      "analysis", "analysis-evidence", "original-option-list", "original-analysis-evidence",
      "study-context-list", "rubric-list", "rubric-summary", "topics", "source-list", "attempt-list"]) {
      $(id).replaceChildren();
    }
    return;
  }
  const labels = correctLabels(q);
  const response = current.responses[q.id];
  const skipped = Boolean(current.skipped[q.id]);
  $("answer-feedback").hidden = !skipped && (!labels.length || !response?.length);
  $("answer-feedback").textContent = skipped ? "已标为不会"
    : $("answer-feedback").hidden ? "" : matches(labels, response) ? "回答正确" : "回答有误";
  $("answer-feedback").dataset.correct = String(!skipped && matches(labels, response));
  const reordered = optionOrder(current, q);
  const selected = reordered.flatMap((option) => labels.includes(option.label) ? [option.label + ". " + option.text] : []);
  const originalAnswer = q.answer || selected.join("\n") || "资料缺参考答案";
  $("answer").textContent = q.optionExplanations?.conflict ? "参考答案待核" : originalAnswer;
  renderFigures($("answer-images"), q, "answer");
  renderRubric(current, q);
  const exactAnalysis = q.analysisOriginal ?? [];
  const originalReason = q.reasoning?.authorship === "原文";
  renderReasoning(exactAnalysis.length && !originalReason ? null : q.reasoning);
  renderExplanations(q, labels, reordered);
  renderStudyContext(q.studyEvidence?.stem ?? q.studyContext);
  $("topics").textContent = q.topics.join("、") || q.chapter || "待原题补齐";
  $("provenance").textContent = [q.source.label, q.source.locator].filter(Boolean).join(" · ");
  const alternateSources = q.alternateSources ?? [];
  $("alternate-sources").hidden = !alternateSources.length;
  $("source-list").replaceChildren(...alternateSources.map((source) => {
    const item = document.createElement("li");
    item.textContent = [source.file, source.locator].filter(Boolean).join(" · ");
    return item;
  }));
}

function renderExplanations(q, labels, ordered) {
  const listItem = ({label, text}) => {
    const li = document.createElement("li");
    li.textContent = label ? `${label}　${text}` : text;
    return li;
  };
  const labelsWithOriginal = new Set(Object.entries(q.studyEvidence?.options ?? {})
    .filter(([, parts]) => parts.some(({kind}) => kind === "original")).map(([label]) => label));
  const originalMain = q.reasoning?.authorship === "原文" ? q.reasoning.text : "";
  const original = (q.analysisOriginal ?? []).filter(({label,text}) =>
    !labelsWithOriginal.has(label) && !originalMain.includes(text));
  const details = $("original-option-analysis");
  details.hidden = !original.length;
  details.open = Boolean(original.length);
  $("original-option-list").replaceChildren(...original.map(listItem));
  const originalRefs = [...new Set(original.map(({source}) => [source.file, source.locator].join(" · ")))];
  $("original-analysis-evidence").hidden = !originalRefs.length;
  $("original-analysis-evidence").textContent = originalRefs.join("；");

  const explanations = q.optionExplanations;
  const reasons = explanations?.reasons ?? {};
  const items = q.options.length ? ordered.flatMap(({label, text}) => {
    const facts = q.studyEvidence?.options[label] ?? [];
    if (!reasons[label] && !facts.length) return [];
    const li = document.createElement("li");
    li.className = "choice-explanation";
    li.dataset.choice = label;
    const state = document.createElement("span");
    const keyed = labels.includes(label);
    state.className = "analysis-state";
    state.dataset.verdict = !labels.length ? "pending" : keyed ? "select" : "reject";
    state.textContent = label + (labels.length ? (keyed ? "　应选" : "　不选") : "");
    const title = document.createElement("h4");
    title.append(state, "　", text);
    li.append(title);
    if (reasons[label]) {
      const reason = document.createElement("p");
      reason.textContent = reasons[label];
      li.append(reason);
    }
    for (const part of facts) li.append(studyFact(part));
    return li;
  }) : !original.length && q.reasoning?.authorship !== "原文" ? q.analysis.map(listItem) : [];
  $("analysis-heading").hidden = !items.length;
  $("analysis").hidden = !items.length;
  $("analysis").replaceChildren(...items);
  const note = explanations?.note ?? "";
  const references = explanations?.references ?? q.analysisMeta?.evidence ?? [];
  const listed = new Set(q.reasoning?.references.map(({file, locator}) => [file, locator].join(" · ")));
  const citations = references.map(({file, locator}) => [file, locator].join(" · "))
    .filter((reference) => !listed.has(reference));
  const generated = Object.keys(reasons).length > 0 || (!q.options.length && items.length > 0);
  const credit = generated ? [...new Set(citations), "（AI生成）"].join("　") : "";
  $("analysis-evidence").textContent = [note, credit].filter(Boolean).join("\n");
  $("analysis-evidence").hidden = !$("analysis-evidence").textContent;
}

function renderStudyContext(entries) {
  $("study-context").hidden = !entries?.length;
  $("study-context-list").replaceChildren(...(entries ?? []).map(studyFact));
}

function studyFact({title, text, kind, source}) {
  const section = document.createElement("div");
  section.className = "study-fact";
  section.dataset.kind = kind ?? "knowledge";
  if (title) {
    const heading = document.createElement("strong");
    heading.textContent = title;
    section.append(heading);
  }
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  section.append(paragraph);
  if (source) {
    const location = document.createElement("small");
    location.className = "provenance";
    location.textContent = [source.file.split("/").pop(), source.locator].filter(Boolean).join(" · ");
    section.append(location);
  }
  return section;
}

function studyFactText({title, text, source}) {
  return [title ? title + "　" + text : text,
    source ? [source.file, source.locator].filter(Boolean).join(" · ") : ""].filter(Boolean).join("\n");
}

function renderRubric(current, q) {
  const rubric = q.rubric;
  $("rubric").hidden = Boolean(q.options.length);
  if (q.options.length) return;
  const response = current.responses[q.id]?.trim();
  const { matches: hits, hits: score, total } = current.attempts[q.id]?.grade ??
    gradeRubric(q, response, preferences.rubricThreshold);
  $("rubric-summary").textContent = !total ? (rubric?.note || "本题缺可用于自动匹配的采分点。")
    : !response ? "核对答案时可逐点自查。"
    : score === total ? `采分点全部命中 · ${score}/${total}` : `命中 ${score}/${total} 个采分点`;
  $("rubric-list").replaceChildren(...(rubric?.points ?? []).map((point, i) => {
    const li = document.createElement("li");
    li.textContent = point.label;
    if (response) {
      const state = document.createElement("span");
      state.className = "point-state";
      state.dataset.hit = String(hits[i]);
      state.textContent = hits[i] ? "已命中" : "未命中";
      li.append(" ", state);
    }
    return li;
  }));
  $("rubric-source").hidden = !total;
  $("rubric-source").textContent = total ? `关键词自评 · ${rubric.basis}（AI生成）` : "";
}

const attemptDate = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai",
});

function renderAttemptHistory(q, shown) {
  $("attempt-history").hidden = !shown || Boolean(q.options.length);
  if ($("attempt-history").hidden) return;
  const rows = attemptsFor(q.id).map((entry) => ({
    ...entry, ...(entry.grade ?? gradeRubric(q, entry.text, preferences.rubricThreshold)),
  }));
  const best = rows.reduce((max, entry) => Math.max(max, entry.hits), 0);
  const total = q.rubric?.points.length ?? 0;
  $("history-progress").textContent = rows.length
    ? [`已记录 ${rows.length} 次`, total ? `最高命中 ${best}/${total}` : ""].filter(Boolean).join(" · ")
    : "有作答内容后，每次记录都会显示在这里。";
  $("attempt-list").replaceChildren(...rows.map((entry, i) => {
    const item = document.createElement("li");
    const details = document.createElement("details");
    details.open = i === rows.length - 1;
    const summary = document.createElement("summary");
    const label = document.createElement("span");
    label.textContent = `第 ${i + 1} 次 · ${attemptDate.format(entry.at)}`;
    const score = document.createElement("strong");
    const previous = rows[i - 1];
    const delta = previous ? entry.hits - previous.hits : 0;
    const change = previous && total ? (delta ? ` · 较上次 ${delta > 0 ? "+" : ""}${delta}` : " · 持平") : "";
    score.textContent = (total ? `命中 ${entry.hits}/${total}` : "待自评") + change;
    summary.append(label, " ", score);
    const text = document.createElement("p");
    text.className = "attempt-text";
    text.textContent = entry.text;
    details.append(summary, text);
    if (total) {
      const matched = document.createElement("p");
      matched.className = "provenance";
      const covered = q.rubric.points.filter((_, index) => entry.matches[index]).map((point) => point.label);
      matched.textContent = covered.length ? `命中要点　${covered.join("、")}` : "未识别到采分点。";
      details.append(matched);
    }
    item.append(details);
    return item;
  }).reverse());
}

function renderReasoning(reason) {
  $("reasoning").hidden = !reason?.text;
  if (!reason?.text) return;
  const book = reason.book.file.split("/").pop().replace(/\.pdf$/i, "");
  $("reasoning-book").textContent = `教材对应　${book} · ${reason.book.locator}`;
  const status = reason.authorship === "原文" ? "资料原文" : "";
  $("reasoning-status").hidden = !status;
  $("reasoning-status").textContent = status;
  $("reasoning-status").dataset.state = reason.status;
  $("reasoning-text").textContent = reason.text;
  $("reasoning-supplement").hidden = !reason.supplement;
  $("reasoning-supplement").textContent = reason.supplement ? reason.supplement + "（AI生成）" : "";
  $("reasoning-note").hidden = !reason.note;
  $("reasoning-note").textContent = reason.note || "";
  const citations = reason.references.filter(({file, locator}) => file !== reason.book.file || locator !== reason.book.locator);
  const credit = reason.authorship === "AI生成" ? "（AI生成）" : "";
  $("reasoning-credit").textContent = credit;
  $("reasoning-sources").open = false;
  $("reasoning-sources").hidden = !citations.length;
  $("reasoning-evidence").hidden = !citations.length && !credit;
  $("reasoning-source-list").replaceChildren(...citations.map(({file, locator, url}) => {
    const item = document.createElement("li");
    const linkUrl = url ?? file;
    if (/^https?:\/\//i.test(linkUrl)) {
      const link = document.createElement("a");
      link.href = linkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = url ? [file, locator].filter(Boolean).join(" · ") : locator || "在线文献";
      item.append(link);
    } else {
      item.textContent = [file.split("/").pop(), locator].filter(Boolean).join(" · ");
    }
    return item;
  }));
}

function renderNav(current) {
  const count = current.questions.length;
  const low = Math.max(0, Math.min(current.index - 24, count - 49));
  const displayed = current.questions.slice(low, low + 49);
  const nodes = displayed.map((q, offset) => {
    const i = low + offset;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(i + 1);
    const active = i === current.index;
    if (active) button.setAttribute("aria-current", "step");
    const answered = hasAttempt(current, q);
    const outcome = current.outcomes[q.id];
    const state = outcome === true ? "correct" : outcome === false ? "wrong" : active ? "current" : answered ? "awaiting" : "unanswered";
    const hint = { correct: "答对", wrong: "答错", current: "当前", awaiting: "已作答 · 待评分", unanswered: "未作答" }[state];
    button.dataset.state = state;
    button.setAttribute("aria-label", `第 ${i + 1} 题 · ${hint}`);
    button.title = hint;
    button.addEventListener("click", () => go(i));
    return button;
  });
  const jump = document.createElement("input");
  jump.type = "number";
  jump.min = "1";
  jump.max = String(count);
  jump.placeholder = "题号";
  jump.setAttribute("aria-label", "跳转到题号");
  jump.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && jump.checkValidity() && jump.value) go(Number(jump.value) - 1);
  });
  $("question-list").replaceChildren(...nodes, ...(count > 49 ? [jump] : []));
}

function go(i) {
  const current = session();
  if (!current || i < 0 || i >= current.questions.length) return;
  if (i !== current.index && !isTimedMode()) finishAttempt();
  current.index = i;
  renderQuestion(current, true);
  studyProgress.checkpoint(current, mode);
}

function currentQuestion() {
  const current = session();
  return current?.questions[current.index];
}

function correctLabels(q) {
  const explicit = Array.isArray(q.correct) ? q.correct : null;
  if (!q.options.length || !usable(q) || !explicit || q.optionExplanations?.conflict) return [];
  const allowed = new Set(q.options.map((o) => o.label));
  const labels = unique(explicit);
  return labels.every((label) => allowed.has(label)) ? labels.sort() : [];
}

function matches(labels, response) {
  return Array.isArray(response) && labels.length === response.length &&
    labels.every((label) => response.includes(label));
}

function countWrong(store, id) {
  const entry = store[id] ?? {};
  store[id] = {
    ...entry,
    wrong: { active: true, at: Date.now(), count: (entry.wrong?.count ?? 0) + 1, streak: 0 },
  };
}

function answerOutcome(current, q) {
  const response = current.responses[q.id];
  if (hasResponse(response) && !isObjective(q)) return gradeSubjective(current, q);
  if (Array.isArray(response) && response.length) {
    const labels = correctLabels(q);
    return labels.length ? matches(labels, response) : null;
  }
  return null;
}

function registerOutcomes(outcomes, addAllWrong = false) {
  if (!outcomes.length) return;
  for (const [question, correct, attemptId] of outcomes) {
    const id = attemptId ?? globalThis.crypto?.randomUUID?.() ?? Date.now() + "-" + Math.random().toString(36).slice(2);
    userProfile.set((isObjective(question) ? choicePrefix : subjectivePrefix) + id, correct);
    studyProgress.complete(question, correct);
  }
  renderStudyStats();
  if (!outcomes.some(([q, correct]) => records[q.id]?.wrong?.active || (!correct && (addAllWrong || q.options.length)))) return;
  mutateRecords((store) => {
    for (const [q, correct] of outcomes) {
      const wrong = store[q.id]?.wrong;
      if (!correct && (addAllWrong || q.options.length || wrong?.active)) {
        countWrong(store, q.id);
      } else if (correct && wrong?.active) {
        const streak = (wrong.streak ?? 0) + 1;
        store[q.id].wrong = { ...wrong, streak, active: streak < Number(preferences.wrongThreshold) };
      }
    }
  });
}

function renderTools(q, current) {
  const entry = records[q.id];
  const favorite = Boolean(entry?.favoriteAt);
  const noted = Boolean(entry?.note?.text);
  const wrong = Boolean(entry?.wrong?.active);
  $("favorite").setAttribute("aria-pressed", String(favorite));
  $("favorite").textContent = favorite ? "取消收藏" : "收藏本题";
  $("edit-note").textContent = noted ? "查看笔记" : "写笔记";
  $("delete-note").hidden = !noted;
  $("add-wrong").hidden = wrong || Boolean(correctLabels(q).length) || !(current.submitted || current.revealed[q.id]);
  $("mastered").hidden = !wrong;
  const streak = entry?.wrong?.streak ?? 0;
  $("wrong-streak").hidden = !wrong || preferences.wrongThreshold !== "3" || !streak;
  $("wrong-streak").textContent = `错题复习 · 连续答对 ${streak}/3 次`;
}

function setNoteOpen(open) {
  const editor = $("note-editor");
  const q = currentQuestion();
  const sameNote = !editor.hidden && editor.dataset.questionId === q?.id;
  if ((open && sameNote) || (!open && editor.hidden)) return;
  const solution = $("solution-scroll");
  const sameQuestion = editor.dataset.questionId === q?.id;
  if (open) {
    answerScrollBeforeNote = $("solution-panel").dataset.questionId === q.id && editor.hidden ? solution.scrollTop : 0;
    editor.dataset.questionId = q.id;
    editor.scrollTop = 0;
    $("note-text").value = session().noteDrafts[q.id] ?? records[q.id]?.note?.text ?? "";
  } else {
    delete editor.dataset.questionId;
  }
  editor.hidden = !open;
  solution.hidden = open;
  if (!open && sameQuestion) solution.scrollTop = answerScrollBeforeNote;
  $("solution-panel-heading").textContent = open ? "本题笔记" : "答案与解析";
  $("edit-note").setAttribute("aria-expanded", String(open));
  $("note-status").textContent = "";
  if (q) renderResponseControls(session(), q);
}

function refreshRecordView(message) {
  $("tool-status").textContent = message;
  renderTools(currentQuestion(), session());
  if (isPersonal()) refreshFilters();
}

function renderResult(current) {
  const objective = {right: 0, graded: 0};
  const subjective = {right: 0, graded: 0};
  const timedMode = isTimedMode();
  let answered = 0, blankScorable = 0;
  const numbers = current.questions.map((q, index) => {
    const attempt = hasAttempt(current, q);
    if (attempt) answered++;
    const grade = current.outcomes[q.id];
    const group = isObjective(q) ? objective : subjective;
    if (typeof grade === "boolean") {
      group.graded++;
      if (grade) group.right++;
    } else if (timedMode && !attempt && (isObjective(q) ? correctLabels(q).length : q.rubric?.points.length)) {
      group.graded++;
      blankScorable++;
    }
    const state = grade === true ? "correct" : grade === false ? "wrong" : attempt ? "awaiting" : "unanswered";
    const hint = {correct: "答对", wrong: "答错", awaiting: "可人工核对", unanswered: "未作答"}[state];
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = index;
    button.dataset.state = state;
    button.textContent = index + 1;
    button.setAttribute("aria-label", `第 ${index + 1} 题 · ${hint}`);
    button.title = hint;
    return button;
  });
  const timed = current.timedOut ? "已到时自动交卷。" : "";
  $("result-heading").textContent = timedMode ? "交卷结果" : "练习结果";
  $("result").textContent = `${timed}共 ${current.questions.length} 题，已作答 ${answered} 题。用时 ${duration(current)}。`;
  $("result-secondary").textContent = objective.graded ? `${accuracyText(objective)}（答对 ${objective.right} / ${objective.graded}）` : "—";
  $("result-subjective").textContent = subjective.graded ? `${accuracyText(subjective)}（答对 ${subjective.right} / ${subjective.graded}）` : "—";
  $("result-note").textContent = [
    subjective.graded ? "主观题按采分点全部命中计为答对。" : "",
    blankScorable ? `有 ${blankScorable} 道可判分题未作答，计入试卷正确率。` : "",
  ].filter(Boolean).join("");
  $("result-note").hidden = !$("result-note").textContent;
  $("result-questions").replaceChildren(...numbers);
}

function duration(current) {
  return clockText(Math.max(0, Math.floor(((current.endedAt ?? current.pausedAt ?? Date.now()) - current.startedAt) / 1000)));
}

function pausePractice() {
  const current = session();
  if (current && !isTimedMode() && !current.submitted) current.pausedAt ??= Date.now();
}

function resumePractice() {
  const current = session();
  if (current?.pausedAt != null) {
    current.startedAt += Date.now() - current.pausedAt;
    current.pausedAt = null;
  }
}

function clockText(seconds) {
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

function updateTime() {
  const current = session();
  if (!current || !isTimedMode()) return;
  $("elapsed").textContent = current.deadline && !current.submitted
    ? `剩余 ${clockText(Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000)))}`
    : duration(current);
}

function submit(name) {
  const current = sessions[name];
  if (!current || current.submitted) return;
  const now = Date.now();
  const timedOut = current.deadline !== null && now >= current.deadline;
  current.submitted = true;
  current.timedOut = timedOut;
  current.endedAt = timedOut ? current.deadline : now;
  const outcomes = [];
  for (const q of current.questions) {
    finishAttempt(current, q);
    if (typeof current.outcomes[q.id] === "boolean") continue;
    const result = answerOutcome(current, q);
    if (result === null) continue;
    current.outcomes[q.id] = result;
    outcomes.push([q, result, current.attempts[q.id]?.id]);
  }
  registerOutcomes(outcomes);
  studyProgress.checkpoint(current, name);
  if (mode === name) {
    renderScopeProgress();
    showWorkspace(true);
  }
}

function tick() {
  const mock = sessions.mock;
  if (mock?.deadline && !mock.submitted && Date.now() >= mock.deadline) submit("mock");
  updateTime();
  if (lastStatsDay !== studyDate()) {
    lastStatsDay = studyDate();
    renderStudyStats();
  }
}

function setAsideSession() {
  finishAttempt();
  studyProgress.checkpoint(session(), mode);
  sessions[mode] = null;
  refreshFilters();
  showWorkspace(false);
  if (isPersonal()) $("saved-library").querySelector("button")?.focus();
  else $("subject-field").hidden ? $("year").focus() : $("subject").focus();
}

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSaved() {
  const markdown = $("export-format").value === "md";
  const title = mode === "wrong" ? "昆医349错题库" : isFavoriteTerms() ? "昆医349收藏名词解释" : "昆医349收藏题目";
  const heading = (name, depth) => (markdown ? "#".repeat(depth) + " " : "") + name;
  const line = (value) => (markdown ? "- " : "") + value;
  const blocks = [heading(title,1), "导出日期 " + studyDate()];
  if (isFavoriteTerms()) {
    for (const term of knowledgeUI.favorites()) {
      const content = [heading(term.name,2), [term.kind,term.subject,term.chapter].filter(Boolean).join(" · "),
        ...term.sections.map(({label,text}) => label + "\n" + text)];
      if (term.related?.length) {
        content.push(heading("关联药物",3));
        for (const {name, type, summary, source} of term.related) {
          const reference = [source.label, source.locator, source.url].filter(Boolean).join(" · ");
          content.push(line(name + " · " + type + "\n" + summary + "\n" + reference));
        }
      }
      content.push(...term.sources.map(({label,locator,url}) => line([label,locator,url].filter(Boolean).join(" · "))));
      blocks.push(content.join("\n\n"));
    }
  } else {
    for (const q of sourceRows()) {
      const entry = records[q.id] ?? {};
      const origins = [q.subject,q.chapter,q.source.label,q.source.locator].filter(Boolean).join(" · ");
      const hasOriginal = q.reasoning?.authorship === "原文" || q.analysisOriginal?.length;
      const selectedAnalysis = hasOriginal ? q.analysisOriginal ?? [] : q.options.length ? [] : q.analysis;
      const original = selectedAnalysis.filter(({text}) => text &&
        !(q.reasoning?.authorship === "原文" && q.reasoning.text.includes(text))).map(({label,text,source}) =>
        line((label ? label + "　" : "") + text) + (source ? "\n原文出处　" + source.file + " · " + source.locator : ""));
      const reason = hasOriginal && q.reasoning?.authorship !== "原文" ? "" : q.reasoning?.text;
      const evidence = q.studyEvidence;
      const optionReasons = q.options.map(({label,text}) => {
        const reason = q.optionExplanations?.reasons?.[label];
        const facts = evidence?.options[label] ?? [];
        if (!reason && !facts.length) return "";
        return [label + ". " + text, reason ? reason + "（AI生成）" : "", ...facts.map(studyFactText)]
          .filter(Boolean).join("\n");
      }).filter(Boolean);
      const context = evidence?.stem ?? q.studyContext ?? [];
      blocks.push([heading(q.id + " · " + q.type,2), "来源　" + origins, q.stem,
        ...q.options.map(({label,text}) => line(label + ". " + text)),
        "答案　" + (q.optionExplanations?.conflict ? "参考答案待核" : q.answer || "原资料缺答案"),
        reason ? heading("本题解析",3) + "\n" + reason + (q.reasoning.authorship === "AI生成" ? "（AI生成）" : "") : "",
        q.reasoning?.supplement ? q.reasoning.supplement + "（AI生成）" : "",
        ...(original.length ? [heading(hasOriginal ? "资料解析原文" : "补充解析（AI生成）",3), original.join("\n")] : []),
        ...(optionReasons.length ? [heading("逐项解析",3), ...optionReasons.map(line)] : []),
        ...(context.length ? [heading("关联知识",3), ...context.map((part) => line(studyFactText(part)))] : []),
        q.topics.length ? "考点　" + q.topics.join("、") : "",
        mode === "wrong" && entry.wrong ? "累计做错 " + entry.wrong.count + " 次" : "",
        entry.note?.text ? "我的笔记　" + entry.note.text : "",
      ].filter(Boolean).join("\n\n"));
    }
  }
  downloadFile(title + "-" + studyDate() + (markdown ? ".md" : ".txt"),
    (markdown ? "" : "\uFEFF") + blocks.join("\n\n") + "\n", (markdown ? "text/markdown" : "text/plain") + ";charset=utf-8");
}

function openPreferences() {
  const message = userProfile.online ? "个人记录保存到此电脑的固定档案。备份可用于换电脑或恢复记录。"
    : "直接打开网页时，记录保存在当前浏览器。长期使用可从「启动题库.cmd」打开，也可备份迁移。";
  $("profile-location").textContent = message;
  $("preferences").showModal();
}

function updatePersonalViews() {
  records = readRecords();
  preferences = readPreferences();
  renderCounts();
  applyPreferences();
  if (mode === "knowledge") knowledgeUI.refresh();
  else if (isPersonal()) refreshFilters();
  if (currentQuestion() && !$("question").hidden) renderTools(currentQuestion(), session());
}

let suggestedResume = null;
function offerResume() {
  const saved = studyProgress.latest();
  if (!saved || !settings[saved.mode] || saved.mode === "knowledge") return;
  suggestedResume = saved;
  const scope = [settings[saved.mode].title,saved.filters?.subject,saved.filters?.chapter].filter(Boolean).join(" · ");
  $("resume-summary").textContent = scope + "，已作答 " + saved.count + "/" + saved.ids.length + " 题。";
  $("resume-dialog").showModal();
}

fill($("subject"), [["", "全部科目"], ...subjects.filter((s) => data.some((q) => q.subject === s)).map((s) => [s, s])]);
$("open-preferences").addEventListener("click", openPreferences);
$("exam-countdown").addEventListener("click", () => { openPreferences(); $("exam-date").focus(); });
$("close-preferences").addEventListener("click", () => $("preferences").close());
$("preferences-form").addEventListener("change", ({ target }) => {
  if (!Object.hasOwn(preferences, target.name)) return;
  preferences[target.name] = target.type === "checkbox" ? target.checked : target.value;
  if (!userProfile.set(preferenceKey, preferences)) {
    $("preference-note").textContent = "浏览器无法保存设置。本次更改会保留到关闭页面。";
    $("preference-note").hidden = false;
  }
  applyPreferences();
  if (currentQuestion() && !$("question").hidden) renderTools(currentQuestion(), session());
});
$("export-profile").addEventListener("click", () => downloadFile("昆医349个人数据-" + studyDate() + ".json",
  JSON.stringify(userProfile.snapshot(), null, 2), "application/json;charset=utf-8"));
$("import-profile").addEventListener("click", () => $("profile-file").click());
$("profile-file").addEventListener("change", async ({target}) => {
  const file = target.files[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error("这个备份超过 8 MB。");
    const count = userProfile.mergeBackup(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
    $("preference-note").textContent = "已载入备份中的 " + count + " 项个人数据。";
  } catch (error) {
    $("preference-note").textContent = error instanceof SyntaxError ? "无法读取该 JSON 备份。" : error.message;
  } finally {
    $("preference-note").hidden = false;
    target.value = "";
  }
});
$("favorite-kinds").addEventListener("click", ({target}) => {
  const button = target.closest("button[data-kind]");
  if (!button) return;
  favoriteKind = button.dataset.kind;
  for (const t of $("favorite-kinds").querySelectorAll("button")) t.setAttribute("aria-pressed", String(t === button));
  $("scope-panel").hidden = isFavoriteTerms();
  refreshFilters();
});
$("export-saved").addEventListener("click", exportSaved);
$("resume-later").addEventListener("click", () => $("resume-dialog").close());
$("resume-study").addEventListener("click", () => {
  const saved = suggestedResume;
  $("resume-dialog").close();
  if (!saved) return;
  const restored = studyProgress.restore(saved, data);
  if (!restored) return;
  switchMode(saved.mode);
  for (const id of studyProgress.filterIds) {
    const value = saved.filters?.[id];
    if (value === undefined) continue;
    const control = $(id);
    if (control.type === "checkbox") control.checked = Boolean(value);
    else if (control.tagName !== "SELECT" || [...control.options].some((option) => option.value === value)) control.value = value;
    refreshFilters();
  }
  sessions[saved.mode] = restored;
  showWorkspace(true);
});
window.addEventListener("study-profile-import", updatePersonalViews);
window.addEventListener("study-open-term", ({detail}) => {
  if (mode !== "knowledge") switchMode("knowledge");
  knowledgeUI.open(detail);
});
window.addEventListener("study-term-star", () => {
  renderCounts();
  if (isFavoriteTerms()) renderPersonalLibrary([]);
});
window.addEventListener("study-profile-status", () => {
  $("storage-note").hidden = !userProfile.diskFailed && !storageFailed;
  if (userProfile.diskFailed) $("storage-note").textContent = "本机档案暂时无法同步，页面会继续重试。";
});
$("modes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (button) switchMode(button.dataset.mode);
});
$("settings").addEventListener("submit", start);
function filterChanged() {
  savedPage = 0;
  refreshFilters();
}
for (const id of ["subject", "chapter", "topic", "year", "mix", "include-recall", ...studyProgress.typeIds]) {
  $(id).addEventListener("change", filterChanged);
}
$("query").addEventListener("input", filterChanged);
$("prev").addEventListener("click", () => go(session().index - 1));
$("next").addEventListener("click", () => go(session().index + 1));
$("check-options").addEventListener("click", confirmOptions);
$("dont-know").addEventListener("click", markUnknown);
$("edit-options").addEventListener("click", () => {
  const current = session();
  const q = currentQuestion();
  current.optionDrafts[q.id] = current.responses[q.id];
  delete current.responses[q.id];
  renderQuestion(current, false);
  studyProgress.checkpoint(current, mode);
  $("option-list").querySelector("input:checked")?.focus();
});
$("reveal").addEventListener("click", () => {
  const current = session();
  const q = currentQuestion();
  const attempt = current.attempts[q.id];
  const comparing = !q.options.length && !current.skipped[q.id] && attempt && !attempt.checked && Boolean(current.responses[q.id]?.trim());
  if (!$("note-editor").hidden) {
    setNoteOpen(false);
    if (current.revealed[q.id] && !comparing) {
      bringAnswerIntoView();
      return;
    }
  }
  if (comparing) {
    attempt.checked = true;
    const result = answerOutcome(current, q);
    if (result !== null) {
      current.outcomes[q.id] = result;
      registerOutcomes([[q, result, attempt.id]]);
      if (isPersonal()) refreshFilters();
    }
  }
  finishAttempt();
  current.revealed[q.id] = comparing || !current.revealed[q.id];
  if (q.options.length) renderOptions(current, q);
  renderSolution(current, q);
  renderTools(q, current);
  renderNav(current);
  studyProgress.checkpoint(current, mode);
  renderScopeProgress();
  if (current.revealed[q.id]) bringAnswerIntoView(comparing ? $("rubric-heading") : null);
});
$("response").addEventListener("input", (event) => {
  const current = session();
  const q = currentQuestion();
  recordResponse(current, q, event.target.value);
  renderResponseControls(current, q);
  renderNav(current);
  renderFinish(current);
});
$("retry-response").addEventListener("click", () => {
  const current = session();
  const q = currentQuestion();
  delete current.attempts[q.id];
  delete current.responses[q.id];
  delete current.revealed[q.id];
  delete current.outcomes[q.id];
  renderQuestion(current, false);
  $("response").focus();
});
$("finish").addEventListener("click", () => {
  const current = session();
  if (!isTimedMode()) {
    const blank = current.questions.filter((q) => !hasAttempt(current, q)).length;
    if (blank && !window.confirm(`还有 ${blank} 道题未作答。现在结束练习？`)) return;
  }
  submit(mode);
});
function reviewAt(index) {
  const current = session();
  current.index = index;
  current.reviewing = true;
  showWorkspace(true);
  $("question").scrollIntoView({block: "nearest"});
}
$("review").addEventListener("click", () => reviewAt(0));
$("result-questions").addEventListener("click", ({target}) => {
  const button = target.closest("button[data-index]");
  if (button) reviewAt(Number(button.dataset.index));
});
$("back-to-result").addEventListener("click", () => {
  session().reviewing = false;
  showWorkspace(true);
});
$("favorite").addEventListener("click", () => {
  const q = currentQuestion();
  updateRecord(q.id, (entry) => ({ ...entry, favoriteAt: entry.favoriteAt ? null : Date.now() }));
  refreshRecordView(records[q.id]?.favoriteAt ? "已收藏本题。" : "已取消收藏。");
});
$("add-wrong").addEventListener("click", () => {
  const q = currentQuestion();
  mutateRecords((store) => countWrong(store, q.id));
  refreshRecordView("已加入错题库。");
});
$("mastered").addEventListener("click", () => {
  const q = currentQuestion();
  updateRecord(q.id, (entry) => ({ ...entry, wrong: { ...entry.wrong, active: false } }));
  refreshRecordView("已标为掌握，题目已移出错题库。");
});
$("edit-note").addEventListener("click", () => {
  const open = $("note-editor").hidden;
  setNoteOpen(open);
  if (open) {
    if (narrowStudyLayout()) $("solution-panel").scrollIntoView({block: "start"});
    $("note-text").focus({preventScroll: true});
  }
});
$("note-text").addEventListener("input", () => {
  session().noteDrafts[currentQuestion().id] = $("note-text").value;
  $("note-status").textContent = "";
});
$("save-note").addEventListener("click", () => {
  const q = currentQuestion();
  const value = $("note-text").value.trim();
  if (!value) {
    $("note-status").textContent = "请输入笔记内容。";
    $("note-text").focus();
    return;
  }
  updateRecord(q.id, (entry) => ({ ...entry, note: { text: value, at: Date.now() } }));
  delete session().noteDrafts[q.id];
  $("note-text").value = value;
  refreshRecordView("");
  $("note-status").textContent = "笔记已保存。";
});
$("delete-note").addEventListener("click", () => {
  if (!window.confirm("删除这道题的笔记？")) return;
  const q = currentQuestion();
  updateRecord(q.id, (entry) => ({ ...entry, note: null }));
  delete session().noteDrafts[q.id];
  setNoteOpen(false);
  refreshRecordView("笔记已删除。");
  $("edit-note").focus();
});
$("close-note").addEventListener("click", () => {
  setNoteOpen(false);
  $("edit-note").focus();
});
$("restart").addEventListener("click", setAsideSession);
$("back-to-library").addEventListener("click", setAsideSession);
window.addEventListener("storage", (event) => {
  const key = event.key?.replace(/^kunming349:revision:v2:/, "");
  if (key === preferenceKey) {
    preferences = readPreferences();
    applyPreferences();
  }
  if (key?.startsWith("kunming349:term:v1:")) {
    renderCounts();
    if (mode === "knowledge") knowledgeUI.refresh();
    else if (isFavoriteTerms()) knowledgeUI.renderFavorites();
  }
  if (key?.startsWith(dayPrefix) || key?.startsWith(choicePrefix) || key?.startsWith(subjectivePrefix)) renderStudyStats();
  if (key?.startsWith("kunming349:progress:v1:") && mode !== "knowledge") renderScopeProgress();
  const q = currentQuestion();
  if (q && key?.startsWith(attemptStoragePrefix + q.id + ":") && !$("attempt-history").hidden) {
    renderAttemptHistory(q, true);
  }
  if (key !== storageKey || storageFailed) return;
  records = readRecords() ?? records;
  renderCounts();
  if (isPersonal()) refreshFilters();
  if (currentQuestion() && !$("question").hidden) renderTools(currentQuestion(), session());
});
window.addEventListener("pagehide", () => {
  studyProgress.checkpoint(session(), mode);
  userProfile.flush();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pausePractice();
    studyProgress.checkpoint(session(), mode);
  } else resumePractice();
});
setInterval(tick, 1000);
renderCounts();
setupPaneSplitter();
applyPreferences();
switchMode("featured");
offerResume();
