# 智考通 ZhiKaoTong · Smart Attendance Connect

> **项目状态：比赛项目，已烂尾（停更搁置）**
>
> 本项目为一次比赛作品，开发至 2026-11-03（待办清账批二）后**停止维护**，现归档于 GitHub 搁置，不再计划任何后续开发。仓库保留可完整运行的全量代码与文档，仅供查阅、学习或二次利用；请勿对作者提出修复或新功能请求。

---

## 目录

1. [项目简介](#项目简介)
2. [环境要求](#环境要求)
3. [部署教程（Windows）](#部署教程windows)
4. [部署教程（Linux / macOS）](#部署教程linux--macos)
5. [初始化演示数据](#初始化演示数据)
6. [访问入口与账号](#访问入口与账号)
7. [常见问题](#常见问题)
8. [目录结构速览](#目录结构速览)

---

## 项目简介

**智考通**是一套面向高校的「考勤与教务一体化管理系统」，单进程 Node 服务 + 浏览器前端，零构建链路、零外部 CDN 依赖，克隆后 `npm install` 即可跑起来。

| 维度 | 说明 |
| :--- | :--- |
| 业务线 | 学生请假审批、课表调课、课堂签到与随人互动、违规积分、问卷与投票（九类题型+显示逻辑） |
| 角色 | 学生 / 教师 / 教务处 / 学生处 / 导员 / IT管理员（六角色） |
| 端 | PC（`/`）+ 手机壳视图（`/m-dev1`，需开启调试端点） |
| 前端 | 原生 ES Module，微内核 + 14 个可插拔业务模块（模块四件套：manifest + index.js + style.css + DEV_LOG.md） |
| 后端 | Node.js + Fastify + SQLite（better-sqlite3，WAL 模式），19 个路由文件 |
| 实时 | SSE 三级频道广播（role / class / teacher） |
| 特色 | 分片上传排队与压力自适应体系（三档监控+入口熔断+SQLite 序列表队列）；登录图形验证码+仅计失败限流；全局搜索（拼音后端单源）；登录待办弹窗 |

> 技术细节见仓库内 `软件描述.md`（六部分：简要说明 / 架构设计 / 核心算法 / 功能说明 / 业务规则 / 接手指南）；开发纪律与踩坑史见 `Rules.md`（项目宪章）与各模块 `DEV_LOG.md`。

---

## 环境要求

| 项 | 要求 | 备注 |
| :--- | :--- | :--- |
| 操作系统 | Windows / Linux / macOS | 启动 bat 仅 Windows；其他系统见下方命令行教程 |
| Node.js | **≥ 20 LTS** | 依赖 better-sqlite3 原生编译，LTS 版省心 |
| npm | ≥ 9 | 随 Node 附带 |
| 磁盘 | ~100 MB | 代码 1.4 MB + node_modules ~25 MB + 运行时数据 |
| 网络 | 仅安装依赖时需要 | 运行期零外网依赖（拼音库为本地 vendor 副本），可完全离线 |
| 浏览器 | Chrome / Edge / Firefox | 现代浏览器即可（ES Module + CSS color-mix） |

---

## 部署教程（Windows）

### 方式 A：一键脚本（推荐）

```bat
1. 解压/克隆仓库到任意本地目录（路径无中文更稳）
2. 双击 start.bat
   └─ 首次运行会自动 npm install（约 1–2 分钟，需联网）
   └─ 之后自动探测空闲端口（默认从 8080 开始）并启动服务
   └─ 启动成功后浏览器自动打开；若未打开，看服务窗口显示的访问地址
3. 停止：双击 stop.bat      重启：双击 Restart.bat
```

### 方式 B：命令行

```bat
git clone https://github.com/XMaoCAT/ZhiKaoTong.git
cd ZhiKaoTong
npm install
npm start
```

启动后控制台会打印实际端口（占用自动顺延，8080–8090 探测），并写入 `data/runtime.json`。

---

## 部署教程（Linux / macOS）

```bash
git clone https://github.com/XMaoCAT/ZhiKaoTong.git
cd ZhiKaoTong
npm install        # better-sqlite3 为原生模块，无 Python/gcc 时看下方 FAQ
npm start          # 即 node server.js
```

前台运行：`npm start`；后台常驻可按习惯使用 systemd / pm2 / nohup，例如：

```bash
nohup node server.js > zkt.log 2>&1 &
```

> 优雅停机：`POST http://127.0.0.1:<端口>/api/shutdown`，或直接结束 node 进程（SQLite WAL 对强制结束安全，重启自动恢复）。

---

## 初始化演示数据

首次启动后数据库为空库（表结构自动建好）。按以下步骤生成演示数据：

1. 浏览器打开 `http://127.0.0.1:<端口>/`
2. 教职工 Tab 登录 `IT管理员`（初始密码 `123456`，登录需输入图形验证码，点击图片可刷新）
3. 进入「系统管理」→ 数据管理区
   - 点「生成模拟数据」→ 自动创建 教师01–05 + 学生000000001–000000100（幂等，可重复执行）
   - （危险操作）「初始化」= 全表清零重置，需输入"清空"二字强确认，**不可逆**
4. 之后即可用学生学号或教师账号登录体验各角色

---

## 访问入口与账号

| 入口 | 地址 | 说明 |
| :--- | :--- | :--- |
| PC 端 | `http://127.0.0.1:<端口>/` | 六角色完整操作 |
| 手机端 | `http://127.0.0.1:<端口>/m-dev1` | 需 IT管理员先在「系统管理 → 调试端点」开启；独立登录态，可多角色并行测试 |
| 健康检查 | `GET /api/health` | `{ok, uptime}` |

| 角色 | 账号 | 密码 |
| :--- | :--- | :--- |
| 学生 | `000000001` – `000000100`（9 位学号） | 初始 `123456`（可自助修改） |
| 教师 | `教师01` – `教师05`（可动态添加） | 初始 `123456` |
| 教务处 / 学生处 / 导员 / IT管理员 | 同名账号 | 初始 `123456` |

> 登录有**图形验证码**（每次必填）；同 IP **半小时内累计 5 次登录失败将被锁定**（仅计失败，成功登录不计；重启服务即清零）。

---

## 常见问题

| 现象 | 处置 |
| :--- | :--- |
| `npm install` 卡住/失败 | 换源：`npm config set registry https://registry.npmmirror.com` 后重试；better-sqlite3 为原生模块，Linux 需系统有编译链（debian: `apt install build-essential python3`） |
| 端口冲突 | 服务自动顺延 8080→8090；实际端口看 `data/runtime.json` 或启动日志 |
| 双击 start.bat 提示已在运行 | 先执行 `stop.bat`；或直接访问既有实例地址 |
| 浏览器没自动打开 | 手动访问 `http://127.0.0.1:8080/`（或 runtime.json 里的端口） |
| 登录 429「尝试过于频繁」 | 同 IP 半小时失败 5 次触发限流；等待半小时或重启服务清零 |
| 页面样式/功能异常 | 浏览器强制刷新（Ctrl+F5）；改后端代码必须重启服务才生效 |
| 数据想重置 | IT管理员登录 → 系统管理 → 初始化（清零后重新生成模拟数据） |
| 想备份/迁移数据 | 备份 `data/app.db` 前先停服务（WAL 模式，运行中直接复制会不一致） |

---

## 目录结构速览

```
ZhiKaoTong/
├─ server.js                 # Fastify 入口（静态托管/端点注册/端口自适应）
├─ start.bat|stop.bat|Restart.bat   # Windows 一键脚本
├─ config/config.json        # 运行配置（支持热更新）
├─ package.json              # node ≥20；fastify/@fastify-static/better-sqlite3
├─ 软件描述.md                # 正式文档：功能与技术全量描述（六部分）
├─ Rules.md                  # 项目宪章：SOP/铁律/踩坑史/模块总表
├─ src/
│  ├─ core/                   # db/config/consts/http-utils/pub(SSE)/pressure/scheduler
│  ├─ api/                    # 19 个路由文件（业务+基础设施）
│  ├─ services/              # uploadService/taskService（分片上传与任务队列）
│  └─ plugins/               # 任务处理插件（热更新样例）
├─ public/
│  ├─ index.html             # 纯插槽宿主
│  ├─ core/                  # 宿主启动/插件加载器/事件总线/全局样式
│  ├─ shared/                # 跨模块共享件（roles/api-*(11)/sse/拼音 vendor 等）
│  └─ modules/               # 14 个业务模块四件套（mod-*/）
├─ scripts/stop.js           # 优雅停机脚本
└─ data/ storage/            # 运行时自动生成（gitignore，含 SQLite 库与上传文件）
```

> data/ 与 storage/ 不在仓库中，首次启动自动创建；`node_modules` 由 npm install 恢复。

---

*本仓库自发布版本起处于搁置状态。感谢阅读。*
