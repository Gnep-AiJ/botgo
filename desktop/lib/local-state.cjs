const fs = require("node:fs");
const path = require("node:path");

const sensitiveName = /(key|token|secret|authorization|password)/i;
const now = () => new Date().toISOString();

function messageOf(message) {
  return {
    id: String(message?.id || crypto.randomUUID()),
    role: ["user", "assistant", "system"].includes(message?.role) ? message.role : "system",
    content: String(message?.content || ""),
    model: String(message?.model || ''),
    kind: ["message", "progress", "error", "files"].includes(message?.kind) ? message.kind : "message",
    files: Array.isArray(message?.files) ? message.files.filter((file) => typeof file === "string").slice(0, 200) : [],
    createdAt: String(message?.createdAt || now())
  };
}

function threadOf(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages.map(messageOf).slice(-200) : [];
  return {
    id: String(thread?.id || crypto.randomUUID()),
    projectPath: String(thread?.projectPath || ""),
    title: String(thread?.title || messages.find((message) => message.role === "user")?.content || "新对话").slice(0, 64),
    sessionId: String(thread?.sessionId || "").slice(0, 200),
    model: String(thread?.model || ''),
    status: ["idle", "running", "completed", "stopped", "error"].includes(thread?.status) ? thread.status : "idle",
    messages,
    createdAt: String(thread?.createdAt || now()),
    updatedAt: String(thread?.updatedAt || thread?.createdAt || now())
  };
}

function migrateTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks.slice(0, 100).map((task) => threadOf({
    id: task.id,
    projectPath: task.projectPath,
    title: task.prompt,
    status: task.status === "completed" ? "completed" : task.status === "stopped" ? "stopped" : "error",
    createdAt: task.createdAt,
    updatedAt: task.createdAt,
    messages: [
      { role: "user", content: task.prompt, createdAt: task.createdAt },
      ...(Array.isArray(task.changedFiles) && task.changedFiles.length ? [{ role: "system", kind: "files", content: "变更文件", files: task.changedFiles, createdAt: task.createdAt }] : [])
    ]
  }));
}

function normalise(value) {
  const recentProjects = Array.isArray(value?.recentProjects) ? [...new Set(value.recentProjects.filter((item) => typeof item === "string"))].slice(0, 12) : [];
  const selectedProject = typeof value?.selectedProject === "string" ? value.selectedProject : (recentProjects[0] || "");
  const sourceThreads = Array.isArray(value?.threads) ? value.threads : migrateTasks(value?.tasks);
  const threads = sourceThreads.map(threadOf).filter((thread) => thread.projectPath).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
  const selectedThreadId = threads.some((thread) => thread.id === value?.selectedThreadId) ? value.selectedThreadId : (threads.find((thread) => thread.projectPath === selectedProject)?.id || "");
  return { version: 2, selectedProject, selectedThreadId, recentProjects, threads };
}

function assertNoSensitiveFields(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (sensitiveName.test(key)) throw new Error("Sensitive data cannot be stored in local task history");
    assertNoSensitiveFields(nested);
  }
}

function createLocalStateStore({ filePath }) {
  return {
    load() { try { return normalise(JSON.parse(fs.readFileSync(filePath, "utf8"))); } catch { return normalise({}); } },
    save(value) { assertNoSensitiveFields(value); fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(normalise(value)), "utf8"); }
  };
}

module.exports = { createLocalStateStore };
