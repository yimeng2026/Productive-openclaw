import { bootApp, logger } from "./app";

bootApp().catch((err) => {
  logger.error({ err }, "Failed to boot application");
  process.exit(1);
});
