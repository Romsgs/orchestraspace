import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("../lib/prisma.js", () => ({ prisma: { membership: { findFirst } } }));

import { requireOrgRole } from "./auth.js";

function response() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

describe("organization role isolation", () => {
  beforeEach(() => findFirst.mockReset());

  it("does not allow a membership in one orchestra to authorize a different orchestra", async () => {
    findFirst.mockImplementation(async (query: any = {}) => query.where?.organizationId === "orchestra-a" ? { roles: [{ role: { key: "ORG_ADMIN" } }] } : null);
    const req: any = { params: { organizationId: "orchestra-b" }, currentUser: { id: "user-1", isSuperAdmin: false } };
    const res = response();
    let calledNext = false;

    await requireOrgRole(req, res, () => { calledNext = true; }, ["ORG_ADMIN"]);

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      organizationId: "orchestra-b", userId: "user-1", status: "ACTIVE", organization: { status: "ACTIVE" }
    }) }));
    expect(calledNext).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ORG_ACCESS_DENIED");
  });

  it("only proceeds when the requested orchestra returns an allowed role", async () => {
    findFirst.mockResolvedValue({ roles: [{ role: { key: "EVENT_MANAGER" } }] });
    const req: any = { params: { organizationId: "orchestra-b" }, currentUser: { id: "user-1", isSuperAdmin: false } };
    const res = response();
    let calledNext = false;

    await requireOrgRole(req, res, () => { calledNext = true; }, ["EVENT_MANAGER"]);

    expect(calledNext).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "orchestra-b" }) }));
  });
});
