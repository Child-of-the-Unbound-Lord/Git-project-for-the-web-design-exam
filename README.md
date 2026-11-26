# LabFlow · 实验室耗材管理

这是一个两人软件工程课程项目。页面能登记耗材、入库和领用，也能查库存、看预警、核对历史记录。

课程仓库：[Git-project-for-the-web-design-exam](https://github.com/Child-of-the-Unbound-Lord/Git-project-for-the-web-design-exam)。本仓库保存网站源码、运行说明、测试和参考资料，后续可以连接 Cloudflare Pages 自动构建和发布。**Cloudflare 网站与共享数据库尚未部署。**

## 先说清楚：现在能运行哪一版

| 运行方式 | 数据放在哪里 | 账号和权限 |
| --- | --- | --- |
| Cloudflare Pages 静态网站 | 当前浏览器的 IndexedDB | 使用示例账号演示角色区别 |
| 本地 Python 版 | 本机 SQLite 数据库 | 由 Python 服务端检查登录和权限 |

静态网站可以在浏览器里操作八个功能，但不同电脑不会共享库存。真实云端账号、共享数据库和跨设备同步还没有接入。演示耗材、人员、数量和流水均为合成数据，不代表真实调研结果。

## 推荐部署：GitHub + Cloudflare Pages

先用平台分配的 `pages.dev` 地址即可，不必先购买域名。

1. 使用上方课程仓库的 `main` 分支。
2. 根目录包含 `build_static.py`、`package_release.py`、`web/` 和本 README。若另建副本，也保持这一结构，不要再套一层文件夹。
3. 登录 Cloudflare，在 Pages 中使用 **Git 集成**新建项目，选择这个 GitHub 仓库。
4. 按下面的配置构建。
5. 部署成功后，打开 Cloudflare 返回的 `pages.dev` 地址。以后把修改推送到 `main`，由 Git 集成继续构建和更新。

| 配置项 | 填写内容 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `python3 build_static.py` |
| Build output directory | `dist` |
| Root directory | 留空，使用仓库根目录 |
| 构建环境变量 | 建议设置 `PYTHON_VERSION=3.12.14` |

本项目不用 npm，不需要安装前端依赖，也不需要额外的 GitHub Actions 流程。

**请从 Git 集成开始创建项目。** 这份目录按“修改源码、推送仓库、自动更新”的方式准备，后续维护不用每次手动上传网页。

当前课程仓库是公开仓库，下载中心也会向网站访客提供经过脱敏的源码 ZIP。演示中使用的是合成数据；运行数据库、会话文件和本机配置不应提交。网站访问权限与仓库可见性分别配置。

详细步骤与常见问题见 [部署到 GitHub 与 Cloudflare](docs/部署到GitHub与Cloudflare.md)。

## 先在本机构建一次

建议使用本地已验证的 Python 3.12.14：

```bash
python3 build_static.py
```

Windows 也可以使用：

```powershell
py -3 build_static.py
```

构建完成后，`dist/` 是要托管的网页目录。脚本还会生成源码 ZIP、离线演示 HTML 和说明 TXT，网站下载中心的按钮因此有实际文件可下载。

`dist/` 和 `web/downloads/` 都是生成结果，已经在 `.gitignore` 中忽略，不需要提交到仓库。Cloudflare 会从源码重新生成。

## 本地运行带后台的版本

需要 Python 3.10 或更高版本，不依赖第三方 Python 包。

```bash
python3 server.py
```

Windows 可执行 `py -3 server.py`，也可以双击 `start_windows.bat`；macOS/Linux 可执行 `bash start_macos_linux.sh`。

默认访问地址是 `http://127.0.0.1:8000`，从首页进入工作台。首次运行会建立演示数据库，之后启动会保留数据。不要把 `data/` 目录提交到 Git。

| 示例身份 | 用户名 | 密码 |
| --- | --- | --- |
| 管理员 | `admin` | `Admin123!` |
| 成员 A | `member_a` | `Member123!` |
| 成员 B | `member_b` | `Member123!` |

这些账号用于课程演示，不能直接用作正式网站账号。

## 八个功能

耗材档案、入库登记、领用登记、库存查询、出入库流水、低库存预警、库存核对和数据统计使用同一套界面。操作步骤见网站的使用指南；课程分工、业务规则、演示步骤和原有测试记录见 [课程作品说明](docs/课程作品说明.md)。

## 下一步做什么

先让两个人在不同电脑上看到同一份库存，再完善成员管理和备份。

现有 `server.py` 面向本地运行，不能直接原样托管就当作正式后端。上线前需要适配允许的 Host、HTTPS 来源、绑定地址、平台端口、数据库持久保存方式以及正式账号。当前导出没有加入这些能力。

测试记录保留了 v0.2 的实际运行结果。本次外部部署导出只核对构建、脚本语法和页面链接，没有把 GitHub 或 Cloudflare 的实际部署写成已经完成。

## 查到的资料

- [托管路线选型](docs/托管路线选型.md)：为什么先用 GitHub 和 Cloudflare，其他平台有哪些取舍。
- [建站资料与实验设计](docs/建站资料与实验设计.md)：开源项目、真实使用者反馈、五个可实际执行的实验和文案建议。

## 官方说明

- [Cloudflare Pages：Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Cloudflare 账号登录方式](https://developers.cloudflare.com/fundamentals/user-profiles/login/)
- [Cloudflare Pages 构建环境与 Python 版本](https://developers.cloudflare.com/pages/configuration/build-image/)
