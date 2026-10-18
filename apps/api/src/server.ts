import { env } from "./config/env.js";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "Orchestra API started");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
