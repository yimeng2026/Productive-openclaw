import axios from 'axios';

const AGENT_ZERO_URL = process.env.AGENT_ZERO_URL || 'http://localhost:5000';

export async function agentZeroGet(path: string): Promise<any> {
  const res = await axios.get(`${AGENT_ZERO_URL}${path}`);
  return res.data;
}

export async function agentZeroPost(path: string, data: unknown): Promise<any> {
  const res = await axios.post(`${AGENT_ZERO_URL}${path}`, data);
  return res.data;
}

export async function agentZeroDelete(path: string): Promise<any> {
  const res = await axios.delete(`${AGENT_ZERO_URL}${path}`);
  return res.data;
}

export async function fetchAllAgentRuntimes(): Promise<any[]> {
  try {
    const status = await agentZeroGet('/status');
    return status?.agents || [];
  } catch {
    return [];
  }
}
