import session from "express-session";
import type { SessionData } from "express-session";
import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

const { Store } = session;

export class PrismaSessionStore extends Store {
  constructor() {
    super();
    const cleanupTimer = setInterval(() => {
      void prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
        .catch((error: unknown) => logger.warn({ error }, "Could not remove expired sessions"));
    }, 60 * 60 * 1000);
    cleanupTimer.unref();
  }

  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void) {
    void prisma.session.findUnique({ where: { sid } }).then(async (record) => {
      if (!record) return callback(null, null);
      if (record.expiresAt <= new Date()) {
        await prisma.session.deleteMany({ where: { sid } });
        return callback(null, null);
      }
      callback(null, record.data as unknown as SessionData);
    }).catch(callback);
  }

  set(sid: string, value: SessionData, callback?: (err?: unknown) => void) {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires)
      : new Date(Date.now() + env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000);
    const data = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    void prisma.session.upsert({
      where: { sid },
      create: { sid, data, expiresAt },
      update: { data, expiresAt }
    }).then(() => callback?.()).catch((error: unknown) => callback?.(error));
  }

  destroy(sid: string, callback?: (err?: unknown) => void) {
    void prisma.session.deleteMany({ where: { sid } })
      .then(() => callback?.()).catch((error: unknown) => callback?.(error));
  }

  touch(sid: string, value: SessionData, callback?: (err?: unknown) => void) {
    const expiresAt = value.cookie.expires
      ? new Date(value.cookie.expires.valueOf())
      : new Date(Date.now() + env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000);
    void prisma.session.updateMany({ where: { sid }, data: { expiresAt } })
      .then(() => callback?.()).catch((error: unknown) => callback?.(error));
  }
}
