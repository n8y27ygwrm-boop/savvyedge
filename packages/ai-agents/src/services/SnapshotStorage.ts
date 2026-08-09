import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export const DEFAULT_MAX_SNAPSHOT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_SNAPSHOT_RETENTION_DAYS = 7;

const ALLOWED_FS_ERROR_CODES = new Set([
  "EACCES",
  "ENOSPC",
  "EMFILE",
  "EROFS",
  "ENOENT",
  "EEXIST",
  "EPERM",
]);

export function classifyFsErrorForLogging(err: unknown): string {
  if (err instanceof Error) {
    if (
      "code" in err &&
      typeof (err as { code?: unknown }).code === "string" &&
      ALLOWED_FS_ERROR_CODES.has((err as { code: string }).code)
    ) {
      return (err as { code: string }).code;
    }
    if (
      ["TypeError", "RangeError", "SyntaxError", "ReferenceError", "Error"].includes(
        err.name,
      )
    ) {
      return err.name;
    }
    return "Error";
  }
  return "UnknownError";
}

export function resolveSnapshotRoot(customRoot?: string): string {
  const root =
    customRoot ||
    process.env.SAVVY_SNAPSHOT_ROOT ||
    path.resolve(process.cwd(), "storage/snapshots");
  return path.resolve(root);
}

export function verifyPathConfinement(root: string, targetPath: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative === ""
  ) {
    throw new Error("PATH_CONFINEMENT_VIOLATION");
  }
}

export function extractSafeHostForSnapshot(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "unknown-host";
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.hostname) {
      return parsed.hostname
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "_")
        .slice(0, 100);
    }
  } catch {
    // Fall back to unknown-host
  }
  return "unknown-host";
}

export function generateSafeSnapshotFilename(
  url: string,
  htmlHash?: string,
): string {
  const safeHost = extractSafeHostForSnapshot(url);
  const hashSeed = htmlHash || url;
  const shortHash = crypto
    .createHash("sha256")
    .update(hashSeed)
    .digest("hex")
    .slice(0, 12);
  const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
  return `${dateStr}_${safeHost}_${shortHash}.html`;
}

export const DEFAULT_PRUNE_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

export interface SaveSnapshotOptions {
  url: string;
  rawHtml: string;
  htmlHash?: string;
  snapshotRoot?: string;
  maxSizeBytes?: number;
  maxAgeDays?: number;
  forcePrune?: boolean;
}

export interface SaveSnapshotResult {
  saved: boolean;
  relativePath?: string;
  absolutePath?: string;
  byteSize: number;
  reason?: "MAX_SIZE_EXCEEDED" | "PATH_CONFINEMENT_VIOLATION" | "FS_ERROR";
}

export class SnapshotStorage {
  private static lastPruneTimestampByRoot = new Map<string, number>();

  /**
   * Resets the prune throttle cache for testing purposes.
   */
  public static resetPruneThrottleForTesting(): void {
    this.lastPruneTimestampByRoot.clear();
  }

  /**
   * Persists raw HTML snapshot under the dedicated snapshot root with strict
   * path confinement, bounded size enforcement, opportunistic retention, and safe relative path output.
   */
  public static saveSnapshot(options: SaveSnapshotOptions): SaveSnapshotResult {
    const {
      url,
      rawHtml,
      htmlHash,
      snapshotRoot,
      maxSizeBytes = DEFAULT_MAX_SNAPSHOT_SIZE_BYTES,
    } = options;

    const safeHost = extractSafeHostForSnapshot(url);
    const byteSize = Buffer.byteLength(rawHtml || "", "utf8");

    // 1. Enforce maximum snapshot byte size
    if (byteSize > maxSizeBytes) {
      console.warn(
        `[SnapshotStorage] HTML snapshot exceeded max size limit (${byteSize} > ${maxSizeBytes} bytes) for host ${safeHost}; skipping snapshot persistence.`,
      );
      return {
        saved: false,
        byteSize,
        reason: "MAX_SIZE_EXCEEDED",
      };
    }

    // 2. Resolve root and verify confinement
    const root = resolveSnapshotRoot(snapshotRoot);
    const fileName = generateSafeSnapshotFilename(url, htmlHash);
    const targetPath = path.resolve(root, fileName);

    try {
      verifyPathConfinement(root, targetPath);
    } catch (err: unknown) {
      const errorClassification = classifyFsErrorForLogging(err);
      console.warn(
        `[SnapshotStorage] Path confinement check failed for host ${safeHost} (${errorClassification})`,
      );
      return {
        saved: false,
        byteSize,
        reason: "PATH_CONFINEMENT_VIOLATION",
      };
    }

    // 3. Opportunistic bounded retention sweep before write
    try {
      const now = Date.now();
      const lastPrune = this.lastPruneTimestampByRoot.get(root) ?? 0;
      if (options.forcePrune || now - lastPrune >= DEFAULT_PRUNE_THROTTLE_MS) {
        this.lastPruneTimestampByRoot.set(root, now);
        this.pruneExpiredSnapshots({
          snapshotRoot: root,
          maxAgeDays: options.maxAgeDays ?? DEFAULT_SNAPSHOT_RETENTION_DAYS,
        });
      }
    } catch (pruneErr: unknown) {
      // Non-fatal: pruning error must never fail snapshot persistence
      const errorClassification = classifyFsErrorForLogging(pruneErr);
      console.warn(
        `[SnapshotStorage] Opportunistic snapshot pruning failed (${errorClassification})`,
      );
    }

    // 4. Perform write with bounded error handling
    try {
      if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
      }

      fs.writeFileSync(targetPath, rawHtml, "utf-8");
      console.log(`[SnapshotStorage] Saved HTML snapshot: ${fileName}`);

      return {
        saved: true,
        relativePath: fileName,
        absolutePath: targetPath,
        byteSize,
      };
    } catch (err: unknown) {
      const errorClassification = classifyFsErrorForLogging(err);
      console.warn(
        `[SnapshotStorage] Failed to save HTML snapshot for host ${safeHost} (${errorClassification})`,
      );
      return {
        saved: false,
        byteSize,
        reason: "FS_ERROR",
      };
    }
  }

  /**
   * Bounded local retention sweep: removes snapshots older than maxAgeDays
   * strictly confined within the snapshot root.
   */
  public static pruneExpiredSnapshots(options?: {
    snapshotRoot?: string;
    maxAgeDays?: number;
  }): number {
    const root = resolveSnapshotRoot(options?.snapshotRoot);
    const maxAgeDays = options?.maxAgeDays ?? DEFAULT_SNAPSHOT_RETENTION_DAYS;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let prunedCount = 0;
    try {
      if (!fs.existsSync(root)) {
        return 0;
      }

      const entries = fs.readdirSync(root);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const fullPath = path.resolve(root, entry);
        try {
          verifyPathConfinement(root, fullPath);
          const stats = fs.statSync(fullPath);
          if (stats.isFile() && now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fullPath);
            prunedCount += 1;
          }
        } catch {
          // Skip unconfined or inaccessible entries safely
        }
      }
    } catch (err: unknown) {
      const errorClassification = classifyFsErrorForLogging(err);
      console.warn(
        `[SnapshotStorage] Snapshot pruning encountered an error (${errorClassification})`,
      );
    }

    return prunedCount;
  }
}

export const saveSnapshot = SnapshotStorage.saveSnapshot.bind(SnapshotStorage);
export const pruneExpiredSnapshots =
  SnapshotStorage.pruneExpiredSnapshots.bind(SnapshotStorage);
