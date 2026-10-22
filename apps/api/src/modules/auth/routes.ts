import { Router } from "express";
import { createHash } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../middleware/async-handler.js";
import { requireAuth } from "../../middleware/auth.js";
import { loadMembershipRoles } from "../../lib/safe-membership-relations.js";
import { logger } from "../../lib/logger.js";

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });


authRouter.post("/accept-invitation", asyncHandler(async (req, res) => {
  const input = z.object({
    token: z.string().min(20).max(200),
    name: z.string().trim().min(2).max(120),
    password: z.string().min(11).max(200).optional()
  }).parse(req.body);
  const tokenHash = createHash("sha256").update(input.token).digest("hex");
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash } });
  if (!invitation) {
    res.status(400).json({ error: "INVITATION_NOT_FOUND", message: "Este convite não foi encontrado nesta base. Abra o link no mesmo ambiente em que ele foi criado ou peça ao administrador um novo link." });
    return;
  }
  if (invitation.acceptedAt) {
    res.status(400).json({ error: "INVITATION_ALREADY_USED", message: "Este convite já foi aceito. Faça login com a conta associada ao convite." });
    return;
  }
  if (invitation.expiresAt <= new Date()) {
    res.status(400).json({ error: "INVITATION_EXPIRED", message: "Este convite expirou. Peça ao administrador que gere um novo link." });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email: invitation.email } });
  if (existing && !existing.isActive) {
    res.status(403).json({ error: "ACCOUNT_INACTIVE", message: "Esta conta está desativada." });
    return;
  }
  if (existing && (!req.session.userId || req.session.userId !== existing.id)) {
    res.status(409).json({ error: "ACCOUNT_EXISTS", message: "Entre na conta associada a este e-mail para aceitar o convite." });
    return;
  }
  if (req.session.userId && (!existing || req.session.userId !== existing.id)) {
    res.status(403).json({ error: "INVITATION_EMAIL_MISMATCH", message: "O convite precisa ser aceito pela conta do mesmo e-mail." });
    return;
  }
  if (existing && (!input.password || !(await argon2.verify(existing.passwordHash, input.password)))) {
    res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Confirme a senha da conta para aceitar o convite." });
    return;
  }
  if (!existing && !input.password) {
    res.status(400).json({ error: "PASSWORD_REQUIRED", message: "Defina uma senha com pelo menos 11 caracteres." });
    return;
  }
  const organization = await prisma.organization.findFirst({ where: { id: invitation.organizationId, status: "ACTIVE" }, select: { id: true } });
  if (!organization) {
    res.status(404).json({ error: "ORGANIZATION_NOT_FOUND", message: "A orquestra deste convite não está ativa." });
    return;
  }
  const roles = await prisma.role.findMany({ where: { organizationId: invitation.organizationId, key: { in: invitation.roleKeys } }, select: { id: true } });
  if (roles.length !== new Set(invitation.roleKeys).size) {
    res.status(400).json({ error: "INVITATION_ROLES_INVALID", message: "O convite contém um role que não existe mais." });
    return;
  }
  const acceptanceStartedAt = Date.now();
  logger.info({ invitationId: invitation.id, organizationId: invitation.organizationId, roleCount: roles.length }, "Accepting organization invitation");
  const passwordHash = input.password ? await argon2.hash(input.password, { type: argon2.argon2id }) : undefined;
  let userId: string | null;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        // MongoDB stores optional null fields as missing unless explicitly set.
        // Match both representations so a fresh invitation can be claimed.
        where: {
          id: invitation.id,
          OR: [
            { acceptedAt: null },
            { acceptedAt: { isSet: false } }
          ],
          expiresAt: { gt: new Date() }
        },
        data: { acceptedAt: new Date() }
      });
      if (!claimed.count) return null;
      const account = existing ?? await tx.user.create({
        data: { email: invitation.email, name: input.name, passwordHash: passwordHash!, emailVerifiedAt: null }
      });
      const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: account.id, organizationId: invitation.organizationId } } });
      if (!membership) {
        await tx.membership.create({ data: {
          userId: account.id, organizationId: invitation.organizationId, status: "ACTIVE", joinedAt: new Date(), instrument: invitation.instrument,
          roles: { create: roles.map((role) => ({ roleId: role.id })) }
        } });
      } else {
        await tx.membership.update({ where: { id: membership.id }, data: { status: "ACTIVE", instrument: invitation.instrument ?? undefined } });
        for (const role of roles) {
          await tx.membershipRole.upsert({
            where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
            create: { membershipId: membership.id, roleId: role.id },
            update: {}
          });
        }
      }
      return account.id;
    });
  } catch (error) {
    logger.error({
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      roleCount: roles.length,
      durationMs: Date.now() - acceptanceStartedAt,
      err: error
    }, "Invitation acceptance transaction failed");
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      res.status(409).json({ error: "ACCOUNT_CREATED_CONCURRENTLY", message: "A conta foi criada em outra solicitação. Entre com ela e aceite o convite novamente." });
      return;
    }
    throw error;
  }
  if (!userId) {
    res.status(400).json({ error: "INVITATION_ALREADY_USED", message: "Este convite foi aceito em outra solicitação. Faça login com a conta associada ao convite." });
    return;
  }
  logger.info({ invitationId: invitation.id, organizationId: invitation.organizationId, durationMs: Date.now() - acceptanceStartedAt }, "Organization invitation accepted");
  res.status(200).json({ message: "Convite aceito e vínculo ativado. Faça login para continuar.", userId });
}));

authRouter.post("/login", loginLimiter, asyncHandler(async (req, res) => {
  const input = z.object({
    email: z.string().email().transform((v) => v.toLowerCase().trim()),
    password: z.string().min(1).max(200)
  }).parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.isActive || !(await argon2.verify(user.passwordHash, input.password))) {
    res.status(401).json({ error: "INVALID_CREDENTIALS", message: "E-mail ou senha incorretos." });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
  req.session.userId = user.id;

  res.json({
    user: { id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin }
  });
}));

authRouter.post("/logout", asyncHandler(async (req, res) => {
  await new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => error ? reject(error) : resolve());
  });
  res.clearCookie("orchestra.sid");
  res.status(204).end();
}));

authRouter.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.currentUser!.id },
    select: { id: true, email: true, name: true, isSuperAdmin: true }
  });
  if (!user) { res.status(401).json({ error: "INVALID_SESSION" }); return; }
  const memberships = await prisma.membership.findMany({ where: { userId: user.id, status: "ACTIVE" } });
  const [organizations, rolesByMembership] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: [...new Set(memberships.map(({ organizationId }) => organizationId))] }, status: "ACTIVE" },
      select: { id: true, name: true, slug: true, timezone: true }
    }),
    loadMembershipRoles(memberships.map(({ id }) => id))
  ]);
  const organizationById = new Map(organizations.map((organization) => [organization.id, organization]));
  const visibleMemberships = memberships.flatMap((membership) => {
    const organization = organizationById.get(membership.organizationId);
    return organization ? [{ ...membership, organization, roles: rolesByMembership.get(membership.id) ?? [] }] : [];
  });
  if (visibleMemberships.length !== memberships.length) {
    logger.warn({ userId: user.id, missingCount: memberships.length - visibleMemberships.length }, "Skipped memberships with missing or inactive organization records");
  }
  res.json({ user: { ...user, memberships: visibleMemberships } });
}));
