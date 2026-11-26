# 把 LabFlow 放到 GitHub 和 Cloudflare Pages

这份说明对应仓库中的静态演示版。最终网站会有自己的网址，但数据仍保存在访问者各自的浏览器里。共享库存和真实云端账号是下一步的工作。

## 需要准备什么

- 一个 GitHub 账号，用来保存代码。
- 一个 Cloudflare 账号，用来连接仓库并托管网页。
- 本项目的整个源码目录。

Cloudflare 提供的登录方式见[官方账号说明](https://developers.cloudflare.com/fundamentals/user-profiles/login/)。平台注册登录、授权它读取 GitHub 仓库、给你自己的网站添加用户登录，是三件不同的事。完成前两件，不会自动让 LabFlow 获得真实云端账号。

先用平台提供的 `pages.dev` 网址，不必先买域名。

## 第一步：选择课程仓库

使用现有的公开课程仓库 [Git-project-for-the-web-design-exam](https://github.com/Child-of-the-Unbound-Lord/Git-project-for-the-web-design-exam)，发布分支为 `main`。若另建副本，可以按使用范围选择仓库可见性，再把源码放到仓库根目录。

仓库根目录至少应看到：

- `README.md`
- `build_static.py`
- `package_release.py`
- `server.py`
- `seed.json`
- `web/`
- `docs/`
- `tests/`
- `.gitignore`

不要把包含这些内容的外层文件夹整个再套进仓库。也不要只上传 `web/`：网站构建时还会生成下载文件，需要完整源码和打包脚本。

运行数据库、会话、缓存、Git 元数据和原托管身份已排除在导出包之外。`seed.json` 是课程演示用的合成初始数据，应保留。

## 第二步：用 Git 集成创建 Pages 项目

按 [Cloudflare Pages 官方 Git 集成说明](https://developers.cloudflare.com/pages/get-started/git-integration/)连接 GitHub，选择上面的课程仓库。

创建方式使用 Git 集成。这样以后你们改完代码并推送到 `main`，Pages 就能根据提交重新构建。当前没有必要加一套 GitHub Actions，也不需要每次手动上传生成结果。

填写：

| 项目 | 内容 |
| --- | --- |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `python3 build_static.py` |
| Build output directory | `dist` |
| Root directory | 默认仓库根目录，留空即可 |
| Environment variable | 建议显式设置 `PYTHON_VERSION` 为 `3.12.14` |

Python 版本变量见 [Cloudflare Pages 构建环境说明](https://developers.cloudflare.com/pages/configuration/build-image/)。这里使用项目已在本地验证的版本。这个项目只用 Python 标准库生成静态文件，不需要运行 `npm install`。

如果页面提示找不到 `build_static.py`，先检查仓库是否多套了一层目录，以及 Root directory 是否填错。

## 第三步：检查生成的网站

构建成功后，用平台返回的网址检查：

1. 首页能打开，导航可以进入使用指南、下载中心和工作台。
2. 选择示例管理员，新增一种耗材，然后登记入库。
3. 领用后查看库存变化，再尝试提交超过库存的数量。
4. 下载源码 ZIP 和离线 HTML，确认得到实际文件。
5. 用另一台电脑打开同一网址，确认页面能访问。

最后一项目前只检查网页访问。**另一台电脑不会看到第一台电脑新增的库存**，因为当前是浏览器演示。这不是云端共享数据库版本。

当前仓库公开，下载中心也提供经过脱敏的源码 ZIP。网页访问权限另外配置；如果只供指定人员查看，需要在托管平台设置访问控制。现阶段使用合成演示数据。

## 第四步：以后怎么更新

主负责人整理代码修改，组员根据测试用例操作并记录问题。确认后将修改提交并推送到 `main`，再查看 Pages 的构建结果和更新后的网页。

`dist/` 和 `web/downloads/` 已在 `.gitignore` 中忽略。它们由 `python3 build_static.py` 生成，不要手动维护其中的文件。

不要在下载生成的网页里直接改功能：功能代码应修改 `web/` 中的源文件。

## 共享库存还需要哪些改动

现有 Python 后台在本机已经负责登录检查、权限和 SQLite 库存事务，但它的部署假设仍是本地运行：

- Host 检查只接受本机或监听地址，正式域名需要明确配置。
- 来源检查按本地 HTTP 编写，HTTPS 和反向代理环境需要适配。
- 监听地址、平台端口和数据库持久保存位置需要设置。
- 示例账号需要改为正式的账号创建和管理流程。

因此，不要把 `server.py` 简单上传到另一个平台后，就认为真实账号和多人共享库存已经完成。下一轮再把这些改动连同跨设备测试一起完成。

## 本次导出做了什么

- 从已验证的 v0.2 源码包整理文件。
- 保留业务源码、测试与课程文档。
- 更新部署说明，并把五处宣传式文案改得更直接。
- 源码通过 GitHub 项目继续维护；Cloudflare 托管与共享数据库仍待接入。
- 构建与语法、链接核对只验证本地导出，不等同于外部部署验收。

## 来源

- [Cloudflare Pages：Git 集成](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Cloudflare：账号登录方式](https://developers.cloudflare.com/fundamentals/user-profiles/login/)
- [Cloudflare Pages：构建环境](https://developers.cloudflare.com/pages/configuration/build-image/)
