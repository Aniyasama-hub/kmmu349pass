"use strict";

const userProfile = (() => {
  const revPrefix = "kunming349:revision:v2:";
  const recordKey = "kunming349:review:v1";
  const managed = /^kunming349:(?:review:v1|preferences:v1|attempts:v1:[\p{L}\p{N}_-]+:[\p{L}\p{N}_-]+|term:v1:[\p{L}\p{N}_-]+|day:v1:\d{4}-\d\d-\d\d|(?:choice|subjective):v1:[\p{L}\p{N}_-]+|progress:v1:[\p{L}\p{N}_-]+|resume:v1:[\p{L}\p{N}_-]+)$/u;
  const seed = window.studyDiskSeed;
  const online = seed && typeof seed === "object";
  const entries = new Map();
  const pending = new Map();
  let browserWritable = true;
  let diskFailed = false;
  let sequence = 0;
  let timer = 0;
  let posting = false;
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const valid = (key, entry) => managed.test(key) && object(entry) &&
    Number.isSafeInteger(entry.at) && entry.at >= 0 && Object.hasOwn(entry, "value");

  function mirror(key, entry) {
    try {
      localStorage.setItem(key, JSON.stringify(entry.value));
      localStorage.setItem(revPrefix + key, String(entry.at));
    } catch {
      browserWritable = false;
    }
  }

  function queue(key, entry) {
    if (!online) return;
    pending.set(key, entry);
    if (!timer) timer = setTimeout(flush, 180);
  }

  async function flush() {
    clearTimeout(timer);
    timer = 0;
    if (posting || !pending.size || !online) return;
    const batch = new Map(pending);
    pending.clear();
    posting = true;
    try {
      const body = JSON.stringify(Object.fromEntries(batch));
      const response = await fetch("/__study_profile__", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body, keepalive: new Blob([body]).size < 60_000,
      });
      if (!response.ok) throw new Error("profile save");
      diskFailed = false;
    } catch {
      diskFailed = true;
      for (const [key, entry] of batch) if (!pending.has(key)) pending.set(key, entry);
    } finally {
      posting = false;
      if (pending.size) timer = setTimeout(flush, diskFailed ? 1800 : 0);
      window.dispatchEvent(new Event("study-profile-status"));
    }
  }

  function readLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return null;
      return { at: Number(localStorage.getItem(revPrefix + key)) || 1, value: JSON.parse(raw) };
    } catch {
      return null;
    }
  }

  function get(key, fallback = null) {
    return entries.get(key)?.value ?? fallback;
  }

  function set(key, value) {
    if (!managed.test(key) || value === undefined) return false;
    const entry = { at: Math.max(Date.now() * 1000, sequence + 1, (entries.get(key)?.at ?? 0) + 1), value };
    sequence = entry.at;
    entries.set(key, entry);
    mirror(key, entry);
    queue(key, entry);
    return browserWritable || online;
  }

  function list(prefix) {
    return [...entries.keys()].filter((key) => key.startsWith(prefix)).map((key) => [key.slice(prefix.length), get(key)]);
  }

  function snapshot() {
    return { format: "kunming349-profile", version: 2, entries: Object.fromEntries(entries) };
  }

  function mergeBackup(input) {
    if (input?.format !== "kunming349-profile" || input.version !== 2 || !object(input.entries)) {
      throw new Error("请选择本题库导出的个人数据备份。");
    }
    const incoming = Object.entries(input.entries);
    if (!incoming.length || incoming.some(([k,v]) => !valid(k,v))) throw new Error("备份中的数据格式不完整。");
    for (const [key, entry] of incoming) {
      const current = entries.get(key);
      if (key === recordKey && object(entry.value) && object(current?.value)) {
        const older = entry.at > current.at ? current.value : entry.value;
        const newer = entry.at > current.at ? entry.value : current.value;
        const merged = { ...older };
        for (const [id, value] of Object.entries(newer)) {
          if (/^[\w-]+$/.test(id) && object(value)) {
            Object.defineProperty(merged, id, {value:{...older[id], ...value},enumerable:true,writable:true,configurable:true});
          }
        }
        set(key, merged);
      } else if (!current || entry.at > current.at) {
        entries.set(key, entry);
        mirror(key, entry);
        queue(key, entry);
      }
    }
    window.dispatchEvent(new Event("study-profile-import"));
    return incoming.length;
  }

  if (online) {
    for (const [key, entry] of Object.entries(seed)) if (valid(key, entry)) entries.set(key, entry);
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (!managed.test(key)) continue;
      const stored = readLocal(key);
      const disk = entries.get(key);
      if (valid(key, stored) && (!disk || stored.at > disk.at)) {
        entries.set(key, stored);
        queue(key, stored);
      }
    }
  } catch {
    browserWritable = false;
  }
  if (online) for (const [key, entry] of entries) mirror(key, entry);
  window.addEventListener("storage", ({ key }) => {
    const managedKey = key?.startsWith(revPrefix) ? key.slice(revPrefix.length) : key;
    if (!managedKey || !managed.test(managedKey)) return;
    const local = readLocal(managedKey);
    if (valid(managedKey, local) && local.at >= (entries.get(managedKey)?.at ?? 0)) entries.set(managedKey, local);
  });
  window.addEventListener("pagehide", flush);
  return { get, set, list, snapshot, mergeBackup, flush, online, get canSave() { return browserWritable || online; }, get diskFailed() { return diskFailed; } };
})();
