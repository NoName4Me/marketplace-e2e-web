import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createAppServer } from "../src/server.mjs";

async function withServer(config, fn) {
  const server = createAppServer(config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await fn("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())); }
}
const config = { commit: "abc123", buildTime: "2026-10-15T00:00:00Z", failureMode: "" };
test("HTML, health, readiness, version and Prometheus metrics have stable contracts", async () => {
  await withServer(config, async root => {
    const page = await fetch(root + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /任务看板/);
    assert.equal((await (await fetch(root + "/healthz")).json()).status, "ok");
    assert.equal((await (await fetch(root + "/readyz")).json()).status, "ready");
    const version = await (await fetch(root + "/version")).json();
    assert.equal(version.commit, "abc123");
    assert.equal(version.version, "1.0.0");
    const metric = await (await fetch(root + "/metrics")).text();
    assert.match(metric, /marketplace_e2e_release_info/);
    assert.match(metric, /marketplace_e2e_tasks\{state="open"\} 0/);
  });
});
test("create, validate, complete, delete tasks", async () => {
  await withServer(config, async root => {
    async function api(path, method, body) {
      return fetch(root + path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    assert.equal((await api("/api/tasks", "POST", { title: " " })).status, 422);
    const created = await api("/api/tasks", "POST", { title: "演示创建任务" });
    assert.equal(created.status, 201);
    const task = (await created.json()).task;
    assert.match(task.id, /^[0-9a-f-]{36}$/);
    assert.equal((await (await fetch(root + "/api/tasks")).json()).tasks.length, 1);
    const done = await api("/api/tasks/" + task.id, "PATCH", { completed: true });
    assert.equal(done.status, 200);
    assert.equal((await done.json()).task.completed, true);
    assert.equal((await (await fetch(root + "/api/tasks/" + task.id, { method: "DELETE" })).json()).deleted, true);
    assert.equal((await (await fetch(root + "/api/tasks")).json()).tasks.length, 0);
  });
});
test("readiness failure can be injected without disabling the live process", async () => {
  await withServer({ ...config, failureMode: "readiness" }, async root => {
    assert.equal((await fetch(root + "/readyz")).status, 503);
    assert.equal((await fetch(root + "/healthz")).status, 200);
    assert.equal((await fetch(root + "/version")).status, 200);
  });
});
test("does not serve arbitrary files or accept oversized and malformed input", async () => {
  await withServer(config, async root => {
    assert.equal((await fetch(root + "/src/server.mjs")).status, 404);
    assert.equal((await fetch(root + "/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: "bad json" })).status, 400);
    assert.equal((await fetch(root + "/api/tasks", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "x" })).status, 415);
    assert.equal((await fetch(root + "/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({title:"x".repeat(4500)}) })).status, 413);
  });
});
