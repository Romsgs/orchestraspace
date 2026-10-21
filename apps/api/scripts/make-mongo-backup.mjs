import { config } from "dotenv";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(scriptDir, "..");
const repositoryDir = resolve(apiDir, "..", "..");
config({ path: join(apiDir, ".env"), quiet: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL não está definido em apps/api/.env nem no ambiente.");
  process.exit(1);
}

let databaseName;
try {
  const uri = new URL(databaseUrl);
  if (!["mongodb:", "mongodb+srv:"].includes(uri.protocol)) throw new Error("Protocolo inesperado");
  databaseName = process.env.MONGO_BACKUP_DATABASE?.trim() || decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
} catch {
  console.error("DATABASE_URL não parece ser uma URI válida do MongoDB.");
  process.exit(1);
}
if (!databaseName) {
  console.error("A URI não informa o nome do banco. Defina MONGO_BACKUP_DATABASE para escolher explicitamente o banco.");
  process.exit(1);
}

const outputDir = resolve(process.env.MONGO_BACKUP_DIR || join(repositoryDir, "backups", "mongodb"));
const timestamp = new Date().toISOString().replaceAll(":", "-");
const archivePath = join(outputDir, `orquestra-${timestamp}.archive.gz`);
const temporaryDir = await mkdtemp(join(tmpdir(), "orquestra-mongo-backup-"));
const configPath = join(temporaryDir, "mongodump.yml");
let archiveCreated = false;

try {
  await mkdir(outputDir, { recursive: true });
  // MongoDB Database Tools supports --config for credentials, avoiding the URI in process arguments.
  await writeFile(configPath, `uri: ${JSON.stringify(databaseUrl)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(configPath, 0o600).catch(() => undefined);

  await new Promise((resolvePromise, rejectPromise) => {
    const executable = process.env.MONGODUMP_BIN || "mongodump";
    const child = spawn(executable, [
      `--config=${configPath}`,
      `--db=${databaseName}`,
      `--archive=${archivePath}`,
      "--gzip"
    ], { stdio: "inherit", windowsHide: true });
    child.once("error", (error) => {
      if (error.code === "ENOENT") rejectPromise(new Error("mongodump não foi encontrado. Instale o MongoDB Database Tools e adicione-o ao PATH."));
      else rejectPromise(error);
    });
    child.once("close", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`mongodump terminou com código ${code ?? "desconhecido"}.`)));
  });

  const { size } = await stat(archivePath);
  if (size === 0) throw new Error("O arquivo de backup ficou vazio.");
  archiveCreated = true;
  console.log(`Backup concluído: ${archivePath} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
} catch (error) {
  await rm(archivePath, { force: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Não foi possível criar o backup.");
  process.exitCode = 1;
} finally {
  await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
  if (!archiveCreated) await rm(archivePath, { force: true }).catch(() => undefined);
}
