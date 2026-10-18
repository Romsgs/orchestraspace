import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { orgRoles, requireAuth } from "../../middleware/auth.js";

export const eventsRouter = Router();

const eventSchema = z.object({
  type: z.enum(["REHEARSAL", "GENERAL_REHEARSAL", "CONCERT", "SOUND_CHECK", "MEETING", "OTHER"]),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED", "COMPLETED"]).optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().max(5000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().min(1).max(80).default("Europe/Sofia"),
  venue: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  conductor: z.string().max(200).optional(),
  program: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  rehearsalDetails: z.object({ studyMaterialsNote: z.string().max(5000).optional() }).optional(),
  concertDetails: z.object({
    requiredClothing: z.string().max(500).optional(),
    bringStand: z.boolean().optional(),
    bringLights: z.boolean().optional(),
    arrivalAt: z.string().datetime().optional(),
    setupAt: z.string().datetime().optional(),
    additionalNotes: z.string().max(5000).optional()
  }).optional()
}).refine((v) => new Date(v.endAt) > new Date(v.startAt), {
  message: "O término precisa ser posterior ao início.", path: ["endAt"]
});

async function assertOrgAccess(userId: string, isSuperAdmin: boolean, organizationId: string) {
  if (isSuperAdmin) return true;
  const membership = await prisma.membership.findFirst({
    where: { userId, organizationId, status: "ACTIVE", organization: { status: "ACTIVE" } }
  });
  return Boolean(membership);
}

eventsRouter.get("/:organizationId/events", requireAuth, asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const allowed = await assertOrgAccess(req.currentUser!.id, req.currentUser!.isSuperAdmin, organizationId);
  if (!allowed) {
    res.status(403).json({ error: "ORG_ACCESS_DENIED" });
    return;
  }
  const events = await prisma.event.findMany({
    where: { organizationId },
    include: { rehearsalDetails: true, concertDetails: true },
    orderBy: { startAt: "asc" }
  });
  res.json({ events });
}));

eventsRouter.post("/:organizationId/events", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const input = eventSchema.parse(req.body);
  const event = await prisma.event.create({
    data: {
      organizationId,
      type: input.type,
      status: input.status ?? "DRAFT",
      title: input.title,
      description: input.description,
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      timezone: input.timezone,
      venue: input.venue,
      address: input.address,
      conductor: input.conductor,
      program: input.program,
      notes: input.notes,
      createdById: req.currentUser!.id,
      rehearsalDetails: input.type === "REHEARSAL" || input.type === "GENERAL_REHEARSAL"
        ? { create: input.rehearsalDetails ?? {} } : undefined,
      concertDetails: input.type === "CONCERT"
        ? { create: {
            ...input.concertDetails,
            arrivalAt: input.concertDetails?.arrivalAt ? new Date(input.concertDetails.arrivalAt) : undefined,
            setupAt: input.concertDetails?.setupAt ? new Date(input.concertDetails.setupAt) : undefined
          } } : undefined
    },
    include: { rehearsalDetails: true, concertDetails: true }
  });
  await prisma.auditLog.create({
    data: { actorId: req.currentUser!.id, organizationId, action: "event.created", entityType: "Event", entityId: event.id }
  });
  res.status(201).json({ event });
}));

eventsRouter.patch("/:organizationId/events/:eventId", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const { organizationId, eventId } = z.object({
    organizationId: z.string().min(1), eventId: z.string().min(1)
  }).parse(req.params);
  const input = eventSchema.partial().parse(req.body);
  const existing = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
  if (!existing) {
    res.status(404).json({ error: "EVENT_NOT_FOUND" });
    return;
  }
  const data: any = { ...input };
  if (input.startAt) data.startAt = new Date(input.startAt);
  if (input.endAt) data.endAt = new Date(input.endAt);
  delete data.rehearsalDetails;
  delete data.concertDetails;
  const event = await prisma.event.update({
    where: { id: eventId },
    data,
    include: { rehearsalDetails: true, concertDetails: true }
  });
  await prisma.auditLog.create({
    data: { actorId: req.currentUser!.id, organizationId, action: "event.updated", entityType: "Event", entityId: event.id }
  });
  res.json({ event });
}));

eventsRouter.delete("/:organizationId/events/:eventId", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const { organizationId, eventId } = z.object({
    organizationId: z.string().min(1), eventId: z.string().min(1)
  }).parse(req.params);
  const existing = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
  if (!existing) {
    res.status(404).json({ error: "EVENT_NOT_FOUND" });
    return;
  }
  await prisma.event.delete({ where: { id: eventId } });
  await prisma.auditLog.create({
    data: { actorId: req.currentUser!.id, organizationId, action: "event.deleted", entityType: "Event", entityId: eventId }
  });
  res.status(204).end();
}));
