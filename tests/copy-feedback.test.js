const test = require("node:test");
const assert = require("node:assert/strict");

// ---- Minimal browser environment so the real script.js can load under Node ----

function createMockElement(tag = "div") {
  return {
    tagName: tag.toUpperCase(),
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    id: "",
    className: "",
    dataset: {},
    attributes: {},
    children: [],
    listeners: {},
    style: { setProperty: function () {} },
    classList: {
      add: function () {},
      remove: function () {},
      toggle: function () {},
      contains: function () { return false; },
    },
    setAttribute: function (key, value) { this.attributes[key] = String(value); },
    getAttribute: function (key) { return key in this.attributes ? this.attributes[key] : null; },
    removeAttribute: function (key) { delete this.attributes[key]; },
    addEventListener: function (type, handler) { this.listeners[type] = handler; },
    removeEventListener: function () {},
    appendChild: function (child) { this.children.push(child); return child; },
    replaceChildren: function () { this.children = []; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    focus: function () { global.document.activeElement = this; },
    click: function () { if (this.listeners.click) return this.listeners.click(); },
    scrollIntoView: function () {},
    toggleAttribute: function () {},
    insertBefore: function (node) { this.children.push(node); return node; },
    remove: function () {},
  };
}

const elementsById = new Map();
const selectorRegistry = new Map();
const body = createMockElement("body");
body.appendChild = function (child) {
  this.children.push(child);
  if (child.id) elementsById.set(child.id, child);
  return child;
};

global.document = {
  activeElement: null,
  body,
  documentElement: createMockElement("html"),
  getElementById: (id) => elementsById.get(id) || null,
  createElement: (tag) => createMockElement(tag),
  createDocumentFragment: () => createMockElement("fragment"),
  querySelector: (selector) => {
    if (!selectorRegistry.has(selector)) selectorRegistry.set(selector, createMockElement());
    return selectorRegistry.get(selector);
  },
  querySelectorAll: () => [],
};

// window.setTimeout queues instead of running, so tests control when restore happens
let pendingTimeouts = [];
global.window = {
  setTimeout: (fn) => { pendingTimeouts.push(fn); return pendingTimeouts.length; },
  clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  scrollTo: () => {},
  location: { href: "http://localhost/", search: "" },
};
global.history = { replaceState: () => {} };
global.CSS = { escape: (value) => value };
global.Image = class { set src(value) {} };

let clipboardWriteText = async () => {};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: (text) => clipboardWriteText(text) } },
});

global.fetch = async () => ({ ok: false, json: async () => ({}) });

// Stubs for the sibling browser scripts script.js expects as globals
global.GitProfileNetworkHistory = {
  createStore: () => ({}),
  orderAccounts: (accounts) => ({ accounts }),
  listCohorts: () => [],
  describeOrdering: () => "",
  findEntry: () => null,
  isBaselineAccount: () => false,
};
global.GitHubAudit = {
  parseUsernameFromSearch: () => null,
  transformRepository: (repository) => repository,
  scoreRepository: () => ({}),
  scoreProfile: () => ({ overall: 0, categories: {} }),
  generateRecommendations: () => [],
  formatReadmeStatus: () => "unknown",
};
global.GitProfileShare = { buildShareText: () => "", buildScoreCardData: () => ({}) };
global.GitProfilePinnedOptimizer = { optimizePinnedSet: () => ({ recommended: [], excluded: [], privateCandidates: [], currentPinned: [], changes: [] }) };
global.GitProfileNetwork = {
  validateUsername: () => ({ ok: true }),
  fetchNetwork: async () => ({}),
  describeIncompleteRetrieval: () => null,
  deriveNotFollowingBack: () => [],
  buildMarkdown: () => "",
  describeCountDifference: () => null,
  withAccountRemoved: () => ({ removed: false }),
  buildFilename: () => "network.md",
};

// ---- Load the REAL production script (wires real listeners onto the mock DOM) ----
require("../script.js");

function resetState() {
  elementsById.clear();
  body.children = [];
  pendingTimeouts = [];
  const copyButton = document.querySelector("#copy-button");
  copyButton.textContent = "Copy";
  return copyButton;
}

test("copy button gives accessible success feedback on keyboard activation", async () => {
  const copyButton = resetState();
  const output = document.querySelector("#output");
  output.value = "markdown content that must not change";

  let captured = null;
  clipboardWriteText = async (text) => { captured = text; };

  // A keyboard user tabs to the button (focus) and activates it. On a native
  // <button>, Enter/Space fires the click handler, which is what we invoke here.
  copyButton.focus();
  assert.equal(typeof copyButton.listeners.click, "function", "copy button must have a click handler");
  await copyButton.listeners.click();

  assert.equal(captured, "markdown content that must not change", "clipboard receives the export");
  assert.equal(copyButton.textContent, "Copied!", "visible success text");
  assert.equal(global.document.activeElement, copyButton, "focus stays on the copy button");
  assert.equal(output.value, "markdown content that must not change", "Markdown output unchanged");

  const liveRegion = document.getElementById("copy-status-live");
  assert.ok(liveRegion, "aria-live region created");
  assert.equal(liveRegion.getAttribute("aria-live"), "polite");
  assert.equal(liveRegion.getAttribute("aria-atomic"), "true");
  assert.equal(liveRegion.textContent, "Copied!", "screen reader announcement");
});

test("copy button gives accessible error feedback on clipboard rejection", async () => {
  const copyButton = resetState();
  const output = document.querySelector("#output");
  output.value = "markdown content that must not change";

  clipboardWriteText = async () => { throw new Error("Clipboard access denied"); };

  copyButton.focus();
  await copyButton.listeners.click();

  assert.equal(copyButton.textContent, "Copy failed", "visible error text, not color alone");
  assert.equal(global.document.activeElement, copyButton, "focus stays on the copy button");
  assert.equal(output.value, "markdown content that must not change", "Markdown output unchanged");

  const liveRegion = document.getElementById("copy-status-live");
  assert.ok(liveRegion, "aria-live region created");
  assert.equal(liveRegion.textContent, "Failed to copy: Copy failed", "screen reader error announcement");
});

test("button text restores and the live region clears after the timeout", async () => {
  const copyButton = resetState();
  document.querySelector("#output").value = "x";
  clipboardWriteText = async () => {};

  copyButton.focus();
  await copyButton.listeners.click();
  assert.equal(copyButton.textContent, "Copied!");

  // Simulate the 1200ms restore timeout elapsing
  const pending = pendingTimeouts;
  pendingTimeouts = [];
  for (const fn of pending) fn();

  assert.equal(copyButton.textContent, "Copy", "button text restores");

  // The nested 500ms clear runs on the real timer
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(document.getElementById("copy-status-live").textContent, "", "live region clears");
});