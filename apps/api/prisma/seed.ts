import "dotenv/config";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password || password === "CHANGE_ME_TO_A_LONG_UNIQUE_PASSWORD") {
    throw new Error("Configure BOOTSTRAP_ADMIN_EMAIL e uma BOOTSTRAP_ADMIN_PASSWORD forte em .env");
  }
  if (password.length < 14) {
    throw new Error("A senha inicial deve ter pelo menos 14 caracteres.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Usuário ${email} já existe; nenhuma alteração foi feita.`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.create({
    data: {
      email,
      name: "System Superadmin",
      passwordHash,
      isSuperAdmin: true,
      isActive: true,
      emailVerifiedAt: new Date()
    }
  });
  console.log(`Superusuário inicial criado: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
