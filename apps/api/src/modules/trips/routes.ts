import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { orgRoles, requireAuth } from "../../middleware/auth.js";

export const tripsRouter = Router();

const tripSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().max(5000).optional(),
  status: z.enum(["PLANNING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().min(1).max(80).default("Europe/Sofia")
}).refine((v) => new Date(v.endAt) >= new Date(v.startAt), {
  message: "A data final não pode ser anterior à inicial.", path: ["endAt"]
});

tripsRouter.get("/:organizationId/trips", requireAuth, asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const allowed = req.currentUser!.isSuperAdmin || await prisma.membership.findFirst({
    where: { organizationId, userId: req.currentUser!.id, status: "ACTIVE", organization: { status: "ACTIVE" } },
    select: { id: true }
  });
  if (!allowed) {
    res.status(403).json({ error: "ORG_ACCESS_DENIED" });
    return;
  }
  const trips = await prisma.trip.findMany({
    where: { organizationId },
    include: {
      eventLinks: {
        include: {
          event: {
            include: {
              musicians: {
                include: { membership: { include: { user: { select: { id: true, name: true, email: true } } } } }
              }
            }
          }
        },
        orderBy: { sortOrder: "asc" }
      },
      stops: { orderBy: { sortOrder: "asc" } }
    },
    orderBy: { startAt: "asc" }
  });
  res.json({ trips });
}));

tripsRouter.post("/:organizationId/trips", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const input = tripSchema.parse(req.body);
  const trip = await prisma.trip.create({
    data: {
      organizationId,
      title: input.title,
      description: input.description,
      status: input.status ?? "PLANNING",
      startAt: new Date(input.startAt),
      endAt: new Date(input.endAt),
      timezone: input.timezone,
      createdById: req.currentUser!.id
    }
  });
  res.status(201).json({ trip });
}));

tripsRouter.patch("/:organizationId/trips/:tripId", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const { organizationId, tripId } = z.object({
    organizationId: z.string().min(1), tripId: z.string().min(1)
  }).parse(req.params);
  const { status } = z.object({
    status: z.enum(["PLANNING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
  }).parse(req.body);
  const trip = await prisma.trip.findFirst({ where: { id: tripId, organizationId }, select: { id: true } });
  if (!trip) {
    res.status(404).json({ error: "TRIP_NOT_FOUND", message: "A viagem não existe nesta orquestra." });
    return;
  }
  const updated = await prisma.trip.update({ where: { id: tripId }, data: { status } });
  res.json({ trip: updated });
}));

tripsRouter.post("/:organizationId/trips/:tripId/events", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const { organizationId, tripId } = z.object({
    organizationId: z.string().min(1), tripId: z.string().min(1)
  }).parse(req.params);
  const input = z.object({
    eventId: z.string().min(1),
    sortOrder: z.number().int().min(0).default(0),
    notes: z.string().max(2000).optional()
  }).parse(req.body);

  const [trip, event] = await Promise.all([
    prisma.trip.findFirst({ where: { id: tripId, organizationId } }),
    prisma.event.findFirst({ where: { id: input.eventId, organizationId } })
  ]);
  if (!trip || !event) {
    res.status(404).json({ error: "TRIP_OR_EVENT_NOT_FOUND", message: "A viagem ou o evento não existe nesta orquestra." });
    return;
  }
  const link = await prisma.tripEvent.upsert({
    where: { tripId_eventId: { tripId, eventId: input.eventId } },
    create: { tripId, eventId: input.eventId, sortOrder: input.sortOrder, notes: input.notes },
    update: { sortOrder: input.sortOrder, notes: input.notes }
  });
  res.status(201).json({ link });
}));

tripsRouter.delete("/:organizationId/trips/:tripId/events/:eventId", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const { organizationId, tripId, eventId } = z.object({
    organizationId: z.string().min(1), tripId: z.string().min(1), eventId: z.string().min(1)
  }).parse(req.params);
  const trip = await prisma.trip.findFirst({ where: { id: tripId, organizationId } });
  if (!trip) {
    res.status(404).json({ error: "TRIP_NOT_FOUND" });
    return;
  }
  await prisma.tripEvent.deleteMany({ where: { tripId, eventId } });
  res.status(204).end();
}));

tripsRouter.patch("/:organizationId/trips/:tripId/events", requireAuth, orgRoles("ORG_ADMIN", "EVENT_MANAGER"), asyncHandler(async (req, res) => {
  const { organizationId, tripId } = z.object({ organizationId: z.string().min(1), tripId: z.string().min(1) }).parse(req.params);
  const { eventIds } = z.object({ eventIds: z.array(z.string().min(1)).max(200) }).parse(req.body);
  if (new Set(eventIds).size !== eventIds.length) {
    res.status(400).json({ error: "DUPLICATE_EVENTS", message: "A lista não pode conter eventos repetidos." });
    return;
  }
  const trip = await prisma.trip.findFirst({ where: { id: tripId, organizationId }, select: { id: true } });
  if (!trip) {
    res.status(404).json({ error: "TRIP_NOT_FOUND" });
    return;
  }
  const events = await prisma.event.findMany({ where: { organizationId, id: { in: eventIds } }, select: { id: true } });
  if (events.length !== eventIds.length) {
    res.status(400).json({ error: "INVALID_EVENTS", message: "Todos os eventos precisam pertencer a esta orquestra." });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.tripEvent.deleteMany({ where: { tripId } });
    if (eventIds.length) await tx.tripEvent.createMany({ data: eventIds.map((eventId, sortOrder) => ({ tripId, eventId, sortOrder })) });
  });
  const eventLinks = await prisma.tripEvent.findMany({ where: { tripId }, include: { event: true }, orderBy: { sortOrder: "asc" } });
  res.json({ eventLinks });
}));
