export interface ReadingContext {
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  selectedText: string;
  surroundingText: string;
  visibleText: string;
}

export function getSurroundingText(
  chapterText: string,
  anchorText: string,
  range: number = 1000
): string {
  if (!chapterText || !anchorText) return "";

  const plainText = chapterText.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");
  const cleanAnchor = anchorText.replace(/\s+/g, " ").trim();

  const index = plainText.indexOf(cleanAnchor);
  if (index === -1) return "";

  const start = Math.max(0, index - range);
  const end = Math.min(plainText.length, index + cleanAnchor.length + range);

  return plainText.slice(start, end).trim();
}

const DEFAULT_TEMPLATE = `You are a reading assistant.

The user is currently reading:
- Book: {bookTitle}
- Author: {bookAuthor}
- Chapter: {chapterTitle}
{visibleBlock}
{selectionBlock}
Answer the user's questions based on the reading context above. Be concise, accurate, and helpful. Reply in the same language the user uses.`;

export function buildSystemPrompt(
  context: ReadingContext,
  customTemplate?: string
): string {
  const template = customTemplate || DEFAULT_TEMPLATE;

  let visibleBlock = "";
  if (context.visibleText && !context.selectedText) {
    visibleBlock = `
Content the user is currently reading (including adjacent pages):
---
${context.visibleText}
---`;
  }

  let selectionBlock = "";
  if (context.selectedText) {
    selectionBlock = `
The user has selected the following text:
---
${context.selectedText}
---`;
    if (context.surroundingText) {
      selectionBlock += `

Surrounding content (~1000 chars before and after the selection):
---
${context.surroundingText}
---`;
    }
  }

  const vars: Record<string, string> = {
    bookTitle: context.bookTitle || "Unknown",
    bookAuthor: context.bookAuthor || "Unknown",
    chapterTitle: context.chapterTitle || "Unknown",
    selectedText: context.selectedText || "",
    surroundingText: context.surroundingText || "",
    visibleText: context.visibleText || "",
    selectionBlock: selectionBlock,
    visibleBlock: visibleBlock,
  };

  return template.replace(
    /\{(bookTitle|bookAuthor|chapterTitle|selectedText|surroundingText|visibleText|selectionBlock|visibleBlock)\}/g,
    (_match, key) => vars[key] ?? ""
  );
}
