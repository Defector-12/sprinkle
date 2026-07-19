# Context Reader

Context Reader 是一个 Chrome / Edge Manifest V3 浏览器插件。用户手动启用当前技术文章后，可以围绕全文、选中文字、文章图片或框选区域直接提问。不同标签页与页面的上下文彼此隔离，返回原页面时恢复。

## 当前能力

- 手动读取当前网页的标题、章节、段落、列表、代码块和图片信息
- 选中文字后通过页面内快捷按钮发起提问
- 选择文章图片或框选可见区域
- 基于相关文章片段和连续对话构建模型请求
- 不展示原文出处、引用卡片或定位入口
- 按 `tabId + 规范化 URL` 隔离和恢复页面上下文
- 标签页关闭后清除正文、图片和截图
- 可选地在本地保留问答文本
- 单一视觉模型接口，用户自行提供 API Key

## 技术栈

- WXT 0.20
- React 19
- TypeScript 7
- Vitest 4
- Manifest V3 Side Panel API

## 本地开发

要求 Node.js 20.12+ 和 pnpm。

```bash
pnpm install
pnpm dev
```

模型实现配置通过本地环境变量提供：

```bash
VITE_MODEL_API_URL=https://provider.example/v1/chat/completions
VITE_MODEL_ID=vision-model
```

这两个值会进入浏览器扩展包，只能用于公开的接口地址和模型标识。API Key 不得写入环境变量或源码，由用户在扩展设置页输入。

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

- 页面未手动启用前，不提取正文或图片。
- API Key 只保存在 `browser.storage.local`。
- 页面正文、图片和截图只进入 `browser.storage.session`。
- 标签页关闭后，删除对应的临时页面上下文。
- 开启“保留对话记录”后，只归档问答文本。

## 目录

```text
entrypoints/
  background.ts       后台上下文与模型编排
  content.ts          页面解析、文字/图片/区域选择
  sidepanel/          文章问答侧边栏
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
- 当前模型客户端采用 OpenAI-compatible Chat Completions 请求结构。
- 不支持 PDF、视频、iframe 内容和跨文章联合问答。
- 区域框选只覆盖当前可见视口。
