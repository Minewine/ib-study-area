// Dependency-free browser stand-in for running the asset scripts under node:
// a Storage-like localStorage (optional byte quota), a tiny document with a
// body/banner, location, a scriptable fetch, and a vm context to load files in.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ASSETS = path.join(__dirname, "..", "..", "assets");

class FakeStorage {
  constructor(init, quota) {
    this.m = new Map(Object.entries(init || {}));
    this.quota = quota || Infinity; // total chars of keys+values
  }
  get length() { return this.m.size; }
  key(i) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null; }
  setItem(k, v) {
    k = String(k); v = String(v);
    let size = 0;
    for (const [a, b] of this.m) if (a !== k) size += a.length + b.length;
    if (size + k.length + v.length > this.quota) {
      const e = new Error("quota"); e.name = "QuotaExceededError"; e.code = 22; throw e;
    }
    this.m.set(k, v);
  }
  removeItem(k) { this.m.delete(String(k)); }
  clear() { this.m.clear(); }
  dump() { return Object.fromEntries(this.m); }
}

function fakeElement(tag, text) {
  const el = {
    tagName: String(tag || "div").toUpperCase(), children: [], style: {}, dataset: {}, attrs: {},
    textContent: String(text || ""), innerHTML: "", className: "", id: "", value: "",
    listeners: {},
    get childElementCount() { return this.children.length; },
    get childNodes() { return this.children; }, // only .length is read off it in the assets
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    insertBefore(c) { this.children.unshift(c); c.parent = this; return c; },
    append(...kids) { // DOM append(): strings become text nodes, nodes as-is
      kids.forEach(k => {
        if (k === null || k === undefined || k === false) return;
        if (typeof k === "object") this.appendChild(k);
        else this.appendChild(fakeElement("#text", String(k)));
      });
    },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  return el;
}

function allText(el) { return (el.textContent || "") + el.children.map(allText).join(" "); }

function makeEnv(opts) {
  opts = opts || {};
  const storage = opts.storage || new FakeStorage(opts.data, opts.quota);
  const body = fakeElement("body");
  const docListeners = {};
  const winListeners = {};
  const document = {
    readyState: opts.readyState || "complete",
    body,
    visibilityState: "visible",
    getElementById(id) {
      const walk = (el) => { if (el.id === id) return el; for (const c of el.children) { const r = walk(c); if (r) return r; } return null; };
      return walk(body);
    },
    createElement: fakeElement,
    createTextNode(t) { return fakeElement("#text", String(t)); },
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
    querySelectorAll() { return []; }
  };
  const window = {
    localStorage: storage,
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    matchMedia: () => ({ matches: false })
  };
  const ctx = {
    window, document, localStorage: storage, console: opts.console || { log() {}, warn() {}, error() {} },
    location: Object.assign({ search: "", hostname: "rametric.com", pathname: "/nevaib/index.html", reload() { ctx.reloads++; } }, opts.location || {}),
    URLSearchParams, setTimeout: opts.setTimeout || setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    Date, JSON, Math, Promise, Map, Set, Array, Object, String, Number, Error, Blob: function () {},
    Node: function Node() {}, // notes.js tests `c instanceof Node` — a bare stand-in is enough
    fetch: opts.fetch || (() => Promise.reject(new Error("offline"))),
    navigator: {}, reloads: 0
  };
  window.document = document; window.location = ctx.location; window.fetch = (...a) => ctx.fetch(...a);
  ctx.self = window;
  vm.createContext(ctx);
  const env = {
    ctx, storage, document, window,
    load(file) { vm.runInContext(fs.readFileSync(path.join(ASSETS, file), "utf8"), ctx, { filename: file }); return env; },
    fire(target, type, ev) { const l = (target === "window" ? winListeners : docListeners)[type] || []; l.forEach(fn => fn(ev || {})); },
    bannerText() { const b = document.getElementById("nb-banner"); return b ? allText(b) : ""; },
    get NB() { return ctx.window.NB; }
  };
  return env;
}

// JSON round-trip so objects from the vm realm compare with deepStrictEqual
const plain = (v) => JSON.parse(JSON.stringify(v));

module.exports = { FakeStorage, makeEnv, plain };
