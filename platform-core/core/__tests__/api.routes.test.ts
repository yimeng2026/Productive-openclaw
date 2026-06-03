import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// Import the routers directly — we mount them on a test app
import agentsRouter from '../routes/agents';
import healthRouter from '../routes/health';

describe('API Routes — /api/agents', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agents', agentsRouter);
  });

  describe('GET /api/agents', () => {
    it('returns empty agents array initially', async () => {
      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('agents');
      expect(Array.isArray(res.body.agents)).toBe(true);
    });
  });

  describe('POST /api/agents', () => {
    it('creates a new agent with default values', async () => {
      const res = await request(app)
        .post('/api/agents')
        .send({ name: 'Test Agent' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Agent');
      expect(res.body.status).toBe('idle');
      expect(res.body).toHaveProperty('createdAt');
      expect(res.body.agentType).toBe('agent');
    });

    it('creates agent with all fields', async () => {
      const payload = {
        name: 'Full Agent',
        agentType: 'entity',
        platform: 'OpenAI',
        model: 'gpt-4o',
        skills: ['coding', 'review'],
      };
      const res = await request(app).post('/api/agents').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Full Agent');
      expect(res.body.agentType).toBe('entity');
      expect(res.body.platform).toBe('OpenAI');
      expect(res.body.model).toBe('gpt-4o');
      expect(res.body.skills).toEqual(['coding', 'review']);
    });

    it('uses default name when not provided', async () => {
      const res = await request(app).post('/api/agents').send({});
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('unnamed');
    });

    it('assigns unique ids', async () => {
      const res1 = await request(app).post('/api/agents').send({ name: 'A' });
      const res2 = await request(app).post('/api/agents').send({ name: 'B' });
      expect(res1.body.id).not.toBe(res2.body.id);
    });
  });

  describe('GET /api/agents/:id', () => {
    it('returns agent by id', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .send({ name: 'Findable' });
      const id = createRes.body.id;

      const res = await request(app).get(`/api/agents/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(res.body.name).toBe('Findable');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await request(app).get('/api/agents/nonexistent-id');
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });
  });

  describe('PUT /api/agents/:id', () => {
    it('updates agent name', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .send({ name: 'Old Name' });
      const id = createRes.body.id;

      const res = await request(app)
        .put(`/api/agents/${id}`)
        .send({ name: 'New Name' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('New Name');
    });

    it('updates agent status', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .send({ name: 'Status Test' });
      const id = createRes.body.id;

      const res = await request(app)
        .put(`/api/agents/${id}`)
        .send({ status: 'running' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('running');
    });

    it('updates agent platform and model', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .send({ name: 'Platform Test' });
      const id = createRes.body.id;

      const res = await request(app)
        .put(`/api/agents/${id}`)
        .send({ platform: 'Claude', model: 'claude-3' });

      expect(res.status).toBe(200);
      expect(res.body.platform).toBe('Claude');
      expect(res.body.model).toBe('claude-3');
    });

    it('updates agent skills', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .send({ name: 'Skills Test' });
      const id = createRes.body.id;

      const res = await request(app)
        .put(`/api/agents/${id}`)
        .send({ skills: ['new-skill'] });

      expect(res.status).toBe(200);
      expect(res.body.skills).toEqual(['new-skill']);
    });

    it('updates fileCount and memoryCount', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .send({ name: 'Counts Test' });
      const id = createRes.body.id;

      const res = await request(app)
        .put(`/api/agents/${id}`)
        .send({ fileCount: 5, memoryCount: 3 });

      expect(res.status).toBe(200);
      expect(res.body.fileCount).toBe(5);
      expect(res.body.memoryCount).toBe(3);
    });

    it('ignores undefined fields', async () => {
      const createRes = await request(app)
        .post('/api/agents')
        .send({ name: 'Immutable', status: 'idle', platform: 'Test' });
      const id = createRes.body.id;

      const res = await request(app)
        .put(`/api/agents/${id}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
      expect(res.body.status).toBe('idle');
      expect(res.body.platform).toBe('Test');
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await request(app)
        .put('/api/agents/nonexistent-id')
        .send({ name: 'New Name' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });
});

describe('API Routes — /api/health', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use('/api/health', healthRouter);
  });

  it('returns health status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status');
  });
});

describe('API Routes — Error Handling', () => {
  it('returns 404 for unknown route', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/agents', agentsRouter);

    const res = await request(app).get('/api/agents/');
    expect(res.status).toBe(200); // agents router handles /

    const res404 = await request(app).get('/api/unknown');
    expect(res404.status).toBe(404);
  });
});
