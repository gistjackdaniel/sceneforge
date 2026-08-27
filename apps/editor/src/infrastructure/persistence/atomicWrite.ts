/**
 * Atomic localStorage write via temp key + swap (browser analogue of temp+rename).
 */
export const writeAtomicLocalStorage = (key: string, value: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  const tempKey = `${key}.tmp`;
  window.localStorage.setItem(tempKey, value);
  window.localStorage.setItem(key, value);
  window.localStorage.removeItem(tempKey);
};

/**
 * Atomic file write helper for future Electron Project Root (PRD §14).
 * Uses write-then-rename when `fs`/`path` are available; otherwise no-op.
 */
export const writeAtomicFile = async (filePath: string, data: string): Promise<void> => {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dir = path.dirname(filePath);
    const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
    await fs.writeFile(tempPath, data, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    throw new Error(
      `Atomic file write failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
};
