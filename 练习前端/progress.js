"use strict";

const studyProgress = (() => {
  const prefix = "kunming349:progress:v1:";
  const resume = "kunming349:resume:v1:";
  const typeIds = ["type-single", "type-multiple", "type-written", "type-calculation", "type-other-choice"];
  const filterIds = ["subject", "chapter", "topic", "query", "include-recall", "year", "size", "mix", "time-limit", ...typeIds];
  const scheduled = new Map();

  function captureFilters() {
    return Object.fromEntries(filterIds.map((id) => {
      const control = document.getElementById(id);
      return [id, control.type === "checkbox" ? control.checked : control.value];
    }));
  }

  function complete(question, outcome) {
    const key = prefix + question.id;
    const previous = userProfile.get(key);
    const correct = typeof outcome === "boolean" ? outcome : previous?.correct ?? null;
    if (previous?.done && previous.correct === correct) return;
    userProfile.set(key, { done: true, correct });
  }

  function summary(questions) {
    let done = 0;
    const objective = {graded: 0, right: 0};
    const subjective = {graded: 0, right: 0};
    for (const q of questions) {
      const record = userProfile.get(prefix + q.id);
      if (!record?.done) continue;
      done++;
      if (typeof record.correct !== "boolean") continue;
      const accuracy = isObjective(q) ? objective : subjective;
      accuracy.graded++;
      if (record.correct) accuracy.right++;
    }
    return {done, objective, subjective, total:questions.length};
  }

  function checkpoint(session, mode) {
    clearTimeout(scheduled.get(mode));
    scheduled.delete(mode);
    if (!session?.questions.length || mode === "knowledge") return;
    const key = resume + mode;
    const count = session.questions.filter((q) => hasAttempt(session, q)).length;
    if (session.submitted) {
      if (userProfile.get(key)) userProfile.set(key, null);
      return;
    }
    if (!count) return;
    const now = Date.now();
    userProfile.set(key, {
      mode, at: now, ids: session.questions.map(({id}) => id), indexId: session.questions[session.index].id, count,
      filters: session.scope ?? captureFilters(),
      responses: session.responses, optionDrafts: session.optionDrafts, attempts: session.attempts,
      outcomes: session.outcomes, skipped: session.skipped, revealed: session.revealed, noteDrafts: session.noteDrafts,
      shuffle: Object.fromEntries(Object.entries(session.shuffledOptions).map(([id, opts]) => [id, opts.map(({label}) => label)])),
      exclusions: Object.fromEntries(Object.entries(session.exclusions).map(([id, set]) => [id, [...set]])),
      elapsed: Math.max(0, (session.pausedAt ?? now) - session.startedAt),
      remaining: session.deadline === null ? null : Math.max(0, session.deadline - now),
    });
  }

  function latest() {
    return userProfile.list(resume).map(([, entry]) => entry).filter((entry) =>
      entry?.count > 0 && Array.isArray(entry.ids) && entry.ids.length && Number.isFinite(entry.at) && typeof entry.mode === "string"
    ).sort((a,b) => b.at - a.at)[0] ?? null;
  }

  function restore(entry, bank) {
    const byId = new Map(bank.map((q) => [q.id, q]));
    const questions = entry.ids.map((id) => byId.get(id)).filter(Boolean);
    if (!questions.length) return null;
    const now = Date.now();
    const shuffle = {};
    const exclusions = {};
    for (const q of questions) {
      const cached = entry.shuffle?.[q.id];
      if (Array.isArray(cached) && cached.length === q.options.length && new Set(cached).size === cached.length) {
        const options = cached.map((label) => q.options.find((option) => option.label === label));
        if (options.every(Boolean)) shuffle[q.id] = options;
      }
      if (Array.isArray(entry.exclusions?.[q.id])) exclusions[q.id] = new Set(entry.exclusions[q.id]);
    }
    return {
      questions, index: Math.max(0, questions.findIndex((q) => q.id === entry.indexId)),
      scope: entry.filters ?? {}, responses: entry.responses ?? {}, optionDrafts: entry.optionDrafts ?? {},
      attempts: entry.attempts ?? {}, outcomes: entry.outcomes ?? {}, skipped: entry.skipped ?? {}, revealed: entry.revealed ?? {},
      noteDrafts: entry.noteDrafts ?? {}, shuffledOptions: shuffle, exclusions,
      startedAt: now - (Number.isFinite(entry.elapsed) ? entry.elapsed : 0),
      deadline: Number.isFinite(entry.remaining) ? now + entry.remaining : null,
      pausedAt: null, endedAt: null, submitted: false, reviewing: false,
    };
  }

  function schedule(session, mode) {
    clearTimeout(scheduled.get(mode));
    scheduled.set(mode, setTimeout(() => checkpoint(session, mode), 230));
  }

  return {captureFilters, complete, summary, checkpoint, latest, restore, schedule, filterIds, typeIds};
})();
