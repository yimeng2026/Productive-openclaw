import { getDb } from '../database/sqlite';
import type { Memory } from '../types';

export async function listMemories(agentId?: string): Promise<Memory[]> {
  const db = await getDb();
  if (agentId) {
    return db.all('SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at DESC', agentId);
  }
  return db.all('SELECT * FROM memories ORDER BY created_at DESC');
}

export async function getMemory(id: string): Promise<Memory | undefined> {
  const db = await getDb();
  return db.get('SELECT * FROM memories WHERE id = ?', id);
}

export async function createMemory(data: Omit<Memory, 'id' | 'createdAt'>): Promise<Memory> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.run(
    'INSERT INTO memories (id, agent_id, content, type, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, data.agentId, data.content, data.type, createdAt]
  );
  return { ...data, id, createdAt };
}

export async function deleteMemory(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run('DELETE FROM memories WHERE id = ?', id);
  return (result.changes ?? 0) > 0;
}
