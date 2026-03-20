export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIStreamCallback {
  onChunk: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
}

export interface AIProviderConfig {
  provider: "openai" | "anthropic" | "deepseek" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
}

function buildOpenAIRequest(
  config: AIProviderConfig,
  messages: AIMessage[]
): { url: string; headers: Record<string, string>; body: string } {
  return {
    url: config.baseUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
    }),
  };
}

function buildAnthropicRequest(
  config: AIProviderConfig,
  messages: AIMessage[]
): { url: string; headers: Record<string, string>; body: string } {
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  const body: Record<string, any> = {
    model: config.model,
    messages: nonSystemMessages,
    max_tokens: 4096,
    stream: true,
  };
  if (systemMsg) {
    body.system = systemMsg.content;
  }

  return {
    url: config.baseUrl,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  };
}

function buildRequest(
  config: AIProviderConfig,
  messages: AIMessage[]
): { url: string; headers: Record<string, string>; body: string } {
  if (config.provider === "anthropic") {
    return buildAnthropicRequest(config, messages);
  }
  return buildOpenAIRequest(config, messages);
}

function parseOpenAIChunk(data: string): string | null {
  if (data === "[DONE]") return null;
  try {
    const parsed = JSON.parse(data);
    return parsed.choices?.[0]?.delta?.content || null;
  } catch {
    return null;
  }
}

function parseAnthropicChunk(
  eventType: string,
  data: string
): string | null {
  if (eventType === "content_block_delta") {
    try {
      const parsed = JSON.parse(data);
      return parsed.delta?.text || null;
    } catch {
      return null;
    }
  }
  return null;
}

async function processOpenAIStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callback: AIStreamCallback,
  abortSignal?: AbortSignal
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    if (abortSignal?.aborted) {
      reader.cancel();
      return;
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      const text = parseOpenAIChunk(data);
      if (text) {
        fullText += text;
        callback.onChunk(text);
      }
      if (data === "[DONE]") {
        callback.onDone(fullText);
        return;
      }
    }
  }

  callback.onDone(fullText);
}

async function processAnthropicStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callback: AIStreamCallback,
  abortSignal?: AbortSignal
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let currentEvent = "";

  while (true) {
    if (abortSignal?.aborted) {
      reader.cancel();
      return;
    }

    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        currentEvent = "";
        continue;
      }
      if (trimmed.startsWith("event: ")) {
        currentEvent = trimmed.slice(7);
        if (currentEvent === "message_stop") {
          callback.onDone(fullText);
          return;
        }
        continue;
      }
      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        const text = parseAnthropicChunk(currentEvent, data);
        if (text) {
          fullText += text;
          callback.onChunk(text);
        }
      }
    }
  }

  callback.onDone(fullText);
}

export async function sendChatStream(
  config: AIProviderConfig,
  messages: AIMessage[],
  callback: AIStreamCallback,
  abortSignal?: AbortSignal
): Promise<void> {
  const { url, headers, body } = buildRequest(config, messages);

  const timeoutMs = 30000;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const internalAbort = new AbortController();

  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, internalAbort.signal])
    : internalAbort.signal;

  timeoutId = setTimeout(() => {
    internalAbort.abort();
    callback.onError("Request timed out (30s without response)");
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: combinedSignal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") return;
    callback.onError(err.message || "Network error");
    return;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    let errorMsg: string;
    try {
      const errBody = await response.json();
      errorMsg =
        errBody.error?.message || errBody.message || JSON.stringify(errBody);
    } catch {
      errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    }
    callback.onError(errorMsg);
    return;
  }

  if (!response.body) {
    clearTimeout(timeoutId);
    callback.onError("Response body is empty");
    return;
  }

  clearTimeout(timeoutId);

  const reader = response.body.getReader();
  try {
    if (config.provider === "anthropic") {
      await processAnthropicStream(reader, callback, combinedSignal);
    } else {
      await processOpenAIStream(reader, callback, combinedSignal);
    }
  } catch (err: any) {
    if (err.name === "AbortError") return;
    callback.onError(err.message || "Stream processing error");
  }
}

export async function testConnection(
  config: AIProviderConfig
): Promise<boolean> {
  const messages: AIMessage[] = [{ role: "user", content: "hi" }];

  let reqConfig: { url: string; headers: Record<string, string>; body: string };

  if (config.provider === "anthropic") {
    reqConfig = buildAnthropicRequest(config, messages);
    reqConfig.body = JSON.stringify({
      ...JSON.parse(reqConfig.body),
      stream: false,
      max_tokens: 1,
    });
  } else {
    reqConfig = buildOpenAIRequest(config, messages);
    reqConfig.body = JSON.stringify({
      ...JSON.parse(reqConfig.body),
      stream: false,
      max_completion_tokens: 10,
    });
  }

  const response = await fetch(reqConfig.url, {
    method: "POST",
    headers: reqConfig.headers,
    body: reqConfig.body,
  });

  if (!response.ok) {
    let errorMsg: string;
    try {
      const errBody = await response.json();
      errorMsg =
        errBody.error?.message || errBody.message || JSON.stringify(errBody);
    } catch {
      errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    }
    throw new Error(errorMsg);
  }

  return true;
}
