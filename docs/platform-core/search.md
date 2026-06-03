# Search System

Full-text search across all entities in Sylva Platform: agents, channels, logs, memories, models, and security audit logs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ SearchPage   │  │ useSearch    │  │ SearchDialog │        │
│  │ (Spotlight)  │  │ (React Hook) │  │ (Cmd+Shift+F)│        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
└─────────┼─────────────────┼─────────────────┼────────────────┘
          │                 │                 │
          └─────────────────┴─────────────────┘
                            │
                    ┌───────┴───────┐
                    │  /api/search  │
                    │  /api/search/suggest
                    │  /api/search/facets
                    └───────┬───────┘
                            │
┌───────────────────────────┼─────────────────────────────────────┐
│                         Backend                                  │
│  ┌────────────────────────┴─────────────────────────────────┐   │
│  │                   searchService.ts                        │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │  │ FTS5 Search │  │ LIKE Fallback│  │ Highlighting │   │   │
│  │  │ (preferred) │  │ (fallback)   │  │ + Scoring    │   │   │
│  │  └─────────────┘  └──────────────┘  └──────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                     │
│              ┌───────────┴───────────┐                        │
│              │   SQLite search_index   │                        │
│              │   (FTS5 virtual table)  │                        │
│              └─────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

## Backend

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search?q=keyword&scope=agents,logs&limit=20&offset=0` | Execute search |
| GET | `/api/search/suggest?q=key` | Autocomplete suggestions |
| GET | `/api/search/facets?q=keyword` | Facet breakdown by type/date/source |
| POST | `/api/search/rebuild` | Rebuild FTS index (admin) |

### Query Parameters

- `q` — search query (required)
- `scope` — comma-separated entity types to search (e.g. `agents,logs`)
- `sort` — `relevance` (default) | `date` | `name`
- `limit` — max results per page (default 20, max 100)
- `offset` — pagination offset
- `dateFrom` / `dateTo` — ISO date filters
- `type` / `source` — additional string filters

### Response Format

```json
{
  "hits": [
    {
      "id": "agent_123",
      "type": "agent",
      "title": "<mark>My</mark> Agent",
      "snippet": "...description with <mark>My</mark> highlighted...",
      "url": "/agents",
      "metadata": { "tags": "bot,running", "source": "agents" },
      "score": 15,
      "timestamp": "2026-05-19T14:30:00.000Z"
    }
  ],
  "total": 42,
  "facets": {
    "byType": { "agent": 10, "log": 20, "memory": 12 },
    "byDate": { "2026-05-19": 15, "2026-05-18": 27 },
    "bySource": { "agents": 10, "logs": 20, "memories": 12 }
  },
  "query": { "q": "my agent", "scope": null, "sort": "relevance", "limit": 20, "offset": 0 },
  "elapsedMs": 12,
  "ftsEnabled": true
}
```

### FTS5 vs Fallback

**Primary**: SQLite FTS5 virtual table `search_index` with automatic triggers keeping it in sync with source tables.

**Fallback**: If FTS5 is unavailable (not compiled into SQLite), the service transparently falls back to `LIKE`-based search across all tables.

### Relevance Scoring

1. **Title match** = 10 pts (starts with = +5 bonus)
2. **Content match** = 3 pts
3. **Tag match** = 2 pts

Multiple search terms stack their scores.

## Database

### FTS5 Virtual Table

Created by migration `003_fts.sql`:

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
  doc_id, doc_type, title, content, tags, source, timestamp UNINDEXED
);
```

### Triggers

Each source table has INSERT/UPDATE/DELETE triggers that mirror changes into `search_index`:
- `trg_search_agents_insert/update/delete`
- `trg_search_channels_insert/update/delete`
- `trg_search_logs_insert/update/delete`
- `trg_search_memories_insert/update/delete`
- `trg_search_models_insert/update/delete`
- `trg_search_audit_insert/update/delete`

The migration also backfills existing data on first run.

## Frontend

### Pages

- **`/search`** — Dedicated search page with inline layout
- **SearchDialog** — Spotlight-style modal (used from CommandPalette or nav)

### Hooks

#### `useSearch(query, options)`

```typescript
const { query, setQuery, results, total, facets, loading, error, execute, loadMore } = useSearch('keyword', {
  scope: ['agent', 'log'],
  sort: 'relevance',
  limit: 20,
  debounceMs: 200,
})
```

Auto-debounced search execution. Returns grouped results, facets, and pagination helpers.

#### `useSearchSuggestions(prefix)`

```typescript
const { suggestions, loading } = useSearchSuggestions('my a')
// → ['My Agent', 'My Analysis Bot', ...]
```

#### `useSearchFacets(query, scope)`

```typescript
const { facets, loading } = useSearchFacets('keyword', ['agent'])
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Open search page |
| `Ctrl+K` / `Cmd+K` | Toggle Command Palette |
| `↑` / `↓` | Navigate results |
| `Enter` | Open selected result |
| `Esc` | Close search |

### UI Features

- **Scope filters** — Toggle entity type chips with live facet counts
- **Date range** — From/To date pickers
- **Sort** — Relevance / Date / Name
- **Suggestions** — Inline autocomplete dropdown
- **Highlighting** — `<mark>` tags wrap matching terms in titles and snippets
- **Pagination** — Load more button with remaining count

## Integration

### Command Palette

The search page is registered as a command:
```typescript
{ id: 'nav-search', label: 'Search', shortcut: 'Ctrl+Shift+F', action: () => navigate('/search'), category: 'Navigation' }
```

### Navigation Header

The header search button now navigates to `/search` instead of toggling CommandPalette:
```typescript
<Button onClick={() => navigate('/search')}>
  <Search /> Search <kbd>Ctrl+Shift+F</kbd>
</Button>
```

## Performance

- FTS5 queries are typically sub-20ms for datasets under 100K rows
- LIKE fallback scales linearly; recommended for <10K rows
- Frontend debounces input at 200ms and cancels in-flight requests
- Results limited to 100 per query (backend enforced)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Fallback" badge shown | SQLite was compiled without FTS5. Search still works via LIKE fallback. |
| No results for existing data | Run `POST /api/search/rebuild` to backfill the index. |
| Slow search | Check if FTS5 is active; if not, rebuild index or reduce dataset. |
| Suggestions not appearing | Suggestions only show when no results yet and prefix ≥1 char. |
