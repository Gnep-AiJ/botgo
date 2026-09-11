const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createTaskRunner } = require("../desktop/lib/task-runner.cjs");

let spawnCall;
let child;
const runner = createTaskRunner({
  spawn(command, args, options) {
    spawnCall = { command, args, options };
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => { child.killedWith = signal; child.emit("close", null, signal); };
    return child;
  }
});

const events = [];
const task = runner.start({
  id: "task-1",
  projectPath: "C:\\work\\demo",
  prompt: "Summarise this project",
  mode: "workspace-write",
  environment: { BOTGO_CODEX_API_KEY: "bgk_private" },
  onEvent: (event) => events.push(event)
});

assert.equal(spawnCall.command, "codex");
assert.deepEqual(spawnCall.args.slice(0, 5), ["exec", "--json", "--sandbox", "workspace-write", "Summarise this project"]);
assert.equal(spawnCall.options.cwd, "C:\\work\\demo");
assert.equal(spawnCall.options.windowsHide, true);
assert.equal(events[0].type, "started");

child.stdout.emit("data", Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"Finished reviewing files"}}\n'));
assert.deepEqual(events.at(-1), { type: "progress", message: "Finished reviewing files" });
assert.doesNotMatch(JSON.stringify(events), /bgk_private|workspace-write|codex/);

task.stop();
assert.equal(child.killedWith, "SIGTERM");
assert.equal(events.at(-1).type, "stopped");
runner.start({ id: "task-resume", projectPath: "C:\\work\\demo", prompt: "Continue", mode: "workspace-write", sessionId: "session-123", environment: {}, onEvent() {} });
assert.deepEqual(spawnCall.args.slice(0, 8), ["exec", "--json", "--sandbox", "workspace-write", "resume", "session-123", "Continue"]);
child.stdout.emit("data", Buffer.from('{"type":"thread.started","thread_id":"session-456"}\n'));
child.emit("close", 0);
assert.throws(() => runner.start({ id: "task-2", projectPath: "C:\\work\\demo", prompt: "x", mode: "full-access", environment: {}, onEvent() {} }), /confirmation/);

console.log("Desktop task runner boundary test passed");
