import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "Rota não encontrada." });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if ((error as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: "REQUEST_TOO_LARGE", message: "O corpo da solicitação excede o limite permitido." });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: "VALIDATION_ERROR", issues: error.issues });
    return;
  }
  logger.error({ err: error }, "Unhandled request error");
  res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro interno do servidor." });
};
