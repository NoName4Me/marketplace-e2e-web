const $ = id => document.getElementById(id);
const state = { tasks: [], filter: "all", busy: false };

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.error || "请求失败 (" + response.status + ")");
  return body;
}

function showNotice(message) {
  const target = $("notice");
  target.textContent = message;
  target.hidden = !message;
}
function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN");
}

function taskElement(task) {
  const item = document.createElement("li");
  item.className = "task-item";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-check";
  checkbox.checked = Boolean(task.completed);
  checkbox.setAttribute("aria-label", (task.completed ? "取消完成：" : "完成任务：") + task.title);
  checkbox.addEventListener("change", () => mutate("/api/tasks/" + encodeURIComponent(task.id), {
    method: "PATCH", body: JSON.stringify({ completed: checkbox.checked }),
  }));

  const text = document.createElement("div");
  text.className = "task-text" + (task.completed ? " done" : "");
  const name = document.createElement("div");
  name.textContent = task.title;
  const created = document.createElement("div");
  created.className = "task-created";
  created.textContent = formatTime(task.createdAt);
  text.append(name, created);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "task-delete";
  remove.textContent = "删除";
  remove.setAttribute("aria-label", "删除任务：" + task.title);
  remove.addEventListener("click", () => mutate("/api/tasks/" + encodeURIComponent(task.id), { method: "DELETE" }));
  item.append(checkbox, text, remove);
  return item;
}

function render() {
  const tasks = state.tasks;
  $("total-count").textContent = String(tasks.length);
  $("open-count").textContent = String(tasks.filter(t => !t.completed).length);
  $("done-count").textContent = String(tasks.filter(t => t.completed).length);
  const visible = tasks.filter(t => state.filter === "all" ||
    (state.filter === "completed" ? t.completed : !t.completed));
  $("result-count").textContent = visible.length + " 条任务";
  const list = $("task-list");
  list.replaceChildren(...visible.map(taskElement));
  $("empty-state").hidden = visible.length > 0;
  for (const filter of document.querySelectorAll("[data-filter]")) {
    const active = filter.dataset.filter === state.filter;
    filter.classList.toggle("active", active);
    filter.setAttribute("aria-pressed", String(active));
  }
}

async function reload() {
  const response = await api("/api/tasks");
  if (!Array.isArray(response.tasks)) throw new Error("任务接口响应格式异常");
  state.tasks = response.tasks;
  render();
}

async function mutate(url, options) {
  if (state.busy) return;
  state.busy = true;
  showNotice("");
  $("add-btn").disabled = true;
  try {
    await api(url, options);
    await reload();
  } catch (error) {
    showNotice(error.message || "操作失败");
    try { await reload(); } catch {}
  } finally {
    state.busy = false;
    $("add-btn").disabled = false;
  }
}

$("new-task").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("task-title");
  const title = input.value.trim();
  if (!title || state.busy) return;
  await mutate("/api/tasks", { method: "POST", body: JSON.stringify({ title }) });
  if (!$("notice").textContent) input.value = "";
  input.focus();
});
$("refresh-btn").addEventListener("click", () => {
  reload().then(() => showNotice("")).catch(error => showNotice(error.message));
});
for (const button of document.querySelectorAll("[data-filter]")) {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    render();
  });
}

async function startup() {
  try {
    const [version, readiness] = await Promise.all([
      api("/version"), fetch("/readyz", { cache: "no-store" }),
    ]);
    $("release-version").textContent = "v" + version.version;
    $("release-commit").textContent = String(version.commit).slice(0, 12);
    $("release-time").textContent = version.builtAt === "unknown" ? "本地开发" : formatTime(version.builtAt);
    const healthy = readiness.ok;
    $("release-state").textContent = healthy ? "Ready" : "Not ready";
    $("service-status").textContent = healthy ? "服务正常运行" : "就绪探针异常";
  } catch {
    $("service-status").textContent = "无法取得运行状态";
    $("release-state").textContent = "未知";
  }
  try { await reload(); }
  catch (error) { showNotice(error.message); }
}
void startup();
