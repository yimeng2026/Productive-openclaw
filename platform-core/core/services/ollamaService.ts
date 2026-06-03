import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

export async function ollamaListModels(): Promise<unknown> {
  const res = await axios.get(`${OLLAMA_URL}/api/tags`);
  return res.data;
}

export async function ollamaGenerate(model: string, prompt: string): Promise<unknown> {
  const res = await axios.post(`${OLLAMA_URL}/api/generate`, { model, prompt, stream: false });
  return res.data;
}

export async function ollamaChat(model: string, messages: unknown[]): Promise<unknown> {
  const res = await axios.post(`${OLLAMA_URL}/api/chat`, { model, messages, stream: false });
  return res.data;
}

export async function ollamaStatus(): Promise<unknown> {
  try {
    const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    return { running: true, models: res.data?.models || [] };
  } catch {
    return { running: false, models: [] };
  }
}
