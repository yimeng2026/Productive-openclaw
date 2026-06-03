/**
 * app.ts — Unified Application Bootstrap
 *
 * Exports `bootApp()` as the single async entry point for:
 *   - Local dev (tsx watch src/app.ts)
 *   - Production (node dist/app.js)
 *   - Railway / Docker / Electron
 *
 * All side-effectful startup logic lives here; server.ts remains
 * pure — it only builds the Express app + HTTP listener.
 */

import { startServer, logger } from "./server";

export { logger };

/**
 * Boot the entire Sylva backend.
 *   1. Parse env + validate config
 *   2. Start HTTP + WebSocket server
 *   3. Attach global error handlers
 */
export async function bootApp(): Promise<void> {
  const PORT = parseInt(process.env.PORT || "3001", 10);

  // Global uncaught exception handlers — prevents crash in production
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
    // Keep serving; crash loops are worse than a single failed request
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled rejection");
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down gracefully");
    process.exit(0);
  });
  process.on("SIGINT", () => {
    logger.info("SIGINT received, shutting down gracefully");
    process.exit(0);
  });

  // Start server (HTTP + WS + coordinator bridges)
  await startServer(PORT);
  logger.info(`[bootApp] Sylva Platform backend ready on port ${PORT}`);

  // Keep-alive heartbeat (prevents idle event-loop exit in some PaaS environments)
  setInterval(() => {
    // no-op — the interval itself holds the event loop
  }, 30000);
}

// Self-start when executed directly (node dist/app.js)
if (require.main === module) {
  bootApp().catch((err) => {
    logger.error({ err }, "[bootApp] Fatal startup failure");
    process.exit(1);
  });
}
