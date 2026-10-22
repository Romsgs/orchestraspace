import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth, requireSuperadmin, orgRoles } from "../../middleware/auth.js";
import { loadMembershipRoles, loadMembershipRoleKeys } from "../../lib/safe-membership-relations.js";

export const organizationsRouter = Router();

organizationsRouter.get("/:organizationId/members", requireAuth, asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, status: "ACTIVE" }, select: { id: true } });
  if (!organization) { res.status(404).json({ error: "ORGANIZATION_NOT_FOUND" }); return; }
  const isSuperAdmin = req.currentUser!.isSuperAdmin;
  if (!isSuperAdmin) {
    const admin = await prisma.membership.findFirst({ where: { organizationId, userId: req.currentUser!.id, status: "ACTIVE" }, select: { id: true } });
    if (!admin || !(await loadMembershipRoleKeys(admin.id)).includes("ORG_ADMIN")) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  }
  let memberships;
  let invitations;
  try {
    [memberships, invitations] = await Promise.all([
      prisma.membership.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
      prisma.invitation.findMany({ where: {
        organizationId,
        OR: [{ acceptedAt: null }, { acceptedAt: { isSet: false } }],
        expiresAt: { gt: new Date() }
      }, select: { id: true, email: true, roleKeys: true, instrument: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "desc" } })
    ]);
  } catch (error) {
    try {
      const membershipRefs = await prisma.membership.findMany({
        where: { organizationId },
        select: { id: true, userId: true }
      });
      const userIds = [...new Set(membershipRefs.map(({ userId }) => userId))];
      const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } });
      const existingUserIds = new Set(users.map(({ id }) => id));
      const orphanMemberships = membershipRefs
        .filter(({ userId }) => !existingUserIds.has(userId))
        .map(({ id, userId }) => ({ membershipId: id, userId }));
      logger.error({ organizationId, orphanMembershipCount: orphanMemberships.length, orphanMemberships }, "Could not load organization members; checked for missing user records");
    } catch (diagnosticError) {
      logger.error({ organizationId, err: diagnosticError }, "Could not diagnose organization member query failure");
    }
    throw error;
  }
  const userIds = [...new Set(memberships.map(({ userId }) => userId))];
  const [users, rolesByMembership] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    loadMembershipRoles(memberships.map(({ id }) => id))
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const visibleMemberships = memberships.flatMap((membership) => {
    const user = usersById.get(membership.userId);
    return user ? [{ ...membership, user, roles: rolesByMembership.get(membership.id) ?? [] }] : [];
  });
  if (visibleMemberships.length !== memberships.length) {
    logger.warn({ organizationId, missingCount: memberships.length - visibleMemberships.length }, "Skipped memberships with missing user records");
  }
  res.json({ memberships: visibleMemberships, invitations });
}));

organizationsRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  if (req.currentUser!.isSuperAdmin) {
    const organizations = await prisma.organization.findMany({ orderBy: { name: "asc" } });
    res.json({ organizations });
    return;
  }
  const memberships = await prisma.membership.findMany({ where: { userId: req.currentUser!.id, status: "ACTIVE" } });
  const [organizations, rolesByMembership] = await Promise.all([
    prisma.organization.findMany({ where: { id: { in: [...new Set(memberships.map(({ organizationId }) => organizationId))] }, status: "ACTIVE" } }),
    loadMembershipRoles(memberships.map(({ id }) => id))
  ]);
  const organizationById = new Map(organizations.map((organization) => [organization.id, organization]));
  const visibleOrganizations = memberships.flatMap((membership) => {
    const organization = organizationById.get(membership.organizationId);
    return organization ? [{ ...organization, roles: (rolesByMembership.get(membership.id) ?? []).map(({ role }) => role.key) }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ organizations: visibleOrganizations });
}));

organizationsRouter.post("/", requireAuth, requireSuperadmin, asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
    description: z.string().max(2000).optional(),
    timezone: z.string().min(1).max(80).default("Europe/Sofia")
  }).parse(req.body);

  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: input });
    const ownerRole = await tx.role.create({
      data: {
        name: "Administrador da orquestra",
        key: "ORG_ADMIN",
        isSystemRole: true,
        organizationId: org.id,
        description: "Administra membros e recursos da instituição."
      }
    });
    const eventRole = await tx.role.create({
      data: {
        name: "Gestor de eventos",
        key: "EVENT_MANAGER",
        isSystemRole: true,
        organizationId: org.id
      }
    });
    await tx.role.create({
      data: {
        name: "Músico",
        key: "MUSICIAN",
        isSystemRole: true,
        organizationId: org.id
      }
    });
    await tx.role.create({
      data: {
        name: "Bibliotecário",
        key: "LIBRARIAN",
        isSystemRole: true,
        organizationId: org.id
      }
    });
    await tx.role.create({
      data: {
        name: "Somente leitura",
        key: "READ_ONLY",
        isSystemRole: true,
        organizationId: org.id
      }
    });
    await tx.auditLog.create({
      data: {
        actorId: req.currentUser!.id,
        organizationId: org.id,
        action: "organization.created",
        entityType: "Organization",
        entityId: org.id
      }
    });
    return { ...org, bootstrapRoleId: ownerRole.id, eventRoleId: eventRole.id };
  });
  res.status(201).json({ organization });
}));


organizationsRouter.post("/:organizationId/invitations", requireAuth, asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const input = z.object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    roleKey: z.enum(["ORG_ADMIN", "EVENT_MANAGER", "MUSICIAN", "LIBRARIAN", "READ_ONLY"]).default("MUSICIAN"),
    instrument: z.enum(["PERCUSSION", "PIANO", "HARP", "VIOLIN", "VIOLA", "CELLO", "DOUBLE_BASS", "FLUTE", "OBOE", "CLARINET", "BASSOON", "TRUMPET", "FRENCH_HORN", "TROMBONE", "TUBA"]).optional()
  }).parse(req.body);
  if (input.roleKey === "MUSICIAN" && !input.instrument) { res.status(400).json({ error: "INSTRUMENT_REQUIRED", message: "Selecione o instrumento do músico." }); return; }
  const actor = req.currentUser!;
  if (!actor.isSuperAdmin) {
    const membership = await prisma.membership.findFirst({ where: { organizationId, userId: actor.id, status: "ACTIVE" }, select: { id: true } });
    if (!membership || !(await loadMembershipRoleKeys(membership.id)).includes("ORG_ADMIN")) {
      res.status(403).json({ error: "FORBIDDEN", message: "Somente administradores podem convidar membros." });
      return;
    }
  }
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, status: "ACTIVE" } });
  if (!organization) {
    res.status(404).json({ error: "ORGANIZATION_NOT_FOUND" });
    return;
  }
  const role = await prisma.role.findFirst({ where: { organizationId, key: input.roleKey } });
  if (!role) {
    res.status(400).json({ error: "ROLE_NOT_FOUND" });
    return;
  }
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const invitation = await prisma.invitation.create({
    data: {
      email: input.email,
      tokenHash,
      organizationId,
      roleKeys: [input.roleKey],
      instrument: input.roleKey === "MUSICIAN" ? input.instrument : undefined,
      invitedById: actor.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    },
    select: { id: true, email: true, expiresAt: true, createdAt: true }
  });
  // Email delivery is not configured yet. The one-time token is returned to the authorized admin for manual sharing.
  res.status(201).json({ invitation, token: rawToken, note: "Compartilhe este token com segurança. O envio automático de e-mail será adicionado depois." });
}));

organizationsRouter.post("/:organizationId/members", requireAuth, asyncHandler(async (req, res) => {
  const organizationId = z.string().min(1).parse(req.params.organizationId);
  const input = z.object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    roleKey: z.enum(["ORG_ADMIN", "EVENT_MANAGER", "MUSICIAN", "LIBRARIAN", "READ_ONLY"]).default("MUSICIAN"),
    instrument: z.enum(["PERCUSSION", "PIANO", "HARP", "VIOLIN", "VIOLA", "CELLO", "DOUBLE_BASS", "FLUTE", "OBOE", "CLARINET", "BASSOON", "TRUMPET", "FRENCH_HORN", "TROMBONE", "TUBA"]).optional()
  }).parse(req.body);
  if (input.roleKey === "MUSICIAN" && !input.instrument) { res.status(400).json({ error: "INSTRUMENT_REQUIRED", message: "Selecione o instrumento do músico." }); return; }

  const actor = req.currentUser!;
  if (!actor.isSuperAdmin) {
    const membership = await prisma.membership.findFirst({ where: { organizationId, userId: actor.id, status: "ACTIVE" }, select: { id: true } });
    if (!membership || !(await loadMembershipRoleKeys(membership.id)).includes("ORG_ADMIN")) {
      res.status(403).json({ error: "FORBIDDEN", message: "Somente administradores da orquestra podem adicionar membros." });
      return;
    }
  }

  const [user, organization, role] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.role.findFirst({ where: { organizationId, key: input.roleKey } })
  ]);
  if (!organization || organization.status !== "ACTIVE") {
    res.status(404).json({ error: "ORGANIZATION_NOT_FOUND", message: "Orquestra não encontrada ou inativa." });
    return;
  }
  if (!user) {
    res.status(404).json({ error: "USER_NOT_FOUND", message: "A conta ainda não existe. Envie um convite para que a pessoa possa criar o acesso." });
    return;
  }
  if (!role) {
    res.status(400).json({ error: "ROLE_NOT_FOUND", message: "Papel não configurado para esta orquestra." });
    return;
  }

  const membership = await prisma.$transaction(async (tx) => {
    const existing = await tx.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } }
    });
    if (!existing) {
      return tx.membership.create({
        data: {
          userId: user.id, organizationId, status: "ACTIVE", joinedAt: new Date(), instrument: input.roleKey === "MUSICIAN" ? input.instrument : undefined,
          roles: { create: { roleId: role.id } }
        }
      });
    }
    await tx.membership.update({
      where: { id: existing.id },
      data: {
        status: "ACTIVE",
        instrument: input.roleKey === "MUSICIAN" ? input.instrument : undefined,
        roles: { connectOrCreate: {
          where: { membershipId_roleId: { membershipId: existing.id, roleId: role.id } },
          create: { roleId: role.id }
        } }
      }
    });
    return tx.membership.findUniqueOrThrow({ where: { id: existing.id } });
  });
  const [memberUser, roleMap] = await Promise.all([
    prisma.user.findUnique({ where: { id: membership.userId }, select: { id: true, name: true, email: true } }),
    loadMembershipRoles([membership.id])
  ]);
  if (!memberUser) {
    logger.warn({ organizationId, membershipId: membership.id }, "Membership references a missing user after member upsert");
    res.status(409).json({ error: "ORPHANED_MEMBERSHIP", message: "O vínculo existente aponta para uma conta removida. Corrija o vínculo antes de tentar novamente." });
    return;
  }
  res.status(201).json({ membership: { ...membership, user: memberUser, roles: roleMap.get(membership.id) ?? [] } });
}));

organizationsRouter.patch("/:organizationId/members/:membershipId", requireAuth, asyncHandler(async (req, res) => {
  const { organizationId, membershipId } = z.object({
    organizationId: z.string().min(1), membershipId: z.string().min(1)
  }).parse(req.params);
  if (!req.currentUser!.isSuperAdmin) {
    const membership = await prisma.membership.findFirst({ where: { organizationId, userId: req.currentUser!.id, status: "ACTIVE" }, select: { id: true } });
    if (!membership || !(await loadMembershipRoleKeys(membership.id)).includes("ORG_ADMIN")) {
      res.status(403).json({ error: "FORBIDDEN" });
      return;
    }
  }
  const input = z.object({
    status: z.enum(["ACTIVE", "SUSPENDED", "LEFT"]).optional(),
    roleKeys: z.array(z.string()).optional(),
    instrument: z.enum(["PERCUSSION", "PIANO", "HARP", "VIOLIN", "VIOLA", "CELLO", "DOUBLE_BASS", "FLUTE", "OBOE", "CLARINET", "BASSOON", "TRUMPET", "FRENCH_HORN", "TROMBONE", "TUBA"]).nullable().optional()
  }).parse(req.body);
  const target = await prisma.membership.findFirst({ where: { id: membershipId, organizationId } });
  if (!target) {
    res.status(404).json({ error: "MEMBERSHIP_NOT_FOUND" });
    return;
  }
  const data: any = {};
  if (input.status) data.status = input.status;
  if (input.instrument !== undefined) data.instrument = input.instrument;
  if (input.roleKeys) {
    const roles = await prisma.role.findMany({ where: { organizationId, key: { in: input.roleKeys } } });
    if (roles.length !== new Set(input.roleKeys).size) {
      res.status(400).json({ error: "INVALID_ROLE", message: "Um ou mais papéis são inválidos para esta orquestra." });
      return;
    }
    data.roles = { deleteMany: {}, create: roles.map((role) => ({ roleId: role.id })) };
    if (!input.roleKeys.includes("MUSICIAN")) data.instrument = null;
    else if (input.instrument === undefined && !target.instrument) { res.status(400).json({ error: "INSTRUMENT_REQUIRED", message: "Defina o instrumento do músico." }); return; }
  }
  const updated = await prisma.membership.update({ where: { id: membershipId }, data });
  const [memberUser, roleMap] = await Promise.all([
    prisma.user.findUnique({ where: { id: updated.userId }, select: { id: true, name: true, email: true } }),
    loadMembershipRoles([updated.id])
  ]);
  if (!memberUser) {
    logger.warn({ organizationId, membershipId }, "Could not return updated membership because its user record is missing");
    res.status(409).json({ error: "ORPHANED_MEMBERSHIP", message: "O vínculo aponta para uma conta removida." });
    return;
  }
  res.json({ membership: { ...updated, user: memberUser, roles: roleMap.get(updated.id) ?? [] } });
}));
