"use strict";

const knowledgeUI = (() => {
  const byId = (id) => document.getElementById(id);
  const prefix = "kunming349:term:v1:";
  const normalize = (text) => text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const catalog = Array.isArray(window.knowledgeCatalog) ? window.knowledgeCatalog : [];
  const termsById = new Map(catalog.map((term) => [term.id, term]));
  const termsByName = new Map();
  for (const term of catalog) for (const name of [term.name, ...term.aliases]) {
    const key = normalize(name);
    if (key && !termsByName.has(key)) termsByName.set(key, term);
  }
  const index = catalog.map((term) => ({
    term, name: normalize(term.name), aliases: term.aliases.map(normalize),
    text: normalize([term.subject, term.chapter, ...term.sections.map(({text}) => text),
      ...(term.related ?? []).map(({name, type}) => name + " " + type)].join(" ")),
  }));
  const starPath = "M12 2.8 14.8 8.6 21.2 9.5 16.6 14 17.7 20.4 12 17.4 6.3 20.4 7.4 14 2.8 9.5 9.2 8.6z";
  let selected = null;
  let savedSelected = null;
  let results = [];
  let limit = 30;

  function favorites() {
    return userProfile.list(prefix).filter(([id, at]) => termsById.has(id) && Number.isFinite(at) && at > 0)
      .sort((a,b) => b[1] - a[1]).map(([id]) => termsById.get(id));
  }

  function search(input) {
    const query = normalize(input);
    if (!query) return catalog.slice(0, 60);
    const words = input.trim().split(/\s+/).map(normalize).filter(Boolean);
    return index.map(({term, name, aliases, text}) => {
      const matching = [name, ...aliases];
      let rank = name === query ? 120 : name.startsWith(query) ? 110 : name.includes(query) ? 90 : 0;
      if (!rank) rank = aliases.some((alias) => alias === query) ? 100 : aliases.some((alias) => alias.startsWith(query)) ? 85
        : aliases.some((alias) => alias.includes(query)) ? 75 : 0;
      if (!rank && words.length > 1 && words.every((word) => [...matching, text].some((value) => value.includes(word)))) rank = 30;
      if (!rank && query.length >= 2 && text.includes(query)) rank = 10;
      return [term, rank + (rank && term.sections.length ? 1 : 0)];
    }).filter(([, rank]) => rank).sort((a,b) => b[1] - a[1] || a[0].name.length - b[0].name.length)
      .map(([term]) => term);
  }

  function setStar(button, term) {
    const starred = Boolean(userProfile.get(prefix + term.id));
    button.setAttribute("aria-pressed", String(starred));
    button.setAttribute("aria-label", (starred ? "取消收藏 " : "收藏 ") + term.name);
    button.title = starred ? "取消收藏" : "收藏到名词解释";
  }

  function sourceNode(source) {
    const text = [source.label, source.locator].filter(Boolean).join(" · ");
    if (!source.url?.startsWith("https://")) return document.createTextNode(text);
    const link = document.createElement("a");
    link.href = source.url;
    link.rel = "noopener noreferrer";
    link.target = "_blank";
    link.textContent = text;
    return link;
  }

  function renderRelated(term) {
    const section = document.createElement("section");
    section.className = "term-related";
    const heading = document.createElement("h3");
    heading.textContent = "关联药物";
    section.append(heading);
    if (!term.related?.length) {
      const empty = document.createElement("p");
      empty.className = "provenance";
      empty.textContent = "当前词条暂无已核实的关联药物。";
      section.append(empty);
      return section;
    }
    const list = document.createElement("ul");
    for (const entry of term.related) {
      const item = document.createElement("li");
      const title = document.createElement("div");
      title.className = "term-related-title";
      const name = document.createElement(entry.termId ? "button" : "strong");
      name.textContent = entry.name;
      if (entry.termId) {
        name.type = "button";
        name.addEventListener("click", () => window.dispatchEvent(new CustomEvent("study-open-term", {detail: entry.termId})));
      }
      const category = document.createElement("span");
      category.textContent = entry.type;
      title.append(name, category);
      const summary = document.createElement("p");
      summary.textContent = entry.summary;
      const source = document.createElement("p");
      source.className = "provenance";
      source.append(sourceNode(entry.source));
      item.append(title, summary, source);
      list.append(item);
    }
    section.append(list);
    return section;
  }

  function renderDetail(target, term) {
    target.replaceChildren();
    if (!term) {
      const p = document.createElement("p");
      p.textContent = "选择一个词条查看释义。";
      target.append(p);
      return;
    }
    const header = document.createElement("header");
    const nameBlock = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = term.name;
    const subtitle = document.createElement("p");
    subtitle.className = "provenance";
    subtitle.textContent = [term.kind, term.subject, term.chapter].filter(Boolean).join(" · ");
    nameBlock.append(title, subtitle);
    const star = document.createElement("button");
    star.type = "button";
    star.className = "term-star";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "21"); svg.setAttribute("height", "21");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", starPath); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.3");
    svg.append(path);
    star.append(svg);
    setStar(star, term);
    star.addEventListener("click", () => {
      userProfile.set(prefix + term.id, userProfile.get(prefix + term.id) ? null : Date.now());
      setStar(star, term);
      window.dispatchEvent(new Event("study-term-star"));
    });
    header.append(nameBlock, star);
    target.append(header);
    if (term.aliases.length) {
      const alias = document.createElement("p");
      alias.className = "provenance";
      alias.textContent = term.aliases.join(" · ");
      target.append(alias);
    }
    const required = term.kind === "药物" ? ["定义", "药理药效", "不良反应", "临床应用", "禁忌"] : ["定义"];
    const order = [...new Set([...required, ...term.sections.map((part) => part.label)])];
    for (const label of order) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      const p = document.createElement("p");
      const content = term.sections.find((part) => part.label === label)?.text;
      heading.textContent = label;
      p.textContent = content || (label === "定义" ? "已定位教材中的词条，释义仍需对照原页核实。" : "现有来源未给出可核实的内容。");
      section.append(heading, p);
      target.append(section);
    }
    if (term.kind === "药物" || term.related?.length) target.append(renderRelated(term));
    if (term.sources.length) {
      const heading = document.createElement("h3");
      const sourceList = document.createElement("ul");
      heading.textContent = "出处";
      sourceList.className = "term-sources";
      for (const source of term.sources) {
        const item = document.createElement("li");
        item.append(sourceNode(source));
        sourceList.append(item);
      }
      target.append(heading, sourceList);
    }
  }

  function termButton(term, active, select) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const name = document.createElement("strong");
    const note = document.createElement("span");
    button.type = "button";
    button.dataset.term = term.id;
    if (active) button.setAttribute("aria-current", "true");
    name.textContent = term.name;
    note.textContent = [term.kind, term.subject, term.sections.length ? "" : "教材索引"].filter(Boolean).join(" · ");
    button.append(name, note);
    button.addEventListener("click", select);
    li.append(button);
    return li;
  }

  function focusDetail(target) {
    target.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 760px)").matches) target.scrollIntoView({block:"start"});
  }

  function render() {
    const count = byId("knowledge-count");
    const query = byId("knowledge-query").value.trim();
    if (!results.some((term) => term.id === selected)) selected = results[0]?.id ?? null;
    count.textContent = query ? (results.length ? "找到 " + results.length.toLocaleString("zh-CN") + " 个词条" : "未找到匹配词条")
      : catalog.length.toLocaleString("zh-CN") + " 个词条 · 浏览常用名词";
    byId("knowledge-list").replaceChildren(...results.slice(0, limit).map((term) => termButton(term, term.id === selected, () => {
      selected = term.id;
      render();
      focusDetail(byId("knowledge-detail"));
    })));
    byId("knowledge-more").hidden = limit >= results.length;
    renderDetail(byId("knowledge-detail"), termsById.get(selected));
  }

  function renderFavorites() {
    const saved = favorites();
    const list = byId("saved-term-list");
    const detail = byId("saved-term-detail");
    if (!saved.some((term) => term.id === savedSelected)) savedSelected = null;
    list.replaceChildren(...saved.map((term) => termButton(term, term.id === savedSelected, () => {
      savedSelected = term.id;
      renderFavorites();
      focusDetail(detail);
    })));
    if (!saved.length) {
      const empty = document.createElement("li");
      empty.textContent = "在知识导航中点亮星标，词条会显示在这里。";
      list.append(empty);
    }
    detail.hidden = !savedSelected;
    if (savedSelected) renderDetail(detail, termsById.get(savedSelected));
  }

  byId("knowledge-query").addEventListener("input", ({target}) => {
    limit = 30;
    results = search(target.value);
    const first = results[0];
    const query = normalize(target.value);
    if (first && [first.name, ...first.aliases].some((name) => normalize(name) === query)) {
      selected = first.id;
    }
    render();
  });
  byId("knowledge-more").addEventListener("click", () => {
    const before = limit;
    limit += 30;
    render();
    byId("knowledge-list").querySelectorAll("button")[before]?.focus();
  });
  return { favorites, renderFavorites, exact(name) { return termsByName.get(normalize(name)); },
    refresh() { results = search(byId("knowledge-query").value); render(); },
    open(id) {
      const term = termsById.get(id);
      if (!term) return;
      byId("knowledge-query").value = term.name;
      limit = 30;
      selected = id;
      results = search(term.name);
      render();
      focusDetail(byId("knowledge-detail"));
    } };
})();
