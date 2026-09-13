const fs = require("node:fs");
const path = require("node:path");
const crypto = require('node:crypto');

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
  const messages = Array.isArray(thread?.messages) ? thread.messages.map(messageOf) : [];
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
  return tasks.map((task) => threadOf({
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
  const threads = sourceThreads.map(threadOf).filter((thread) => thread.projectPath).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selectedThreadId = threads.some((thread) => thread.id === value?.selectedThreadId) ? value.selectedThreadId : (threads.find((thread) => thread.projectPath === selectedProject)?.id || "");
  return { version: 3, selectedProject, selectedThreadId, recentProjects, threads };
}

function assertNoSensitiveFields(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (sensitiveName.test(key)) throw new Error("Sensitive data cannot be stored in local task history");
    assertNoSensitiveFields(nested);
  }
}

function createLocalStateStore({ filePath }) {
  const threadDirectory = filePath + '.threads';
  const store = {
    load() {
      try {
        const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (value.version === 3) value.threads = (value.threads || []).map(thread => {
          if (!/^[a-f0-9]{64}\.json$/.test(thread.messagesFile || '')) throw Error('Invalid message reference');
          return { ...thread, messages: JSON.parse(fs.readFileSync(path.join(threadDirectory, thread.messagesFile), 'utf8')) };
        });
        return normalise(value);
      }
      catch (error) { if (error.code === 'ENOENT') return normalise({}); throw new Error('本地对话记录无法读取，原文件已保留。', { cause: error }); }
    },
    save(value) {
      assertNoSensitiveFields(value);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (fs.existsSync(filePath) && !fs.existsSync(filePath + '.pre-v3.bak')) fs.copyFileSync(filePath, filePath + '.pre-v3.bak');
      fs.mkdirSync(threadDirectory, { recursive: true });
      const normalized = normalise(value);
      const index = { ...normalized, threads: normalized.threads.map(thread => {
        const body = JSON.stringify(thread.messages);
        const messagesFile = crypto.createHash('sha256').update(body).digest('hex') + '.json';
        const target = path.join(threadDirectory, messagesFile);
        if (!fs.existsSync(target)) {
          const temporary = target + '.' + crypto.randomUUID() + '.tmp';
          fs.writeFileSync(temporary, body, 'utf8'); fs.renameSync(temporary, target);
        }
        const { messages, ...metadata } = thread;
        return { ...metadata, messagesFile, messageCount: messages.length };
      }) };
      const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
      try { fs.writeFileSync(temporary, JSON.stringify(index), "utf8"); fs.renameSync(temporary, filePath); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    },
    renameThread(id, title) {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 64) throw new Error('请输入 1–64 字的对话名称。');
      const value = store.load(), thread = value.threads.find(item => item.id === id);
      if (!thread) throw new Error('对话不存在。');
      thread.title = title.trim(); store.save(value); return store.load();
    },
    recoverInterruptedThreads() {
      const value = store.load();
      if (value.threads.some(thread => thread.status === 'running')) {
        value.threads.forEach(thread => { if (thread.status === 'running') thread.status = 'stopped'; });
        store.save(value);
      }
      return store.load();
    },
    deleteThread(id) {
      const value = store.load(), thread = value.threads.find(item => item.id === id);
      if (!thread) throw new Error('对话不存在。');
      if (thread.status === 'running') throw new Error('请先停止当前任务。');
      value.threads = value.threads.filter(item => item.id !== id);
      return persistSelection(value);
    },
    removeProject(projectPath) {
      const value = store.load();
      if (!value.recentProjects.includes(projectPath)) throw new Error('项目不存在。');
      if (value.threads.some(item => item.projectPath === projectPath && item.status === 'running')) throw new Error('请先停止当前任务。');
      value.threads = value.threads.filter(item => item.projectPath !== projectPath);
      value.recentProjects = value.recentProjects.filter(item => item !== projectPath);
      if (value.selectedProject === projectPath) value.selectedProject = '';
      return persistSelection(value);
    }
  };
  function persistSelection(value) {
    const selected = value.threads.find(item => item.id === value.selectedThreadId) || value.threads[0];
    value.selectedThreadId = selected?.id || '';
    value.selectedProject = selected?.projectPath || value.selectedProject || value.recentProjects[0] || '';
    store.save(value); return store.load();
  }
  return store;
}

module.exports = { createLocalStateStore };
