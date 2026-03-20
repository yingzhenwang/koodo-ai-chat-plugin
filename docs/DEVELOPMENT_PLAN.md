# Koodo AI Chat Plugin — 开发计划

> 基于 Koodo Reader 源码深度分析后的具体实现方案
>
> **状态：MVP 已完成** (2026-03-20)

---

## 架构决策

### 侧边栏方案：独立右侧面板（非复用 SettingPanel）

现有 Reader 页面布局：
- **左侧**: NavigationPanel (299px, 书籍目录/书签/笔记)
- **右侧**: SettingPanel (299px, 阅读设置)
- **顶部**: OperationPanel (操作按钮)
- **底部**: ProgressPanel (进度条)
- **浮层**: PopupMenu (选中文字弹窗)

**AI 侧边栏策略**：在右侧新增一个独立的面板容器 `.ai-panel-container`，与 SettingPanel 共用右侧空间。通过 Redux state `isAIPanelOpen` 控制显隐。当 AI 面板打开时，SettingPanel 自动关闭（互斥）。

理由：
1. SettingPanel 是纯配置面板，塞入聊天 UI 会破坏其内聚性
2. 独立面板可以自由控制宽度（AI 聊天需要更宽，350px）
3. 复用 Reader 已有的 `handleEnterReader("right")` / `handleLeaveReader("right")` 模式

### API 调用方案：Electron 主进程中转 vs 渲染进程直接 fetch

**选择渲染进程直接 fetch**。Electron 无 CORS 限制，渲染进程可以直接调用外部 API。无需在 main.js 添加 IPC handler。

### 不使用 eval() 插件系统

`assistant` 类型插件只存储配置（provider, apiKey, model 等），API 调用逻辑由内置的 `aiProvider.ts` 统一处理。

---

## 实现步骤（共 7 步）

---

### Step 1: Redux State + Actions 扩展

**目标**：为 AI 面板添加必要的状态管理

#### 1.1 新增 Redux action

**文件**: `src/store/actions/reader.tsx`

新增：
```typescript
export function handleAIPanelOpen(isOpen: boolean) {
  return { type: "HANDLE_AI_PANEL_OPEN", payload: isOpen };
}
```

#### 1.2 扩展 reader reducer

**文件**: `src/store/reducers/reader.tsx`

在 `initState` 中添加：
```typescript
isAIPanelOpen: false,
```

在 switch 中添加：
```typescript
case "HANDLE_AI_PANEL_OPEN":
  return { ...state, isAIPanelOpen: action.payload };
```

#### 1.3 导出新 action

**文件**: `src/store/actions/index.tsx` — 已经 `export * from "./reader"`，无需修改。

#### 1.4 更新 stateType

**文件**: `src/store/index.tsx` — 确认 stateType 包含 reader 类型定义。由于 Koodo 使用 TypeScript，需要在相关 interface 文件中更新类型。

**涉及文件**:
- `src/store/actions/reader.tsx` (修改)
- `src/store/reducers/reader.tsx` (修改)

---

### Step 2: AI Provider 抽象层

**目标**：实现一个统一的 API 调用层，支持 OpenAI / Anthropic / DeepSeek / Custom

#### 2.1 新建 `src/utils/aiProvider.ts`

核心接口：
```typescript
interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AIStreamCallback {
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
}

interface AIProviderConfig {
  provider: "openai" | "anthropic" | "deepseek" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
}
```

核心函数：
```typescript
export async function sendChatStream(
  config: AIProviderConfig,
  messages: AIMessage[],
  callback: AIStreamCallback,
  abortSignal?: AbortSignal
): Promise<void>
```

#### 2.2 实现细节

**OpenAI / DeepSeek / Custom（OpenAI 兼容格式）**:
- Endpoint: `config.baseUrl`（默认 `https://api.openai.com/v1/chat/completions`）
- Header: `Authorization: Bearer ${apiKey}`
- Body: `{ model, messages, stream: true }`
- SSE 解析: `data: {"choices":[{"delta":{"content":"..."}}]}`
- 结束标志: `data: [DONE]`

**Anthropic**:
- Endpoint: `config.baseUrl`（默认 `https://api.anthropic.com/v1/messages`）
- Headers: `x-api-key: ${apiKey}`, `anthropic-version: 2023-06-01`
- Body: `{ model, messages (不含 system), system, max_tokens: 4096, stream: true }`
- 注意：Anthropic 的 system prompt 不在 messages 数组中，需要单独提取
- SSE 解析: `event: content_block_delta` → `data: {"delta":{"text":"..."}}`
- 结束标志: `event: message_stop`

**SSE 解析器**:
- 使用 `fetch()` + `response.body.getReader()` 读取 stream
- 维护 buffer 处理跨 chunk 的行拆分
- 实现 `TextDecoder` 处理 UTF-8
- 30 秒超时（无首 token 则报错）
- 支持 `AbortController` 中断

#### 2.3 测试连接函数

```typescript
export async function testConnection(config: AIProviderConfig): Promise<boolean>
```
- 发送 `messages: [{role: "user", content: "hi"}]` + `max_tokens: 1`
- `stream: false`
- 成功返回 true，失败抛出错误

**涉及文件**:
- `src/utils/aiProvider.ts` (新建)

---

### Step 3: 阅读上下文收集器

**目标**：从 Koodo 内部状态提取阅读上下文，构建 system prompt

#### 3.1 新建 `src/utils/readingContext.ts`

```typescript
interface ReadingContext {
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  selectedText: string;
  surroundingText: string;  // 前后各 100 字
}
```

#### 3.2 上下文提取方法

**书名 + 作者**:
- 来源: Redux `state.book.currentBook.name` / `state.book.currentBook.author`
- 始终可用

**当前章节名**:
- 来源: Redux `state.reader.currentChapter`
- 或从 `ConfigService.getObjectConfig(bookKey, "recordLocation", {}).chapterTitle`
- 翻页/换章时 Koodo 自动更新此值

**选中文字**:
- 来源: Redux `state.reader.originalText`
- 通过 `handleOriginalText()` action 写入

**附近内容（前后各 100 字）**:
- 来源: `htmlBook.rendition.chapterText()` 获取当前章节全文
- 在章节全文中搜索选中文字的位置
- 截取选中文字前 100 字 + 后 100 字
- 如果找不到精确匹配（可能因为格式化差异），fallback 到只返回选中文字

#### 3.3 System Prompt 构建

```typescript
export function buildSystemPrompt(
  context: ReadingContext,
  customTemplate?: string
): string
```

默认模板：
```
你是一个阅读助手。

用户正在阅读：
- 书名：{bookTitle}
- 作者：{bookAuthor}
- 当前章节：{chapterTitle}

{条件: selectedText 非空时}
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

支持用户自定义模板，用 `{bookTitle}` `{bookAuthor}` `{chapterTitle}` `{selectedText}` `{surroundingText}` 模板变量替换。

**涉及文件**:
- `src/utils/readingContext.ts` (新建)

---

### Step 4: AI 聊天侧边栏组件

**目标**：实现完整的 AI 聊天侧边栏 UI

#### 4.1 新建组件目录

```
src/components/aiAssistant/
├── component.tsx       # 主组件（类组件，遵循 Koodo 现有模式）
├── interface.tsx        # Props/State 类型定义
├── index.tsx           # Redux connect
└── aiAssistant.css     # 样式
```

#### 4.2 组件 State 设计

```typescript
interface AiAssistantState {
  messages: AIMessage[];        // 对话历史
  inputValue: string;           // 输入框内容
  isStreaming: boolean;         // 是否正在 streaming
  streamingText: string;        // 当前 streaming 的文字
  selectedText: string;         // 缓存的选中文字（用于显示）
  surroundingText: string;      // 缓存的附近内容
  aiService: string;            // 当前选中的 AI 插件 key
}
```

#### 4.3 组件 Props（通过 Redux connect）

```typescript
interface AiAssistantProps {
  // 从 Redux state:
  originalText: string;         // state.reader.originalText
  currentBook: BookModel;       // state.book.currentBook
  currentChapter: string;       // state.reader.currentChapter
  htmlBook: HtmlBookModel;      // state.reader.htmlBook
  plugins: PluginModel[];       // state.manager.plugins
  isAIPanelOpen: boolean;       // state.reader.isAIPanelOpen
  backgroundColor: string;      // state.reader.backgroundColor

  // Actions:
  handleAIPanelOpen: (isOpen: boolean) => void;
  handleFetchPlugins: () => void;

  // i18n:
  t: (key: string) => string;
}
```

#### 4.4 UI 布局实现

```
┌──────────────────────────────┐
│ 📖 书名 · 当前章节     [×]  │  ← 上下文摘要条 + 关闭按钮
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ "选中的文字..."       ▼  │ │  ← 选中文字折叠区（可展开/收起）
│ └──────────────────────────┘ │
├──────────────────────────────┤
│ [解释] [翻译] [总结] [词义]  │  ← 快捷 Prompt 按钮（仅选中文字时显示）
├──────────────────────────────┤
│                              │
│  消息流区域                   │  ← 滚动区域，flex-grow: 1
│  - 用户消息靠右，浅色背景     │
│  - AI 消息靠左               │
│  - Markdown 渲染（用 marked） │
│  - "思考中..." loading 动画  │
│                              │
├──────────────────────────────┤
│ ┌────────────────────┐ [发送]│  ← 输入区（固定底部）
│ │ 输入问题...        │ [🗑️] │     Enter 发送, Shift+Enter 换行
│ └────────────────────┘       │     清除对话按钮
└──────────────────────────────┘
```

#### 4.5 关键交互逻辑

**发送消息流程**:
1. 用户输入 → 点击发送或按 Enter
2. 从 Redux 获取最新的 `currentBook`, `currentChapter`
3. 如果有 `originalText`，调用 `readingContext.ts` 获取 `surroundingText`
4. 调用 `buildSystemPrompt()` 构建 system message
5. 组装 messages 数组: `[systemMsg, ...history, newUserMsg]`
6. 获取当前选中的 plugin config
7. 调用 `sendChatStream(config, messages, callbacks)`
8. streaming 回调更新 `streamingText` state → UI 实时渲染
9. 完成后将 assistant message 加入 `messages` history

**选中文字更新**:
- `componentDidUpdate` 监听 `props.originalText` 变化
- 变化时更新 `state.selectedText` 和 `state.surroundingText`
- 但不清除对话历史

**章节切换**:
- 监听 `props.currentChapter` 变化
- 变化时 system prompt 自动更新（下次发送消息时生效）
- 对话历史保留

**清除对话**:
- 重置 `messages` 为空数组
- 重置 `streamingText`

**中断请求**:
- 维护 `AbortController` ref
- streaming 中点击"停止"按钮调用 `abortController.abort()`

#### 4.6 Markdown 渲染

复用 Koodo 现有依赖：
- `marked` (已安装) — Markdown → HTML
- `DOMPurify` (已安装) — XSS 防护
- `html-react-parser` (已安装) — HTML → React

渲染链: `text → marked.parse() → DOMPurify.sanitize() → Parser()`

与 `PopupAssist` 完全一致的渲染模式。

#### 4.7 样式实现

遵循 Koodo 现有 CSS 模式（非 CSS Modules，普通 CSS + BEM 命名）：

关键类名：
- `.ai-assistant-container` — 主容器
- `.ai-assistant-header` — 上下文摘要条
- `.ai-assistant-selection` — 选中文字显示区
- `.ai-assistant-shortcuts` — 快捷按钮区
- `.ai-assistant-messages` — 消息流滚动区
- `.ai-assistant-message-user` — 用户消息
- `.ai-assistant-message-ai` — AI 消息
- `.ai-assistant-input` — 输入区容器
- `.ai-assistant-textarea` — 输入框
- `.ai-assistant-send-btn` — 发送按钮

暗色模式：通过 `props.backgroundColor` 动态设置，与 SettingPanel / NavigationPanel 一致。

**涉及文件**:
- `src/components/aiAssistant/component.tsx` (新建)
- `src/components/aiAssistant/interface.tsx` (新建)
- `src/components/aiAssistant/index.tsx` (新建)
- `src/components/aiAssistant/aiAssistant.css` (新建)

---

### Step 5: 集成到 Reader 页面

**目标**：将 AI 侧边栏挂载到阅读界面，添加触发入口

#### 5.1 修改 Reader 页面

**文件**: `src/pages/reader/component.tsx`

修改内容：
1. import AiAssistant 组件
2. 在 render 中添加 AI 面板容器（与 setting-panel-container 平级）：
```jsx
<div
  className="ai-panel-container"
  style={
    this.props.isAIPanelOpen
      ? {}
      : { transform: "translateX(359px)" }
  }
>
  <AiAssistant />
</div>
```

3. 修改现有 AI 按钮逻辑（~第 217-238 行）：
   - 移除 `this.props.isAuthed` 条件检查（不再需要官方认证）
   - 点击时 dispatch `handleAIPanelOpen(true)` 打开侧边栏
   - 同时调用 `handleOriginalText(await htmlBook.rendition.chapterText())` 获取章节文本

4. 当 AI 面板打开时，调整翻页按钮位置（`right` 值加 350px）

5. AI 面板打开时如果 SettingPanel 也开着，关闭 SettingPanel（互斥）

#### 5.2 修改 Reader 页面 CSS

**文件**: `src/pages/reader/index.css`

新增 `.ai-panel-container` 样式：
```css
.ai-panel-container {
  width: 349px;
  height: 100vh;
  position: absolute;
  top: 0px;
  right: 0px;
  transition: transform 0.5s ease;
  z-index: 15;
}
```

#### 5.3 修改 Reader index.tsx (Redux connect)

**文件**: `src/pages/reader/index.tsx`

- `mapStateToProps` 中添加 `isAIPanelOpen: state.reader.isAIPanelOpen`
- `actionCreator` 中添加 `handleAIPanelOpen`
- 更新 interface 文件

#### 5.4 修改右键菜单 — 添加 "问 AI" 按钮

**文件**: `src/constants/popupList.tsx`

添加新菜单项：
```typescript
{ name: "ai-assist", title: "Ask AI", icon: "chat" }
```

**文件**: `src/components/popups/popupOption/component.tsx`

在 switch 中新增 case（index 8 = "ai-assist"）：
```typescript
case 8:
  this.handleAskAI();
  break;
```

新增方法：
```typescript
handleAskAI = () => {
  this.props.handleOriginalText(getSelection(this.props.currentBook.format));
  this.props.handleAIPanelOpen(true);
  this.props.handleOpenMenu(false);
};
```

需要在 PopupOption 的 Redux connect (index.tsx) 中添加 `handleAIPanelOpen` action。

**涉及文件**:
- `src/pages/reader/component.tsx` (修改)
- `src/pages/reader/index.tsx` (修改)
- `src/pages/reader/interface.tsx` (修改)
- `src/pages/reader/index.css` (修改)
- `src/constants/popupList.tsx` (修改)
- `src/components/popups/popupOption/component.tsx` (修改)
- `src/components/popups/popupOption/index.tsx` (修改)
- `src/components/popups/popupOption/interface.tsx` (修改)

---

### Step 6: 插件配置 UI

**目标**：在设置页面支持 AI 助手插件的添加和管理

#### 6.1 策略选择

有两个方案：
- **方案 A**: 在现有 `pluginSetting` 页面中为 `assistant` 类型插件添加表单式配置（而非粘贴 JSON）
- **方案 B**: 在 AI 侧边栏内嵌配置入口

**选择方案 A+B 结合**：
- 在 `pluginSetting` 中添加 "添加 AI 助手" 按钮，点击展开表单：选择 Provider → 自动填充 URL/Model → 用户填 API Key → 保存
- 在 AI 侧边栏头部添加 Provider 切换下拉框（复用 PopupAssist 的模式）
- 首次使用时侧边栏显示"未配置 AI 助手，请先在设置中添加"

#### 6.2 修改 pluginSetting

**文件**: `src/containers/settings/pluginSetting/component.tsx`

为 `assistant` 类型插件新增专用表单：
- Provider 下拉选择 (OpenAI / Anthropic / DeepSeek / Custom)
- API Key 输入框 (`<input type="password">`)
- API Base URL (根据 Provider 自动填充，可手动修改)
- Model 名称 (根据 Provider 给默认值)
- System Prompt (可选，多行 textarea)
- 测试连接按钮
- 保存按钮

保存时构建 plugin 对象并调用 `DatabaseService.saveRecord(plugin, "plugins")`。

#### 6.3 预置插件模板

点击 Provider 下拉时自动填充：
| Provider | baseUrl | model |
|----------|---------|-------|
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-5.4-mini` |
| Anthropic | `https://api.anthropic.com/v1/messages` | `claude-sonnet-4-20250514` |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| Custom | (空) | (空) |

**涉及文件**:
- `src/containers/settings/pluginSetting/component.tsx` (修改)
- `src/containers/settings/pluginSetting/interface.tsx` (修改)

---

### Step 7: 国际化

**目标**：支持中英文界面

#### 7.1 翻译 key

需要在以下两个文件中添加翻译 key：

**文件**: `src/assets/locales/en/translation.json`
**文件**: `src/assets/locales/zh-CN/translation.json` (如果存在 `zhCN/` 目录则用 `zhCN/`)

新增 key：
```json
{
  "AI Assistant": "AI Assistant" / "AI 助手",
  "Ask AI": "Ask AI" / "问 AI",
  "Type your question...": "Type your question..." / "输入你的问题...",
  "Send": "Send" / "发送",
  "Clear conversation": "Clear conversation" / "清除对话",
  "AI Provider": "AI Provider" / "AI 服务商",
  "API Key": "API Key" / "API 密钥",
  "API Base URL": "API Base URL" / "API 地址",
  "Model": "Model" / "模型",
  "System Prompt": "System Prompt" / "系统提示词",
  "Test Connection": "Test Connection" / "测试连接",
  "Connection successful": "Connection successful" / "连接成功",
  "Connection failed": "Connection failed" / "连接失败",
  "Explain this": "Explain this" / "解释这段话",
  "Translate to": "Translate to" / "翻译成",
  "What does this mean in context?": "What does this mean in context?" / "这在上下文中是什么意思？",
  "Summarize": "Summarize" / "总结",
  "Explain in simpler terms": "Explain in simpler terms" / "用更简单的语言解释",
  "No AI assistant configured": "No AI assistant configured" / "未配置 AI 助手",
  "Please add an AI assistant plugin in settings": "Please add an AI assistant plugin in settings" / "请先在设置中添加 AI 助手插件",
  "Thinking...": "Thinking..." / "思考中...",
  "Current context": "Current context" / "当前上下文",
  "Stop": "Stop" / "停止",
  "Add AI Assistant": "Add AI Assistant" / "添加 AI 助手"
}
```

**涉及文件**:
- `src/assets/locales/en/translation.json` (修改)
- `src/assets/locales/zhCN/translation.json` (修改，需确认目录名)

---

## 文件变更总览

### 新建文件 (6 个)

| 文件 | 用途 |
|------|------|
| `src/utils/aiProvider.ts` | API Provider 抽象层 + streaming |
| `src/utils/readingContext.ts` | 阅读上下文收集 + system prompt 构建 |
| `src/components/aiAssistant/component.tsx` | AI 侧边栏主组件 |
| `src/components/aiAssistant/interface.tsx` | 类型定义 |
| `src/components/aiAssistant/index.tsx` | Redux connect |
| `src/components/aiAssistant/aiAssistant.css` | 样式 |

### 修改文件 (约 12 个)

| 文件 | 修改内容 |
|------|---------|
| `src/store/actions/reader.tsx` | +1 action: `handleAIPanelOpen` |
| `src/store/reducers/reader.tsx` | +1 state field + 1 case |
| `src/pages/reader/component.tsx` | 挂载 AI 面板容器，修改 AI 按钮逻辑 |
| `src/pages/reader/index.tsx` | Redux connect 新增 props |
| `src/pages/reader/interface.tsx` | 类型定义更新 |
| `src/pages/reader/index.css` | 新增 `.ai-panel-container` 样式 |
| `src/constants/popupList.tsx` | 新增 "Ask AI" 菜单项 |
| `src/components/popups/popupOption/component.tsx` | 新增 handleAskAI 处理 |
| `src/components/popups/popupOption/index.tsx` | Redux connect 新增 action |
| `src/components/popups/popupOption/interface.tsx` | 类型定义更新 |
| `src/containers/settings/pluginSetting/component.tsx` | AI 插件配置表单 |
| `src/assets/locales/en/translation.json` | 英文翻译 |
| `src/assets/locales/zhCN/translation.json` | 中文翻译 |

---

## 实施顺序与验证节点

| 阶段 | 步骤 | 验证标准 |
|------|------|---------|
| **阶段 1: 基础设施** | Step 1 (Redux) + Step 2 (aiProvider) + Step 3 (readingContext) | 单元级：可以在控制台手动调用 `sendChatStream()` 发送请求并收到 streaming 响应 |
| **阶段 2: 核心 UI** | Step 4 (AI 侧边栏组件) | 组件可渲染，发送消息可收到 AI 回复，streaming 逐字显示 |
| **阶段 3: 集成** | Step 5 (集成到 Reader) | 右键菜单 "问 AI" 可打开侧边栏，AI 按钮可打开侧边栏，上下文自动注入 |
| **阶段 4: 配置** | Step 6 (插件配置 UI) | 用户可在设置中添加/删除 AI 插件，测试连接可用 |
| **阶段 5: 收尾** | Step 7 (i18n) + 全面测试 | 中英文切换正常，暗色模式正常，所有验收标准通过 |

---

## 风险点与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| `htmlBook.rendition.chapterText()` 返回带 HTML 标签的文本 | 附近内容提取不准确 | 用 `innerText` 或 strip tags 后再搜索 |
| 选中文字在章节全文中出现多次 | 无法定位正确位置取附近内容 | 取第一个匹配作为 fallback |
| Anthropic API 的 system prompt 格式不同 | 调用失败 | 在 `aiProvider.ts` 中特殊处理 Anthropic 的 system 字段 |
| SSE 流中 `data:` 行跨 chunk 拆分 | 解析错误 | 维护 line buffer，只在遇到 `\n` 时处理 |
| 暗色模式下新组件颜色不协调 | 视觉问题 | 使用 `props.backgroundColor` 动态设置，参考 SettingPanel 的实现 |

---

## 实现过程中的修复记录

| 问题 | 原因 | 修复 |
|------|------|------|
| OpenAI 测试连接报 "Unsupported parameter: max_tokens" | OpenAI 新模型（gpt-5.4-mini）不再支持 `max_tokens`，需用 `max_completion_tokens` | `aiProvider.ts` 中 OpenAI 测试连接改用 `max_completion_tokens` |
| 测试连接报 "max_tokens or model output limit was reached" | `max_completion_tokens: 1` 太小，模型输出被截断触发错误信息 | 改为 `max_completion_tokens: 10` |
| 打开书后白屏 | Redux `state.manager.plugins` 初始值是 `null`（非空数组），AiAssistant 组件调用 `null.filter()` 崩溃，导致整个 Reader 页面 React 树卸载 | AiAssistant 中所有 `this.props.plugins` 调用加 `\|\| []` null 安全防护 |
| "Add AI Assistant" 和 "Add new plugin" 按钮文字重叠 | 两个按钮共用 `.setting-dialog-new-plugin` class（`position: absolute; bottom: 20px`），定位到同一位置 | "Add AI Assistant" 按钮加 `bottom: 50px` 偏移 |
