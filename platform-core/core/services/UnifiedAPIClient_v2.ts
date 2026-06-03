import { apiConfigEngine } from "./UnifiedAPIConfig";

export interface UnifiedRequest {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  extra?: Record<string, unknown>;
}

export interface UnifiedResponse {
  id: string;
  model: string;
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason: string;
  raw?: Record<string, unknown>;
}

export interface UnifiedStreamChunk {
  id: string;
  model: string;
  delta: string;
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export abstract class BaseAdapter {
  protected config = apiConfigEngine;

  constructor(public platform: string) {}

  abstract chat(request: UnifiedRequest): Promise<UnifiedResponse>;
  abstract chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk>;

  protected async fetchWithAuth(
    url: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  protected extractContent(data: Record<string, unknown>): string {
    if (typeof data.content === "string") return data.content;
    if (Array.isArray(data.content)) {
      return data.content.map((c: any) => c.text || c).join("");
    }
    if (typeof data.text === "string") return data.text;
    if (typeof data.message === "string") return data.message;
    if (typeof data.response === "string") return data.response;
    return "";
  }
}

export class OpenClawAdapter extends BaseAdapter {
  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const cfg = this.config.getPreset("openclaw");
    if (!cfg) throw new Error("OpenClaw preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/api/v1/chat/completions`,
      { model: request.model || cfg.defaultModel, messages: request.messages },
      { Authorization: `Bearer ${this.config.getPreset("openclaw")}` }
    );
    const data = await res.json();
    return {
      id: data.id || "oc-" + Date.now(),
      model: request.model || cfg.defaultModel,
      content: this.extractContent(data),
      usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: data.finish_reason || "stop",
      raw: data,
    };
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    const cfg = this.config.getPreset("openclaw");
    if (!cfg) throw new Error("OpenClaw preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/api/v1/chat/completions`,
      { model: request.model || cfg.defaultModel, messages: request.messages, stream: true },
      { Authorization: `Bearer ${this.config.getPreset("openclaw")}` }
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6).trim();
          if (json === "[DONE]") return;
          try {
            const data = JSON.parse(json);
            yield {
              id: data.id || "oc-stream-" + Date.now(),
              model: request.model || cfg.defaultModel,
              delta: this.extractContent(data.choices?.[0]?.delta || {}),
              finishReason: data.choices?.[0]?.finish_reason,
            };
          } catch {}
        }
      }
    }
  }
}

export class KimiAdapter extends BaseAdapter {
  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const cfg = this.config.getPreset("kimi");
    if (!cfg) throw new Error("Kimi preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/v1/chat/completions`,
      { model: request.model || cfg.defaultModel, messages: request.messages },
      { Authorization: `Bearer ${this.config.getPreset("kimi")}` }
    );
    const data = await res.json();
    return {
      id: data.id || "kimi-" + Date.now(),
      model: request.model || cfg.defaultModel,
      content: this.extractContent(data.choices?.[0]?.message || {}),
      usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: data.choices?.[0]?.finish_reason || "stop",
      raw: data,
    };
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    const cfg = this.config.getPreset("kimi");
    if (!cfg) throw new Error("Kimi preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/v1/chat/completions`,
      { model: request.model || cfg.defaultModel, messages: request.messages, stream: true },
      { Authorization: `Bearer ${this.config.getPreset("kimi")}` }
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6).trim();
          if (json === "[DONE]") return;
          try {
            const data = JSON.parse(json);
            yield {
              id: data.id || "kimi-stream-" + Date.now(),
              model: request.model || cfg.defaultModel,
              delta: this.extractContent(data.choices?.[0]?.delta || {}),
              finishReason: data.choices?.[0]?.finish_reason,
            };
          } catch {}
        }
      }
    }
  }
}

export class ClaudeAdapter extends BaseAdapter {
  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const cfg = this.config.getPreset("claude");
    if (!cfg) throw new Error("Claude preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/v1/messages`,
      {
        model: request.model || cfg.defaultModel,
        max_tokens: request.maxTokens || 4096,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      },
      {
        "x-api-key": this.config.getPreset("claude")?.defaultModel || "",
        "anthropic-version": "2023-06-01",
      }
    );
    const data = await res.json();
    return {
      id: data.id || "claude-" + Date.now(),
      model: request.model || cfg.defaultModel,
      content: Array.isArray(data.content)
        ? data.content.map((c: any) => c.text || "").join("")
        : this.extractContent(data),
      usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: data.stop_reason || "stop",
      raw: data,
    };
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    const cfg = this.config.getPreset("claude");
    if (!cfg) throw new Error("Claude preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/v1/messages`,
      {
        model: request.model || cfg.defaultModel,
        max_tokens: request.maxTokens || 4096,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      },
      {
        "x-api-key": this.config.getPreset("claude")?.defaultModel || "",
        "anthropic-version": "2023-06-01",
      }
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6).trim();
          if (json === "[DONE]") return;
          try {
            const data = JSON.parse(json);
            const delta = data.delta;
            yield {
              id: data.message?.id || "claude-stream-" + Date.now(),
              model: request.model || cfg.defaultModel,
              delta: typeof delta?.text === "string" ? delta.text : "",
              finishReason: data.message?.stop_reason,
            };
          } catch {}
        }
      }
    }
  }
}

export class OpenAIAdapter extends BaseAdapter {
  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const cfg = this.config.getPreset("openai");
    if (!cfg) throw new Error("OpenAI preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/v1/chat/completions`,
      { model: request.model || cfg.defaultModel, messages: request.messages },
      { Authorization: `Bearer ${this.config.getPreset("openai")}` }
    );
    const data = await res.json();
    return {
      id: data.id || "openai-" + Date.now(),
      model: request.model || cfg.defaultModel,
      content: this.extractContent(data.choices?.[0]?.message || {}),
      usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: data.choices?.[0]?.finish_reason || "stop",
      raw: data,
    };
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    const cfg = this.config.getPreset("openai");
    if (!cfg) throw new Error("OpenAI preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/v1/chat/completions`,
      { model: request.model || cfg.defaultModel, messages: request.messages, stream: true },
      { Authorization: `Bearer ${this.config.getPreset("openai")}` }
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6).trim();
          if (json === "[DONE]") return;
          try {
            const data = JSON.parse(json);
            yield {
              id: data.id || "openai-stream-" + Date.now(),
              model: request.model || cfg.defaultModel,
              delta: this.extractContent(data.choices?.[0]?.delta || {}),
              finishReason: data.choices?.[0]?.finish_reason,
            };
          } catch {}
        }
      }
    }
  }
}

export class OllamaAdapter extends BaseAdapter {
  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const cfg = this.config.getPreset("ollama");
    if (!cfg) throw new Error("Ollama preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/api/chat`,
      { model: request.model || cfg.defaultModel, messages: request.messages, stream: false },
      {}
    );
    const data = await res.json();
    return {
      id: data.id || "ollama-" + Date.now(),
      model: request.model || cfg.defaultModel,
      content: this.extractContent(data.message || {}),
      usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: data.done ? "stop" : "length",
      raw: data,
    };
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    const cfg = this.config.getPreset("ollama");
    if (!cfg) throw new Error("Ollama preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/api/chat`,
      { model: request.model || cfg.defaultModel, messages: request.messages, stream: true },
      {}
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          yield {
            id: data.id || "ollama-stream-" + Date.now(),
            model: request.model || cfg.defaultModel,
            delta: this.extractContent(data.message || {}),
            finishReason: data.done ? "stop" : undefined,
          };
        } catch {}
      }
    }
  }
}

export class HermesAdapter extends BaseAdapter {
  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const cfg = this.config.getPreset("hermes");
    if (!cfg) throw new Error("Hermes preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/api/generate`,
      { model: request.model || cfg.defaultModel, prompt: request.messages.map((m) => m.content).join("\n"), stream: false },
      { "X-API-Key": this.config.getPreset("hermes")?.defaultModel || "" }
    );
    const data = await res.json();
    return {
      id: data.id || "hermes-" + Date.now(),
      model: request.model || cfg.defaultModel,
      content: this.extractContent(data),
      usage: data.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: data.done ? "stop" : "length",
      raw: data,
    };
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    const cfg = this.config.getPreset("hermes");
    if (!cfg) throw new Error("Hermes preset not found");
    const res = await this.fetchWithAuth(
      `${cfg.defaultBaseUrl}/api/generate`,
      { model: request.model || cfg.defaultModel, prompt: request.messages.map((m) => m.content).join("\n"), stream: true },
      { "X-API-Key": this.config.getPreset("hermes")?.defaultModel || "" }
    );
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          yield {
            id: data.id || "hermes-stream-" + Date.now(),
            model: request.model || cfg.defaultModel,
            delta: this.extractContent(data),
            finishReason: data.done ? "stop" : undefined,
          };
        } catch {}
      }
    }
  }
}

export class CustomAdapter extends BaseAdapter {
  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    const cfg = this.config.getPreset("custom");
    if (!cfg) throw new Error("Custom preset not found");
    throw new Error("Custom adapter requires manual implementation");
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    throw new Error("Custom adapter requires manual implementation");
  }
}

export const ADAPTERS: Record<string, new () => BaseAdapter> = {
  openclaw: OpenClawAdapter,
  kimi: KimiAdapter,
  claude: ClaudeAdapter,
  openai: OpenAIAdapter,
  ollama: OllamaAdapter,
  hermes: HermesAdapter,
  custom: CustomAdapter,
};

export class UnifiedAPIClient {
  private adapter: BaseAdapter;

  constructor(platform: string) {
    const AdapterClass = ADAPTERS[platform];
    if (!AdapterClass) throw new Error(`Unsupported platform: ${platform}`);
    this.adapter = new AdapterClass();
  }

  async chat(request: UnifiedRequest): Promise<UnifiedResponse> {
    return this.adapter.chat(request);
  }

  async *chatStream(request: UnifiedRequest): AsyncGenerator<UnifiedStreamChunk> {
    yield* this.adapter.chatStream(request);
  }
}
