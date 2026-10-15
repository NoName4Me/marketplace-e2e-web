import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const TITLE_LIMIT = 120;
const MAX_BODY_BYTES = 4096;
const MAX_TASKS = 100;
const APP_ID = "marketplace-e2e-web";

const assets = {
  "/": { file: new URL("../public/index.html", import.meta.url), type: "text/html; charset=utf-8" },
  "/app.js": { file: new URL("../public/app.js", import.meta.url), type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: new URL("../public/styles.css", import.meta.url), type: "text/css; charset=utf-8" },
  "/favicon.svg": { file: new URL("../public/favicon.svg", import.meta.url), type: "image/svg+xml" },
};

export function defaultConfig() {
  return {
    commit: process.env.APP_COMMIT || "local",
    buildTime: process.env.APP_BUILD_TIME || "unknown",
    failureMode: process.env.E2E_FAILURE_MODE || "",
  };
}

function createResponse(response, onResponse) {
  return (status, body, contentType = "application/json; charset=utf-8") => {
    onResponse(status);
    const data = typeof body === "string" ? body : JSON.stringify(body);
    response.writeHead(status, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(data);
  };
}

async function getJson(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.status = 415;
    throw error;
  }
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const error = new Error("Invalid JSON"); error.status = 400; throw error; }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Expected JSON object");
    error.status = 400;
    throw error;
  }
  return value;
}

function escapePrometheus(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

function makeMetrics(config, tasks, counts, startedAt) {
  const lines = [
    "# HELP marketplace_e2e_release_info Release metadata.",
    "# TYPE marketplace_e2e_release_info gauge",
    'marketplace_e2e_release_info{service="' + APP_ID + '",commit="' + escapePrometheus(config.commit) + '"} 1',
    "# HELP marketplace_e2e_tasks Tasks by completion state.",
    "# TYPE marketplace_e2e_tasks gauge",
    'marketplace_e2e_tasks{state="open"} ' + [...tasks.values()].filter(t => !t.completed).length,
    'marketplace_e2e_tasks{state="completed"} ' + [...tasks.values()].filter(t => t.completed).length,
    "# HELP marketplace_e2e_uptime_seconds Service uptime.",
    "# TYPE marketplace_e2e_uptime_seconds gauge",
    "marketplace_e2e_uptime_seconds " + Math.floor((Date.now() - startedAt) / 1000),
    "# HELP marketplace_e2e_http_requests_total Requests received by method, route and status.",
    "# TYPE marketplace_e2e_http_requests_total counter",
  ];
  for (const [key, count] of counts) {
    const [method, route, status] = key.split("|");
    lines.push('marketplace_e2e_http_requests_total{method="' +
      escapePrometheus(method) + '",route="' + escapePrometheus(route) +
      '",status="' + escapePrometheus(status) + '"} ' + count);
  }
  return lines.join("\n") + "\n";
}

function labelRoute(path) {
  if (/^\/api\/tasks\/[0-9a-f-]{36}$/.test(path)) return "/api/tasks/:id";
  return ["/", "/app.js", "/styles.css", "/favicon.svg", "/health", "/healthz", "/readyz", "/version",
    "/metrics", "/api/tasks"].includes(path) ? path : "not_found";
}

export function createAppServer(config = defaultConfig()) {
  const tasks = new Map();
  const counts = new Map();
  const startedAt = Date.now();
  const server = createServer(async (request, response) => {
    let path;
    try { path = new URL(request.url || "/", "http://localhost").pathname; }
    catch { response.writeHead(400); response.end(); return; }
    const method = request.method || "GET";
    const route = labelRoute(path);
    const send = createResponse(response, status => {
      const key = [method, route, String(status)].join("|");
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    try {
      if (method === "GET" && assets[path]) {
        const asset = assets[path];
        return send(200, await readFile(asset.file, "utf8"), asset.type);
      }
      if (method === "GET" && (path === "/health" || path === "/healthz")) {
        return send(200, { status: "ok", service: APP_ID });
      }
      if (method === "GET" && path === "/readyz") {
        return config.failureMode === "readiness"
          ? send(503, { status: "not_ready", reason: "intentional_e2e_fault" })
          : send(200, { status: "ready" });
      }
      if (method === "GET" && path === "/version") {
        return send(200, {
          service: APP_ID,
          version: "1.0.0",
          commit: config.commit,
          builtAt: config.buildTime,
        });
      }
      if (method === "GET" && path === "/metrics") {
        return send(200, makeMetrics(config, tasks, counts, startedAt), "text/plain; version=0.0.4; charset=utf-8");
      }
      if (method === "GET" && path === "/api/tasks") {
        return send(200, { tasks: [...tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
      }
      if (method === "POST" && path === "/api/tasks") {
        const body = await getJson(request);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || title.length > TITLE_LIMIT) return send(422, { error: "标题需为 1–120 个字符" });
        if (tasks.size >= MAX_TASKS) return send(409, { error: "演示环境最多保存 100 条任务" });
        const task = { id: randomUUID(), title, completed: false, createdAt: new Date().toISOString() };
        tasks.set(task.id, task);
        return send(201, { task });
      }
      const matched = path.match(/^\/api\/tasks\/([0-9a-f-]{36})$/);
      if (matched && (method === "PATCH" || method === "DELETE")) {
        const task = tasks.get(matched[1]);
        if (!task) return send(404, { error: "任务不存在" });
        if (method === "DELETE") {
          tasks.delete(task.id);
          return send(200, { deleted: true });
        }
        const body = await getJson(request);
        if (typeof body.completed !== "boolean") return send(422, { error: "completed 必须是布尔值" });
        const updated = { ...task, completed: body.completed };
        tasks.set(task.id, updated);
        return send(200, { task: updated });
      }
      if (path === "/api/tasks" || matched) return send(405, { error: "请求方式不支持" });
      return send(404, { error: "页面不存在" });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      if (status >= 500) console.error(JSON.stringify({ event: "server_error", message: String(error) }));
      if (!response.headersSent) send(status, { error: status >= 500 ? "服务器暂不可用" : error.message });
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fileURLToPath(new URL(import.meta.url))).href &&
    fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("Invalid PORT");
  const server = createAppServer();
  server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({
    event: "started", service: APP_ID, port, commit: defaultConfig().commit,
  })));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
