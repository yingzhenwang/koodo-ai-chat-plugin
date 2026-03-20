# Koodo Reader 自定义 AI 聊天插件 — 需求文档

> **目标**：Fork Koodo Reader，新增一个「自定义 AI 聊天」插件类型，让用户可以选中文字后使用自己的 API Key 调用 LLM（OpenAI / Anthropic / DeepSeek / Ollama 等）进行自由提问和对话。

---

## 1. 项目背景

### 1.1 Koodo Reader 简介

- **仓库地址**：`https://github.com/koodo-reader/koodo-reader`
- **技术栈**：React + TypeScript + JavaScript，桌面端基于 Electron，支持 Web 部署
- **构建工具**：Webpack，包管理用 yarn
- **开源协议**：AGPL-3.0（fork 后必须保持同一协议开源）
- **开发启动**：
  ```bash
  git clone https://github.com/koodo-reader/koodo-reader.git
  cd koodo-reader
  yarn
  yarn dev   # 桌面模式（Electron）
  yarn start # Web 模式
  ```

### 1.2 现有 AI 功能的局限

Koodo Reader 已有的 AI 功能（翻译、词典、问书/Chat）**全部依赖官方后端 API**，需要 Pro 付费账户（`isAuthed` 鉴权），**不支持用户配置自己的 API Key**。

现有插件系统仅覆盖 `translation` 和 `dictionary` 两种类型，虽然支持自定义 API Key，但**没有 `assistant` / `chat` 类型的自定义插件**。

### 1.3 目标

新增一种插件类型 `"assistant"`，让**未付费用户**也可以通过填入自己的 LLM API Key，在阅读中选中文字后与 AI 自由对话。

---

## 2. 现有架构分析

### 2.1 目录结构（关键路径）

```
src/
├── components/
│   └── popups/
│       ├── popupTrans/       # 翻译弹窗（参考实现）
│       │   ├── component.tsx
│       │   ├── popupTrans.css
│       │   └── index.tsx     # Redux connect
│       ├── popupDict/        # 词典弹窗（参考实现）
│       │   ├── component.tsx
│       │   ├── popupDict.css
│       │   └── index.tsx
│       ├── popupAssist/      # 官方 AI 助手弹窗（参考但需改造）
│       │   ├── component.tsx
│       │   ├── popupAssist.css
│       │   └── index.tsx
│       └── popupMenu/        # 选中文字后的右键菜单
├── containers/
│   ├── lists/navList/        # 左侧导航（含翻译/词典/问书 tab 切换）
│   └── panels/operationPanel/ # 操作面板
├── assets/locales/           # 国际化文件 (en/, zh-CN/, ...)
└── ...
```

### 2.2 插件系统架构

插件存储在本地数据库的 `plugins` 表中，每个插件是一个 JSON 对象：

```typescript
interface Plugin {
  identifier: string;        // 唯一标识，例如 "openai-chat-plugin"
  type: string;              // "translation" | "dictionary" | "assistant"（新增）
  displayName: string;       // 显示名称
  icon: string;              // 图标标识
  version: string;           // 版本号
  autoValue: string;         // 自动检测值
  config: Record<string, string>; // 配置项（API Key, endpoint 等）
  langList?: Record<string, string>; // 语言列表（chat 类型可选）
  scriptSHA256: string;      // 脚本哈希（安全校验）
  script: string;            // JavaScript 代码字符串
}
```

**插件执行机制**：通过 `eval()` 执行 `script` 字段中的 JS 代码，注入全局函数后调用。

### 2.3 现有弹窗组件模式

所有弹窗组件（PopupTrans, PopupDict, PopupAssist）遵循统一模式：

1. 通过 Redux `connect` 获取 props：`originalText`（选中文字）、`plugins`（插件列表）、`isAuthed`（是否付费）
2. 通过 `ConfigService` 读写用户偏好配置
3. 通过 `DatabaseService` 的 `plugins` 表加载/保存插件
4. 通过 `navList` 中的 tab 切换显示不同弹窗

### 2.4 官方 AI 助手（popupAssist）

当前 `popupAssist` 组件：
- 仅在 `isAuthed === true` 时可用
- 调用官方 streaming API（`getAssistStream` 等函数）
- 支持传入选中文字 + 用户自定义问题
- UI 包含：选中文字展示区、输入框、消息流显示区、发送按钮

---

## 3. 功能需求

### 3.1 核心功能：自定义 AI 聊天插件

#### 3.1.1 插件配置界面

在设置中新增 "AI 助手" 插件管理区域（或复用现有插件添加流程）：

- **Provider 选择**：下拉列表选择 AI 服务商
  - OpenAI (ChatGPT)
  - Anthropic (Claude)
  - DeepSeek
  - Ollama (本地)
  - 自定义 OpenAI 兼容端点（Custom）
- **API Key 输入框**：密码类型，本地存储
- **API Base URL**：可选，默认根据 Provider 自动填充
  - OpenAI: `https://api.openai.com/v1/chat/completions`
  - Anthropic: `https://api.anthropic.com/v1/messages`
  - DeepSeek: `https://api.deepseek.com/v1/chat/completions`
  - Ollama: `http://localhost:11434/api/chat`
  - Custom: 用户自填
- **Model 选择**：文本输入或下拉
  - OpenAI 默认: `gpt-4o-mini`
  - Anthropic 默认: `claude-sonnet-4-20250514`
  - DeepSeek 默认: `deepseek-chat`
  - Ollama 默认: `llama3`
- **System Prompt**（可选）：用户可自定义系统提示词，默认提供一个合理的阅读助手 prompt
- **测试连接按钮**：发送简单请求验证 API Key 是否有效

#### 3.1.2 阅读中的 AI 聊天交互

**触发方式**：
1. 选中文字 → 右键弹出菜单（PopupMenu）→ 点击 "AI 助手" 按钮
2. 通过左侧导航栏的 "AI 助手" tab 打开聊天面板

**聊天面板 UI**：
- 顶部：显示当前选中的文字（可折叠）
- 中间：消息流区域（支持 streaming 逐字显示）
  - AI 消息支持 Markdown 渲染
  - 用户消息靠右，AI 消息靠左
- 底部：
  - 文本输入框（支持 Enter 发送，Shift+Enter 换行）
  - 发送按钮
  - Provider/Model 快捷切换（小图标）
- 右上角：清除对话按钮

**预设快捷 Prompt**（选中文字后一键使用）：
- "解释这段话"
- "翻译成 [目标语言]"
- "这个词在这个上下文中是什么意思？"
- "总结这段内容"
- "用更简单的语言解释"

用户可在设置中自定义这些快捷 Prompt。

#### 3.1.3 API 调用实现

**统一的 Provider 抽象层**：

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
  provider: "openai" | "anthropic" | "deepseek" | "ollama" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt?: string;
}

// 各 provider 的请求适配
async function sendChatRequest(
  config: AIProviderConfig,
  messages: AIMessage[],
  callback: AIStreamCallback
): Promise<void>;
```

**各 Provider 的 API 差异处理**：

| Provider | Auth Header | Request Body Format | Stream Format |
|----------|------------|-------------------|---------------|
| OpenAI | `Authorization: Bearer {key}` | `{ model, messages, stream: true }` | SSE `data: {"choices":[{"delta":{"content":"..."}}]}` |
| Anthropic | `x-api-key: {key}` + `anthropic-version: 2023-06-01` | `{ model, messages, max_tokens, stream: true }` | SSE `event: content_block_delta` + `data: {"delta":{"text":"..."}}` |
| DeepSeek | 同 OpenAI 格式 | 同 OpenAI 格式 | 同 OpenAI 格式 |
| Ollama | 无需 auth | `{ model, messages, stream: true }` | NDJSON `{"message":{"content":"..."}}` |

**注意**：Anthropic 的请求格式和 streaming 格式与 OpenAI 不同，需要单独适配。

#### 3.1.4 对话上下文管理

- 每次选中新文字开始新对话时，自动将选中文字作为上下文注入
- 支持多轮对话（在同一个选中文字的上下文中继续追问）
- 对话历史保存在内存中（不持久化到数据库，避免存储膨胀）
- 用户可手动清除对话重新开始
- System Prompt 模板示例：

```
你是一个阅读助手。用户正在阅读一本书，选中了以下文字并向你提问。
请基于选中的文字内容回答用户的问题。回答要简洁、准确、有帮助。
如果用户没有明确提问，请解释选中文字的含义。

选中的文字：
---
{selectedText}
---
```

### 3.2 插件格式定义

新增 `assistant` 类型插件的 JSON 格式：

```json
{
  "identifier": "openai-chat-plugin",
  "type": "assistant",
  "displayName": "OpenAI ChatGPT",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "openai",
    "apiKey": "[Your API Key]",
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4o-mini",
    "systemPrompt": ""
  },
  "script": "async function chat(messages, config, axios, callback) { ... }"
}
```

同时提供预置插件模板，用户只需要填入 API Key 即可使用。

---

## 4. 技术实现方案

### 4.1 需要新增的文件

```
src/
├── components/
│   └── popups/
│       └── popupAIChat/              # 新增：自定义 AI 聊天弹窗
│           ├── component.tsx          # 主组件
│           ├── popupAIChat.css        # 样式
│           └── index.tsx              # Redux connect
├── utils/
│   └── aiProvider.ts                  # 新增：AI Provider 抽象层
└── ...
```

### 4.2 需要修改的文件

| 文件路径 | 修改内容 |
|---------|---------|
| `src/components/popups/popupMenu/` | 右键菜单新增 "AI 助手" 按钮 |
| `src/containers/lists/navList/component.tsx` | 左侧导航新增 "AI 助手" tab |
| `src/containers/panels/operationPanel/component.tsx` | 操作面板集成 AI 聊天窗口 |
| `src/assets/locales/en/translation.json` | 新增英文国际化 key |
| `src/assets/locales/zh-CN/translation.json` | 新增中文国际化 key |

### 4.3 实现步骤（建议顺序）

1. **Step 1**：创建 `aiProvider.ts` — 实现统一的多 Provider API 调用层，含 streaming 支持
2. **Step 2**：创建 `popupAIChat` 组件 — 参考 `popupAssist` 的结构，替换官方 API 调用为自定义 Provider 调用
3. **Step 3**：修改插件系统 — 在插件添加/管理界面中支持 `assistant` 类型插件的配置 UI
4. **Step 4**：集成到阅读界面 — 修改 PopupMenu、NavList、OperationPanel
5. **Step 5**：添加国际化文本
6. **Step 6**：添加预置插件模板（OpenAI, Anthropic, DeepSeek, Ollama）
7. **Step 7**：测试与调试

### 4.4 关键实现细节

#### 4.4.1 Streaming 响应处理

```typescript
// OpenAI 兼容格式（OpenAI / DeepSeek）
const response = await fetch(baseUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    messages,
    stream: true,
  }),
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // 解析 SSE 格式: "data: {...}\n\n"
  const lines = chunk.split("\n").filter(line => line.startsWith("data: "));
  for (const line of lines) {
    const data = line.slice(6); // 去掉 "data: "
    if (data === "[DONE]") { callback.onDone(); return; }
    const json = JSON.parse(data);
    const content = json.choices?.[0]?.delta?.content || "";
    if (content) callback.onChunk(content);
  }
}
```

```typescript
// Anthropic 格式
const response = await fetch(baseUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model,
    messages: messages.filter(m => m.role !== "system"), // system 走顶层字段
    system: messages.find(m => m.role === "system")?.content || "",
    max_tokens: 4096,
    stream: true,
  }),
});
// 解析 SSE: event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"..."}}
```

```typescript
// Ollama 格式（NDJSON，非 SSE）
const response = await fetch(baseUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model, messages, stream: true }),
});
// 每行一个 JSON: {"message":{"content":"..."},"done":false}
```

#### 4.4.2 CORS 问题处理

在 Web 模式下，直接从浏览器调用外部 API 会遇到 CORS 限制。解决方案：

- **Electron 桌面模式**：无 CORS 限制，直接调用
- **Web 模式**：
  - 方案 A：在 Koodo 的 Docker/Node 后端添加一个简单的 proxy endpoint
  - 方案 B：提示用户在 Web 模式下使用浏览器插件解决 CORS
  - 方案 C（推荐）：Ollama 本地部署天然无 CORS 问题；对于云端 API，在 `httpServer.js` 中添加 proxy 路由

#### 4.4.3 API Key 安全存储

- API Key 存储在本地数据库的 `plugins` 表 `config` 字段中
- 与现有插件（DeepL、Azure 等）使用相同的存储机制
- UI 上用 `<input type="password">` 显示
- 不会通过 Koodo 官方服务器传输

---

## 5. UI/UX 设计要求

### 5.1 聊天面板样式

- 与现有的翻译/词典弹窗保持视觉一致
- 参考 `popupAssist.css` 和 `popupTrans.css` 的样式
- 支持暗色模式（跟随 Koodo 主题切换）
- 面板大小可拖拽调整（复用现有可调大小逻辑）
- Markdown 渲染：使用简单的 Markdown → HTML 转换（粗体、斜体、代码块、列表）

### 5.2 响应式设计

- 桌面端：侧边面板模式（与翻译/词典面板一致）
- 窄屏/移动端：全宽底部弹出

### 5.3 加载状态

- Streaming 时显示逐字输出动画
- 等待首个 token 时显示 "thinking..." 动画
- 网络错误时显示友好的错误提示和重试按钮

---

## 6. 国际化

需要添加的翻译 key（至少支持 en 和 zh-CN）：

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
  "Custom": "自定义",
  "Add AI Plugin": "添加 AI 插件",
  "No AI assistant configured": "未配置 AI 助手",
  "Please add an AI assistant plugin first": "请先添加一个 AI 助手插件",
  "Thinking...": "思考中...",
  "Generated with": "由 {provider} 生成"
}
```

---

## 7. 预置插件模板

在插件管理页面提供 "一键添加" 按钮，用户只需填入 API Key：

### 7.1 OpenAI

```json
{
  "identifier": "openai-chat-plugin",
  "type": "assistant",
  "displayName": "OpenAI ChatGPT",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "openai",
    "apiKey": "[Your API Key]",
    "baseUrl": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4o-mini"
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
    "apiKey": "[Your API Key]",
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
    "apiKey": "[Your API Key]",
    "baseUrl": "https://api.deepseek.com/v1/chat/completions",
    "model": "deepseek-chat"
  }
}
```

### 7.4 Ollama（本地）

```json
{
  "identifier": "ollama-chat-plugin",
  "type": "assistant",
  "displayName": "Ollama (Local)",
  "icon": "chat",
  "version": "1.0.0",
  "config": {
    "provider": "ollama",
    "apiKey": "",
    "baseUrl": "http://localhost:11434/api/chat",
    "model": "llama3"
  }
}
```

---

## 8. 不在本期范围内（Out of Scope）

以下功能暂不实现，可作为后续迭代：

- 对话历史持久化存储
- 多模态支持（图片输入）
- 整本书上下文注入（token 成本太高）
- 与 Koodo 官方 AI 服务的集成
- 移动端（Android/iOS）适配
- 自定义 Function Calling / Tool Use
- 插件市场 / 在线分发

---

## 9. 验收标准

1. ✅ 用户可以在设置中添加自定义 AI 聊天插件（选择 Provider、填入 API Key）
2. ✅ 阅读中选中文字后，右键菜单出现 "AI 助手" 选项
3. ✅ 点击后打开聊天面板，自动将选中文字作为上下文
4. ✅ 用户可以输入自由问题并获得 streaming 回复
5. ✅ 支持多轮对话
6. ✅ 支持至少 4 个 Provider（OpenAI, Anthropic, DeepSeek, Ollama）
7. ✅ 支持中英文界面
8. ✅ 暗色模式下正常显示
9. ✅ 桌面端（Electron）可正常调用 API
10. ✅ API Key 存储在本地，不经过任何远程服务器

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
| Ollama API | https://github.com/ollama/ollama/blob/main/docs/api.md |
| KOReader assistant 插件（灵感参考） | https://github.com/omer-faruq/assistant.koplugin |
