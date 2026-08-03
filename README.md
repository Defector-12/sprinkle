# Context Reader

Context Reader 是一个 Chrome / Edge Manifest V3 浏览器插件。普通网页默认保持休眠；用户点击浏览器工具栏图标后，插件才在本地理解当前页面并显示悬浮助手。用户可以围绕全文或选中文字就地提问，不同标签页与页面的上下文彼此隔离。

## 当前能力

- 工具栏点击后读取当前网页的标题、章节、段落、列表和代码块
- 未启用页面不读取内容、不显示悬浮球
- 显示理解中、已就绪、缺少 API Key、回答中和失败状态
- 部分读取时提供按需打开的结构诊断、原因详情和重新理解入口
- 支持 X Article 及使用 `div/span` 渲染的 React 长文正文回退提取
- 选中文字后通过页面内快捷按钮发起提问
- 支持点选、双击引用页面图片，以及自由框选可见页面区域提问
- 点击悬浮球或工具栏图标展开网页内对话卡片
- 支持拖动悬浮球、移动及缩放整个对话框，并可显式停止理解当前页面
- 基于相关文章片段和连续对话构建模型请求
- 纯文本问题默认使用 DeepSeek，引用图片时自动切换 Doubao
- 不展示原文出处、引用卡片或定位入口
- 按 `tabId + 规范化 URL` 隔离和恢复页面上下文
- 标签页关闭后清除正文和临时上下文
- 可选地在本地保留问答文本
- DeepSeek 与 Doubao 分别使用用户提供的 API Key

## 技术栈

- WXT 0.20
- React 19
- TypeScript 7
- Vitest 4
- Manifest V3 Content Script + Shadow DOM

## 本地开发

要求 Node.js 20.12+ 和 pnpm。

```bash
pnpm install
pnpm dev
```

模型实现配置通过本地环境变量提供：

```bash
VITE_MODEL_API_URL=https://api.deepseek.com/v1/chat/completions
VITE_MODEL_ID=deepseek-v4-flash
VITE_VISION_MODEL_API_URL=https://ark.cn-beijing.volces.com/api/v3/responses
VITE_VISION_MODEL_ID=doubao-seed-2-0-mini-260428
```

这些值会进入浏览器扩展包，只能用于公开的接口地址和模型标识。两个 API Key 都不得写入环境变量或源码，由用户在扩展设置页分别输入。

## 构建与加载

```bash
pnpm build
pnpm build:edge
```

构建目录：

- Chrome：`.output/chrome-mv3`
- Edge：`.output/edge-mv3`

在 `chrome://extensions` 或 `edge://extensions` 中启用开发者模式，然后选择“加载已解压的扩展程序”并指定对应构建目录。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check
```

覆盖率门槛应用于可确定性测试的核心逻辑、会话存储和模型边界。浏览器 entrypoints 通过 Chrome / Edge 构建与解压扩展加载进行验证。

## 隐私边界

- 页面加载后保持休眠；只有用户点击工具栏图标才在本地读取正文。
- 页面理解本身不会调用模型 API，只有用户发送问题才会请求模型。
- DeepSeek 与 Doubao API Key 只保存在 `browser.storage.local`。
- 页面正文只进入 `browser.storage.session`。
- 标签页关闭后，删除对应的临时页面上下文。
- 开启“保留对话记录”后，只归档问答文本。

## 目录

```text
entrypoints/
  background.ts       后台上下文与模型编排
  content.ts          页面解析、选词入口与悬浮助手挂载
  sidepanel/          保留的开发回退界面，不再由工具栏打开
  options/            API Key 与隐私设置
src/
  components/         React 界面
  core/               解析、检索、提示词和上下文状态
  runtime/            存储、模型客户端与浏览器桥接
docs/product/         MVP PRD
tests/                核心、运行时和组件测试
```

## 当前限制

- 正式使用前必须确定并配置具体模型 API。
- DeepSeek 使用 OpenAI-compatible Chat Completions，Doubao 使用 Ark Responses API。
- 不支持 PDF、视频、iframe 内容和跨文章联合问答。
- 图片与区域框选基于当前可见页面截图，不支持截取视口之外的内容。
