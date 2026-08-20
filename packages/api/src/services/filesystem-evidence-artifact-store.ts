import * as fs from "fs";
import * as path from "path";
import {
  DEFAULT_SNAPSHOT_RETENTION_DAYS,
  SnapshotStorage,
  resolveSnapshotRoot,
  verifyPathConfinement,
} from "@savvyedge/ai-agents/snapshot-storage";
import {
  buildEvidenceArtifactObjectKey,
  computeEvidenceArtifactHash,
  EvidenceArtifactPersistenceError,
  type EvidenceArtifactStore,
  type PersistObservationInput,
  type PersistObservationResult,
  validateObservationInput,
} from "./evidence-artifact-storage.service";

export interface FilesystemEvidenceArtifactStoreOptions {
  snapshotRoot?: string;
  maxAgeDays?: number;
}

export class FilesystemEvidenceArtifactStore implements EvidenceArtifactStore {
  private readonly snapshotRoot: string;
  private readonly maxAgeDays: number;

  constructor(options: FilesystemEvidenceArtifactStoreOptions = {}) {
    this.snapshotRoot = resolveSnapshotRoot(options.snapshotRoot);
    this.maxAgeDays =
      options.maxAgeDays ?? DEFAULT_SNAPSHOT_RETENTION_DAYS;
  }

  public async persistObservation(
    input: PersistObservationInput,
  ): Promise<PersistObservationResult> {
    const { bytes, htmlHash } = validateObservationInput(input);
    const objectKey = buildEvidenceArtifactObjectKey(input, htmlHash);
    const relativePath = objectKey.replaceAll("/", "_");
    const targetPath = path.resolve(this.snapshotRoot, relativePath);

    try {
      verifyPathConfinement(this.snapshotRoot, targetPath);
      SnapshotStorage.pruneExpiredSnapshots({
        snapshotRoot: this.snapshotRoot,
        maxAgeDays: this.maxAgeDays,
      });
      await fs.promises.mkdir(this.snapshotRoot, { recursive: true });

      try {
        await fs.promises.writeFile(targetPath, bytes, { flag: "wx" });
      } catch (error: unknown) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            (error as { code?: unknown }).code === "EEXIST"
          )
        ) {
          throw error;
        }
      }

      const persistedBytes = await fs.promises.readFile(targetPath);
      if (
        persistedBytes.byteLength !== bytes.byteLength ||
        computeEvidenceArtifactHash(persistedBytes) !== htmlHash ||
        !persistedBytes.equals(bytes)
      ) {
        throw new EvidenceArtifactPersistenceError("OBJECT_COLLISION");
      }

      return {
        locator: relativePath,
        htmlHash,
        byteSize: bytes.byteLength,
      };
    } catch (error: unknown) {
      if (error instanceof EvidenceArtifactPersistenceError) {
        throw error;
      }
      throw new EvidenceArtifactPersistenceError("PERSISTENCE_FAILED");
    }
  }
}
