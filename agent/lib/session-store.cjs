const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const allowedStatus = new Set(["idle", "running", "completed", "stopped", "error"]);
const allowedRole = new Set(["user", "assistant", "system"]);

function now() { return new Date().toISOString(); }

function normalizeMessage(message) {
  return {
    id: String(message?.id || crypto.randomUUID()),
    role: allowedRole.has(message?.role) ? message.role : "system",
    kind: ["message", "progress", "error", "files"].includes(message?.kind) ? message.kind : "message",
    content: String(message?.content || ""),
    model: String(message?.model || ''),
    files: Array.isArray(message?.files) ? message.files.filter((file) => typeof file === "string").slice(0, 200) : [],
    createdAt: String(message?.createdAt || now())
  };
}

function normalizeSession(session) {
  const messages = Array.isArray(session?.messages) ? session.messages.map(normalizeMessage).slice(-300) : [];
  return {
    id: String(session?.id || crypto.randomUUID()),
    projectPath: String(session?.projectPath || ""),
    title: String(session?.title || messages.find((message) => message.role === "user")?.content || "New session").slice(0, 120),
    codexSessionId: String(session?.codexSessionId || "").slice(0, 200),
    model: String(session?.model || ''),
    status: allowedStatus.has(session?.status) ? session.status : "idle",
    messages,
    createdAt: String(session?.createdAt || now()),
    updatedAt: String(session?.updatedAt || session?.createdAt || now())
  };
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const sessions = Array.isArray(source.sessions) ? source.sessions.map(normalizeSession).filter((session) => session.projectPath) : [];
  return { version: 1, sessions };
}

function createSessionStore({ filePath, fsImpl = fs } = {}) {
  if (typeof filePath !== "string" || !filePath) throw new Error("A session state path is required");
  function loadState() {
    try { return normalizeState(JSON.parse(fsImpl.readFileSync(filePath, "utf8"))); } catch { return normalizeState({}); }
  }
  function writeState(value) {
    const state = normalizeState(value);
    if (typeof fsImpl.mkdirSync === "function") fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}`;
    const serialized = JSON.stringify(state);
    fsImpl.writeFileSync(temporaryPath, serialized, "utf8");
    if (typeof fsImpl.renameSync === "function") {
      try {
        fsImpl.renameSync(temporaryPath, filePath);
      } catch (error) {
        // Windows may refuse to replace an existing file with renameSync. Keep the
        // state usable and remove the temporary copy after the direct replacement.
        fsImpl.writeFileSync(filePath, serialized, "utf8");
        if (typeof fsImpl.rmSync === "function") fsImpl.rmSync(temporaryPath, { force: true });
        else if (typeof fsImpl.unlinkSync === "function") { try { fsImpl.unlinkSync(temporaryPath); } catch {} }
        void error;
      }
    } else {
      fsImpl.writeFileSync(filePath, serialized, "utf8");
    }
    return state;
  }
  return {
    list() { return loadState().sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    get(id) { return loadState().sessions.find((session) => session.id === id) || null; },
    upsert(value) {
      const session = normalizeSession(value);
      const state = loadState();
      const index = state.sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) state.sessions.splice(index, 1, session);
      else state.sessions.unshift(session);
      return writeState(state).sessions.find((item) => item.id === session.id);
    },
    appendMessage(id, message) {
      const session = this.get(id);
      if (!session) throw new Error("Session not found");
      session.messages.push(normalizeMessage(message));
      session.updatedAt = now();
      return this.upsert(session);
    },
    remove(id) {
      const state = loadState();
      state.sessions = state.sessions.filter((session) => session.id !== id);
      writeState(state);
    }
  };
}

module.exports = { createSessionStore, normalizeSession, normalizeState };
