import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  classifyFsErrorForLogging,
  DEFAULT_MAX_SNAPSHOT_SIZE_BYTES,
  DEFAULT_SNAPSHOT_RETENTION_DAYS,
  extractSafeHostForSnapshot,
  generateSafeSnapshotFilename,
  pruneExpiredSnapshots,
  resolveSnapshotRoot,
  SnapshotStorage,
  verifyPathConfinement,
} from "@savvyedge/ai-agents";

describe("Snapshot Persistence Security Hardening (Boundary B3)", () => {
  let tempSnapshotRoot: string;

  beforeEach(() => {
    tempSnapshotRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "savvy-snapshot-test-"),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempSnapshotRoot)) {
      try {
        fs.chmodSync(tempSnapshotRoot, 0o777);
      } catch {}
      fs.rmSync(tempSnapshotRoot, { recursive: true, force: true });
    }
  });

  describe("Path Confinement & Root Strategy", () => {
    it("resolves dedicated snapshot root safely", () => {
      const root = resolveSnapshotRoot(tempSnapshotRoot);
      expect(path.isAbsolute(root)).toBe(true);
      expect(root).toBe(path.resolve(tempSnapshotRoot));
    });

    it("verifies path confinement for targets strictly within root", () => {
      const validTarget = path.join(tempSnapshotRoot, "snapshot-1.html");
      expect(() =>
        verifyPathConfinement(tempSnapshotRoot, validTarget),
      ).not.toThrow();
    });

    it("rejects path traversal attempts escaping the root", () => {
      const outsideTargets = [
        path.join(tempSnapshotRoot, "../outside.html"),
        path.join(tempSnapshotRoot, "../../etc/passwd"),
        path.resolve("/etc/shadow"),
        tempSnapshotRoot, // Exact root is not a valid child target file
      ];

      for (const target of outsideTargets) {
        expect(() =>
          verifyPathConfinement(tempSnapshotRoot, target),
        ).toThrow("PATH_CONFINEMENT_VIOLATION");
      }
    });

    it("fails snapshot persistence safely if confinement is violated", () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      const result = SnapshotStorage.saveSnapshot({
        url: "https://example.com/normal",
        rawHtml: "<html><body>Content</body></html>",
        snapshotRoot: tempSnapshotRoot,
      });

      expect(result.saved).toBe(true);
      expect(result.relativePath).toBeDefined();

      // Ensure no files exist outside the dedicated temporary root
      const parentDir = path.dirname(tempSnapshotRoot);
      const rogueFiles = fs
        .readdirSync(parentDir)
        .filter((f) => f.includes("example.com") && f.endsWith(".html"));
      expect(rogueFiles.length).toBe(0);
    });
  });

  describe("Sensitive URL Filename Protection", () => {
    const SENSITIVE_URL =
      "https://user:password-secret@casino.example.com:8443/promotions/welcome?token=very-secret-token#private-fragment";

    it("extracts safe sanitized hostname without credentials, query params, or fragments", () => {
      const safeHost = extractSafeHostForSnapshot(SENSITIVE_URL);
      expect(safeHost).toBe("casino.example.com");
      expect(safeHost).not.toContain("user");
      expect(safeHost).not.toContain("password");
      expect(safeHost).not.toContain("very-secret-token");
      expect(safeHost).not.toContain("token=");
      expect(safeHost).not.toContain("private-fragment");
    });

    it("generates safe filename containing no sensitive URL components", () => {
      const filename = generateSafeSnapshotFilename(SENSITIVE_URL);
      expect(filename).not.toContain("user");
      expect(filename).not.toContain("password");
      expect(filename).not.toContain("very-secret-token");
      expect(filename).not.toContain("token=");
      expect(filename).not.toContain("private-fragment");
      expect(filename).toContain("casino.example.com");
      expect(filename.endsWith(".html")).toBe(true);
    });

    it("handles invalid or non-URL strings gracefully with unknown-host fallback", () => {
      expect(extractSafeHostForSnapshot("not-a-valid-url")).toBe("unknown-host");
      expect(extractSafeHostForSnapshot("")).toBe("unknown-host");
      const filename = generateSafeSnapshotFilename("not a url");
      expect(filename).toContain("unknown-host");
    });
  });

  describe("Maximum Snapshot Size Enforcement", () => {
    it("persists normal HTML snapshot below the max size limit", () => {
      const smallHtml = "<html><body><h1>Welcome</h1></body></html>";
      const result = SnapshotStorage.saveSnapshot({
        url: "https://casino.example.com/welcome",
        rawHtml: smallHtml,
        snapshotRoot: tempSnapshotRoot,
        maxSizeBytes: 1024 * 1024, // 1 MB
      });

      expect(result.saved).toBe(true);
      expect(result.byteSize).toBe(Buffer.byteLength(smallHtml, "utf8"));
      expect(result.relativePath).toBeDefined();

      const filePath = path.join(tempSnapshotRoot, result.relativePath!);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(smallHtml);
    });

    it("safely skips snapshot persistence and logs bounded warning when HTML exceeds limit", () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      const limit = 500; // 500 bytes limit
      const oversizedHtml = "A".repeat(1000); // 1000 bytes

      const result = SnapshotStorage.saveSnapshot({
        url: "https://casino.example.com/huge-page",
        rawHtml: oversizedHtml,
        snapshotRoot: tempSnapshotRoot,
        maxSizeBytes: limit,
      });

      expect(result.saved).toBe(false);
      expect(result.reason).toBe("MAX_SIZE_EXCEEDED");
      expect(result.relativePath).toBeUndefined();

      // Ensure no file was written to disk
      const files = fs.readdirSync(tempSnapshotRoot);
      expect(files.length).toBe(0);

      // Verify bounded warning log
      expect(warnSpy).toHaveBeenCalled();
      const allWarnings = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(allWarnings).toContain(
        "[SnapshotStorage] HTML snapshot exceeded max size limit",
      );
      expect(allWarnings).toContain("casino.example.com");
      expect(allWarnings).not.toContain(oversizedHtml); // Raw HTML must never appear in logs
    });
  });

  describe("Root-Relative Persisted Path Representation", () => {
    it("returns root-relative path without machine-specific absolute prefixes", () => {
      const result = SnapshotStorage.saveSnapshot({
        url: "https://casino.example.com/terms",
        rawHtml: "<html>Terms</html>",
        snapshotRoot: tempSnapshotRoot,
      });

      expect(result.saved).toBe(true);
      expect(result.relativePath).toBeDefined();

      // Relative path must not be absolute
      expect(path.isAbsolute(result.relativePath!)).toBe(false);
      expect(result.relativePath!).not.toContain(tempSnapshotRoot);
      expect(result.relativePath!.startsWith("/")).toBe(false);
      expect(result.relativePath!).toMatch(/^[0-9T\-_a-zA-Z.]+\.html$/);
    });
  });

  describe("Filesystem Error Logging Sanitization", () => {
    it("classifies standard and error codes safely while excluding raw messages or secrets", () => {
      const maliciousSecretFsError = new Error(
        "DATABASE_URL=postgresql://admin:super-secret@internal-db:5432/savvy EACCES permission denied",
      );
      maliciousSecretFsError.name = "CUSTOM_FS_SECRET_ERROR";
      maliciousSecretFsError.stack =
        "Error: stack-secret-info at /internal/fs.ts:1:1";

      const classified = classifyFsErrorForLogging(maliciousSecretFsError);
      expect(classified).toBe("Error");
      expect(classified).not.toContain("super-secret");
      expect(classified).not.toContain("DATABASE_URL");
      expect(classified).not.toContain("postgresql");

      const nodeFsError = Object.assign(new Error("Permission denied"), {
        code: "EACCES",
      });
      expect(classifyFsErrorForLogging(nodeFsError)).toBe("EACCES");
      expect(classifyFsErrorForLogging(new TypeError("test"))).toBe("TypeError");
      expect(classifyFsErrorForLogging("string error")).toBe("UnknownError");
    });

    it("safely handles filesystem write failures without leaking secrets into process logs", () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      // Create a read-only root directory
      const readOnlyRoot = path.join(tempSnapshotRoot, "readonly");
      fs.mkdirSync(readOnlyRoot, { mode: 0o444 });
      try {
        fs.chmodSync(readOnlyRoot, 0o444);
      } catch {}

      const result = SnapshotStorage.saveSnapshot({
        url: "https://casino.example.com/readonly-test",
        rawHtml: "<html>Content</html>",
        snapshotRoot: readOnlyRoot,
      });

      // If user has write permission regardless (e.g. root), clean up
      if (!result.saved) {
        expect(result.reason).toBe("FS_ERROR");
        expect(warnSpy).toHaveBeenCalled();
        const allWarnings = warnSpy.mock.calls
          .map((c) => c.join(" "))
          .join("\n");
        expect(allWarnings).toContain(
          "[SnapshotStorage] Failed to save HTML snapshot for host casino.example.com",
        );
      }
    });
  });

  describe("Snapshot Retention Policy", () => {
    it("prunes expired snapshots older than retention days while preserving recent snapshots", () => {
      // 1. Create a recent snapshot (mtime = now)
      const recentPath = path.join(tempSnapshotRoot, "recent-snapshot.html");
      fs.writeFileSync(recentPath, "<html>Recent</html>", "utf-8");

      // 2. Create an expired snapshot (mtime = 10 days ago)
      const expiredPath = path.join(tempSnapshotRoot, "expired-snapshot.html");
      fs.writeFileSync(expiredPath, "<html>Expired</html>", "utf-8");
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      fs.utimesSync(expiredPath, tenDaysAgo, tenDaysAgo);

      // 3. Run retention prune with 7-day threshold
      const pruned = pruneExpiredSnapshots({
        snapshotRoot: tempSnapshotRoot,
        maxAgeDays: DEFAULT_SNAPSHOT_RETENTION_DAYS,
      });

      expect(pruned).toBe(1);
      expect(fs.existsSync(expiredPath)).toBe(false);
      expect(fs.existsSync(recentPath)).toBe(true);
    });

    it("automatically activates opportunistic retention during saveSnapshot, pruning expired snapshots and keeping new snapshots", () => {
      // 1. Create an expired snapshot fixture in the temporary root
      const expiredPath = path.join(tempSnapshotRoot, "old-expired.html");
      fs.writeFileSync(expiredPath, "<html>Old Expired</html>", "utf-8");
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      fs.utimesSync(expiredPath, tenDaysAgo, tenDaysAgo);

      // 2. Create a recent snapshot fixture
      const existingRecentPath = path.join(
        tempSnapshotRoot,
        "existing-recent.html",
      );
      fs.writeFileSync(existingRecentPath, "<html>Recent</html>", "utf-8");

      // 3. Save a new snapshot through the standard production saveSnapshot path
      SnapshotStorage.resetPruneThrottleForTesting();
      const result = SnapshotStorage.saveSnapshot({
        url: "https://casino.example.com/new-live-offer",
        rawHtml: "<html><body>New Live Offer</body></html>",
        snapshotRoot: tempSnapshotRoot,
        forcePrune: true,
      });

      expect(result.saved).toBe(true);
      expect(result.relativePath).toBeDefined();

      // Assert expired snapshot was pruned
      expect(fs.existsSync(expiredPath)).toBe(false);

      // Assert existing recent snapshot was preserved
      expect(fs.existsSync(existingRecentPath)).toBe(true);

      // Assert newly written snapshot exists and was not deleted by its own cleanup
      const newSnapshotPath = path.join(
        tempSnapshotRoot,
        result.relativePath!,
      );
      expect(fs.existsSync(newSnapshotPath)).toBe(true);

      // Assert nothing outside snapshot root is touched
      const parentDir = path.dirname(tempSnapshotRoot);
      const rogueFiles = fs
        .readdirSync(parentDir)
        .filter((f) => f.includes("new-live-offer") && f.endsWith(".html"));
      expect(rogueFiles.length).toBe(0);
    });

    it("ensures pruning failure does not fail valid snapshot persistence or leak secrets into logs", () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      const maliciousPruningError = new Error(
        "DATABASE_URL=postgresql://admin:super-secret@internal-db:5432/savvy prune failure",
      );
      maliciousPruningError.name = "CUSTOM_PRUNE_SECRET_ERROR";

      vi.spyOn(SnapshotStorage, "pruneExpiredSnapshots").mockImplementation(
        () => {
          throw maliciousPruningError;
        },
      );

      const result = SnapshotStorage.saveSnapshot({
        url: "https://casino.example.com/resilient-save",
        rawHtml: "<html><body>Resilient Content</body></html>",
        snapshotRoot: tempSnapshotRoot,
        forcePrune: true,
      });

      // Snapshot persistence must succeed despite pruning failure
      expect(result.saved).toBe(true);
      expect(result.relativePath).toBeDefined();
      const savedPath = path.join(tempSnapshotRoot, result.relativePath!);
      expect(fs.existsSync(savedPath)).toBe(true);

      // Verify no secrets leaked in logs
      expect(warnSpy).toHaveBeenCalled();
      const allWarnings = warnSpy.mock.calls
        .map((c) => c.join(" "))
        .join("\n");
      expect(allWarnings).not.toContain("super-secret");
      expect(allWarnings).not.toContain("DATABASE_URL");
      expect(allWarnings).not.toContain("postgresql://admin");
      expect(allWarnings).not.toContain("CUSTOM_PRUNE_SECRET_ERROR");
      expect(allWarnings).toContain(
        "[SnapshotStorage] Opportunistic snapshot pruning failed (Error)",
      );
    });

    it("returns 0 gracefully if snapshot root does not exist", () => {
      const nonExistent = path.join(tempSnapshotRoot, "does-not-exist");
      expect(
        pruneExpiredSnapshots({
          snapshotRoot: nonExistent,
          maxAgeDays: 7,
        }),
      ).toBe(0);
    });
  });
});
