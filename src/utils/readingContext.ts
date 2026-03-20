export interface ReadingContext {
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  selectedText: string;
  surroundingText: string;
}

export function getSurroundingText(
  chapterText: string,
  selectedText: string,
  range: number = 100
): string {
  if (!chapterText || !selectedText) return "";

  const plainText = chapterText.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  const cleanSelected = selectedText.replace(/\s+/g, " ").trim();

  const index = plainText.indexOf(cleanSelected);
  if (index === -1) return "";

  const start = Math.max(0, index - range);
  const end = Math.min(plainText.length, index + cleanSelected.length + range);

  return plainText.slice(start, end).trim();
}

const DEFAULT_TEMPLATE = `你是一个阅读助手。

用户正在阅读：
- 书名：{bookTitle}
- 作者：{bookAuthor}
- 当前章节：{chapterTitle}
{selectionBlock}
请基于以上阅读上下文回答用户的问题。回答要简洁、准确、有帮助。`;

export function buildSystemPrompt(
  context: ReadingContext,
  customTemplate?: string
): string {
  const template = customTemplate || DEFAULT_TEMPLATE;

  let selectionBlock = "";
  if (context.selectedText) {
    selectionBlock = `
用户选中了以下文字：
---
${context.selectedText}
---`;
    if (context.surroundingText) {
      selectionBlock += `

附近内容（前后各 100 字）：
---
${context.surroundingText}
---`;
    }
  }

  return template
    .replace(/\{bookTitle\}/g, context.bookTitle || "未知")
    .replace(/\{bookAuthor\}/g, context.bookAuthor || "未知")
    .replace(/\{chapterTitle\}/g, context.chapterTitle || "未知")
    .replace(/\{selectedText\}/g, context.selectedText || "")
    .replace(/\{surroundingText\}/g, context.surroundingText || "")
    .replace(/\{selectionBlock\}/g, selectionBlock);
}
