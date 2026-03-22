import BookModel from "../../models/Book";
import HtmlBookModel from "../../models/HtmlBook";
import PluginModel from "../../models/Plugin";

export interface AiAssistantProps {
  originalText: string;
  currentBook: BookModel;
  currentChapter: string;
  htmlBook: HtmlBookModel;
  plugins: PluginModel[];
  isAIPanelOpen: boolean;
  isAIPanelLocked: boolean;
  backgroundColor: string;
  renderBookFunc: () => void;
  handleAIPanelOpen: (isOpen: boolean) => void;
  handleAIPanelLock: (isLocked: boolean) => void;
  handleFetchPlugins: () => void;
  t: (title: string) => string;
}

export interface AiAssistantState {
  messages: { role: "user" | "assistant"; content: string }[];
  inputValue: string;
  isStreaming: boolean;
  streamingText: string;
  selectedText: string;
  surroundingText: string;
  aiService: string;
  isSelectionCollapsed: boolean;
  copiedIndex: number | null;
}
