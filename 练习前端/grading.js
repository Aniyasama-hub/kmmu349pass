"use strict";

const attemptStoragePrefix = "kunming349:attempts:v1:";
const attemptMemory = new Map();
let attemptStorageFailed = false;
const rubricThresholds = ["55", "65", "75", "85", "100"];
const defaultRubricThreshold = "65";
const isObjective = (question) => Boolean(question.options.length) || ["单选题", "多选题", "判断题", "配伍题"].includes(question.type);
const hasResponse = (value) => typeof value === "string" ? Boolean(value.trim()) : Array.isArray(value) && value.length > 0;
const hasAttempt = (current, q) => hasResponse(current.responses[q.id]) || Boolean(current.skipped?.[q.id]);

function attemptsFor(questionId) {
  const prefix = attemptStoragePrefix + questionId + ":";
  const attempts = new Map(attemptMemory.get(questionId));
  for (const [, item] of userProfile.list(prefix)) {
    if (item?.id && typeof item.text === "string" && Number.isFinite(item.at)) attempts.set(item.id, item);
  }
  return [...attempts.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

function saveAttempt(questionId, draft) {
  if (!attemptMemory.has(questionId)) attemptMemory.set(questionId, new Map());
  attemptMemory.get(questionId).set(draft.id, draft);
  attemptStorageFailed = !userProfile.set(attemptStoragePrefix + questionId + ":" + draft.id, draft);
}

function answerText(text, delimit = false) {
  let normalized = text.normalize("NFKC").toLowerCase()
    .replace(/[‐‑‒–−]/g, "-")
    .replace(/[*•·⋅]/g, "×")
    .replace(/÷/g, "/")
    .replace(/[μµ]/g, "u")
    .replace(/(?<=\d)[,、]\s*(?=\d{1,2}(?:[,、]\s*\d{1,2})*-[\p{L}])/gu, "~");
  if (delimit) normalized = normalized.replace(/(?<=[a-z0-9])[\s,;、，；。]+(?=[a-z0-9])/g, "§");
  if (delimit) normalized = normalized.replace(/[；;。！？!?\r\n]+/g, "§");
  return normalized.replace(/[^\p{L}\p{N}.=%+\-×÷/<>≤≥§~]/gu, "")
    .replace(/的/g, "");
}

const meaningful = /[不增减升降促抑高低正负前后内外活失长短强弱多开闭单双有无甲乙丙丁氟氯溴碘]/;
const negatedAt = (text, index) => /(?:不|未|无|没有|不能|并非|无需|不会|未能|无法)(?:会|能|明显|直接|显著|主动)?$/.test(
  text.slice(Math.max(0, index - 6), index)
);

function fuzzyDistance(left, right, allowed) {
  const cost = (char) => meaningful.test(char) ? Infinity : 1;
  let row = [0];
  for (const char of right) row.push(row.at(-1) + cost(char));
  for (const char of left) {
    const next = [row[0] + cost(char)];
    for (let j = 0; j < right.length; j++) {
      const substitute = char === right[j] ? 0 : Math.max(cost(char), cost(right[j]));
      next.push(Math.min(row[j] + substitute, row[j + 1] + cost(char), next[j] + cost(right[j])));
    }
    if (next.every((distance) => distance > allowed)) return Infinity;
    row = next;
  }
  return row.at(-1);
}

function fuzzyKeyword(text, needle, minimum) {
  if (minimum >= 1 || !/^\p{Script=Han}{3,}$/u.test(needle)) return false;
  const allowed = Math.min(4, Math.floor((1 - minimum) * needle.length + 1e-8));
  if (!allowed) return false;
  const heads = new Set(needle.slice(0, allowed + 1));
  for (let i = 0; i < text.length; i++) {
    if (negatedAt(text, i) || !heads.has(text[i])) continue;
    for (let length = Math.max(2, needle.length - allowed); length <= needle.length + allowed && i + length <= text.length; length++) {
      const sample = text.slice(i, i + length);
      if (!/^\p{Script=Han}+$/u.test(sample)) break;
      if (fuzzyDistance(needle, sample, allowed) <= allowed) return true;
    }
    // A typo can affect the first character while the next character still anchors the phrase.
    if (i && /^\p{Script=Han}$/u.test(text[i - 1]) && !negatedAt(text, i - 1)) {
      const sample = text.slice(i - 1, i - 1 + needle.length);
      if (/^\p{Script=Han}+$/u.test(sample) && fuzzyDistance(needle, sample, allowed) <= allowed) return true;
    }
  }
  return false;
}

function hasKeyword(text, alias, threshold = defaultRubricThreshold) {
  const key = answerText(alias);
  if (!key) return false;
  const numeric = /^([-+]?\d+(?:\.\d+)?)(%|[a-z]+(?:\/[a-z]+)?)?$/.exec(key);
  if (numeric) {
    const measurements = text.matchAll(/(?<![a-z0-9.+-])([-+]?\d+(?:\.\d+)?)(?:§?(%|[a-z]+(?:\/[a-z]+)?))?(?![0-9.])/g);
    return Array.from(measurements).some((match) =>
      Number(match[1]) === Number(numeric[1]) && (!numeric[2] || match[2] === numeric[2]) && !negatedAt(text, match.index));
  }
  const latin = /^[a-z][a-z\d-]*$/.test(key);
  const haystack = latin ? text.replace(/(?<=[a-z0-9])-(?=[a-z0-9])/g, "") : text;
  const needle = latin ? key.replace(/-/g, "") : key;
  const spaced = answerText(alias, true);
  let fuzzyText = haystack;
  for (const variant of new Set([needle, spaced])) {
    for (let i = haystack.indexOf(variant); i !== -1; i = haystack.indexOf(variant, i + 1)) {
      const before = haystack[i - 1] ?? "";
      const after = haystack[i + variant.length] ?? "";
      if (latin && (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after))) continue;
      if (!negatedAt(haystack, i)) return true;
      fuzzyText = fuzzyText.slice(0, i) + "§".repeat(variant.length) + fuzzyText.slice(i + variant.length);
    }
  }
  return fuzzyKeyword(fuzzyText, needle, Number(threshold) / 100);
}

function gradeRubric(question, response, threshold = defaultRubricThreshold) {
  const points = question.rubric?.points ?? [];
  const text = answerText(response ?? "", true);
  const matches = points.map(({groups}) => Boolean(text) && groups.every((alternatives) =>
    alternatives.some((alias) => hasKeyword(text, alias, threshold))));
  return { matches, hits: matches.filter(Boolean).length, total: points.length };
}
