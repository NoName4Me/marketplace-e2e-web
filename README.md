# Marketplace E2E Web

用于验证 [Enterprise App Marketplace](https://github.com/NoName4Me/enterprise-app-marketplace) 的 GitHub → CI → GHCR → Kubernetes TEST → 生产晋级、健康检查及回滚的**独立测试应用**。

这个仓库不是生产业务系统：演示任务仅保存在进程内存中，重启会清空；**不含真实账号、员工数据或部署凭据**。

后续提交将提供：Web 界面、健康与版本接口、Prometheus 指标、Dockerfile、多架构镜像发布工作流和自动化测试。
