# 声入山野 · AI 乡村音乐课堂

面向乡村小学音乐教师的备课与课堂工具：用一句自然语言描述需求，生成可执行的音乐课方案；课堂上用真实音频测量学生的音准与节奏，并沉淀成可追溯的课堂报告。

- 前端：原生 HTML/CSS/JS（无构建步骤），入口 `public/index.html`
- 后端：Node.js 原生 `http` 模块，零第三方依赖
- 存储：本地 JSON + WAV 文件（`.local-data/`），按账号隔离

## 目录结构

```
shanyin-demo/
├── public/                 前端静态站点（浏览器直接访问的根目录）
│   ├── index.html
│   ├── app.js              首页 / 备课 / 我的班级 / 山野声音
│   ├── workspace.js        工作台、账号、山音工作记录
│   ├── lesson-ui.js        课堂方案与逐音校对
│   ├── agent-ui.js         教学 Agent 任务面板
│   ├── audio-ui.js         AI 听唱录音与测量
│   ├── reports-ui.js       课堂报告中心
│   ├── lesson-core.js      课程核心算法（浏览器 + Node 共用）
│   ├── style.css / workspace.css / lesson.css / reports.css
│   ├── assets/             插画、Logo、示范音频
│   └── lessons/            课程数据与生成的音频清单
├── server/                 服务端
│   ├── server.cjs          启动入口（127.0.0.1:4173）
│   ├── auth-server.cjs     路由、静态服务、账号与会话
│   ├── teaching-agent.cjs  教学 Agent 编排与模型适配
│   ├── audio-analysis.cjs  音频测量（去噪 → 基频 → 对齐 → 音准/节奏）
│   ├── audio-store.cjs     录音持久化、去重、复测比较
│   ├── audio-worker.cjs    分析线程
│   └── report-builder.cjs  课堂报告聚合
├── scripts/
│   └── build-lesson.cjs    由课程 JSON 生成 WAV 与浏览器数据
├── tests/                  `node --test` 测试（使用临时目录）
├── docs/                   验收记录、缺口清单、Agent 接入说明
└── .local-data/            运行时数据（不进入版本库）
```

## 快速开始

```bash
npm start            # 等价于 node server/server.cjs
```

打开 http://127.0.0.1:4173 。Windows 也可直接双击 `启动声入山野.cmd`（需保持窗口开启）。
服务默认只监听本机；需要局域网访问时，把 `server/server.cjs` 里的 `127.0.0.1` 改为 `0.0.0.0`。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm start` | 启动本地服务 |
| `npm test` | 运行全部测试（`tests/*.test.cjs`） |
| `npm run build:lesson` | 由 `public/lessons/molihua.lesson.json` 重新生成示范音频与浏览器数据 |

## 使用流程

1. **备课**：登录后在工作台用自然语言描述需求（年级、人数、时长、歌曲、设备），生成方案与「山音工作记录」。
2. **AI 听唱**：在安静环境录制一段 1–20 秒的人声，读取音准/节奏指标；同一句可复测一次，形成前后比较。
3. **课堂报告**：报告中心只汇总本账号的有效录音，可打印/另存为 PDF，或下载文字报告、JSON、WAV。

## 功能边界（不做的部分也写清楚）

- 《茉莉花》接入真实教学 Agent（需配置模型）与真实音频测量；《小雨沙沙》《两只老虎》为模板演示。
- 测量限定「安静环境、一位演唱者、无伴奏、1–20 秒」，多人与带伴奏录音会判为无效；声学偏差不能推断气息、心理状态或唱法原因。
- 示范与自然音效由 Web Audio 合成；朗读与语音识别依赖浏览器能力。
- 账号系统不含邮件/手机验证、找回密码、第三方登录或跨设备云同步，服务器重启后需重新登录（数据保留）。
- 尚无 RAG 知识库、弱网离线模式与儿童端；录音未做课堂结束后自动删除。

详细缺口见 `docs/功能缺口清单.md`。

## 测试

```bash
npm test
```

覆盖：账号注册/登录/改密/隔离/重启恢复；《茉莉花》课程条件与实际音频波形；真实音频测量、复测比较、复用拒绝；教学 Agent 严格校验、事件持久化与越权隔离；课堂报告只统计有效样本；Agent 任务取消与重试（越权 404、运行中重试 429、取消后结果不被覆盖）。

## 开发约定

- 服务端与前端逻辑分离：`public/` 只放浏览器代码，`server/` 只放 Node 代码，`lesson-core.js` 为两端共用的纯算法。
- 先本地实现与验收，不擅自部署或推送线上版本。
- 测试一律使用临时目录，不读写 `.local-data/`。

## License

MIT
