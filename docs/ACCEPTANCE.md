# 托管应用发布 E2E 验收标准

这是独立于门户主仓库的测试应用，主要验证用户从 GitHub 登记仓库到 **CI → GHCR Digest → Kubernetes TEST → 同 Digest 晋级 PRODUCTION → 回滚 → AI 运维证据** 的平台完整路径。

## 前置条件
- GitHub 仓库：`NoName4Me/marketplace-e2e-web`，默认受信主分支 `master`。
- GitHub Actions `verify` 和 `publish` 都成功后，从 publish Job Summary 复制 `ghcr.io/noname4me/marketplace-e2e-web@sha256:<digest>`。镜像支持 **linux/arm64**（Mac mini M4）和 linux/amd64。
- 在门户创建 **GitHub 托管应用**：填写 `NoName4Me/marketplace-e2e-web` 以及名称、简介即可。测试/生产环境和 NodePort 由门户自动分配，不手填。
- Kubernetes 部署系统必须提供 8080 端口的健康探针以及 HTTP 访问，允许 GHCR image pull。不要把 GitHub Token、Argo 凭据或 Temporal Token 放进本仓库。

## 验收步骤
1. **代码阶段**：提交修改到测试项目主分支，GitHub CI 显示已运行 HTTP 接口测试及真实 Docker smoke test。
2. **镜像阶段**：`publish` 成功，输出 **不可变 digest** 而非只输出可移动的 `:latest`。
3. **TEST 部署**：Portal 通过 GitOps 把此 Digest 部署到专属 namespace。验证 `GET /healthz`、`GET /readyz` 为 200，`GET /version` 中的 commit SHA 与发布记录一致；从局域网用固定 IP + NodePort 访问界面。
4. **功能验证**：页面上新增/完成/删除任务，检测 API 响应均有效。
5. **可观测性**：Prometheus 从 `/metrics` 读取 release_info、任务数、请求计数；Portal 仅读取此应用 namespace 的指标和日志。
6. **生产晋级**：测试版本达到平台的真实检查条件后，生产部署引用 **完全相同的 image digest**（不得从源分支重新构建）。生产 URL 使用不同 NodePort。
7. **版本升级**：向测试仓库提交一个可识别 UI 或 API 变化，得到新 Digest，测试与生产分别验证新 SHA。
8. **故障和回滚**：通过**只针对测试环境**的部署环境变量 `E2E_FAILURE_MODE=readiness`，模拟 `/readyz` 503，观察平台标记异常并进行人工/Temporal 受控恢复。确认回滚到先前健康 Digest 后探针恢复为 200。**不要在生产配置此故障变量**。

> 当前门户还没做完通用托管发布器和全自动故障恢复；此文是验收标准，不代表上述链路已经由本仓库的 CI 实测。

## 接口合同

| 路径 | 方法 | 含义 |
| --- | --- | --- |
| `/` | GET | 有交互的任务工作台 |
| `/healthz` | GET | 存活探针 200 |
| `/readyz` | GET | 就绪探针，测试故障模式下返回 503 |
| `/version` | GET | 当前服务版本、Git commit 和构建时间 |
| `/metrics` | GET | Prometheus 文本格式指标 |
| `/api/tasks` | GET, POST | 查询、新增任务 |
| `/api/tasks/:id` | PATCH, DELETE | 完成/撤销完成、删除任务 |

内存任务不持久化，不可输入真实业务数据。
