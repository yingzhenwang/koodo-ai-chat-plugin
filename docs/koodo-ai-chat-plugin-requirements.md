# Koodo Reader AI 阅读助手 — 需求文档 v2

> **目标**：Fork Koodo Reader，新增 AI 阅读助手侧边栏，让用户使用自己的 API Key 调用 LLM，结合书籍上下文（书名、章节、附近内容、选中文字）进行自由提问和多轮对话。

---

## 1. 项目背景

### 1.1 Koodo Reader 简介

- **仓库地址**：`https://github.com/koodo-reader/koodo-reader`
- **技术栈**：React + TypeScript + JavaScript，桌面端基于 Electron
- **构建工具**：Webpack，包管理用 yarn
- **开源协议**：AGPL-3.0（fork 后必须保持同一协议开源）
- **开发启动**：
  ```bash
  git clone https://github.com/koodo-reader/koodo-reader.git
  cd koodo-reader
  yarn
  yarn dev   # Electron 桌面模式
  ```

### 1.2 现有 AI 功能的局限

- 现有 AI 功能（翻译、词典、问书/Chat）**全部依赖官方后端 API**，需要 Pro 付费账户
- 插件系统仅覆盖 `translation` 和 `dictionary` 两种类型，**没有自定义 AI 聊天插件**
- 即使是官方 AI 助手，也只传入选中文字，**不注入书名、章节、附近内容等阅读上下文**

### 1.3 目标

新增 `"assistant"` 类型插件 + AI 聊天侧边栏，让用户：
1. 使用自己的 API Key 调用 LLM
2. AI 自动获取丰富的阅读上下文（书名、章节、附近内容、选中文字）
3. 在阅读过程中自由提问、多轮对话

---

## 2. 现有架构分析

### 2.1 目录结构（关键路径）

```
src/
├── components/
│   └── popups/
│       ├── popupTrans/       # 翻译弹窗（参考实现）
│       ├── popupDict/        # 词典弹窗（参考实现）
│       ├── popupAssist/      # 官方 AI 助手弹窗（参考但需改造）
│       └── popupMenu/        # 选中文字后的右键菜单
├── containers/
│   ├── lists/navList/        # 左侧导航（含翻译/词典/问书 tab 切换）
│   └── panels/operationPanel/ # 操作面板
├── assets/locales/           # 国际化文件 (en/, zh-CN/, ...)
└── ...
```

### 2.2 插件系统架构

插件存储在本地数据库的 `plugins` 表中：

```typescript
interface Plugin {
  identifier: string;
  type: string;              // "translation" | "dictionary" | "assistant"（新增）
  displayName: string;
  icon: string;
  version: string;
  config: Record<string, string>;
  script: string;            // JavaScript 代码字符串
  // ...其他字段
}
```

**插件执行机制**：通过 `eval()` 执行 `script` 字段中的 JS 代码。

### 2.3 现有弹窗组件模式

所有弹窗组件遵循统一模式：
1. Redux `connect` 获取 props：`originalText`、`plugins`、`isAuthed`
2. `ConfigService` 读写用户偏好
3. `DatabaseService` 的 `plugins` 表加载/保存插件
4. `navList` 中的 tab 切换显示不同弹窗

---

## 3. 功能需求

### 3.1 核心功能：AI 阅读上下文系统

这是本项目与普通 AI 聊天的核心差异点。AI 不是只看到选中的文字，而是理解用户正在读什么。

#### 3.1.1 上下文组成（Context）

AI 每次请求时，system prompt 自动注入以下结构化上下文：

| 上下文项 | 来源 | 行为 |
|---------|------|------|
| **书名 + 作者** | 书籍元数据 | 始终包含 |
| **当前章节名** | 目录/导航信息 | 始终包含，翻页/换章时自动更新 |
| **选中文字** | 用户选中操作 | 选中时包含，作为对话锚点 |
| **附近内容** | 选中文字前后各 100 字 | 选中时包含，提供语境 |

**System Prompt 模板**（默认，用户可自定义）：

```
你是一个阅读助手。

用户正在阅读：
- 书名：{bookTitle}
- 作者：{bookAuthor}
- 当前章节：{chapterTitle}

{如果有选中文字：}
用户选中了以下文字：
---
{selectedText}
---

附近内容（前后各 100 字）：
---
{surroundingText}
---

请基于以上阅读上下文回答用户的问题。回答要简洁、准确、有帮助。
```

#### 3.1.2 上下文自动跟随

- 翻页/换章时，书名和章节名自动更新到最新位置
- 对话历史保留，直到用户手动清除
- 选中新文字时，附近内容更新，但不清除之前的对话
- 侧边栏顶部显示当前上下文摘要（书名 · 章节），让用户知道 AI 看到了什么

### 3.2 插件配置界面

在设置中新增 "AI 助手" 插件管理区域：

- **Provider 选择**：下拉列表
  - OpenAI（默认）
  - Anthropic (Claude)
  - DeepSeek
  - 自定义 OpenAI 兼容端点（Custom）
- **API Key 输入框**：密码类型，本地存储
- **API Base URL**：根据 Provider 自动填充，可手动修改
  - OpenAI: `https://api.openai.com/v1/chat/completions`
  - Anthropic: `https://api.anthropic.com/v1/messages`
  - DeepSeek: `https://api.deepseek.com/v1/chat/completions`
  - Custom: 用户自填
- **Model**：文本输入，默认值随 Provider 切换
  - OpenAI: `gpt-5.4-mini`
  - Anthropic: `claude-sonnet-4-20250514`
  - DeepSeek: `deepseek-chat`
- **System Prompt**：可选，多行文本框，支持 `{bookTitle}` `{bookAuthor}` `{chapterTitle}` `{selectedText}` `{surroundingText}` 模板变量
- **测试连接按钮**：发送 `messages: [{role: "user", content: "hi"}]` + `max_tokens: 1` 验证 API Key

### 3.3 AI 聊天侧边栏

#### 3.3.1 交互方式

**主入口**：右侧可展开/收起的侧边栏
- 通过左侧导航栏的 "AI 助手" tab 展开
- 选中文字 → 右键菜单 → "问 AI" 按钮也可展开并自动填入选中文字
- 收起时不占用阅读空间

#### 3.3.2 侧边栏 UI 布局

```
┌─────────────────────────┐
│ 📖 书名 · 当前章节    [×]│  ← 上下文摘要 + 收起按钮
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ "选中的文字..."    ▼ │ │  ← 选中文字（可折叠）
│ └─────────────────────┘ │
├─────────────────────────┤
│ [解释] [翻译] [总结]    │  ← 快捷 Prompt 按钮
│ [词义] [简化]           │
├─────────────────────────┤
│                         │
│  User: 这段话是什么意思  │  ← 消息流区域
│                         │
│  AI: 这段话讲的是...     │     用户消息靠右
│      blah blah blah     │     AI 消息靠左
│                         │     支持 Markdown 渲染
│                         │
├─────────────────────────┤
│ [输入问题...]    [发送]  │  ← 输入区
│                  [🗑️]   │     Enter 发送
│                         │     Shift+Enter 换行
└─────────────────────────┘     清除对话按钮
```

#### 3.3.3 快捷 Prompt

选中文字后显示，点击即发送：
- "解释这段话"
- "翻译成 [目标语言]"（目标语言跟随 Koodo 界面语言）
- "这个词在上下文中是什么意思？"
- "总结这段内容"
- "用更简单的语言解释"

### 3.4 API 调用实现

#### 3.4.1 Provider 抽象层

```typescript
// src/utils/aiProvider.ts

interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AIStreamCallback {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

interface AIProviderConfig {
  provider: "openai" | "anthropic" | "deepseek" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt?: string;
}

async function sendChatRequest(
  config: AIProviderConfig,
  messages: AIMessage[],
  callback: AIStreamCallback
): Promise<void>;
```

#### 3.4.2 Provider API 差异

| Provider | Auth Header | Request Body | Stream Format |
|----------|------------|-------------|---------------|
| OpenAI | `Authorization: Bearer {key}` | `{ model, messages, stream: true }` | SSE `data: {"choices":[{"delta":{"content":"..."}}]}` |
| Anthropic | `x-api-key: {key}` + `anthropic-version: 2023-06-01` | `{ model, messages, system, max_tokens, stream: true }` | SSE `event: content_block_delta` |
| DeepSeek | 同 OpenAI | 同 OpenAI | 同 OpenAI |
| Custom | 同 OpenAI | 同 OpenAI | 同 OpenAI |

**Streaming 实现注意事项**：
- SSE 解析需处理跨 chunk 的 `data:` 行拆分（维护 buffer）
- 实现 AbortController 支持中断请求
- 网络超时设置（30 秒无首 token 则报错）

#### 3.4.3 对话上下文管理

- 对话历史保存在组件 state 中（不持久化）
- 用户手动清除对话时重置
- 翻页/换章时 system prompt 中的上下文自动更新，但对话历史保留
- 每轮对话发送完整 messages 数组（system + 历史 + 新消息）

### 3.5 插件格式定义

```json
{
  "identifier": "openai-chat-plugin",
  "type": "assistant",
  "displayName": "OpenAI GPT",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "openai",
    "apiKey": "",
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-5.4-mini",
    "systemPrompt": ""
  }
}
```

注意：`assistant` 类型插件**不使用 `script` 字段**，API 调用由内置的 `aiProvider.ts` 处理，避免 `eval()` 带来的安全风险。

---

## 4. 技术实现方案

### 4.1 目标平台

**MVP 仅支持 Electron 桌面端**。Electron 环境无 CORS 限制，可直接调用外部 API。

Web 模式和移动端（iOS/Android）作为后续迭代。

### 4.2 需要新增的文件

```
src/
├── components/
│   └── aiAssistant/                    # 新增：AI 助手侧边栏
│       ├── component.tsx               # 主组件
│       ├── aiAssistant.css             # 样式
│       └── index.tsx                   # Redux connect
├── utils/
│   ├── aiProvider.ts                   # 新增：Provider 抽象层 + streaming
│   └── readingContext.ts               # 新增：阅读上下文收集器
└── ...
```

### 4.3 需要修改的文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/components/popups/popupMenu/` | 右键菜单新增 "问 AI" 按钮，点击展开侧边栏 |
| `src/containers/lists/navList/` | 左侧导航新增 "AI 助手" tab |
| `src/containers/panels/operationPanel/` | 集成 AI 侧边栏的展开/收起 |
| `src/assets/locales/en/translation.json` | 新增英文 i18n key |
| `src/assets/locales/zh-CN/translation.json` | 新增中文 i18n key |

### 4.4 实现步骤

1. **Step 1**：`readingContext.ts` — 实现从 Koodo 内部状态提取书名、作者、章节名、附近内容的工具函数
2. **Step 2**：`aiProvider.ts` — 实现 OpenAI 兼容 streaming 调用（含 Anthropic 适配）
3. **Step 3**：`aiAssistant` 侧边栏组件 — 包含上下文显示、消息流、输入框、快捷 Prompt
4. **Step 4**：集成到阅读界面 — 修改 PopupMenu、NavList、OperationPanel
5. **Step 5**：插件配置 UI — 在设置中支持 `assistant` 类型插件的添加和管理
6. **Step 6**：国际化 + 预置插件模板
7. **Step 7**：测试与调试

### 4.5 API Key 安全存储

- 存储在本地数据库 `plugins` 表 `config` 字段中
- 与现有插件（DeepL、Azure 等）使用相同的存储机制
- UI 上用 `<input type="password">` 显示
- 不经过任何远程服务器

---

## 5. UI/UX 设计要求

### 5.1 侧边栏样式

- 与现有翻译/词典面板视觉一致
- 支持暗色模式（跟随 Koodo 主题）
- 面板宽度可拖拽调整
- Markdown 渲染：粗体、斜体、代码块、列表
- 展开/收起动画平滑

### 5.2 加载状态

- 等待首个 token 时显示 "思考中..." 动画
- Streaming 时逐字显示
- 网络错误时显示错误提示 + 重试按钮

---

## 6. 国际化

需要添加的翻译 key（支持 en 和 zh-CN）：

```json
{
  "AI Assistant": "AI 助手",
  "Ask AI": "问 AI",
  "Type your question...": "输入你的问题...",
  "Send": "发送",
  "Clear conversation": "清除对话",
  "AI Provider": "AI 服务商",
  "API Key": "API 密钥",
  "API Base URL": "API 地址",
  "Model": "模型",
  "System Prompt": "系统提示词",
  "Test Connection": "测试连接",
  "Connection successful": "连接成功",
  "Connection failed": "连接失败",
  "Explain this": "解释这段话",
  "Translate to": "翻译成",
  "What does this mean in context?": "这在上下文中是什么意思？",
  "Summarize": "总结",
  "Explain in simpler terms": "用更简单的语言解释",
  "Add AI Plugin": "添加 AI 插件",
  "No AI assistant configured": "未配置 AI 助手",
  "Please add an AI assistant plugin first": "请先添加一个 AI 助手插件",
  "Thinking...": "思考中...",
  "Current context": "当前上下文"
}
```

---

## 7. 预置插件模板

插件管理页面提供 "一键添加" 按钮，用户只需填入 API Key：

### 7.1 OpenAI（默认推荐）

```json
{
  "identifier": "openai-chat-plugin",
  "type": "assistant",
  "displayName": "OpenAI GPT",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "openai",
    "apiKey": "",
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-5.4-mini"
  }
}
```

### 7.2 Anthropic Claude

```json
{
  "identifier": "anthropic-chat-plugin",
  "type": "assistant",
  "displayName": "Anthropic Claude",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "anthropic",
    "apiKey": "",
    "baseUrl": "https://api.anthropic.com/v1/messages",
    "model": "claude-sonnet-4-20250514"
  }
}
```

### 7.3 DeepSeek

```json
{
  "identifier": "deepseek-chat-plugin",
  "type": "assistant",
  "displayName": "DeepSeek",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "deepseek",
    "apiKey": "",
    "baseUrl": "https://api.deepseek.com/v1/chat/completions",
    "model": "deepseek-chat"
  }
}
```

### 7.4 自定义 OpenAI 兼容端点

```json
{
  "identifier": "custom-chat-plugin",
  "type": "assistant",
  "displayName": "Custom AI",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "custom",
    "apiKey": "",
    "baseUrl": "",
    "model": ""
  }
}
```

---

## 8. 不在本期范围内（Out of Scope）

- 对话历史持久化存储
- 多模态支持（图片输入）
- 整本书上下文注入（token 成本太高）
- 与 Koodo 官方 AI 服务的集成
- Web 模式支持
- 移动端（iOS/Android）适配
- Ollama 本地模型支持
- 自定义 Function Calling / Tool Use
- 插件市场 / 在线分发
- 用户自定义快捷 Prompt（使用内置预设）
- 附近内容范围可配置（MVP 固定前后各 100 字）

---

## 9. 验收标准

1. ✅ 用户可以在设置中添加 AI 助手插件（选择 Provider、填入 API Key、选择 Model）
2. ✅ 测试连接按钮可验证 API Key 有效性
3. ✅ 阅读时右侧有可展开/收起的 AI 助手侧边栏
4. ✅ 选中文字后右键菜单出现 "问 AI"，点击展开侧边栏并填入选中文字
5. ✅ AI 请求自动注入阅读上下文：书名、作者、章节名、选中文字、附近 100 字
6. ✅ 翻页/换章时上下文自动更新
7. ✅ 支持 streaming 逐字输出
8. ✅ 支持多轮对话，可手动清除
9. ✅ 快捷 Prompt 按钮可用（解释、翻译、总结、词义、简化）
10. ✅ 支持 3 个 Provider（OpenAI, Anthropic, DeepSeek）+ 自定义兼容端点
11. ✅ 支持中英文界面
12. ✅ 暗色模式下正常显示
13. ✅ Electron 桌面端可正常调用 API
14. ✅ API Key 存储在本地，不经过任何远程服务器

---

## 10. 参考资源

| 资源 | 链接 |
|------|------|
| Koodo Reader 仓库 | https://github.com/koodo-reader/koodo-reader |
| Koodo 插件文档 | https://www.koodoreader.com/en/plugin |
| Koodo 架构深度解析 (DeepWiki) | https://deepwiki.com/koodo-reader/koodo-reader |
| 翻译/词典插件架构 | https://deepwiki.com/koodo-reader/koodo-reader/4.6-translation-and-dictionary-services |
| AI 助手集成 | https://deepwiki.com/koodo-reader/koodo-reader/4.7-ai-assistant-integration |
| 插件系统 | https://deepwiki.com/koodo-reader/koodo-reader/7.4-plugin-system |
| 文字选择与上下文菜单 | https://deepwiki.com/koodo-reader/koodo-reader/4.1-text-selection-and-context-menus |
| OpenAI Chat API | https://platform.openai.com/docs/api-reference/chat |
| Anthropic Messages API | https://docs.anthropic.com/en/api/messages |
| DeepSeek API | https://platform.deepseek.com/api-docs |
