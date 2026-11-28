"use strict";

importScripts("offline-assets.js");

const scope = self.registration.scope;
const cachePrefix = "kunming349-mobile:" + scope + ":";
const cacheName = cachePrefix + offlineBuild.version;
const landing = new URL("index.html", scope).href;
const files = new Set(offlineBuild.paths.map((path) => new URL(path, scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      const paths = [...files];
      for (let offset = 0; offset < paths.length; offset += 16) {
        const batch = paths.slice(offset, offset + 16);
        await cache.addAll(batch.map((url) => new Request(url, { cache: "reload" })));
      }
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(cachePrefix) && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  url.search = "";
  const address = event.request.mode === "navigate" && url.href === scope ? landing : url.href;
  if (!files.has(address)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(address)) ?? fetch(event.request);
  })());
});
