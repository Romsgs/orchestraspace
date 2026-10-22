import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { loadMembershipRoleKeys } from "../lib/safe-membership-relations.js";

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
};

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.session.userId) {
      res.status(401).json({ error: "AUTH_REQUIRED", message: "Faça login para continuar." });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, email: true, name: true, isSuperAdmin: true, isActive: true }
    });
    if (!user || !user.isActive) {
      req.session.destroy(() => undefined);
      res.status(401).json({ error: "INVALID_SESSION", message: "Sessão inválida." });
      return;
    }
    req.currentUser = {
      id: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction) {
  if (!req.currentUser?.isSuperAdmin) {
    res.status(403).json({ error: "FORBIDDEN", message: "Requer privilégio de superusuário." });
    return;
  }
  next();
}

export async function requireOrgRole(
  req: Request,
  res: Response,
  next: NextFunction,
  allowedRoles: string[]
) {
  try {
    const organizationId = String(req.params.organizationId ?? "");
    if (req.currentUser?.isSuperAdmin) {
      next();
      return;
    }
    const membership = await prisma.membership.findFirst({
      where: {
        organizationId,
        userId: req.currentUser!.id,
        status: "ACTIVE",
        organization: { status: "ACTIVE" }
      },
      select: { id: true }
    });
    if (!membership) {
      res.status(403).json({ error: "ORG_ACCESS_DENIED", message: "Você não é membro ativo desta orquestra." });
      return;
    }
    const roles = await loadMembershipRoleKeys(membership.id);
    if (!roles.some((role) => allowedRoles.includes(role))) {
      res.status(403).json({ error: "ORG_PERMISSION_DENIED", message: "Você não tem permissão para esta operação." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function orgRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) =>
    requireOrgRole(req, res, next, roles);
}
