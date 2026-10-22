import { beforeEach, describe, expect, it, vi } from "vitest";
import argon2 from "argon2";

const db = vi.hoisted(() => ({
  invitation: { findUnique: vi.fn(), updateMany: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn() },
  organization: { findFirst: vi.fn() },
  role: { findMany: vi.fn() },
  membership: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  membershipRole: { upsert: vi.fn() },
  $transaction: vi.fn()
}));
vi.mock("../../lib/prisma.js", () => ({ prisma: db }));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("argon2", () => ({ default: { argon2id: 2, hash: vi.fn().mockResolvedValue("test-hash"), verify: vi.fn().mockResolvedValue(true) } }));

import { authRouter } from "./routes.js";

function acceptInvitation(userId?: string) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const req = {
      method: "POST", url: "/accept-invitation", session: { userId },
      body: { token: "invitation-token-for-testing", name: "New Admin", password: "a-long-test-password" }
    };
    const res: any = {
      status(code: number) { status = code; return res; },
      json(body: unknown) { resolve({ status, body }); return res; }
    };
    (authRouter as any).handle(req, res, (error: unknown) => reject(error ?? new Error("Route did not respond")));
  });
}

describe("ORG_ADMIN invitation acceptance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(argon2.hash).mockResolvedValue("test-hash" as never);
    vi.mocked(argon2.verify).mockResolvedValue(true);
    db.invitation.findUnique.mockResolvedValue({
      id: "invite-1", email: "admin@example.test", organizationId: "org-1", roleKeys: ["ORG_ADMIN"],
      instrument: null, acceptedAt: null, expiresAt: new Date(Date.now() + 86_400_000)
    });
    db.user.findUnique.mockResolvedValue(null);
    db.organization.findFirst.mockResolvedValue({ id: "org-1" });
    db.role.findMany.mockResolvedValue([{ id: "admin-role-1" }]);
    db.invitation.updateMany.mockResolvedValue({ count: 1 });
    db.user.create.mockResolvedValue({ id: "new-user-1" });
    db.membership.findUnique.mockResolvedValue(null);
    db.membership.create.mockResolvedValue({ id: "new-membership-1" });
    db.$transaction.mockImplementation(async (callback) => callback(db));
  });

  it("creates an active organization membership with ORG_ADMIN without granting global superadmin", async () => {
    const result = await acceptInvitation();
    expect(result.status).toBe(200);
    expect(result.body.userId).toBe("new-user-1");
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.role.findMany).toHaveBeenCalledWith({ where: { organizationId: "org-1", key: { in: ["ORG_ADMIN"] } }, select: { id: true } });
    expect(db.membership.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: "new-user-1", organizationId: "org-1", status: "ACTIVE", roles: { create: [{ roleId: "admin-role-1" }] }
    }) });
    expect(db.user.create.mock.calls[0]?.[0].data).not.toHaveProperty("isSuperAdmin");
  });

  it("reactivates an existing membership and adds the requested admin role", async () => {
    db.user.findUnique.mockResolvedValue({ id: "existing-user", isActive: true, passwordHash: "test-hash" });
    db.membership.findUnique.mockResolvedValue({ id: "existing-membership", status: "LEFT" });
    const result = await acceptInvitation("existing-user");
    expect(result.status).toBe(200);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.membership.create).not.toHaveBeenCalled();
    expect(db.membership.update).toHaveBeenCalledWith({ where: { id: "existing-membership" }, data: { status: "ACTIVE", instrument: undefined } });
    expect(db.membershipRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { membershipId: "existing-membership", roleId: "admin-role-1" }
    }));
  });

  it("rejects an invitation whose organization role has been deleted before creating an account", async () => {
    db.role.findMany.mockResolvedValue([]);
    const result = await acceptInvitation();
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("INVITATION_ROLES_INVALID");
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not create another user if a concurrent request already claimed the invitation", async () => {
    db.invitation.updateMany.mockResolvedValue({ count: 0 });
    const result = await acceptInvitation();
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("INVITATION_ALREADY_USED");
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.membership.create).not.toHaveBeenCalled();
  });
});
