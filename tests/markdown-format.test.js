const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCompactMarkdown,
  compactReadmeStatus,
  formatCompactDate,
  formatCompactPinned,
} = require("../markdown-format.js");

function repository(overrides = {}) {
  return {
    name: "case-notes",
    description: "Local-first notes app",
    url: "https://github.com/example/case-notes",
    language: "Swift",
    topics: ["ios", "swiftui"],
    license: "MIT",
    readme: { present: true },
    updatedAt: "2026-09-08T15:30:00Z",
    createdAt: "2026-08-01T12:00:00Z",
    pinned: true,
    pinnedPosition: 0,
    private: false,
    fork: false,
    ...overrides,
  };
}

test("compact markdown produces the readable repository layout", () => {
  const markdown = createCompactMarkdown(
    "quangshuynh",
    [repository()],
    { pinnedRepositories: ["case-notes"] },
    { includePinned: true }
  );

  assert.match(markdown, /^## Repositories/m);
  assert.doesNotMatch(markdown, /^# GitProfileLens Repository Report/m);
  assert.match(markdown, /### \[case-notes\]\(https:\/\/github\.com\/example\/case-notes\)/);
  assert.match(markdown, /- Local-first notes app/);
  assert.match(markdown, /- \*\*Visibility:\*\* Public · \*\*Language:\*\* Swift/);
  assert.match(markdown, /\*\*Topics:\*\* ios, swiftui/);
  assert.match(markdown, /\*\*License:\*\* MIT/);
  assert.match(markdown, /\*\*README:\*\* Present/);
  assert.match(markdown, /\*\*Updated:\*\* 2026-09-08/);
  assert.match(markdown, /\*\*Pinned:\*\* Yes/);
  assert.doesNotMatch(markdown, /last pushed:/i);
  assert.doesNotMatch(markdown, /open issues/i);
});

test("compact markdown labels forks in the repository heading", () => {
  const markdown = createCompactMarkdown(
    "quangshuynh",
    [repository({ name: "ray", fork: true, language: null, license: "Apache-2.0", readme: { present: false } })],
    {},
    { includePinned: true }
  );

  assert.match(markdown, /### \[ray\]\(https:\/\/github\.com\/example\/case-notes\) \(FORKED\)/);
  assert.match(markdown, /\*\*Language:\*\* Not specified/);
  assert.match(markdown, /\*\*README:\*\* Missing/);
});

test("compact markdown includes private visibility and treats private repos as unpinned", () => {
  const markdown = createCompactMarkdown(
    "quangshuynh",
    [repository({ private: true, pinned: null })],
    null,
    { includePinned: true }
  );

  assert.match(markdown, /\*\*Visibility:\*\* Private/);
  assert.match(markdown, /\*\*Pinned:\*\* No/);
  assert.equal(formatCompactPinned({ private: true, pinned: null }), "No");
});

test("compact markdown represents unknown README metadata honestly", () => {
  const markdown = createCompactMarkdown(
    "quangshuynh",
    [repository({ readme: { present: null } })],
    {},
    { includePinned: true }
  );

  assert.match(markdown, /\*\*README:\*\* Unverified/);
  assert.equal(compactReadmeStatus({ present: false }), "Missing");
  assert.equal(compactReadmeStatus({ present: null }), "Unverified");
});

test("compact markdown keeps newest-first ordering by default", () => {
  const older = repository({ name: "older", createdAt: "2026-01-01T00:00:00Z", pinned: false });
  const newer = repository({ name: "newer", createdAt: "2026-09-01T00:00:00Z", pinned: false });
  const markdown = createCompactMarkdown("quang", [older, newer], {}, { includePinned: true });

  assert.ok(markdown.indexOf("### [newer]") < markdown.indexOf("### [older]"));
});

test("compact date falls back safely for invalid timestamps", () => {
  assert.equal(formatCompactDate("not-a-date"), "Unknown");
});
