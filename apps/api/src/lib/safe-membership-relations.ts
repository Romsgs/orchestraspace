import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

type MembershipRole = { id: string; key: string; name: string };

/** MongoDB does not enforce Prisma relations when records are removed outside Prisma.
 * Resolve these references as separate scalar queries so one stale link cannot fail
 * an entire API request (or Prisma's nested include resolver).
 */
export async function loadMembershipRoles(membershipIds: string[]) {
  const result = new Map<string, Array<{ role: MembershipRole }>>();
  if (!membershipIds.length) return result;

  const [links, memberships] = await Promise.all([
    prisma.membershipRole.findMany({
      where: { membershipId: { in: membershipIds } },
      select: { membershipId: true, roleId: true }
    }),
    prisma.membership.findMany({
      where: { id: { in: membershipIds } },
      select: { id: true, organizationId: true }
    })
  ]);
  const organizationByMembership = new Map(memberships.map(({ id, organizationId }) => [id, organizationId]));
  const roleIds = [...new Set(links.map(({ roleId }) => roleId))];
  const roles = roleIds.length ? await prisma.role.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, key: true, name: true, organizationId: true }
  }) : [];
  const roleById = new Map(roles.map((role) => [role.id, role]));
  let missingRoleCount = 0;
  let invalidMembershipCount = 0;
  for (const link of links) {
    const role = roleById.get(link.roleId);
    if (!role) { missingRoleCount++; continue; }
    // A damaged link must never grant a role from another orchestra.
    if (organizationByMembership.get(link.membershipId) !== role.organizationId) {
      invalidMembershipCount++;
      continue;
    }
    const memberships = result.get(link.membershipId) ?? [];
    memberships.push({ role: { id: role.id, key: role.key, name: role.name } });
    result.set(link.membershipId, memberships);
  }
  if (missingRoleCount || invalidMembershipCount) {
    logger.warn({ missingRoleCount, invalidMembershipCount }, "Skipped invalid membership-role links");
  }
  return result;
}

export async function loadMembershipRoleKeys(membershipId: string) {
  const roles = await loadMembershipRoles([membershipId]);
  return (roles.get(membershipId) ?? []).map(({ role }) => role.key);
}
