# Context Reader MVP 技术方案

## 1. 技术目标

在不建设账号、计费和业务服务端的前提下，实现一个 Chrome / Edge Manifest V3 插件：

- 网页默认保持休眠；只有用户点击工具栏图标后才解析页面并显示悬浮助手。
- 页面正文和对话上下文按标签页与 URL 隔离。
- 选中文字可以与文章相关片段组成文本问题。
- API Key 不进入网页上下文。
- 页面关闭后清理临时正文。

## 2. 运行时结构

```text
Browser Action
  -> tabs.sendMessage("assistant:open")
       -> Content Script + Shadow DOM
            -> Floating Assistant (React)
            -> runtime message("context:activate")
            -> article extraction
            -> text selection
            -> runtime message
                 -> Background Service Worker
                      -> storage.session: PageContext
                      -> storage.local: Settings / optional messages
                      -> Model API
```

### Floating Assistant

- 未启用页面渲染为空，不读取页面内容。
- 工具栏点击后展开卡片并显式进入页面理解流程；收起后以 48px 悬浮球靠边显示。
- 展示未配置 API Key、理解中、已就绪、回答中和失败状态。
- 悬浮球可拖动；展开后的对话卡片可通过标题区移动位置，并通过持续可见的底角缩放柄或键盘调整整体尺寸。
- 基于 `visualViewport` 约束悬浮球和卡片，浏览器缩放后自动回收到可见区域。
- 通过 Shadow DOM 隔离网页样式，并阻止交互事件冒泡到宿主页面。
- 不直接访问 API Key，也不直接请求模型。

### Content Script

- 只运行在 HTTP / HTTPS 页面。
- 在 `document_idle` 阶段挂载休眠的悬浮助手，但不请求页面解析。
- 只有已启用页面才开放轻量文字快捷入口。
- 将选择结果发送给 Background，不持久化数据。

### Background Service Worker

- 是页面上下文、模型请求和存储清理的唯一编排入口。
- 优先根据消息发送者识别页面，避免标签切换时串用活动标签页。
- 从 Content Script 获取页面结构与选择结果。
- 从扩展本地存储读取 API Key，并直接请求模型。
- 监听标签页关闭事件并清除对应临时上下文。

## 3. 页面身份与生命周期

### 页面键

```text
pageKey = tabId + ":" + normalize(url)
```

URL 规范化规则：

- 移除 hash。
- 移除 `utm_*`、`fbclid`、`gclid`、`mc_cid`、`mc_eid`、`ref_src`。
- 保留并排序其他 query 参数。
- 非根路径移除末尾 `/`。

### 生命周期

```text
UNACTIVATED
  --browser action--> PARSING

PARSING
  -> READY | PARTIAL | FAILED

READY | PARTIAL
  -> ANSWERING
  -> READY | PARTIAL

ANY ACTIVE STATE
  --stop understanding--> UNACTIVATED
```

- 新 URL 只创建 `UNACTIVATED` 上下文，不读取 DOM。
- 返回同一标签页内的旧 URL 时恢复已有上下文。
- 页面刷新不会自动重新解析；再次点击工具栏图标才刷新页面理解结果。
- 标签页关闭后删除该标签页的全部 `PageContext`。

## 4. 页面解析

解析优先级：

```text
article -> main -> [role="main"] -> body
```

提取内容：

- `h1` 至 `h6`
- `p`
- `pre`
- `blockquote`
- `ul` / `ol`

过滤内容：

- `nav`
- `footer`
- `aside`
- `form`
- `[role="navigation"]`
- `[aria-hidden="true"]`

提取到的可读文字总长度小于 80 个字符时标记为 `PARTIAL`。这表示提取器没有获得足够正文，不一定意味着原页面本身很短。

每次提取同时记录不含正文的诊断指标：

- 选中的正文根节点类型。
- 可读字符数与完整读取阈值。
- 候选、接受、过滤和空内容块数量。
- 页面中的多个 `article`、iframe、Canvas、表格和 Shadow DOM 信号。
- 页面是否仍存在加载态标记。

`PARTIAL` 状态提供三级排查入口：对话页轻量入口、诊断概览、单项原因详情。诊断页可以返回对话或显式重新理解页面，不会自动发送模型请求。

## 5. 检索与模型请求

### 片段构建

- 按章节和最大字符数切分文章。
- 标题与正文保留在同一章节片段中。
- 不生成向用户展示的原文出处信息。

### 相关性排序

当前 MVP 使用本地轻量检索：

- 问题词重合权重：70%
- 当前选中内容重合权重：30%
- 支持英文词和中文双字片段

模型确定后，可以在不改变上层接口的前提下替换为向量或混合检索。

### 回答约束

系统提示词要求：

- 优先依据当前文章语境。
- 文章不足时才使用通用知识补充。
- 不展示原文出处、段落编号、引用卡片或跳转位置。
- 信息不足时明确说明，不将推断写成文章结论。

## 6. 模型接口

实现侧通过以下公开构建变量固定单一模型：

```text
VITE_MODEL_API_URL
VITE_MODEL_ID
```

用户设置只包含 API Key。当前客户端采用 OpenAI-compatible Chat Completions 结构：

```json
{
  "model": "<fixed model>",
  "messages": [],
  "stream": false
}
```

当前固定模型只支持文本消息，`VITE_MODEL_SUPPORTS_VISION=false` 时界面隐藏图片工具，运行时也会阻止图片请求。模型未配置、API Key 缺失、网络错误、HTTP 错误和无效响应均转化为明确的产品错误。

## 7. 存储

### `browser.storage.session`

保存：

- 页面状态
- 解析后的正文块
- 当前选择内容
- 当前页面消息

浏览器会话结束后自动失效，标签页关闭时主动按 `tabId` 删除。

### `browser.storage.local`

保存：

- API Key
- 对话保留开关
- 用户主动选择保留的问答文本

不保存：

- 文章全文
- 模型请求完整上下文

## 8. 安全边界

- Content Script 无权读取 API Key。
- API Key 不进入 DOM、普通日志、模型消息和对话归档。
- 模型请求只从 Background 发出。
- 页面理解只由用户点击工具栏图标触发，并且只发生在浏览器本地。
- 用户发送问题后才调用模型 API；Content Script 只能获得“是否已配置 Key”的布尔状态。
- 清除当前上下文时，同时删除该 URL 的本地对话归档。

## 9. 验证策略

- Core：URL、解析、检索、上下文状态和模型请求单元测试。
- Runtime：session/local 存储与模型错误边界测试。
- UI：休眠默认态、显式启用、状态面板、选词展开、窗口缩放、浏览器缩放回收、发送问题、Esc 收起和设置保存组件测试。
- Build：Chrome MV3 和 Edge MV3 双构建。
- Manual：解压扩展加载、休眠页面不读取、工具栏显式启动、状态切换、选中文字、窗口缩放与悬浮卡片问答。
