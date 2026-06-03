# Cross-Platform Agent Swarm

A TypeScript framework for orchestrating multiple AI agents across different platforms (OpenClaw, Hermes, Claude, etc.) to collaboratively complete complex tasks.

## Features

- **Task Decomposition**: Automatically breaks user requests into subtasks with dependency graphs
- **Capability Matching**: Scores agent↔subtask fit with concrete thresholds (≥0.70)
- **Cross-Platform Messaging**: JSON envelopes with priority queues and round-robin polling
- **Result Merging**: 4 strategies (sequential, voting, expert review, hierarchical)
- **Error Recovery**: Retry → reassign → degrade → escalate chain with circuit breaker
- **Timeout Degradation**: Auto-downgrade tasks: full → simplified → placeholder → skip

## Project Structure

```
cross-platform-swarm/
├── src/
│   ├── types.ts                    # Core interfaces
│   ├── TaskDecomposer.ts           # Request → subtasks
│   ├── CapabilityMatcher.ts        # Agent scoring
│   ├── CrossPlatformMessage.ts     # Message envelope & inbox
│   ├── MessageRouter.ts            # Message routing
│   ├── ResultMerger.ts             # Output synthesis
│   ├── ErrorRecovery.ts            # Retry & circuit breaker
│   ├── TimeoutDegradation.ts       # Timeout & degradation
│   ├── CrossPlatformBridge.ts      # Platform transport
│   ├── SwarmCoordinator.ts         # Main orchestrator
│   └── index.ts                    # Public API
├── tests/                          # Unit tests
├── docs/
│   └── CROSS_PLATFORM_SWARM_DESIGN.md  # Full design doc
├── examples/
│   ├── example-a-paper-writing.md
│   ├── example-b-code-review.md
│   └── example-c-data-analysis.md
├── package.json
├── tsconfig.json
└── jest.config.js
```

## Quick Start

```bash
npm install
npm run build
npm test
```

## Usage

```typescript
import { SwarmCoordinator, SwarmConfig } from 'cross-platform-swarm';

const config: SwarmConfig = {
  platforms: [
    { platform: 'openclaw', enabled: true, endpoint: 'memory://oc', weight: 1 },
    { platform: 'claude', enabled: true, endpoint: 'memory://cl', weight: 1 },
    { platform: 'hermes', enabled: true, endpoint: 'memory://hm', weight: 1 },
  ],
  agents: [/* CapabilityManifest[] */],
  matchConfig: { minScore: 0.70, preferSamePlatform: true, fallbackEnabled: true, maxRetries: 2 },
  errorConfig: { maxRetries: 2, retryDelayMs: 1000, circuitBreakerThreshold: 3, circuitBreakerResetMs: 30000, escalationTimeoutMs: 60000 },
  timeoutConfig: { simpleTaskMs: 30000, complexTaskMs: 300000, researchTaskMs: 600000 },
  mergeConfig: { strategy: 'sequential_append', conflictResolution: 'highest_score', qualityThreshold: 0.5 },
  maxConcurrentTasks: 5,
};

const coordinator = new SwarmCoordinator(config);
coordinator.onProgress = (msg) => console.log(msg);

const result = await coordinator.execute('Write a paper on quantum computing');
console.log(result);
```

## Design Document

See [`docs/CROSS_PLATFORM_SWARM_DESIGN.md`](docs/CROSS_PLATFORM_SWARM_DESIGN.md) for complete architecture, algorithms, thresholds, and Mermaid diagrams.

## Examples

- [A: Paper Writing](examples/example-a-paper-writing.md) — Researcher + Writer + Reviewer
- [B: Code Review](examples/example-b-code-review.md) — Coder + Security + Tester (parallel)
- [C: Data Analysis](examples/example-c-data-analysis.md) — Analyst + Visualizer + Interpreter

## License

MIT
