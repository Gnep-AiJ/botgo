import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const dist = path.join(root, "dist");
const host = process.env.BOTGO_DEV_HOST || "127.0.0.1";
const port = Number(process.env.BOTGO_DEV_PORT || 4173);
const ignoredRoots = new Set([".agents", ".claude", ".codex", ".git", ".skill-archive", "desktop", "dist", "docs", "node_modules", "tests", "worker"]);
const ignoredPrefixes = [".tmp-", "tmp-", "layout-", "debug-"];
const clients = new Set();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};
const reloadScript = '<script>(function(){var source=new EventSource("/__botgo-reload");source.onmessage=function(){window.location.reload();};window.addEventListener("beforeunload",function(){source.close();});}());</script>';

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`构建进程退出，代码 ${code}`));
    });
  });
}

function shouldIgnore(filename) {
  if (!filename) return true;
  return filename.toString().replaceAll("\\", "/").split("/").some((part) => (
    ignoredRoots.has(part) || ignoredPrefixes.some((prefix) => part.startsWith(prefix))
  ));
}

function broadcastReload() {
  for (const client of clients) {
    try { client.write("data: reload\n\n"); }
    catch { clients.delete(client); }
  }
}

function fileFromRequest(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}`).pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(dist, relative);
  if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) return null;
  return file;
}

let rebuildTimer = null;
let rebuilding = false;
let queued = false;

async function rebuild(reason) {
  if (rebuilding) {
    queued = true;
    return;
  }
  rebuilding = true;
  try {
    await runBuild();
    console.log(`[dev] 已更新：${reason}`);
    broadcastReload();
  } catch (error) {
    console.error(`[dev] 构建失败，继续保留上一次页面：${error.message}`);
  } finally {
    rebuilding = false;
    if (queued) {
      queued = false;
      rebuild("后续修改");
    }
  }
}

function scheduleRebuild(filename) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuild(filename.toString()), 120);
}

await runBuild();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}`);
  if (url.pathname === "/__botgo-reload") {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    });
    response.write("retry: 1000\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const file = fileFromRequest(request.url || "/");
  if (!file) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const content = await fs.promises.readFile(file);
    const extension = path.extname(file).toLowerCase();
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    if (extension === ".html") {
      const html = content.toString("utf8");
      response.end(html.includes("</body>") ? html.replace("</body>", `${reloadScript}</body>`) : `${html}${reloadScript}`);
      return;
    }
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end();
  }
});

const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
  if (!shouldIgnore(filename)) scheduleRebuild(filename);
});

server.listen(port, host, () => {
  console.log(`[dev] BotGo 本地预览：http://${host}:${port}/`);
});

function shutdown() {
  watcher.close();
  for (const client of clients) client.end();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
