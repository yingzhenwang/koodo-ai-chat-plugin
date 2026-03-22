import React from "react";
import "./aiAssistant.css";
import { AiAssistantProps, AiAssistantState } from "./interface";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  sendChatStream,
  AIMessage,
  AIProviderConfig,
} from "../../utils/aiProvider";
import {
  getSurroundingText,
  buildSystemPrompt,
  ReadingContext,
} from "../../utils/readingContext";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { Trans } from "react-i18next";

const quickPrompts = [
  { label: "Explain this", prompt: "Explain this" },
  { label: "Translate to", prompt: "Translate to" },
  { label: "Summarize", prompt: "Summarize" },
  {
    label: "What does this mean in context?",
    prompt: "What does this mean in context?",
  },
  { label: "Explain in simpler terms", prompt: "Explain in simpler terms" },
];

class AiAssistant extends React.Component<
  AiAssistantProps,
  AiAssistantState
> {
  private messagesEndRef: React.RefObject<HTMLDivElement>;
  private abortController: AbortController | null = null;

  constructor(props: AiAssistantProps) {
    super(props);
    this.state = {
      messages: [],
      inputValue: "",
      isStreaming: false,
      streamingText: "",
      selectedText: "",
      surroundingText: "",
      aiService:
        ConfigService.getReaderConfig("aiService") ||
        "openai-chat-plugin",
      isSelectionCollapsed: true,
    };
    this.messagesEndRef = React.createRef();
  }

  componentWillUnmount() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  componentDidUpdate(prevProps: AiAssistantProps) {
    if (
      prevProps.originalText !== this.props.originalText &&
      this.props.originalText
    ) {
      this.updateSelectedText(this.props.originalText);
    }
  }

  updateSelectedText = async (text: string) => {
    const cleanText = text
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    let surrounding = "";
    if (this.props.htmlBook?.rendition) {
      try {
        const chapterText =
          await this.props.htmlBook.rendition.chapterText();
        surrounding = getSurroundingText(chapterText, cleanText);
      } catch {
        // fallback: no surrounding text
      }
    }

    this.setState({
      selectedText: cleanText,
      surroundingText: surrounding,
      isSelectionCollapsed: false,
    });
  };

  getPluginConfig = (): AIProviderConfig | null => {
    const plugin = (this.props.plugins || []).find(
      (item) => item.key === this.state.aiService
    );
    if (!plugin) return null;
    const config = plugin.config as any;
    return {
      provider: config.provider || "openai",
      apiKey: config.apiKey || "",
      baseUrl: config.baseUrl || "",
      model: config.model || "",
    };
  };

  buildContext = async (): Promise<ReadingContext> => {
    let visibleText = "";
    if (!this.state.selectedText && this.props.htmlBook?.rendition) {
      try {
        const visible = await this.props.htmlBook.rendition.visibleText();
        const visibleStr = (visible || []).join(" ").trim();
        if (visibleStr) {
          const chapterText =
            await this.props.htmlBook.rendition.chapterText();
          visibleText = getSurroundingText(chapterText, visibleStr, 1000);
          if (!visibleText) visibleText = visibleStr;
        }
      } catch {
        // fallback: no visible text context
      }
    }
    return {
      bookTitle: this.props.currentBook?.name || "",
      bookAuthor: this.props.currentBook?.author || "",
      chapterTitle: this.props.currentChapter || "",
      selectedText: this.state.selectedText,
      surroundingText: this.state.surroundingText,
      visibleText,
    };
  };

  scrollToBottom = () => {
    if (ConfigService.getReaderConfig("isManualScroll") === "yes") return;
    this.messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  handleSend = async (text?: string) => {
    const input = text || this.state.inputValue.trim();
    if (!input || this.state.isStreaming) return;

    const config = this.getPluginConfig();
    if (!config || !config.apiKey) return;

    const context = await this.buildContext();
    const plugin = (this.props.plugins || []).find(
      (item) => item.key === this.state.aiService
    );
    const customTemplate = (plugin?.config as any)?.systemPrompt || undefined;
    const systemPrompt = buildSystemPrompt(context, customTemplate);

    const newMessages: { role: "user" | "assistant"; content: string }[] =
      [...this.state.messages, { role: "user" as const, content: input }];

    this.setState(
      {
        messages: newMessages,
        inputValue: "",
        isStreaming: true,
        streamingText: "",
      },
      () => {
        this.scrollToBottom();
        this.doStream(config, systemPrompt, newMessages);
      }
    );
  };

  doStream = async (
    config: AIProviderConfig,
    systemPrompt: string,
    chatMessages: { role: "user" | "assistant"; content: string }[]
  ) => {
    this.abortController = new AbortController();

    const apiMessages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      ...chatMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    let fullText = "";

    await sendChatStream(
      config,
      apiMessages,
      {
        onChunk: (text: string) => {
          fullText += text;
          this.setState({ streamingText: fullText }, this.scrollToBottom);
        },
        onDone: (_finalText: string) => {
          this.setState(
            (prev) => ({
              messages: [
                ...prev.messages,
                { role: "assistant" as const, content: fullText },
              ],
              isStreaming: false,
              streamingText: "",
            }),
            this.scrollToBottom
          );
        },
        onError: (error: string) => {
          this.setState(
            (prev) => ({
              messages: [
                ...prev.messages,
                {
                  role: "assistant" as const,
                  content: `**Error:** ${error}`,
                },
              ],
              isStreaming: false,
              streamingText: "",
            }),
            this.scrollToBottom
          );
        },
      },
      this.abortController.signal
    );
  };

  handleStop = () => {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.state.streamingText) {
      this.setState((prev) => ({
        messages: [
          ...prev.messages,
          { role: "assistant" as const, content: prev.streamingText },
        ],
        isStreaming: false,
        streamingText: "",
      }));
    } else {
      this.setState({ isStreaming: false });
    }
  };

  handleClear = () => {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.setState({
      messages: [],
      streamingText: "",
      isStreaming: false,
    });
  };

  handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  };

  handleQuickPrompt = (prompt: string) => {
    let finalPrompt = prompt;
    if (prompt === "Translate to") {
      const lang = ConfigService.getReaderConfig("lang");
      const target =
        lang && lang.startsWith("zh") ? "Chinese" : "English";
      finalPrompt = `Translate to ${target}`;
    }
    this.handleSend(this.props.t(finalPrompt));
  };

  renderMarkdown = (content: string) => {
    const html = marked.parse(content) as string;
    return Parser(DOMPurify.sanitize(html) || " ");
  };

  handleChangeAiService = (key: string) => {
    this.setState({ aiService: key });
    ConfigService.setReaderConfig("aiService", key);
  };

  handleToggleLock = () => {
    const newLocked = !this.props.isAIPanelLocked;
    this.props.handleAIPanelLock(newLocked);
    if (this.props.renderBookFunc) {
      this.props.renderBookFunc();
    }
  };

  render() {
    const assistantPlugins = (this.props.plugins || []).filter(
      (item) => item.type === "assistant"
    );
    const hasPlugin = assistantPlugins.length > 0;
    const config = this.getPluginConfig();
    const hasApiKey = config && config.apiKey;

    return (
      <div
        className="ai-assistant-container"
        style={{
          backgroundColor: this.props.backgroundColor || undefined,
          color: ConfigService.getReaderConfig("textColor") || undefined,
        }}
      >
        {/* Header */}
        <div className="ai-assistant-header">
          <div className="ai-assistant-header-info">
            <span className="ai-assistant-header-title">
              {this.props.currentBook?.name || this.props.t("AI Assistant")}
            </span>
            {this.props.currentChapter && (
              <span className="ai-assistant-header-chapter">
                {" · "}
                {this.props.currentChapter}
              </span>
            )}
          </div>
          <div className="ai-assistant-header-actions">
            {assistantPlugins.length > 1 && (
              <select
                className="ai-assistant-service-select"
                value={this.state.aiService}
                onChange={(e) => this.handleChangeAiService(e.target.value)}
              >
                {assistantPlugins.map((p) => (
                  <option value={p.key} key={p.key}>
                    {this.props.t(p.displayName)}
                  </option>
                ))}
              </select>
            )}
            <span
              className={
                this.props.isAIPanelLocked
                  ? "icon-lock ai-assistant-lock"
                  : "icon-unlock ai-assistant-lock"
              }
              onClick={this.handleToggleLock}
              data-tooltip-id="my-tooltip"
              data-tooltip-content={
                this.props.isAIPanelLocked
                  ? this.props.t("Unlock reflow")
                  : this.props.t("Reflow reading area")
              }
            ></span>
            <span
              className="icon-close ai-assistant-close"
              onClick={() => {
                this.props.handleAIPanelOpen(false);
                if (this.props.isAIPanelLocked) {
                  this.props.handleAIPanelLock(false);
                  if (this.props.renderBookFunc) {
                    this.props.renderBookFunc();
                  }
                }
              }}
            ></span>
          </div>
        </div>

        {!hasPlugin || !hasApiKey ? (
          <div className="ai-assistant-empty">
            <p>
              <Trans>No AI assistant configured</Trans>
            </p>
            <p className="ai-assistant-empty-hint">
              <Trans>Please add an AI assistant plugin in settings</Trans>
            </p>
          </div>
        ) : (
          <>
            {/* Selected text */}
            {this.state.selectedText && (
              <div className="ai-assistant-selection">
                <div
                  className="ai-assistant-selection-header"
                  onClick={() =>
                    this.setState((prev) => ({
                      isSelectionCollapsed: !prev.isSelectionCollapsed,
                    }))
                  }
                >
                  <span className="ai-assistant-selection-label">
                    <Trans>Selected text</Trans>
                  </span>
                  <span
                    className={`icon-dropdown ai-assistant-selection-toggle ${
                      this.state.isSelectionCollapsed ? "collapsed" : ""
                    }`}
                  ></span>
                </div>
                {!this.state.isSelectionCollapsed && (
                  <div className="ai-assistant-selection-text">
                    {this.state.selectedText}
                  </div>
                )}
              </div>
            )}

            {/* Quick prompts */}
            {this.state.selectedText && (
              <div className="ai-assistant-shortcuts">
                {quickPrompts.map((item) => (
                  <div
                    className="ai-assistant-shortcut"
                    key={item.label}
                    onClick={() => this.handleQuickPrompt(item.prompt)}
                  >
                    {this.props.t(item.label)}
                  </div>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="ai-assistant-messages">
              {this.state.messages.length === 0 &&
                !this.state.isStreaming && (
                  <div className="ai-assistant-welcome">
                    {this.props.t(
                      "Hi there! What questions do you have about this chapter?"
                    )}
                  </div>
                )}
              {this.state.messages.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.role === "user"
                      ? "ai-assistant-msg-user"
                      : "ai-assistant-msg-ai"
                  }
                >
                  {msg.role === "assistant"
                    ? this.renderMarkdown(msg.content)
                    : msg.content}
                </div>
              ))}
              {this.state.isStreaming && (
                <div className="ai-assistant-msg-ai">
                  {this.state.streamingText ? (
                    this.renderMarkdown(this.state.streamingText)
                  ) : (
                    <span className="ai-assistant-thinking">
                      <span className="icon-loading ai-assistant-loading-icon"></span>
                      {this.props.t("Thinking...")}
                    </span>
                  )}
                </div>
              )}
              <div ref={this.messagesEndRef as any} />
            </div>

            {/* Input */}
            <div className="ai-assistant-input-area">
              <div className="ai-assistant-input-row">
                <textarea
                  className="ai-assistant-textarea"
                  placeholder={this.props.t("Type your question...")}
                  value={this.state.inputValue}
                  onChange={(e) =>
                    this.setState({ inputValue: e.target.value })
                  }
                  onKeyDown={this.handleKeyDown}
                  disabled={this.state.isStreaming}
                />
                {this.state.isStreaming ? (
                  <div
                    className="ai-assistant-btn ai-assistant-stop-btn"
                    onClick={this.handleStop}
                  >
                    <Trans>Stop</Trans>
                  </div>
                ) : (
                  <div
                    className="ai-assistant-btn ai-assistant-send-btn"
                    onClick={() => this.handleSend()}
                  >
                    <Trans>Send</Trans>
                  </div>
                )}
              </div>
              <div
                className="ai-assistant-clear-btn"
                onClick={this.handleClear}
              >
                <Trans>Clear conversation</Trans>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }
}

export default AiAssistant;
