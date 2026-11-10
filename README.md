<div align="center">

<img src="docs/logo.svg" width="104" alt="智考通 ZhiKaoTong Logo"/>

# 智考通 ZhiKaoTong

**Smart Attendance Connect · 高校考勤与教务一体化管理系统**

[![比赛项目](https://img.shields.io/badge/%E6%AF%94%E8%B5%9B%E9%A1%B9%E7%9B%AE-%E5%B7%B2%E6%90%81%E7%BD%AE-lightgrey?style=for-the-badge)](https://github.com/XMaoCAT/ZhiKaoTong/releases/tag/v1.0.0-shelved)
[![归档版本](https://img.shields.io/badge/%E5%BD%92%E6%A1%A3%E7%89%88%E6%9C%AC-v1.0.0--shelved-blue?style=for-the-badge)](https://github.com/XMaoCAT/ZhiKaoTong/releases/tag/v1.0.0-shelved)
[![Stars](https://img.shields.io/github/stars/XMaoCAT/ZhiKaoTong?style=for-the-badge&color=yellow)](https://github.com/XMaoCAT/ZhiKaoTong/stargazers)

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D%2020-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Fastify](https://img.shields.io/badge/Fastify-v4-20232A?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![前端](https://img.shields.io/badge/%E5%89%8D%E7%AB%AF-%E5%8E%9F%E7%94%9F_ESM-FF9A62?style=for-the-badge&logo=javascript&logoColor=white)]()
[![双端](https://img.shields.io/badge/%E5%8F%8C%E7%AB%AF-PC_%2B_Mobile-6C5CE7?style=for-the-badge)]()
[![零CDN依赖](https://img.shields.io/badge/%E9%9B%B6CDN%E4%BE%9D%E8%B5%96-%E5%8F%AF%E7%A6%BB%E7%BA%BF%E8%BF%90%E8%A1%8C-00B8A9?style=for-the-badge)]()

*单进程 Node 服务 · 原生 ESM 前端 · 零构建链路 · 克隆即用*

```bash
git clone https://github.com/XMaoCAT/ZhiKaoTong.git
cd ZhiKaoTong && npm install && npm start
```

</div>

---

> [!WARNING]
> **项目状态：比赛项目，已烂尾（停更搁置）**
>
> 本项目为一次比赛作品，开发至 2026-11-03（待办清账批二）后**停止维护**，现归档于 GitHub 搁置，不再计划任何后续开发。仓库保留可完整运行的全量代码与文档，仅供查阅、学习或二次利用；请勿对作者提出修复或新功能请求。

---

## 目录

| 章节 | 内容 |
| :--- | :--- |
| [项目简介](#项目简介) | 一张表看懂全貌 |
| [服务器抗压架构](#服务器抗压架构) | 高压缓冲 / 排队 / 熔断设计 |
| [环境要求](#环境要求) | 部署前检查清单 |
| [部署教程 · Windows](#部署教程--windows) | 一键脚本 / 命令行 |
| [部署教程 · Linux / macOS](#部署教程--linux--macos) | 含后台常驻 |
| [初始化演示数据](#初始化演示数据) | 生成 100 学生 + 5 教师 |
| [访问入口与账号](#访问入口与账号) | 六角色速查表 |
| [常见问题](#常见问题) | 8 条 FAQ |
| [目录结构速览](#目录结构速览) | 仓库地图 |

---

## 项目简介

**智考通**是一套面向高校的「考勤与教务一体化管理系统」：单进程 Node 服务 + 浏览器前端，**无前端框架、无构建工具、零外部 CDN 依赖**，克隆后 `npm install` 即可跑起来。

| 能力域 | 内容 |
| :--- | :--- |
| 业务线 | 学生请假审批 · 课表调课 · 课堂签到与随人互动 · 违规积分 · 问卷与投票（九类题型 + 显示逻辑引擎） |
| 角色 | 学生 / 教师 / 教务处 / 学生处 / 导员 / IT管理员 |
| 端 | PC（`/`）+ 手机壳视图（`/m-dev1`，需开启调试端点；独立登录态可多角色并行） |
| 前端架构 | 原生 ES Module 微内核 + **14 个可插拔业务模块**（四件套：manifest + index.js + style.css + DEV_LOG.md） |
| 实时推送 | SSE 三级频道广播（role / class / teacher），断线自动重连 + 通知表兜底 |
| 抗压设计 | 分片上传排队与压力自适应体系（详见[下一节](#服务器抗压架构)） |
| 登录防护 | 自绘 SVG 图形验证码 + 仅计失败限流（单 IP 半小时 5 次 → 429） |
| 效率件 | 全局搜索（拼音后端单源）· 顶栏通知铃铛 · 登录待办弹窗 |

技术细节见 [`软件描述.md`](软件描述.md)（六部分全量描述）与 [`Rules.md`](Rules.md)（项目宪章：SOP / 铁律 / 全部踩坑史）。

---

## 服务器抗压架构

> 该体系先于业务版块建成（源自《服务器架构方案》），服务"文件上传 → 任务处理 → 结果下载"全链路。核心思想：**高请求时不硬扛也不丢弃，而是排队缓冲 + 分级降速 + 兜底熔断**。

```
 客户端请求                     服务端（单进程）
┌──────────┐   ①入口熔断闸门    ┌─────────────────────────────────────┐
│ 申请上传  │ ───────────────► │ apply：磁盘<500MB 或 队列超 2×高水位  │
└──────────┘                   │        → 直接 rejected（拒收）        │
                               │      槽位满 → 发 QUEUED 排队票据      │
┌──────────┐   ②分片续传        │ 5MB 分片：.part.tmp → rename 原子落盘│
│ 传分片    │ ───────────────► │ 断线重连按 .part 实数续传缺片          │
└──────────┘                   └───────────────┬─────────────────────┘
                                               │ 入任务队列
                               ┌───────────────▼─────────────────────┐
                               │ ③SQLite 序列表即队列                │
                               │ seq 单调递增 · priority DESC 取队    │
                               │ 排队位置实时 SSE 广播                │
                               └───────────────┬─────────────────────┘
                                               │ 1s 调度器
                               ┌───────────────▼─────────────────────┐
                               │ ④压力自适应（PressureMonitor·5s 评估）│
                               │ 并发上限 = 压力档位的动态输出        │
                               └─────────────────────────────────────┘
```

**① 入口熔断（高压缓冲的闸门）** —— 不让系统在高压下崩溃：

| 信号 | 动作 |
| :--- | :--- |
| 磁盘剩余 < 500MB 或队列 > 2×高水位 | `acceptingNewTasks = false`，新申请直接拒收 |
| 上传槽位满（或压力 HIGH） | 申请不打回，转 **QUEUED 持久化票据**，压力回落后凭 ticket 继续上传 |

**② 分片上传通道（断点续传 + 原子落盘）**：

| 机制 | 要点 |
| :--- | :--- |
| 分片 | 默认 5MB/片；`.part.tmp` 写完改名 `.part`——半片永远不会被误认为完整 |
| 续传 | 断线重连后以磁盘 `.part` 实数为真值续传缺片（不信库值信盘值） |
| 校验 | complete 时逐片累加字节数与申报 fileSize 严格相等，不符 409 |

**③ 任务排队（SQLite 序列表即队列）** —— 不引入 Redis 等外部队列，表就是队列：

| 机制 | 要点 |
| :--- | :--- |
| 入队 | `seq` 单调递增；创建即向所有排队任务 SSE 推送最新排队位置 |
| 调度 | 1s 扫描，`priority DESC, seq ASC` 取首条执行；**并发上限直接消费压力档位** |
| 进度 | `updateProgress` 落库 + SSE 实时帧；任务级事件流首帧补发（错过的状态不丢） |

**④ 压力三档自适应（每 5s 评估）**：

| 维度 | 采集方式 |
| :--- | :--- |
| CPU | `process.cpuUsage` 差分 / 墙钟 |
| 内存 | `os.freemem` 比例 |
| 事件循环延迟 | setTimeout 200ms 基线，实测偏差即阻塞度 |
| 磁盘 / 队列 / 活跃上传 | statfs + 队列表 + 服务方快照回灌 |

| 档位 | 判定 | 调节动作（平滑渐进，防抖动） |
| :--- | :--- | :--- |
| HIGH | CPU>85% 或 mem>85% 或 队列>200 或 loopDelay>150ms 或 磁盘<1GB | 任务并发 ×0.75（下限 1）、上传槽位 −3（下限 2） |
| LOW | 全指标低位 | 并发 +1、槽位 +1（上限为配置值） |
| NORMAL | 其余 | 维持 |

> 全套指标通过 `GET /api/queue/status` 实时可观测；调度与插件执行解耦（带时间戳 query 动态 `import()`，换插件不重启核心）。

---

## 环境要求

| 项 | 要求 | 备注 |
| :--- | :--- | :--- |
| 操作系统 | Windows / Linux / macOS | `.bat` 脚本仅 Windows；其他系统见命令行教程 |
| Node.js | **≥ 20 LTS** | 依赖 better-sqlite3 原生编译，LTS 版省心 |
| npm | ≥ 9 | 随 Node 附带 |
| 磁盘 | ~100 MB | 代码 1.4 MB + node_modules ~25 MB + 运行时数据 |
| 网络 | 仅安装依赖时需要 | 运行期零外网依赖，可完全离线 |
| 浏览器 | Chrome / Edge / Firefox | 现代浏览器即可（ES Module + CSS color-mix） |

---

## 部署教程 · Windows

### 方式 A：一键脚本（推荐）

```bat
1. 解压/克隆仓库到任意本地目录（路径无中文更稳）
2. 双击 start.bat
   ├─ 首次运行自动 npm install（约 1–2 分钟，需联网）
   ├─ 自动探测空闲端口（默认从 8080 开始）并启动服务
   └─ 浏览器自动打开；若未打开，看服务窗口显示的访问地址
3. 停止：双击 stop.bat     重启：双击 Restart.bat
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

## 部署教程 · Linux / macOS

```bash
git clone https://github.com/XMaoCAT/ZhiKaoTong.git
cd ZhiKaoTong
npm install        # better-sqlite3 为原生模块，编译问题见下方 FAQ
npm start          # 即 node server.js
```

后台常驻可按习惯使用 systemd / pm2 / nohup：

```bash
nohup node server.js > zkt.log 2>&1 &
```

> [!TIP]
> **优雅停机**：`POST http://127.0.0.1:<端口>/api/shutdown`，或直接结束 node 进程（SQLite WAL 对强制结束安全，重启自动恢复）。

---

## 初始化演示数据

首次启动后数据库为空库（表结构自动建好）。按以下步骤生成演示数据：

1. 浏览器打开 `http://127.0.0.1:<端口>/`
2. 教职工 Tab 登录 `IT管理员`（初始密码 `123456`；登录需输入图形验证码，点击图片可刷新）
3. 进入「系统管理」→ 数据管理区：
   - 点击「生成模拟数据」→ 自动创建 教师01–05 + 学生000000001–000000100（幂等，可重复执行）
   - 危险操作：「初始化」= 全表清零重置，需输入「清空」二字强确认，**不可逆**
4. 之后即可用学生学号或教师账号登录体验各角色

---

## 访问入口与账号

### 入口

| 入口 | 地址 | 说明 |
| :--- | :--- | :--- |
| PC 端 | `http://127.0.0.1:<端口>/` | 六角色完整操作 |
| 手机端 | `http://127.0.0.1:<端口>/m-dev1` | 需 IT管理员在「系统管理 → 调试端点」开启；独立登录态 |
| 健康检查 | `GET /api/health` | `{ok, uptime}` |

### 账号（初始密码均为 `123456`，可自助修改）

| 角色 | 账号 |
| :--- | :--- |
| 学生 | `000000001` – `000000100`（9 位学号） |
| 教师 | `教师01` – `教师05`（教务处可动态添加） |
| 教务处 | `教务处` |
| 学生处 | `学生处` |
| 导员 | `导员` |
| IT管理员 | `IT管理员` |

> [!NOTE]
> 登录有**图形验证码**（每次必填）；同 IP **半小时内累计 5 次登录失败将被锁定**（仅计失败，成功登录不计；重启服务即清零）。

---

## 常见问题

<details>
<summary><b>展开 8 条 FAQ（npm 换源 / 端口 / 限流 / WAL 备份 …）</b></summary>

| 现象 | 处置 |
| :--- | :--- |
| `npm install` 卡住/失败 | 换源：`npm config set registry https://registry.npmmirror.com` 后重试；better-sqlite3 为原生模块，Linux 需编译链（debian: `apt install build-essential python3`） |
| 端口冲突 | 服务自动顺延 8080→8090；实际端口看 `data/runtime.json` 或启动日志 |
| 双击 start.bat 提示已在运行 | 先执行 `stop.bat`；或直接访问既有实例地址 |
| 浏览器没自动打开 | 手动访问 `http://127.0.0.1:8080/`（或 runtime.json 里的端口） |
| 登录 429「尝试过于频繁」 | 同 IP 半小时失败 5 次触发限流；等待半小时或重启服务清零 |
| 页面样式/功能异常 | 浏览器强制刷新 <kbd>Ctrl</kbd>+<kbd>F5</kbd>；改后端代码必须重启服务才生效 |
| 数据想重置 | IT管理员登录 → 系统管理 → 初始化（清零后重新生成模拟数据） |
| 想备份/迁移数据 | 备份 `data/app.db` 前先停服务（WAL 模式，运行中直接复制会不一致） |

</details>

---

## 目录结构速览

<details>
<summary><b>展开仓库地图</b></summary>

```
ZhiKaoTong/
├─ server.js                       # Fastify 入口（静态托管/端点注册/端口自适应）
├─ start.bat | stop.bat | Restart.bat   # Windows 一键脚本
├─ config/config.json              # 运行配置（支持热更新）
├─ package.json                    # node ≥20；fastify/@fastify-static/better-sqlite3
├─ 软件描述.md                      # 正式文档：功能与技术全量描述（六部分）
├─ Rules.md                        # 项目宪章：SOP/铁律/踩坑史/模块总表
├─ docs/logo.svg                   # 本 README 徽标（复刻应用内 brand-mark）
├─ src/
│  ├─ core/                        # db/config/consts/http-utils/pub(SSE)/pressure/scheduler
│  ├─ api/                         # 19 个路由文件（业务+基础设施）
│  ├─ services/                    # uploadService/taskService（分片上传与任务队列）
│  └─ plugins/                     # 任务处理插件（热更新样例）
├─ public/
│  ├─ index.html                   # 纯插槽宿主
│  ├─ core/                        # 宿主启动/插件加载器/事件总线/全局样式
│  ├─ shared/                      # 跨模块共享件（roles/api-*(11)/sse/拼音 vendor 等）
│  └─ modules/                     # 14 个业务模块四件套（mod-*/）
├─ scripts/stop.js                 # 优雅停机脚本
└─ data/ storage/                  # 运行时自动生成（gitignore，含 SQLite 库与上传文件）
```

> `data/` 与 `storage/` 不在仓库中，首次启动自动创建；`node_modules` 由 `npm install` 恢复。

</details>

---

<div align="center">

*本仓库自发布版本起处于搁置状态 · 感谢阅读*

— 智考通 ZhiKaoTong · Smart Attendance Connect —

</div>

> AI生成
