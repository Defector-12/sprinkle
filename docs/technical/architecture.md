# Context Reader 工程接手手册

> 技术栈：WXT 0.20 / React 19 / TypeScript 7 / Vitest 4 / MV3
> 运行要求：Node.js 22.13+，pnpm 11
> 当前基线以 `main` 分支和 `pnpm check` 结果为准，不在文档中维护易过期的 commit 与测试数量。

本文是后续 Agent 的工程入口。产品行为以 [产品基线](../product/mvp-prd.md) 为准；README 用于安装和运行，不应承载架构决策。

## 1. 系统总览

```text
Browser Action
  -> Content Script (isolated world)
       -> 标准 div Shadow host
       -> FloatingAssistant
       -> 页面解析 / 划词 / 点图 / 框选
       -> runtime message
            -> Background Service Worker
                 -> PageContext 编排
                 -> storage.session
                 -> storage.local
                 -> DeepSeek Chat Completions

FloatingAssistant
  -> study.html?tabId&url
       -> StudyWorkspace
            -> 重建文章 + 同一 PageContext 对话

FloatingAssistant / StudyWorkspace
  -> library.html
       -> HistoryLibrary
            -> 本地学习记录 / 搜索 / 删除 / 继续提问
```

没有 Side Panel、业务服务端、账号系统或数据库服务。所有敏感配置和数据都在用户浏览器中。

## 2. 入口与职责

### `entrypoints/content.ts`

- 匹配所有 HTTP/HTTPS 页面，在 `document_idle` 挂载休眠助手。
- 工具栏消息到达前不解析正文。
- 承担 DOM 提取、选区定位、页面图片引用和可见区域裁剪。
- UI 使用标准 `div` 作为 closed Shadow host。不要改回未注册自定义标签，否则 Reddit 的 `:not(:defined)` 会将整个插件设为 `visibility: hidden`。
- 通过模块内私有事件打开 React 助手，严禁恢复为网页可伪造的公开 `window` 事件。

### `entrypoints/background.ts`

- 唯一的页面上下文、问答、模型、归档和标签页生命周期编排器。
- 工具栏点击先向 Content Script 发消息；未注入时使用 `browser.scripting.executeScript` 补注入。
- 所有异步解析和回答都用 `pageKey + generation` 校验，过期结果不得覆盖新页面。
- 同一页面只允许一个回答请求进行。
- 模型请求只从这里发出。

### 扩展页面

- `study.html`：绑定不可变 `tabId + URL`，不依赖当前活动标签页。
- `library.html`：只通过 Background 访问归档，不直接读取业务存储。
- `options.html`：保存 DeepSeek API Key、学习记录开关和清除操作。

## 3. 核心数据与身份

### 页面身份

```text
pageKey = tabId + ":" + normalizePageUrl(url)
```

`normalizePageUrl`：

- 移除普通 hash，保留 `#/...` 和 `#!/...` 路由。
- 移除 `utm_*`、`fbclid`、`gclid`、`mc_cid`、`mc_eid`、`ref_src`。
- 保留并排序其他查询参数。
- 非根路径去掉末尾 `/`。

### `PageContext`

核心字段：

```text
tabId / url / normalizedUrl / title
status
article
focus
messages
conversationCheckpoint
warning / updatedAt
```

实际状态：

```text
unactivated -> parsing -> ready | partial | failed
ready | partial -> answering -> ready | partial
```

- session 与归档写操作共享串行队列；PageContext 的局部字段更新必须通过仓储的原子 `update`，整状态替换必须先校验 generation，避免旧快照覆盖并发变更。
- `answering` 是可恢复的临时状态；service worker 重启后会将未完成问题标记为失败并恢复到可提问状态。

### 文章结构

`ArticleDocument` 包含：

- `blocks`：heading / paragraph / code / list / quote
- `images`
- 可选 `tables`
- 可选 `formulas`
- `isPartial`
- 可选 `diagnostics`

旧 session 可能缺少表格、公式、标题层级或媒体位置；新增字段必须保持可选或提供回退。

## 4. 关键数据流

### 4.1 激活与解析

1. 工具栏点击发送 `assistant:open`。
2. 悬浮助手立即打开并调用 `context:activate`。
3. Background 写入 `parsing`，再请求 Content Script 执行 `extractArticle`。
4. 提交结果前重新校验 generation 和标签页 URL。
5. 根据 `article.isPartial` 写入 `ready` 或 `partial`。

页面刷新不自动重解析。用户再次点击工具栏才刷新正文；学习记录的“继续提问”是另一个明确授权入口。

### 4.2 正文提取

根节点优先级：

```text
article -> main -> [role="main"] -> body
```

- 同级候选按过滤噪声后的可读文本量选择。
- 语义节点不足、命中特定长文容器或存在大量未捕获文字时，补采 `div/span/strong/b` 叶子文本。
- 保留代码换行、`br`、列表边界和 `h2+` 多级章节路径。
- 表格转为单元格结构；MathML 经过白名单净化；图片/SVG/Canvas 记录插入位置。
- 加载态或可读内容不足 80 字时标记 `partial`。

不要直接保存或渲染任意原站 HTML。

### 4.3 问答上下文

1. `articleContentBlocks` 将正文、图片说明、表格和公式合成有序块。
2. `createArticleChunks` 生成不跨章节的结构感知检索块：
   - 900 字符是软目标，1,200 字符是硬上限。
   - 普通正文依次尝试段落、完整句子、分句标点、空白和字符边界。
   - 代码优先按行，列表优先按项，表格优先按行；跨块表格重复标题和表头。
   - 非重叠分片使用唯一 `block-part` ID，不在索引阶段增加固定重叠。
3. `assembleQuestionContext` 在文章证据、会话检查点与对话原文共享的 64,000 字符预算内编排请求：
   - 文章自身可放入预算时，按原文顺序发送全文，剩余空间交给对话原文。
   - 会话检查点存在且需要使用时先扣除其字符数；它可能使接近上限的文章进入检索路径。
   - 超出预算时进入多路融合；引用只作为高优先级锚点，不再成为检索边界。
4. 多路融合同时生成以下候选：
   - 引用锚点及同章节邻近窗口，最多 3 个并优先保留。
   - 引用、引号/反引号短语和 API 标识符使用本地字面子串精确匹配，RRF 权重 1.5。
   - 使用原问题、引用文字、Planner 改写和子查询进行全文 BM25。
   - 每个 Planner 证据需求独立召回，确保不同事实面都有机会进入上下文。
   - `document-wide` 按主要章节选择章节开头；剩余槽位优先补充未覆盖字符最多的长章节尾部和中部。
5. 候选使用 RRF 合并，按 `blockIds` 去重；先保留锚点，再覆盖各证据需求，最后按融合分数填满最多 8 个窗口。
6. 只有超出统一预算时才进入查询规划：
   - 规划请求包含文章标题、目录、最多 3,000 字符摘要、当前引用和最近 2 轮完整问答。
   - 模型返回独立问题、最多 4 个检索查询、最多 4 个证据需求、`focused / multi-section / document-wide` 覆盖范围和对话记忆需求。
   - 规划调用最长 10 秒；超时、接口失败或 JSON 无效时回退到原问题、引用和历史驱动的确定性融合。
7. `selectConversationMemory` 接收编排器分配的预算，返回最近原文、相关旧问答、遗漏轮次和需要检查点覆盖的旧前缀。
8. 历史回答属于低信任对话记忆，不能覆盖本轮文章证据；系统提示词显式要求冲突时以文章为准。
9. 当前引用可从悬浮窗或工作台取消；只有 Background 返回 `focus: null` 后 UI 才移除引用，历史消息中的引用快照不受影响。
10. `buildModelRequest` 将 system policy、文章证据和不受信任网页资料分离，并使用编排器选出的对话历史。
11. Background 在请求前写入用户消息，成功后写入回答并消费 focus。
12. 每条用户问题挂载 `QuestionTrace`，在初始编排、查询规划、最终请求、成功/失败和 service worker 中断恢复时原子更新。
13. `QuestionTrace` 记录提取统计、引用状态、精确匹配/章节覆盖来源、会话检查点状态、统一预算、规划请求与结果、最终 `ModelRequest` 文本、模型 ID 和响应状态；图片只记录数量与数据长度。

所有模型 system/user prompt 模板统一位于 `src/core/prompts.ts`；调用方不得内联新增模型指令。

预算内文章直接进入长上下文；超限文章通过 Planner 和多路 BM25 融合收敛。底层仍不是 embedding。

### 4.4 对话记忆

- 历史不超过 48,000 字符时完整发送。
- `ContextAssembler` 根据文章占用空间给历史分配预算；全文路径优先保留完整原文并把剩余空间交给历史，检索路径默认给历史 8,000 字符，Planner 明确需要对话时最多 16,000 字符。
- 超限后优先保留最近 6 轮完整原文，再召回相关旧问答；单轮无法放入预算时不截断或伪造原文。
- 剩余预算从更早历史中召回最多 6 轮相关问答。
- 只使用成功的完整问答对；预算选择不修改归档原文。
- 当旧前缀首次离开原文预算时，`conversation-checkpoint.ts` 调用现有模型生成结构化检查点，保存目标、当前主题、最多 30 个有序任务项、决策、用户约束和未解决指代。
- 检查点只增量处理上一检查点之后新离开窗口的成功问答，最长等待 10 秒；无效 JSON、超时或接口失败时保留上一份有效检查点并继续主请求。
- 检查点最多 4,000 字符，由应用代码写入 `throughMessageId` 和覆盖轮数；模型输出不能控制覆盖边界。
- 检查点作为独立 `<conversation_state>` 发送给 Planner 和回答模型，只用于恢复意图与进度，不能作为文章事实。
- 后台顺序固定为：初步编排 -> 必要时生成/更新检查点 -> 重新编排 -> 必要时 Planner -> 最终编排 -> 回答请求。
- 任何请求只使用同一规范化 URL 的历史。

### 4.5 图片与截图

- 本地图片：JPEG/PNG/GIF/WebP，最大 5 MB，读为 data URL。
- 页面图片和区域：调用 `captureVisibleTab`，按 `visualViewport` 映射裁剪，最长边收敛到 1,600px。
- 截图前后校验活动标签页未变化。
- 页面截图只覆盖当前可见视口。
- 图片引用只用于当前一问；长期归档移除 `imageUrl`，只留类型、章节和说明。

## 5. 存储

### `browser.storage.session`

- 键：`context-reader:context:{tabId}:{normalizedUrl}`
- 保存完整 `PageContext`，包括正文、focus、临时对话和可选会话检查点。
- `QuestionTrace` 随问题保存在临时对话中，每页只保留最近 10 次详细诊断。
- 标签页关闭时按 `tabId` 删除全部上下文。

### `browser.storage.local`

- `context-reader:settings`：API Key、`retainConversations`
- `context-reader:conversation:{normalizedUrl}`：V2 问答归档
- 长期归档会主动剥离 `QuestionTrace`，不保存证据原文或模型请求。
- 长期归档不保存会话检查点；从归档继续提问时按需重新生成。
- 归档按 URL 串行写入，按问题 ID 合并完整问答对。
- V1 数据读取时兼容，下一次写入升级。
- 代码按 10 MB 配额显示使用量和 80% 警告，不自动删除旧记录。

删除归档时必须同步清理匹配 session 中的消息，避免关闭标签页后重新写回。

## 6. 模型接口

构建变量：

```text
VITE_MODEL_API_URL=https://api.deepseek.com/chat/completions
VITE_MODEL_ID=deepseek-flash
```

- 用户只提供一个 DeepSeek API Key。
- OpenAI-compatible Chat Completions，`stream: false`。
- 文字使用字符串；图片使用 `image_url`。
- 最终回答使用 45 秒 `AbortController` 超时；可降级的查询规划和会话检查点生成使用 10 秒超时。
- UI 的逐字效果是完整响应后的客户端动画，不是真正 SSE。
- `AnswerModel = 'deepseek' | 'doubao'` 中的 Doubao 只用于旧归档展示。

不要把 API Key 放入 `.env`、源码、测试、日志或模型消息。

## 7. 安全不变量

后续改动必须保持：

- 页面默认休眠；不允许页面脚本主动启动插件。
- Content Script 不得读取 API Key。
- Background 是唯一模型调用方。
- 网页标题、URL、正文一律按不受信任数据处理。
- Markdown 禁止原始 HTML 和远程图片；外链新标签打开。
- MathML 只允许白名单元素和属性。
- 截图必须由用户显式触发，并校验来源标签页。
- `host_permissions: ['<all_urls>']` 不得移除；这是扩展工作台截图的 API 要求。
- 清除、停用、跳转或并发请求后，过期异步结果不得回写。

## 8. 模块导航

| 模块 | 主要职责 |
| --- | --- |
| `src/application/ports.ts` | UI 与 runtime adapter 的稳定能力契约 |
| `src/application/assistant-problems.ts` | 助手问题模型与错误映射 |
| `src/application/serial-task-queue.ts` | session/local 存储写操作串行化 |
| `src/core/prompts.ts` | 回答、翻译、查询规划 prompt 的唯一管理入口 |
| `src/core/article-extractor.ts` | DOM 解析、结构恢复、诊断 |
| `src/core/selection-focus.ts` | 判断划词目标是否为章节标题并保留原始标题层级 |
| `src/core/context-assembler.ts` | 全文、引用、检索证据和对话记忆的统一预算编排 |
| `src/core/retrieval.ts` | 结构感知切片、字面精确匹配、BM25、引用锚定和章节覆盖 |
| `src/core/query-planner.ts` | 查询改写触发、规划请求和结果校验 |
| `src/core/model-request.ts` | 提示词和模型消息 |
| `src/core/conversation-memory.ts` | 最近原文、相关旧问答和遗漏前缀选择 |
| `src/core/conversation-checkpoint.ts` | 结构化会话检查点请求、校验和增量边界 |
| `src/core/question-trace.ts` | 每轮提取、检索、记忆、请求和结果诊断 |
| `src/runtime/context-repository.ts` | session 上下文、local 归档 |
| `src/runtime/model-client.ts` | DeepSeek 请求、超时和错误 |
| `entrypoints/background.ts` | 全局编排与生命周期 |
| `entrypoints/content.ts` | 网页注入、解析、截图和快捷交互 |
| `FloatingAssistant.tsx` | 网页悬浮交互 |
| `StudyWorkspace.tsx` | 双栏阅读工作台 |
| `HistoryLibrary.tsx` | 学习记录 |

`background.ts`、`content.ts`、`FloatingAssistant.tsx`、`StudyWorkspace.tsx` 和 `article-extractor.ts` 都较大。优先抽离可单测的纯逻辑；不要同时重写状态机和 UI。

## 9. 已知技术债与历史兼容

- 默认模型是 DeepSeek 实验视觉型号，需关注官方替代型号和接口变更。
- 全文意图识别仍依赖关键词；查询改写可以缓解同义表达，但规划失败时仍会退回 BM25。
- 字面精确匹配和 BM25 仍是词法检索，不覆盖所有同义改写；只有超预算文章才调用 Planner。
- 章节感知覆盖是代表性采样，不是任意长度文章的完整摘要；完整总结需要独立 Map-Reduce 工作流。
- 会话检查点是模型生成的派生状态，可能发生进度漂移；原始完整问答始终是事实来源，诊断会暴露检查点使用和失败状态。
- 页面提取是启发式 DOM 解析，虚拟列表、iframe、Shadow DOM、PDF 和异步未加载内容可能不完整。
- 学习记录仍使用 `storage.local`，容量继续增长时应评估 IndexedDB 迁移。
- 没有真实 token 流式协议。
- 缺少稳定的跨站 E2E 测试；当前主要依赖组件测试、构建检查和手工加载扩展。
- 旧 Doubao 消息、V1 归档和缺失结构字段必须继续可读；不要因“清理死代码”直接删除兼容类型。

已修复但值得保留为回归经验：

- Content Script 原生 `fetch` 必须通过箭头函数保持调用上下文。
- 设置页只能由 Background 打开。
- 扩展 Shadow host 必须使用标准 HTML 元素，避免 Reddit 的 `:not(:defined)` 隐藏。
- 截图需要 `<all_urls>`，`activeTab` 不会跨到扩展工作台。
- 历史回答不能在初始化、刷新或跨视图同步时重新播放逐字动画。
- 明确引用必须优先于同名章节和旧回答。

## 10. 开发与交付

```bash
pnpm install
pnpm check
```

`pnpm check` 依次执行源码类型检查、测试类型检查、覆盖率测试和 Chrome/Edge 构建。当前覆盖率全局阈值均为 80%。

构建目录：

```text
.output/chrome-mv3
.output/edge-mv3
```

手工验收必须加载构建目录，不是仓库根目录；代码或 manifest 更新后，要在扩展管理页重新加载并刷新目标网页。

完成任务前：

1. 检查工作区，保留用户已有改动。
2. 为行为回归补最小测试，风险越高覆盖越广。
3. 运行 `pnpm check`；默认 shell 若是 Node 18，应切换到已有 Node 22，不要降低项目要求。
4. 对真实网页问题记录 URL、DOM 特征和可复现证据。
5. 更新本手册或产品基线中受影响的事实。
6. 用户要求提交时，提交后必须显式 push，并比较本地、`origin/main` 和远端 SHA。

## 11. 快速排障

- **点击插件无 UI**：查 `[data-context-reader-ui="assistant-root"]`、Shadow Root、dialog、计算样式和 `:defined`；Reddit 曾因未注册宿主标签被隐藏。
- **页面部分读取**：先看诊断中的 root、可读字符、候选块、加载态、未匹配文本和 iframe/Shadow DOM。
- **回答串章节**：检查 focus 的多级 section、选中的 article chunks，以及请求是否误带旧历史。
- **全文只答前半段**：检查是否识别为 `whole`、选择片段数和 `contextTruncated`。
- **截图失败或错页**：检查 manifest `<all_urls>`、活动标签页和 `visualViewport` 坐标。
- **模型一直等待**：检查 45 秒超时、HTTP 状态和 Background 错误；UI 没有真正 SSE。
- **历史被删除后又出现**：检查 session 消息是否与 local 归档同时清理。
