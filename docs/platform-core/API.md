# Sylva Platform — Backend API Documentation

> **Version:** 2.0.0  
> **Base URL:** `http://localhost:3000`  
> **Content-Type:** `application/json`  
> **WebSocket Path:** `/ws`  

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Pagination & Common Patterns](#pagination--common-patterns)
4. [Error Handling](#error-handling)
5. [Endpoints](#endpoints)
   - [Health](#health)
   - [Agents](#agents)
   - [Channels](#channels)
   - [Models](#models)
   - [Auth](#auth)
   - [Tasks](#tasks)
   - [Monitor](#monitor)
   - [Platforms](#platforms)
   - [Skills](#skills)
   - [Workspaces](#workspaces)
   - [Handoff](#handoff)
   - [Knowledge Bases](#knowledge-bases)
   - [Backup](#backup)
   - [Logs](#logs)
   - [Memories](#memories)
   - [Uploads](#uploads)
   - [Webhooks](#webhooks)
   - [Security](#security)
   - [Settings](#settings)
   - [Scheduler](#scheduler)
   - [Search](#search)
   - [Process](#process)
   - [Registry](#registry)
   - [AI Search](#ai-search)
   - [Ollama](#ollama)
   - [Agent Zero](#agent-zero)
   - [Coordinator](#coordinator)
   - [Events](#events)
   - [External](#external)
   - [Google Chat](#google-chat)
   - [Groups](#groups)
   - [API Keys](#api-keys)
   - [Imports](#imports)
   - [Unified](#unified)
   - [Platform Details](#platform-details)
   - [Agents V2 / Swarm](#agents-v2--swarm)
   - [Agents Runtime](#agents-runtime)
6. [WebSocket](#websocket)
7. [Data Models](#data-models)
8. [HTTP Status Codes](#http-status-codes)

---

## Overview

Sylva Platform exposes a RESTful HTTP API and a WebSocket endpoint for real-time communication. All timestamps are in milliseconds since Unix epoch unless otherwise noted.

| Protocol | Endpoint | Purpose |
|----------|----------|---------|
| HTTP | `GET /api/health` | Service health check |
| HTTP | `/api/agents` | Agent CRUD & lifecycle |
| HTTP | `/api/channels` | Channel CRUD operations |
| HTTP | `/api/models` | Model registry CRUD |
| HTTP | `/api/auth` | Authentication |
| HTTP | `/api/tasks` | Task scheduling & tracking |
| HTTP | `/api/monitor` | System & platform monitoring |
| WS | `ws://host:port/ws` | Real-time events & push |

---

## Authentication

> **Current Version:** Bearer JWT + API Key dual mode.

```
Authorization: Bearer <jwt-token>
# or
Authorization: ApiKey <your-api-key>
```

When authentication is enabled, the following endpoints are public:
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `WS /ws` (connection only; messages may require auth)

All other endpoints return **401 Unauthorized** if the header is missing or invalid.

---

## Pagination & Common Patterns

### List Endpoints

All list endpoints support uniform pagination:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `page` | integer | 1 | — | Page number (1-based) |
| `limit` | integer | 20 | 100 | Items per page |
| `sortBy` | string | varies | — | Sort field |
| `sortOrder` | string | `asc` | — | `asc` or `desc` |

### Response Shape (List)

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20,
  "totalPages": 0
}
```

### Response Shape (Single Resource)

```json
{
  "data": { ... },
  "message": "optional human-readable hint",
  "timestamp": 1716115200000
}
```

---

## Error Handling

All errors use the following JSON structure:

```json
{
  "code": "RESOURCE_NOT_FOUND",
  "message": "Agent with id 'agent_xxx' not found",
  "statusCode": 404,
  "details": {},
  "timestamp": 1716115200000
}
```

### Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `BAD_REQUEST` | 400 | Malformed request body or query |
| `UNAUTHORIZED` | 401 | Missing or invalid credentials |
| `FORBIDDEN` | 403 | Valid credentials but insufficient permissions |
| `RESOURCE_NOT_FOUND` | 404 | Requested resource does not exist |
| `METHOD_NOT_ALLOWED` | 405 | HTTP method not supported on this path |
| `CONFLICT` | 409 | Resource already exists or state conflict |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unhandled server error |
| `SERVICE_UNAVAILABLE` | 503 | Dependency (e.g., model provider) is down |

---

## Endpoints

---

### Health

#### `GET /api/health`

Returns the current health status of the Sylva backend.

**Parameters:** None

**Response Body:**

```json
{
  "status": "ok",
  "uptime": 3600.42
}
```

#### `GET /api/health/stats`

Extended health with full system metrics (CPU, memory, disk, load average, health score).

#### `GET /api/health/dashboard`

Dashboard-ready health aggregation including per-service status map.

---

### Agents

#### `GET /api/agents`

List all agents with optional filtering by `status`, `health`, `role`, `skill`.

#### `GET /api/agents/:id`

Retrieve a single agent with enriched data (task counts, provider health status).

#### `POST /api/agents`

Create a new agent with `name`, `levelA`, `levelB`, `levelC`, `role`, `skills`, `systemPrompt`, `temperature`, `maxTokens`, `maxConcurrentTasks`.

#### `PUT /api/agents/:id`

Update an existing agent. Partial updates supported.

#### `DELETE /api/agents/:id`

Delete an agent. Idempotent.

#### `GET /api/agents/:id/tasks`

List tasks assigned to a specific agent.

#### `POST /api/agents/:id/tasks`

Submit a new task to a specific agent.

#### `GET /api/agents/:id/health`

Get the real-time health status of an agent's bound providers.

---

### Agents Runtime

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents-runtime` | List runtime agents |
| POST | `/api/agents-runtime/:id/start` | Start an agent runtime |
| POST | `/api/agents-runtime/:id/stop` | Stop an agent runtime |

---

### Agents V2 / Swarm

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents-v2/providers` | List AI providers |
| GET | `/api/agents-v2/swarm` | List swarm configurations |
| POST | `/api/agents-v2/swarm` | Create a swarm |
| GET | `/api/agents-v2/agents` | List agents (V2 view) |
| GET | `/api/agents-v2/agents/:id` | Agent detail (V2) |
| PUT | `/api/agents-v2/agents/:id` | Update agent (V2) |
| DELETE | `/api/agents-v2/agents/:id` | Delete agent (V2) |
| POST | `/api/agents-v2/agents/:id/tasks` | Submit task to agent (V2) |
| GET | `/api/agents-v2/skills` | List skills |
| GET | `/api/agents-v2/skills/:id/health` | Skill health check |
| POST | `/api/agents-v2/skills/scan` | Scan for new skills |
| GET | `/api/agents-v2/tasks/:taskId` | Task detail |
| GET | `/api/agents-v2/tasks/:taskId/results` | Task results |
| POST | `/api/agents-v2/tasks` | Create task |
| POST | `/api/agents-v2/tasks/:taskId/interrupt` | Interrupt task |
| GET | `/api/agents-v2/workspace/files` | List workspace files |
| POST | `/api/agents-v2/workspace/import` | Import workspace asset |
| GET/POST | `/api/agents-v2/groups/:groupId/*` | Group management (status, meetings, relays, reorg, conflicts, health, hierarchy, interrupt, resolve) |
| POST | `/api/agents-v2/agents/:agentId/knowledge-bases` | Bind knowledge base to agent |

---

### Channels

#### `GET /api/channels`

List all channels.

#### `GET /api/channels/:id`

Retrieve a single channel.

#### `POST /api/channels`

Create a new channel.

---

### Models

#### `GET /api/models`

List all registered AI models, grouped by platform.

#### `GET /api/models/all`

Cross-platform model summary.

#### `GET /api/models/:id`

Retrieve a single model with provider features and status.

#### `GET /api/models/platforms/:platformId`

Filter models by platform ID.

---

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |
| POST | `/api/auth/refresh` | Refresh JWT token |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user profile |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password |

---

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks |
| GET | `/api/tasks/stats` | Task statistics |
| GET | `/api/tasks/:id` | Task detail |
| GET | `/api/tasks/:id/progress` | Task progress |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/:id/status` | Update task status |
| DELETE | `/api/tasks/:id` | Delete task |

---

### Monitor

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/monitor` | Full monitoring dashboard data |
| GET | `/api/monitor/system` | System metrics only |
| GET | `/api/monitor/platforms` | Platform health statuses |
| GET | `/api/monitor/agents` | Agent status list |
| GET | `/api/monitor/tasks` | Task status list |
| GET | `/api/monitor/skills` | Skill health list |
| GET | `/api/monitor/alerts` | Active alerts |
| GET | `/api/monitor/stream` | SSE real-time monitor stream |
| GET | `/api/monitor/config` | Monitor configuration |
| POST | `/api/monitor/config/refresh` | Refresh monitor config |
| POST | `/api/monitor/config/ollama` | Update Ollama config |
| POST | `/api/monitor/config/skills` | Update skills config |
| GET | `/api/monitor/websocket` | WebSocket monitor endpoint |

---

### Platforms

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platforms` | List registered platforms |
| GET | `/api/platforms/tiers` | Platform tier classification |
| GET | `/api/platforms/:id` | Platform detail |
| GET | `/api/platforms/:id/models` | Models available on platform |
| POST | `/api/platforms` | Register a platform |
| POST | `/api/platforms/:id/test` | Test platform connectivity |
| POST | `/api/platforms/ollama/refresh` | Refresh Ollama model list |
| POST | `/api/platforms/rescan` | Rescan all platforms |

---

### Platform Details

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platform-details/hermes/status` | Hermes memory status |
| GET | `/api/platform-details/hermes/graph` | Hermes knowledge graph |
| GET | `/api/platform-details/agent-zero/status` | Agent Zero status |
| GET | `/api/platform-details/ollama/models` | Ollama model list |
| GET | `/api/platform-details/ollama/usage` | Ollama usage stats |
| GET | `/api/platform-details/mega-hub/status` | Mega Hub status |
| GET | `/api/platform-details/model-router/status` | Model Router status |

---

### Skills

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills` | List skills |
| GET | `/api/skills/library` | Skill library catalog |
| GET | `/api/skills/categories` | Skill categories |
| GET | `/api/skills/platforms` | Skills by platform |
| POST | `/api/skills/scan` | Scan for skills |
| POST | `/api/skills/install` | Install a skill |
| PUT | `/api/skills/:id/toggle` | Enable/disable skill |
| GET | `/api/skills/:id/health` | Skill health check |

---

### Workspaces

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workspaces/tasks` | Workspace tasks |
| GET | `/api/workspaces/tasks/:id` | Workspace task detail |
| POST | `/api/workspaces/tasks/:id/import` | Import task into workspace |
| GET | `/api/workspaces/knowledge` | Workspace knowledge items |
| GET | `/api/workspaces/knowledge/:id` | Knowledge item detail |
| POST | `/api/workspaces/knowledge/import` | Import knowledge |
| GET | `/api/workspaces/stats` | Workspace statistics |

---

### Handoff

> Handoff Gateway — 跨域Agent群组交接管控。

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/handoff/groups` | List handoff groups |
| GET | `/api/handoff/groups/hierarchy` | Group hierarchy tree |
| GET | `/api/handoff/templates` | List handoff templates |
| POST | `/api/handoff/templates` | Create handoff template |
| GET | `/api/handoff/records` | List handoff records |
| POST | `/api/handoff/inter-domain` | Initiate cross-domain handoff |
| GET | `/api/handoff/domain/:domainId` | Domain handoff detail |

---

### Knowledge Bases

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/knowledge-bases` | List knowledge bases |

---

### Backup

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/backup` | List backups |
| POST | `/api/backup` | Create backup |
| GET | `/api/backup/:id` | Backup detail |
| POST | `/api/backup/:id/restore` | Restore from backup |
| GET | `/api/backup/:id/download` | Download backup |
| GET | `/api/backup/:id/verify` | Verify backup integrity |
| DELETE | `/api/backup/:id` | Delete backup |

---

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs` | List logs |
| GET | `/api/logs/stats` | Log statistics |
| GET | `/api/logs/:id` | Log detail |
| POST | `/api/logs/export` | Export logs |
| POST | `/api/logs` | Create log entry |

---

### Memories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/memories` | List memories |
| GET | `/api/memories/:id` | Memory detail |
| POST | `/api/memories` | Create memory |
| DELETE | `/api/memories/:id` | Delete memory |
| POST | `/api/memories/search` | Semantic memory search |
| POST | `/api/memories/:id/sync` | Sync memory with backend |

---

### Uploads

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/uploads` | List uploads |
| POST | `/api/uploads` | Upload file |
| GET | `/api/uploads/:id/download` | Download uploaded file |
| GET | `/api/uploads/:id/preview` | Preview uploaded file |
| DELETE | `/api/uploads/:id` | Delete upload |

---

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks` | Create webhook |
| GET | `/api/webhooks/:id` | Webhook detail |
| PUT | `/api/webhooks/:id` | Update webhook |
| DELETE | `/api/webhooks/:id` | Delete webhook |
| POST | `/api/webhooks/:id/test` | Test webhook |

---

### Security

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/security/acl` | List ACL entries |
| POST | `/api/security/acl` | Create ACL entry |
| PUT | `/api/security/acl/:id` | Update ACL entry |
| DELETE | `/api/security/acl/:id` | Delete ACL entry |
| GET | `/api/security/ip-blocklist` | IP blocklist |
| POST | `/api/security/ip-blocklist` | Add IP to blocklist |
| DELETE | `/api/security/ip-blocklist/:id` | Remove IP from blocklist |
| GET | `/api/security/audit-logs` | Security audit logs |

---

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | List all settings |
| GET | `/api/settings/:key` | Get setting by key |
| PUT | `/api/settings/:key` | Update setting |
| DELETE | `/api/settings/:key` | Delete setting |

---

### Scheduler

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/scheduler/tasks` | List scheduled tasks |
| POST | `/api/scheduler/tasks` | Create scheduled task |
| GET | `/api/scheduler/tasks/:id` | Scheduled task detail |
| PUT | `/api/scheduler/tasks/:id` | Update scheduled task |
| DELETE | `/api/scheduler/tasks/:id` | Delete scheduled task |
| POST | `/api/scheduler/tasks/:id/run` | Run scheduled task now |
| POST | `/api/scheduler/tasks/:id/pause` | Pause scheduled task |
| POST | `/api/scheduler/tasks/:id/resume` | Resume scheduled task |

---

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search` | Full-text search |
| GET | `/api/search/indexes` | List search indexes |
| POST | `/api/search/indexes` | Create search index |
| POST | `/api/search/indexes/:name/reindex` | Rebuild index |

---

### Process

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/process` | List managed processes |
| GET | `/api/process/stats` | Process statistics |
| GET | `/api/process/:id` | Process detail |
| POST | `/api/process/:id/restart` | Restart process |
| POST | `/api/process/:id/kill` | Kill process |

---

### Registry

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/registry` | List registry entries |
| GET | `/api/registry/:id` | Registry entry detail |

---

### AI Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ai-search` | AI-enhanced search query |
| POST | `/api/ai-search` | Submit AI search task |

---

### Ollama

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ollama/models` | List Ollama local models |
| GET | `/api/ollama/status` | Ollama service status |
| POST | `/api/ollama/generate` | Generate via Ollama |
| POST | `/api/ollama/chat` | Chat via Ollama |

---

### Agent Zero

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agent-zero` | Agent Zero overview |
| GET | `/api/agent-zero/monitor` | Monitor dashboard |
| GET | `/api/agent-zero/monitor/agents` | Monitored agents |
| GET | `/api/agent-zero/monitor/tasks` | Monitored tasks |
| GET | `/api/agent-zero/monitor/topology` | Topology view |
| GET | `/api/agent-zero/monitor/metrics` | Metrics data |
| GET | `/api/agent-zero/workspace` | Workspace list |
| GET | `/api/agent-zero/workspace/download` | Download workspace |
| POST | `/api/agent-zero/workspace/upload` | Upload to workspace |
| POST | `/api/agent-zero/run` | Run Agent Zero command |
| DELETE | `/api/agent-zero/:id` | Remove Agent Zero instance |

---

### Coordinator

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/coordinator/hierarchy` | Coordinator hierarchy |
| GET | `/api/coordinator/status/:id` | Coordinator status |
| POST | `/api/coordinator/election` | Leader election |
| POST | `/api/coordinator/route` | Route task to coordinator |
| GET | `/api/coordinator/strategies` | Routing strategies |
| PUT | `/api/coordinator/strategies` | Update routing strategies |
| GET | `/api/coordinator/swarm` | Swarm status |
| GET | `/api/coordinator/swarm/:id` | Swarm member detail |

---

### Events

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/events/poll` | Poll for new events |
| GET | `/api/events/stats` | Event statistics |

---

### External

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/external` | List external integrations |
| GET | `/api/external/:endpoint` | Proxy to external API endpoint |

---

### Google Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/google-chat` | Google Chat integration status |

---

### Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/groups/:groupId/meeting` | Start group meeting |
| POST | `/api/groups/:groupId/relay` | Relay message to group |
| POST | `/api/groups/:groupId/interrupt` | Interrupt group activity |
| POST | `/api/groups/:groupId/meeting/end` | End group meeting |

---

### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/apikeys` | List API keys |
| POST | `/api/apikeys` | Create API key |
| DELETE | `/api/apikeys/:id` | Revoke API key |

---

### Imports

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/imports` | Import data/asset |
| GET | `/api/imports` | List import jobs |

---

### Unified

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/unified` | Unified platform status overview |

---

## WebSocket

### Connection

```javascript
const ws = new WebSocket("ws://localhost:3000/ws");
```

The server immediately sends a `connected` message upon successful handshake.

### Client → Server Messages

| Type | Description | Payload |
|------|-------------|---------|
| `heartbeat` | Keep-alive ping | `{ sequence: number }` |
| `subscribe` | Subscribe to channel(s) | `{ channels: string[] }` |
| `unsubscribe` | Unsubscribe from channel(s) | `{ channels: string[] }` |
| `chat-message` | Send a chat message | `{ message: Message, sessionId?: string }` |
| `ack` | Acknowledge a server push | `{ id: string }` |

### Server → Client Messages

| Type | Description | Payload |
|------|-------------|---------|
| `connected` | Handshake complete | `{ clientId?: string, status: "connected" }` |
| `disconnected` | Connection closing | `{ clientId?: string, status: "disconnected" }` |
| `push` | Server-initiated event | `{ channel?: string, payload: any }` |
| `error` | Protocol or logic error | `{ code: string, message: string }` |
| `system-alert` | System-level alert | `{ level: "info"|"warning"|"error"|"critical", title, description }` |
| `tool-output` | Tool execution result | `{ toolName, output, exitCode?, executionTime? }` |
| `chat-message` | Broadcast chat message | `{ message: Message, sessionId?: string }` |
| `monitor-update` | Real-time monitor data | `{ data: MonitorData }` |

### Message Format

```json
{
  "id": "ws-msg-001",
  "type": "chat-message",
  "channel": "ch_1716115200000",
  "payload": {
    "message": {
      "id": "msg-001",
      "sender": { "id": "agent_1", "name": "Bot", "isBot": true },
      "content": { "text": "Hello from Sylva" },
      "type": "text",
      "timestamp": 1716115200000
    }
  },
  "timestamp": 1716115200000
}
```

### Error Codes (WebSocket)

| Code | Meaning |
|------|---------|
| `INVALID_MESSAGE` | Malformed JSON or missing required fields |
| `UNKNOWN_TYPE` | Message `type` is not recognized |
| `NOT_SUBSCRIBED` | Attempted action on unsubscribed channel |
| `RATE_LIMITED` | Too many messages in a short window |
| `INTERNAL_ERROR` | Unhandled server-side error |

---

## Data Models

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  status: "idle" | "running" | "error" | "paused";
  health: "healthy" | "unhealthy" | "unknown";
  role: string;
  levelA?: string[];       // Tier-A provider IDs
  levelB?: string[];       // Tier-B provider IDs
  levelC?: string[];       // Tier-C provider IDs
  skills?: string[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  maxConcurrentTasks?: number;
  createdAt: number;
  updatedAt?: number;
  taskCount?: number;
  runningTaskCount?: number;
  providerStatus?: Record<string, boolean>;
}
```

### Channel

```typescript
interface Channel {
  id: string;
  name: string;
  type: "dm" | "group" | "public";
  participants: string[];
  createdAt: number;
  config?: ChannelConfig;
}
```

### Model

```typescript
interface Model {
  id: string;
  name: string;
  provider: string;
  platformId: string;
  capabilities: ModelCapability[];
  weight?: number;
  quota?: ModelQuota;
  fallback?: string;
  endpoint?: string;
  providerFeatures?: string[];
  providerStatus?: "active" | "unknown";
}

type ModelCapability =
  | "chat" | "reasoning" | "analysis"
  | "vision" | "code" | "embedding"
  | "audio" | "multimodal";
```

### Task

```typescript
interface Task {
  id: string;
  type: "chat" | "agent" | "workflow" | "batch" | "cron";
  status: "pending" | "running" | "completed" | "failed" | "interrupted";
  agentId?: string;
  progress: number;
  prompt?: string;
  output?: string;
  error?: string;
  latencyMs?: number;
  startedAt?: string;
  completedAt?: string;
  tokensUsed?: number;
}
```

### Message (WebSocket / Unified)

```typescript
interface Message {
  id: string;
  sender: {
    id: string;
    name: string;
    avatar?: string;
    isBot: boolean;
  };
  content: {
    text: string;
    attachments?: Attachment[];
    mentions?: Mention[];
    replyTo?: string;
  };
  type: "text" | "image" | "file" | "command" | "system" | "error";
  timestamp: number;
  metadata?: {
    processed: boolean;
    priority: number;
    raw?: Record<string, unknown>;
  };
}
```

### MonitorData

```typescript
interface MonitorData {
  timestamp: string;
  system: SystemMetrics;
  platforms: PlatformHealth[];
  agents: AgentStatusDetail[];
  tasks: TaskStatusDetail[];
  skills: Array<{ id: string; name: string; healthy: boolean; lastCheck: string }>;
  alerts: Array<{ level: "info" | "warn" | "error"; message: string; source: string; timestamp: string }>;
}
```

---

## HTTP Status Codes

| Status | Usage |
|--------|-------|
| **200 OK** | Standard success for GET, PUT, DELETE |
| **201 Created** | Success for POST (resource created) |
| **204 No Content** | Optional for DELETE when no body is returned |
| **400 Bad Request** | Invalid JSON, missing required fields, malformed parameters |
| **401 Unauthorized** | Missing or invalid authentication |
| **403 Forbidden** | Authenticated but not permitted |
| **404 Not Found** | Resource or endpoint does not exist |
| **405 Method Not Allowed** | HTTP verb not supported on this path |
| **409 Conflict** | Resource already exists, state conflict |
| **429 Too Many Requests** | Rate limit exceeded |
| **500 Internal Server Error** | Unhandled exception |
| **503 Service Unavailable** | Upstream dependency failure |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 2.0.0 | 2026-05-23 | Expanded to full backend route coverage: 37 route modules, 200+ endpoints. Added Auth, Tasks, Monitor, Platforms, Skills, Workspaces, Handoff, Backup, Logs, Memories, Uploads, Webhooks, Security, Settings, Scheduler, Search, Process, Registry, AI Search, Ollama, Agent Zero, Coordinator, Events, External, Google Chat, Groups, API Keys, Imports, Unified, Platform Details, Agents V2/Swarm, Agents Runtime. |
| 1.0.0 | 2024-05-19 | Initial API documentation (Health, Agents, Channels, Models only) |

---

*End of Document*
