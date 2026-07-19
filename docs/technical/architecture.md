# Context Reader MVP 技术方案

## 1. 技术目标

在不建设账号、计费和业务服务端的前提下，实现一个 Chrome / Edge Manifest V3 插件：

- 用户按页面手动启用。
- 页面正文、图片和对话上下文按标签页与 URL 隔离。
- 文本、图片和区域截图可以组成多模态问题。
- API Key 不进入网页上下文。
- 页面关闭后清理临时正文、图片和截图。

## 2. 运行时结构

```text
Browser Action
  -> Side Panel (React)
       -> runtime message
          -> Background Service Worker
               -> storage.session: PageContext
               -> storage.local: Settings / optional messages
               -> Model API
               -> tabs.sendMessage
                    -> Content Script
                         -> article extraction
                         -> text selection
                         -> image selection
                         -> region capture
```

### Side Panel

- 展示当前页面状态和独立对话。
- 触发读取、提问、图片选择、区域框选和清除操作。
- 不直接访问 API Key，也不直接请求模型。

### Content Script

- 只运行在 HTTP / HTTPS 页面。
- 接到读取命令后解析 DOM，不在页面未启用时预先提取正文。
- 注入轻量文字快捷入口、图片选择状态和区域框选层。
- 将选择结果发送给 Background，不持久化数据。

### Background Service Worker

- 是页面上下文、模型请求和存储清理的唯一编排入口。
- 从 Side Panel 获取当前活动标签页。
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
  -> PARSING
  -> READY | PARTIAL | FAILED

READY | PARTIAL
  -> ANSWERING
  -> READY | PARTIAL
```

- 新 URL 自动创建 `UNACTIVATED` 容器。
- 返回同一标签页内的旧 URL 时恢复已有上下文。
- 已启用页面刷新后自动重新解析，并保留消息。
- 未启用页面刷新后仍保持未启用。
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
- `img`、`alt`、`figcaption` 和相邻内容

过滤内容：

- `nav`
- `footer`
- `aside`
- `form`
- `[role="navigation"]`
- `[aria-hidden="true"]`

文本总长度小于当前阈值时标记为 `PARTIAL`，允许提问但显示上下文不完整提示。

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

接口支持文本消息和 `image_url` 多模态内容。模型未配置、API Key 缺失、网络错误、HTTP 错误和无效响应均转化为明确的产品错误。

## 7. 存储

### `browser.storage.session`

保存：

- 页面状态
- 解析后的正文块
- 图片元信息
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
- 图片
- 区域截图
- 模型请求完整上下文

## 8. 安全边界

- Content Script 无权读取 API Key。
- API Key 不进入 DOM、普通日志、模型消息和对话归档。
- 模型请求只从 Background 发出。
- 页面未启用前不执行正文提取。
- 清除当前上下文时，同时删除该 URL 的本地对话归档。

## 9. 验证策略

- Core：URL、解析、检索、上下文状态和模型请求单元测试。
- Runtime：session/local 存储与模型错误边界测试。
- UI：手动启用、发送问题、设置保存、无出处 UI 和失败重试组件测试。
- Build：Chrome MV3 和 Edge MV3 双构建。
- Manual：解压扩展加载、真实网页解析、选中文字、图片选择和区域截图。
