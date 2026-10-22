import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  event: { findMany: vi.fn() },
  rehearsalDetails: { findMany: vi.fn() },
  concertDetails: { findMany: vi.fn() },
  eventMusician: { findMany: vi.fn() },
  membership: { findMany: vi.fn() },
  user: { findMany: vi.fn() }
}));
vi.mock("../../lib/prisma.js", () => ({ prisma: db }));
vi.mock("../../lib/logger.js", () => ({ logger: { warn: vi.fn() } }));

import { loadOrganizationEvents } from "./data.js";

describe("events containing damaged membership references", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.event.findMany.mockResolvedValue([{ id: "event-1", organizationId: "org-1", title: "Concert" }]);
    db.rehearsalDetails.findMany.mockResolvedValue([]);
    db.concertDetails.findMany.mockResolvedValue([{ eventId: "event-1", bringStand: true }]);
    db.eventMusician.findMany.mockResolvedValue([
      { id: "lineup-valid", eventId: "event-1", membershipId: "member-1" },
      { id: "lineup-deleted-membership", eventId: "event-1", membershipId: "deleted-member" },
      { id: "lineup-deleted-user", eventId: "event-1", membershipId: "member-2" }
    ]);
    db.membership.findMany.mockResolvedValue([
      { id: "member-1", userId: "user-1", organizationId: "org-1", instrument: "VIOLA" },
      { id: "member-2", userId: "deleted-user", organizationId: "org-1", instrument: "VIOLIN" }
    ]);
    db.user.findMany.mockResolvedValue([{ id: "user-1", name: "Musician", email: "musician@example.test" }]);
  });

  it("keeps the event, details and healthy musician when other assignments have deleted parents", async () => {
    const events = await loadOrganizationEvents("org-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Concert");
    expect(events[0]?.concertDetails?.bringStand).toBe(true);
    expect(events[0]?.musicians).toEqual([expect.objectContaining({
      id: "lineup-valid",
      membership: expect.objectContaining({ id: "member-1", user: expect.objectContaining({ name: "Musician" }) })
    })]);
    expect(db.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      id: { in: ["member-1", "deleted-member", "member-2"] }, organizationId: "org-1"
    } }));
  });

  it("returns an empty lineup when all referenced memberships have been deleted", async () => {
    db.membership.findMany.mockResolvedValue([]);
    const events = await loadOrganizationEvents("org-1");
    expect(events).toHaveLength(1);
    expect(events[0]?.musicians).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("returns no events for an empty requested set instead of loading every event", async () => {
    expect(await loadOrganizationEvents("org-1", [])).toEqual([]);
    expect(db.event.findMany).not.toHaveBeenCalled();
  });

  it("does not mask a database outage as a successful empty lineup", async () => {
    const error = new Error("database unavailable");
    db.membership.findMany.mockRejectedValue(error);
    await expect(loadOrganizationEvents("org-1")).rejects.toThrow(error);
  });
});
