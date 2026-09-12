const assert = require("node:assert/strict");
const test = require("node:test");

const { createSessionStore } = require("../lib/session-store.cjs");

test("session store keeps only local metadata and supports resume lookup", () => {
  let file = "{}";
  const fsImpl = {
    existsSync: () => true,
    readFileSync: () => file,
    writeFileSync: (_path, value) => { file = value; },
    renameSync: () => {}
  };
  const store = createSessionStore({ filePath: "C:\\agent\\state.json", fsImpl });
  store.upsert({ id: "thread-1", projectPath: "C:\\project", title: "Inspect", codexSessionId: "thread-1", status: "completed" });
  assert.equal(store.get("thread-1").projectPath, "C:\\project");
  assert.equal(store.list()[0].title, "Inspect");
  assert.doesNotMatch(file, /bgk_|bgdt_|Bearer/i);
});
