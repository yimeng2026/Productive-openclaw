# Testing Strategy

## Overview

Sylva Platform adopts a **Testing Pyramid** approach with emphasis on unit tests and integration tests, supplemented by E2E and performance testing.

```
        /\
       /  \     E2E Tests (Playwright)
      /    \
     /------\   Integration Tests (Supertest)
    /        \ 
   /----------\ Unit Tests (Jest)
  /____________\
```

## Coverage Targets

| Layer | Target | Current |
|-------|--------|---------|
| Unit Tests | 80% | ~65% |
| Integration Tests | 70% | ~45% |
| E2E Tests | 50% | ~30% |

## Unit Testing (Jest)

Backend tests use **Jest** with **Supertest** for HTTP assertions.

### Key Patterns

- **Route Tests**: `src/__tests__/routes/*.test.ts`
- **Service Tests**: `src/__tests__/services/*.test.ts`
- **Mock Strategy**: In-memory stores for development; testcontainers for CI

### Example

```typescript
import request from 'supertest'
import { app } from '../src/server'

describe('GET /api/agents', () => {
  it('returns agent list', async () => {
    const res = await request(app).get('/api/agents')
    expect(res.status).toBe(200)
    expect(res.body.agents).toBeDefined()
  })
})
```

## Integration Testing

Tests complete API flows:
- Agent lifecycle (create → execute → stop)
- Channel creation + message flow
- Memory CRUD + search
- Security ACL + IP management

## E2E Testing (Playwright)

Frontend E2E covers:
- Authentication flow
- Dashboard data visualization
- Settings save/reset
- Channel management (CRUD + ping)
- Memory hub (search, share, pin)

### Playwright Config

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
})
```

## Performance Testing (k6)

Load testing scenarios:
- Concurrent agent execution (50, 100, 500 agents)
- WebSocket message throughput
- API response time under load
- Memory leak detection (24h run)

### k6 Script Example

```javascript
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 200 },
    { duration: '1m', target: 0 },
  ],
}

export default function () {
  const res = http.get('http://localhost:3000/api/health')
  check(res, { 'status is 200': (r) => r.status === 200 })
}
```

## Security Testing (OWASP)

| OWASP Item | Test Method | Status |
|------------|-------------|--------|
| Injection | SQLi / NoSQLi fuzzing | ✅ Pass |
| Broken Auth | Brute force / session hijacking | ✅ Pass |
| Sensitive Data Exposure | Encryption audit | ✅ Pass |
| XXE | XML parser testing | N/A (JSON only) |
| Broken Access Control | ACL bypass attempts | ✅ Pass |
| Security Misconfiguration | Config scan | ✅ Pass |
| XSS | Stored / reflected testing | ✅ Pass |
| Insecure Deserialization | Payload injection | ✅ Pass |
| Known Vulnerabilities | Dependency scan (npm audit) | ⚠️ Ongoing |
| Insufficient Logging | Audit coverage check | ✅ Pass |

## CI/CD Test Pipeline

```
Push/PR
    ↓
[Lint + TypeCheck] (parallel)
    ↓
[Unit Tests] (backend + frontend)
    ↓
[Integration Tests] (backend)
    ↓
[Build Check] (frontend + backend)
    ↓
[E2E Tests] (Playwright, on merge to main)
    ↓
[Deploy to Staging]
```

## Test Data Management

- **Mock Data**: Each service module includes `mockData` for isolated testing
- **Test Fixtures**: `src/__tests__/fixtures/` for shared test data
- **Database Reset**: `beforeAll` / `afterAll` hooks clean state

## Flaky Test Policy

1. Mark flaky tests with `it.skip` and create issue
2. Retry limit: 3 attempts in CI
3. Root cause analysis required within 48h

## Next Steps

- [ ] Reach 80% unit test coverage
- [ ] Add visual regression tests (Chromatic)
- [ ] Implement contract testing (Pact)
- [ ] Add chaos engineering tests (Litmus)
