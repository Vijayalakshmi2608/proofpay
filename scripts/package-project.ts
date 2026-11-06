import { existsSync, createWriteStream } from "node:fs";
import { lstat, readdir, rename, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const currentDirectory = process.cwd();
const root = existsSync(join(currentDirectory, "contracts")) ? currentDirectory : resolve(currentDirectory, "..");
const outputPath = join(root, "proofpay-hackathon-bundle.zip");
const temporaryPath = `${outputPath}.partial`;
const excludedDirectories = new Set([
  ".git", ".next", ".turbo", ".cache", ".pnpm-store", "node_modules", "target", "coverage", "dist", "out",
]);
const requiredDirectories = ["contracts", "frontend", "agent-verifier", "scripts"];
const requiredFiles = ["package.json", "README.md", "HACKATHON.md", "LICENSE"];

function shouldSkip(relativePath: string, name: string): boolean {
  if (name === "proofpay-hackathon-bundle.zip" || name === "proofpay-hackathon-bundle.zip.partial") return true;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true;
  return relativePath.split(sep).some((part) => excludedDirectories.has(part));
}

async function verifyRequiredPaths(): Promise<void> {
  for (const item of [...requiredDirectories, ...requiredFiles]) {
    const info = await lstat(join(root, item)).catch(() => null);
    if (!info || info.isSymbolicLink() || (requiredFiles.includes(item) ? !info.isFile() : !info.isDirectory())) {
      throw new Error(`Required bundle path is missing or has the wrong type: ${item}`);
    }
  }
}

async function collectFiles(directory: string, result: Array<{ path: string; name: string }>): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath);
    if (shouldSkip(relativePath, entry.name)) continue;
    // Do not follow symlinks: a link may escape the repository or disclose external files.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await collectFiles(absolutePath, result);
    } else if (entry.isFile()) {
      result.push({ path: absolutePath, name: relativePath.split(sep).join("/") });
    }
  }
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function main(): Promise<void> {
  await verifyRequiredPaths();
  const files: Array<{ path: string; name: string }> = [];
  await collectFiles(root, files);
  for (const required of requiredFiles) {
    if (!files.some((file) => file.name === required)) throw new Error(`Required file was excluded from the bundle: ${required}`);
  }
  if (files.some((file) => file.name.split("/").some((part) => excludedDirectories.has(part)))) {
    throw new Error("A heavy dependency/build/VCS directory leaked into the bundle file list.");
  }

  await rm(temporaryPath, { force: true });
  const { ZipArchive } = await import("archiver");
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = createWriteStream(temporaryPath, { flags: "w" });
  const finished = new Promise<void>((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    archive.once("error", reject);
    archive.on("warning", reject);
  });
  archive.pipe(output);
  for (const file of files) archive.file(file.path, { name: file.name });
  await archive.finalize();
  await finished;
  await rename(temporaryPath, outputPath);
  const outputStat = await stat(outputPath);
  console.log(`[SUCCESS] Saved ${relative(root, outputPath)} (${humanSize(outputStat.size)})`);
  console.log(`[INFO] Packaged ${files.length} files; excluded dependencies, build output, VCS metadata and secret environment files.`);
}

main().catch(async (error: unknown) => {
  await rm(temporaryPath, { force: true }).catch(() => undefined);
  console.error(`[ERROR] ZIP packaging failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`);
  process.exitCode = 1;
});
