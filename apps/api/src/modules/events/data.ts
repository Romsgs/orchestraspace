import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";

export async function loadOrganizationEvents(organizationId: string, eventIds?: string[]) {
  if (eventIds && !eventIds.length) return [];
  const events = await prisma.event.findMany({
    where: { organizationId, ...(eventIds ? { id: { in: eventIds } } : {}) },
    orderBy: { startAt: "asc" }
  });
  if (!events.length) return [];

  const ids = events.map(({ id }) => id);
  const [rehearsalDetails, concertDetails, assignments] = await Promise.all([
    prisma.rehearsalDetails.findMany({ where: { eventId: { in: ids } } }),
    prisma.concertDetails.findMany({ where: { eventId: { in: ids } } }),
    prisma.eventMusician.findMany({
      where: { eventId: { in: ids } },
      select: { id: true, eventId: true, membershipId: true, createdAt: true }
    })
  ]);

  const membershipIds = [...new Set(assignments.map(({ membershipId }) => membershipId))];
  const memberships = membershipIds.length ? await prisma.membership.findMany({
    where: { id: { in: membershipIds }, organizationId },
    select: { id: true, userId: true, organizationId: true, instrument: true }
  }) : [];
  const userIds = [...new Set(memberships.map(({ userId }) => userId))];
  const users = userIds.length ? await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true }
  }) : [];
  const membershipById = new Map(memberships.map((membership) => [membership.id, membership]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const validAssignments = assignments.flatMap((assignment) => {
    const membership = membershipById.get(assignment.membershipId);
    const user = membership && userById.get(membership.userId);
    if (!membership || !user) return [];
    return [{ ...assignment, membership: { ...membership, user } }];
  }).sort((a, b) => a.membership.user.name.localeCompare(b.membership.user.name));
  const missingCount = assignments.length - validAssignments.length;
  if (missingCount) {
    logger.warn({ organizationId, missingCount }, "Skipped event-musician links with missing membership or user records");
  }

  const rehearsalByEventId = new Map(rehearsalDetails.map((details) => [details.eventId, details]));
  const concertByEventId = new Map(concertDetails.map((details) => [details.eventId, details]));
  const musiciansByEventId = new Map<string, typeof validAssignments>();
  for (const assignment of validAssignments) {
    const list = musiciansByEventId.get(assignment.eventId) ?? [];
    list.push(assignment);
    musiciansByEventId.set(assignment.eventId, list);
  }

  return events.map((event) => ({
    ...event,
    rehearsalDetails: rehearsalByEventId.get(event.id) ?? null,
    concertDetails: concertByEventId.get(event.id) ?? null,
    musicians: musiciansByEventId.get(event.id) ?? []
  }));
}
