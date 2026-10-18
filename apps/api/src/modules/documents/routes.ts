import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { orgRoles, requireAuth } from "../../middleware/auth.js";

export const documentsRouter = Router();
const storageDir = process.env.DOCUMENT_STORAGE_PATH || join(process.cwd(), ".private-documents");
const maxBytes = 25 * 1024 * 1024;
const allowedMimeTypes = new Set(["application/pdf", "text/plain", "image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/wav", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const safeFileName = (value: string) => basename(value).replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "document";

function matchesMime(bytes: Buffer, mimeType: string) {
  switch (mimeType) {
    case "application/pdf": return bytes.subarray(0, 5).toString() === "%PDF-";
    case "image/jpeg": return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png": return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/webp": return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
    case "audio/wav": return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE";
    case "audio/mpeg": return bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    case "text/plain": return !bytes.includes(0);
    default: return false;
  }
}

async function activeMembership(organizationId: string, userId: string, isSuperAdmin: boolean) {
  if (isSuperAdmin) return { roles: [{ role: { key: "ORG_ADMIN" } }] };
  return prisma.membership.findFirst({
    where: { organizationId, userId, status: "ACTIVE", organization: { status: "ACTIVE" } },
    include: { roles: { include: { role: { select: { key: true } } } } }
  });
}

documentsRouter.get("/:organizationId/documents", requireAuth, asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const membership = await activeMembership(organizationId, req.currentUser!.id, req.currentUser!.isSuperAdmin);
  if (!membership) { res.status(403).json({ error: "ORG_ACCESS_DENIED" }); return; }
  const roles = membership.roles.map((item) => item.role.key);
  const canSeeStaff = req.currentUser!.isSuperAdmin || roles.some((role) => ["ORG_ADMIN", "EVENT_MANAGER", "LIBRARIAN"].includes(role));
  const canSeeAdmin = req.currentUser!.isSuperAdmin || roles.includes("ORG_ADMIN");
  const documents = await prisma.document.findMany({
    where: { organizationId, ...(canSeeAdmin ? {} : canSeeStaff ? { visibility: { in: ["STAFF", "MEMBERS", "PUBLIC"] } } : { visibility: { in: ["MEMBERS", "PUBLIC"] } }) },
    select: { id: true, title: true, description: true, fileName: true, mimeType: true, sizeBytes: true, visibility: true, createdAt: true, uploadedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" }
  });
  res.json({ documents: documents.map((document) => ({ ...document, sizeBytes: document.sizeBytes.toString() })) });
}));

documentsRouter.post("/:organizationId/documents", requireAuth, orgRoles("ORG_ADMIN", "LIBRARIAN"), express.raw({ type: ["application/octet-stream", "application/pdf", "text/plain", "image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/wav", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], limit: maxBytes }), asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const contentType = String(req.headers["content-type"] || "").split(";")[0]?.trim().toLowerCase() ?? "";
  const mimeType = z.string().parse(req.headers["x-file-mime"] || contentType);
  if (!allowedMimeTypes.has(mimeType)) { res.status(415).json({ error: "UNSUPPORTED_FILE_TYPE" }); return; }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ error: "EMPTY_FILE" }); return; }
  if (req.body.length > maxBytes) { res.status(413).json({ error: "FILE_TOO_LARGE" }); return; }
  if (contentType !== mimeType || !matchesMime(req.body, mimeType)) { res.status(415).json({ error: "FILE_CONTENT_MISMATCH", message: "O conteúdo do arquivo não corresponde ao tipo declarado." }); return; }
  const input = z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(2000).optional(), visibility: z.enum(["ADMINS_ONLY", "STAFF", "MEMBERS", "PUBLIC"]).default("MEMBERS") }).parse(req.query);
  const fileName = safeFileName(String(req.headers["x-file-name"] || "document"));
  const storageKey = randomUUID();
  await mkdir(storageDir, { recursive: true });
  const filePath = join(storageDir, storageKey);
  await writeFile(filePath, req.body, { flag: "wx", mode: 0o600 });
  try {
    const document = await prisma.document.create({
      data: { organizationId, uploadedById: req.currentUser!.id, title: input.title, description: input.description, fileName, storageKey, mimeType, sizeBytes: req.body.length, visibility: input.visibility },
      select: { id: true, title: true, fileName: true, mimeType: true, sizeBytes: true, visibility: true, createdAt: true }
    });
    res.status(201).json({ document: { ...document, sizeBytes: document.sizeBytes.toString() } });
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}));

documentsRouter.get("/:organizationId/documents/:documentId/download", requireAuth, asyncHandler(async (req, res) => {
  const { organizationId, documentId } = z.object({ organizationId: z.string().min(1), documentId: z.string().min(1) }).parse(req.params);
  const membership = await activeMembership(organizationId, req.currentUser!.id, req.currentUser!.isSuperAdmin);
  if (!membership) { res.status(403).json({ error: "ORG_ACCESS_DENIED" }); return; }
  const document = await prisma.document.findFirst({ where: { id: documentId, organizationId } });
  if (!document) { res.status(404).json({ error: "DOCUMENT_NOT_FOUND" }); return; }
  const roles = membership.roles.map((item) => item.role.key);
  const allowed = req.currentUser!.isSuperAdmin || document.visibility === "PUBLIC" || document.visibility === "MEMBERS" ||
    (document.visibility === "STAFF" && roles.some((role) => ["ORG_ADMIN", "EVENT_MANAGER", "LIBRARIAN"].includes(role))) ||
    (document.visibility === "ADMINS_ONLY" && roles.includes("ORG_ADMIN"));
  if (!allowed) { res.status(403).json({ error: "DOCUMENT_ACCESS_DENIED" }); return; }
  const contents = await readFile(join(storageDir, document.storageKey));
  const downloadName = safeFileName(document.fileName);
  res.setHeader("Content-Type", document.mimeType);
  res.setHeader("Content-Length", String(contents.length));
  res.setHeader("Content-Disposition", `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  res.send(contents);
}));

documentsRouter.delete("/:organizationId/documents/:documentId", requireAuth, orgRoles("ORG_ADMIN", "LIBRARIAN"), asyncHandler(async (req, res) => {
  const { organizationId, documentId } = z.object({ organizationId: z.string().min(1), documentId: z.string().min(1) }).parse(req.params);
  const document = await prisma.document.findFirst({ where: { id: documentId, organizationId }, select: { id: true, storageKey: true } });
  if (!document) { res.status(404).json({ error: "DOCUMENT_NOT_FOUND" }); return; }
  await prisma.document.delete({ where: { id: document.id } });
  await unlink(join(storageDir, document.storageKey)).catch(() => undefined);
  res.status(204).end();
}));

export { maxBytes };
