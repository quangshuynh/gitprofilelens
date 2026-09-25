const test = require("node:test");
const assert = require("node:assert/strict");

// Minimal DOM mock to test the accessibility function without a full browser environment
const mockLiveRegion = {
  id: "",
  attributes: {},
  style: {},
  textContent: "",
  setAttribute: function (key, value) {
    this.attributes[key] = value;
  },
};

const mockBody = {
  children: [],
  appendChild: function (child) {
    this.children.push(child);
  },
};

const mockDocument = {
  elements: {},
  getElementById: function (id) {
    return this.elements[id] || null;
  },
  createElement: function (tag) {
    if (tag === "div") return mockLiveRegion;
    return {};
  },
  body: mockBody,
};

// Inject mocks into global scope
global.document = mockDocument;

// Mock setTimeout to NOT execute immediately, so we can test the intermediate state
let timeoutCallbacks = [];
global.window = {
  setTimeout: (fn, delay) => {
    const id = timeoutCallbacks.length + 1;
    timeoutCallbacks.push({ fn, id });
    return id;
  },
  clearTimeout: (id) => {
    timeoutCallbacks = timeoutCallbacks.filter((cb) => cb.id !== id);
  },
};

// Helper to flush all pending timeouts
function flushTimeouts() {
  const callbacks = [...timeoutCallbacks];
  timeoutCallbacks = [];
  for (const { fn } of callbacks) {
    fn();
  }
}

// Define the function exactly as it appears in script.js to test its logic in isolation
function showTemporaryButtonText(button, temporaryText, isError = false) {
  const originalText = button.textContent;
  button.textContent = temporaryText;

  let liveRegion = document.getElementById("copy-status-live");
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.id = "copy-status-live";
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("aria-atomic", "true");
    Object.assign(liveRegion.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      border: "0",
    });
    document.body.appendChild(liveRegion);
    document.elements["copy-status-live"] = liveRegion;
  }

  liveRegion.textContent = isError ? `Failed to copy: ${temporaryText}` : temporaryText;

  window.setTimeout(function restoreButtonText() {
    button.textContent = originalText;
    window.setTimeout(() => {
      liveRegion.textContent = "";
    }, 500);
  }, 1200);
}

test("showTemporaryButtonText creates aria-live region and announces success", () => {
  // Reset mock state
  document.elements = {};
  document.body.children = [];
  timeoutCallbacks = [];
  const mockButton = { textContent: "Copy" };
  
  showTemporaryButtonText(mockButton, "Copied!", false);

  assert.equal(mockButton.textContent, "Copied!");
  
  const liveRegion = document.getElementById("copy-status-live");
  assert.ok(liveRegion, "aria-live region should be created");
  assert.equal(liveRegion.attributes["aria-live"], "polite");
  assert.equal(liveRegion.attributes["aria-atomic"], "true");
  assert.equal(liveRegion.textContent, "Copied!");
});

test("showTemporaryButtonText announces error state correctly", () => {
  // Reset mock state
  document.elements = {};
  document.body.children = [];
  timeoutCallbacks = [];
  const mockButton = { textContent: "Copy" };

  showTemporaryButtonText(mockButton, "Copy failed", true);

  assert.equal(mockButton.textContent, "Copy failed");
  
  const liveRegion = document.getElementById("copy-status-live");
  assert.ok(liveRegion, "aria-live region should be created");
  assert.equal(liveRegion.textContent, "Failed to copy: Copy failed");
});

test("showTemporaryButtonText restores original text after timeout", () => {
  // Reset mock state
  document.elements = {};
  document.body.children = [];
  timeoutCallbacks = [];
  const mockButton = { textContent: "Copy Markdown" };

  showTemporaryButtonText(mockButton, "Copied!", false);

  // Verify intermediate state
  assert.equal(mockButton.textContent, "Copied!");
  
  // Flush the 1200ms timeout
  flushTimeouts();
  
  // Verify restoration
  assert.equal(mockButton.textContent, "Copy Markdown");
  
  // Flush the nested 500ms timeout that clears the live region
  flushTimeouts();
  
  const liveRegion = document.getElementById("copy-status-live");
  assert.equal(liveRegion.textContent, "");
});