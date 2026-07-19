import { promises as fs } from "node:fs";
import * as path from "node:path";

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content, "utf8");
    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      await fs.rm(filePath, { force: true });
      await fs.rename(temporaryPath, filePath);
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
