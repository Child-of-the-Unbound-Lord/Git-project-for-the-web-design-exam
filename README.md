# LabFlow · 实验室耗材管理 v0.3

两人软件工程课程项目：耗材档案、入库、领用、库存查询、流水、预警、核对与统计共享业务模型；本轮新增 Cloudflare Workers + D1 云端 API、正式账号及管理员成员管理界面。

- **代码和隔离自动测试已完成**，云端部署是否成功、数据库是否实际自动绑定、首次初始化及跨设备验收需在 Cloudflare 控制台和真实浏览器确认。不要将自动化通过误认为线上验收通过。
- **云端模式**：业务数据保存在 D1；由服务端处理认证、权限、库存变更与会话；默认没有任何公开演示账号。管理员首设后创建成员。
- **本机完整版本**：`python3 server.py`，使用本机 SQLite 和旧版示例身份。
- **离线版本**：下载 HTML 后直接试用，数据保存在本浏览器 IndexedDB，**不与云端同步**。

## Cloudflare Workers 部署

Cloudflare 已通过 GitHub 连接到公开课程仓库：
[Git-project-for-the-web-design-exam](https://github.com/Child-of-the-Unbound-Lord/Git-project-for-the-web-design-exam)。

`wrangler.toml` 配置了 `main = "src/worker.mjs"`、静态资源 `dist` 和自动创建的 `DB`（D1）绑定。Cloudflare 的构建命令为 `npx wrangler deploy`；Wrangler 的 `[build]` 钩子会先运行 `python3 build_static.py`。GitHub Actions 另运行后端、云端接口、业务规则和页面渲染的隔离自动测试。

### 首次上线与管理员初始化

1. 在 Cloudflare → Workers & Pages → 本项目 → Deployments 中核对最新版本是否 `Ready`，并确认 Workers 绑定存在 `DB`（D1）。自动分配 D1 属于 Wrangler beta，未确认之前不要写成已完成。
2. 在 **Settings → Variables and Secrets** 添加 Secret `ADMIN_SETUP_TOKEN`，由本人生成并保管不少于24字符的随机值。**不要提交到 Git、发到聊天、写进文档或截图**。
3. 打开网站 `app.html`，按“创建首位管理员”页面填写账号、自己的强密码和上一步的初始化凭证。首个管理员建立后该入口会关闭。
4. 管理员登录，在“成员管理”新增一个普通成员账号，首次密码单独、安全地交给对应本人，并提醒其登录后修改。
5. 两个人在不同浏览器/电脑登录；管理员创建一个耗材，入库20、领用15，普通成员刷新后看到同一份库存。检验库存不足、成员不能调用管理接口、同单号重试与退出登录后会话失效。按 `docs/云端初始化与多人验收.md` 记录真实结果。

**如果部署失败**：查 Cloudflare Build 日志是否提示数据库资源自动创建失败或 Wrangler 版本问题；也可以在 Cloudflare 手动建立 D1、绑定变量名 `DB`。如需改 `wrangler.toml` 补入已创建数据库的 ID，请只使用控制台显示的真实 ID，不要编造。

正式上线前要确保默认 Demo 账号不对公网服务开放，云端 Worker 不会回退到浏览器本地模拟数据。仅在 `file://` 离线演示或明确没有 `/api/` 的静态站点使用浏览器数据层。

## 本地运行与检验

```bash
python3 server.py
python3 tests/test_server.py
node tests/browser-domain-checks.js
node tests/cloud-worker-checks.mjs
node tests/ui-render-checks.js
python3 build_static.py
```

Windows 下使用 `py -3 server.py`；本机 Python 版需要 Python 3.10 或更高，Node 只用于开发测试。`dist/` 和 `web/downloads/` 为构建输出，不提交到 Git。

## 项目结构

- `src/worker.mjs`：云端 API、授权、密码哈希、库存接口。
- `src/schema.mjs`：D1 数据表、唯一约束和库存流水原子触发器。
- `web/`：首页、指南、下载页和工作台；`web/api.js` 在云端与离线演示之间选择数据源。
- `server.py`：旧版完整本地 Python 服务；`seed.json` 仅供本地/离线演示。
- `tests/`：原有业务测试、云端后端隔离测试及 DOM 渲染烟测。
- `docs/云端初始化与多人验收.md`：成员分工、实际操作步骤、截图记录表和已知限制。

## 八个功能

耗材档案、入库登记、领用登记、库存查询、出入库流水、低库存预警、库存核对和数据统计使用同一套界面。操作步骤见网站的使用指南；课程分工、业务规则、演示步骤和原有测试记录见 [课程作品说明](docs/课程作品说明.md)。

## 下一步做什么

先让两个人在不同电脑上看到同一份库存，再完善成员管理和备份。

现有 `server.py` 面向本地运行，不能直接原样托管就当作正式后端。上线前需要适配允许的 Host、HTTPS 来源、绑定地址、平台端口、数据库持久保存方式以及正式账号。现有 Worker 已加入云端接口，但首次初始化与跨设备检查仍需落实。

测试记录保留了 v0.2 的实际运行结果。本次外部部署导出只核对构建、脚本语法和页面链接，没有把 GitHub 或 Cloudflare 的实际部署写成已经完成。

## 查到的资料

- [托管路线选型](docs/托管路线选型.md)：为什么先用 GitHub 和 Cloudflare，其他平台有哪些取舍。
- [建站资料与实验设计](docs/建站资料与实验设计.md)：开源项目、真实使用者反馈、五个可实际执行的实验和文案建议。

## 官方说明

- [Cloudflare Pages：Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Cloudflare 账号登录方式](https://developers.cloudflare.com/fundamentals/user-profiles/login/)
- [Cloudflare Pages 构建环境与 Python 版本](https://developers.cloudflare.com/pages/configuration/build-image/)
