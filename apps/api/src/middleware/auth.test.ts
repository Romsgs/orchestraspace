import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  membership: { findFirst: vi.fn(), findMany: vi.fn() },
  membershipRole: { findMany: vi.fn() },
  role: { findMany: vi.fn() }
}));
const { findFirst } = db.membership;
vi.mock("../lib/prisma.js", () => ({ prisma: db }));
vi.mock("../lib/logger.js", () => ({ logger: { warn: vi.fn() } }));

import { requireOrgRole } from "./auth.js";

function response() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

describe("organization role isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findFirst.mockResolvedValue({ id: "member-b" });
    db.membership.findMany.mockResolvedValue([{ id: "member-b", organizationId: "orchestra-b" }]);
    db.membershipRole.findMany.mockResolvedValue([{ membershipId: "member-b", roleId: "role-b" }]);
    db.role.findMany.mockResolvedValue([{ id: "role-b", key: "EVENT_MANAGER", name: "Manager", organizationId: "orchestra-b" }]);
  });

  it("does not allow a membership in one orchestra to authorize a different orchestra", async () => {
    findFirst.mockImplementation(async (query: any = {}) => query.where?.organizationId === "orchestra-a" ? { roles: [{ role: { key: "ORG_ADMIN" } }] } : null);
    const req: any = { params: { organizationId: "orchestra-b" }, currentUser: { id: "user-1", isSuperAdmin: false } };
    const res = response();
    const next = vi.fn();

    await requireOrgRole(req, res, next, ["ORG_ADMIN"]);

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      organizationId: "orchestra-b", userId: "user-1", status: "ACTIVE", organization: { status: "ACTIVE" }
    }) }));
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ORG_ACCESS_DENIED");
  });

  it("only proceeds when the requested orchestra returns an allowed role", async () => {
    findFirst.mockResolvedValue({ id: "member-b" });
    const req: any = { params: { organizationId: "orchestra-b" }, currentUser: { id: "user-1", isSuperAdmin: false } };
    const res = response();
    const next = vi.fn();

    await requireOrgRole(req, res, next, ["EVENT_MANAGER"]);

    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(res.statusCode).toBe(200);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "orchestra-b" }) }));
  });

  it("authorizes ORG_ADMIN through a valid membership and role in the same orchestra", async () => {
    db.role.findMany.mockResolvedValue([{ id: "role-b", key: "ORG_ADMIN", name: "Admin", organizationId: "orchestra-b" }]);
    const req: any = { params: { organizationId: "orchestra-b" }, currentUser: { id: "user-1", isSuperAdmin: false } };
    const next = vi.fn();
    await requireOrgRole(req, response(), next, ["ORG_ADMIN"]);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });

  it.each(["deleted role", "deleted membership", "role from another orchestra"])("denies access safely for a %s", async (damage) => {
    if (damage === "deleted role") db.role.findMany.mockResolvedValue([]);
    if (damage === "deleted membership") db.membership.findMany.mockResolvedValue([]);
    if (damage === "role from another orchestra") db.role.findMany.mockResolvedValue([
      { id: "role-b", key: "ORG_ADMIN", name: "Admin", organizationId: "orchestra-a" }
    ]);
    const req: any = { params: { organizationId: "orchestra-b" }, currentUser: { id: "user-1", isSuperAdmin: false } };
    const res = response();
    const next = vi.fn();
    await requireOrgRole(req, res, next, ["ORG_ADMIN", "EVENT_MANAGER"]);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ORG_PERMISSION_DENIED");
  });

  it("forwards database failures as errors rather than treating next(error) as authorization", async () => {
    const error = new Error("database unavailable");
    db.membershipRole.findMany.mockRejectedValue(error);
    const req: any = { params: { organizationId: "orchestra-b" }, currentUser: { id: "user-1", isSuperAdmin: false } };
    const next = vi.fn();
    await requireOrgRole(req, response(), next, ["EVENT_MANAGER"]);
    expect(next).toHaveBeenCalledExactlyOnceWith(error);
  });
});
