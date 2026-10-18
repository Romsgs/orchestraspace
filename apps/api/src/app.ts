import express from "express";
import rateLimit from "express-rate-limit";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import { PrismaSessionStore } from "./lib/session-store.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { authRouter } from "./modules/auth/routes.js";
import { organizationsRouter } from "./modules/organizations/routes.js";
import { eventsRouter } from "./modules/events/routes.js";
import { tripsRouter } from "./modules/trips/routes.js";
import { documentsRouter } from "./modules/documents/routes.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import { requireAuth } from "./middleware/auth.js";
import { prisma } from "./lib/prisma.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY_HOPS);
app.use(helmet());
app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  if (req.get("origin") !== env.WEB_ORIGIN) {
    res.status(403).json({ error: "UNTRUSTED_ORIGIN" });
    return;
  }
  next();
});
app.use(session({
  name: "orchestra.sid",
  store: new PrismaSessionStore(),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: env.COOKIE_SECURE === "true",
    sameSite: "lax",
    maxAge: env.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000
  }
}));

app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, "HTTP request");
  next();
});

app.get("/health", async (_req, res) => {
  try {
    await prisma.$runCommandRaw({ ping: 1 });
    res.json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable", database: "unavailable" });
  }
});
app.use("/api/auth", authRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/organizations", eventsRouter);
app.use("/api/organizations", tripsRouter);
app.use("/api/organizations", documentsRouter);

app.get("/api/system/overview", requireAuth, async (req, res, next) => {
  try {
    if (!req.currentUser?.isSuperAdmin) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
    const { prisma } = await import("./lib/prisma.js");
    const [users, organizations, events] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.event.count()
    ]);
    res.json({ users, organizations, events });
  } catch (error) {
    next(error);
  }
});

app.use(notFound);
app.use(errorHandler);

export { app };
