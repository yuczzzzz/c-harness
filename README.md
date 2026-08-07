# c-harness

> 基于 Harness 提高网页版大模型使用体验。

> [!CAUTION]
> **风险须知：** 本扩展仅供学习与技术交流使用。其运行会改变受支持网页的正常对话流程，可能触发目标网站的异常行为检测，并导致账号验证、功能限制、临时或永久封禁等风控措施。使用前请确认符合目标网站的服务条款。安装、启用或继续使用本扩展，即表示你已知悉并自愿承担由此产生的账号、数据及其他相关风险。

## 为什么做 c-harness

网页版大模型开箱即用，但它与用户主动整理的本地 Skill、Reference 和外部 MCP 能力之间仍有明显边界。在使用 Skill、查阅配套资料或调用用户添加的工具服务时，重复复制上下文很容易打断对话节奏。

c-harness 是一款 Chrome Manifest V3 扩展。它在受支持的网页版大模型对话页中加入一层 Harness，把用户导入的 Skill 和用户添加的 Streamable HTTP MCP 服务接入对话，让模型能够按明确的协作协议请求所需上下文和工具能力。

[项目介绍](https://yuczzzzz.github.io/c-harness/)

## 下载与安装

[前往 GitHub Releases 下载最新版本](https://github.com/yuczzzzz/c-harness/releases)。每个版本提供可安装的 Chrome 扩展 ZIP，以及 ZIP 和 TAR.GZ 格式的源码归档。

1. 下载最新版本的 `c-harness-*-chrome.zip`。
2. 将 ZIP 完整解压到一个固定目录。
3. 在 Chrome 地址栏打开 `chrome://extensions`，开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择刚才解压的目录。

更新版本时，请下载新的扩展 ZIP 并解压到固定目录，再回到扩展管理页重新加载。Chrome 不支持直接安装此 ZIP，请勿在未解压的情况下选择安装包。

## 当前功能

### Skill 导入与管理

- 从 ZIP 包导入包含 `SKILL.md` 和可选 `references/` 的 Skill。
- 在扩展管理页查看、搜索、覆盖和删除已导入的 Skill。
- 可全局启用或停用 Skill 功能；停用不会删除已经导入的 Skill。
- Skill 保存在浏览器本地。启用 Skill 功能时，名称和简介目录会随 Harness 发送；`SKILL.md` 和 Reference 正文只在当前对话明确请求后发送给网页大模型。

### 渐进式披露

- 发起增强对话时只向模型提供 Skill 的名称和简介，而不是一次性注入全部内容。
- 模型先通过显式命令读取需要的 `SKILL.md`，再按 Skill 指引读取具体 Reference。
- 已成功提供的 Skill 和 Reference 会记录为当前网站会话的工具知识，内容未变化时无需在后续问题中重复发送。

### 通用设置

- 可配置自动回注延迟的最小值和最大值，范围为 `1` 至 `60` 秒，默认区间为 `1–3` 秒，用于模拟更接近真人操作的回复间隔。
- 扩展在每次适用的自动回注前，从闭区间内独立抽样一个整数秒；首次 Harness 和 MCP 确认后的反馈不延迟。
- 等待回注期间停止生成、切换对话或销毁页面运行时，会取消尚未发送的回注。

### MCP 服务

- 用户可以添加、检测、查看和删除无鉴权 Streamable HTTP MCP 服务。
- 发起增强对话时只披露 MCP 服务目录；模型需要先请求服务详情，才能按 Tool 名称和结构化参数请求调用。
- MCP Tool 调用默认需要用户确认；用户可选择仅允许本次调用，或信任当前目标网站会话中的该服务。会话信任仅在服务详情未变化时免于重复确认。
- MCP Tool 返回 `structuredContent` 时，扩展优先将其序列化为 YAML 回填；没有结构化结果时继续回填纯文本结果。

### 本地开发环境 MCP

- 本地文件读写、命令执行和项目构建等能力由用户自行启动并添加的本地开发环境 MCP 提供，实际权限和结果以该服务为准。
- 受支持服务命中初始化信息中的 `serverName` 后，Harness 会在文件、本地、工作区、文件目录和本地 Skill 场景提示模型优先使用该服务；同时启用 Skill 时，模型会先确认 Skill 来源。
- 多个服务命中当前支持列表时，Harness 按 `serverTitle` 选择首项；没有标题的服务排在后面，同标题再按 `serviceId` 排序。MCP 管理页会显示所有命中服务及当前选择，方便核对。

当前支持的本地开发环境 MCP：

- [CodexPro](https://github.com/rebel0789/codexpro)（`serverName` 为 `codexpro`，忽略大小写）

希望支持其他本地开发环境 MCP？请通过 [GitHub Issue](https://github.com/yuczzzzz/c-harness/issues/new) 提供服务名称、初始化返回的 `serverName` 和文档链接，或直接提交 [Pull Request](https://github.com/yuczzzzz/c-harness/compare)。列表外的 MCP 仍可添加和调用，但不会获得本地开发环境协作提示。

## 支持范围与局限

当前仅支持以下网站的 Chat 模式：

- [DeepSeek](https://chat.deepseek.com/)
- [Z.ai（GLM）](https://chat.z.ai/)

c-harness 目前是一款面向 Google Chrome 桌面版 114 及以上版本的本地扩展，不是通用浏览器自动化工具。它不会从自然语言中猜测命令，只解析 Harness 约定的显式围栏命令。

c-harness 只负责网页版大模型 Chat 模式与 Skill、MCP 之间的 Agent Loop，本身不提供本地文件读写、命令行执行或项目构建能力。若任务需要这些能力，应连接由用户自行启动的受支持本地开发环境 MCP（例如上方列表中的 CodexPro）；实际能力、访问范围和执行结果均由相应 MCP 提供。扩展根据初始化返回的 `serverName` 识别受支持服务，而不是根据地址或服务 ID 推断。

同样由于浏览器扩展没有独立的 Python、Node.js 或 Shell 开发运行环境，部分 Skill 自带的 Python/JavaScript 辅助脚本暂不支持执行。当前更适合导入以 `SKILL.md` 和文本 Reference 为主的 Skill；如果某个 Skill 的使用流程依赖脚本生成、解析、联网查询或调用本地工具链，这些步骤需要用户在扩展外部完成后，再将结果作为对话上下文提供。

总而言之，当前不支持以下功能
- 其他大模型网站
- z.ai 的 Agent 模式
- 需要鉴权的 MCP 服务
- 扩展直接读写任意本地目录、执行命令行工具、脚本或项目构建

需要本地开发环境能力时，请通过 MCP 功能连接相应服务，并根据服务的权限与安全说明谨慎确认每次调用。

## 本地开发

环境要求：Node.js 22.18.0 及以上、23 以下版本，以及 pnpm 11.10.0。

```bash
pnpm install
pnpm dev
```

执行自动化验证：

```bash
pnpm typecheck
pnpm test
pnpm build
```

构建完成后，可在 Chrome 的扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”，并加载 WXT 生成的 `.output/chrome-mv3` 目录。

## 后续计划

以下方向仍处于路线图阶段，尚未作为当前版本能力提供：

- 计划模式（Plan Mode）
- 定时任务
- 子代理(Sub Agent)
- 多智能体（Multi Agent）
- 更多网页版大模型与更完整的任务工作流

具体范围和实现顺序将分别经过设计、验证后确定。

## 许可证

本项目采用 [MIT License](LICENSE)，版权归作者 yuczzzzz 所有。

隐私与数据处理说明请参阅 [隐私政策](PRIVACY.md)。
