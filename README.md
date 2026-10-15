# Marketplace E2E Web

这是专为 [Enterprise App Marketplace](https://github.com/NoName4Me/enterprise-app-marketplace) 准备的 **真实、独立、轻量的托管应用**，用于检验完整的 GitHub → GHCR → TEST → PRODUCTION → 回滚 → 运维观测路径。

应用是一个中文任务看板，支持新增、完成、撤销完成、删除任务；有简洁的发布版本卡片和可真实操作的界面。它使用 Node.js 22 原生 HTTP，没有第三方运行依赖，容器可运行于 Apple Silicon 对应的 linux/arm64。

## 本地运行

需要 Node.js 22+，无须数据库或安装 npm 依赖：

```sh
npm test
npm start
# 访问 http://localhost:8080
```

也可以 Docker 启动：

```sh
docker build -t marketplace-e2e-web:local .
docker run --rm -p 8080:8080 marketplace-e2e-web:local
```

应用内存中的任务不会持久化：重启容器/重新部署将清空数据，请勿输入员工或实际业务信息。

## 真实健康检查与版本信息

- `/healthz`：存活探针；`/readyz`：就绪探针
- `/version`：返回应用版本、镜像内置 Git Commit、构建时间
- `/metrics`：Prometheus 格式的发布、任务和 HTTP 请求指标
- `/api/tasks`：任务增删改查

本地端到端接口验收：

```sh
bash scripts/smoke.sh http://localhost:8080
```

## GitHub Actions / GHCR

`.github/workflows/ci.yml` 在 PR 上仅运行单测和 Docker smoke（**不授予包写入权限**），对 `master` 的受信提交在测试通过后发布多架构镜像：

```text
ghcr.io/noname4me/marketplace-e2e-web:sha-<commit>
```

发布 Job Summary 会显示**不可变的 Digest**：

```text
ghcr.io/noname4me/marketplace-e2e-web@sha256:<digest>
```

门户必须使用 Digest 部署，不能把可移动的 tag 当作通过 TEST 验证的产物。GitHub 新建 Package 的访问可见性可能需要仓库所有者在 GHCR Package 设置中调整，并确认门户的拉取权限（例如私有 GHCR 镜像需 imagePullSecret）。**本仓库不存任何 Mac mini / Argo CD / Temporal 密钥。**

## 故障注入

只在实验环境设置 `E2E_FAILURE_MODE=readiness`，`/readyz` 将返回 HTTP 503，`/healthz` 仍为 200，便于测试启动失败、监控、受控回滚。没有开放任何匿名的“制造故障”HTTP 接口。

完整测试矩阵与门户集成边界见 [验收文档](docs/ACCEPTANCE.md)。

## 设计约束

- 测试应用单实例、无数据库、无认证，仅用于隔离实验；不应接入公网或保存真实数据。
- 容器监听 `0.0.0.0:8080`、非 root 用户、readiness Healthcheck。
- TEST 与 PRODUCTION 由门户统一创建；此仓库不直接管理 Kubernetes、NodePort、生产环境或发布凭据。
