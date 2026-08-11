import {
  EvidenceArtifactRetrievalError,
  EvidenceArtifactRetrievalService,
  type EvidenceArtifactReader,
  type EvidenceArtifactLocatorType,
} from "@savvyedge/api";
import { prisma } from "@savvyedge/database";

const EVIDENCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AdminEvidenceRetrievalError extends Error {
  public readonly code = "EVIDENCE_NOT_FOUND" as const;

  public constructor() {
    super("Governed evidence was not found");
    this.name = "AdminEvidenceRetrievalError";
  }
}

export interface AdminEvidenceRetrievalResult {
  id: string;
  evidenceType: string;
  sourceUrl: string;
  observedAt: string;
  extractedAt: string;
  htmlHash: string;
  locatorType: EvidenceArtifactLocatorType;
  byteSize: number;
  availability: "AVAILABLE";
  content: string;
}

export interface AdminEvidenceRetrievalDependencies {
  database?: Pick<typeof prisma, "evidenceRecord">;
  artifactReader?: EvidenceArtifactReader;
}

function decodeExactUtf8(bytes: Buffer): string {
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    throw new EvidenceArtifactRetrievalError("ARTIFACT_INTEGRITY_FAILED");
  }
  return content;
}

export async function retrieveGovernedAdminEvidence(
  evidenceId: string,
  dependencies: AdminEvidenceRetrievalDependencies = {},
): Promise<AdminEvidenceRetrievalResult> {
  if (!EVIDENCE_ID_PATTERN.test(evidenceId)) {
    throw new AdminEvidenceRetrievalError();
  }

  const database = dependencies.database ?? prisma;
  const evidence = await database.evidenceRecord.findFirst({
    where: {
      id: evidenceId,
      OR: [
        { casino_claims: { some: {} } },
        { bonus_claims: { some: {} } },
        { slot_claims: { some: {} } },
        { license_claims: { some: {} } },
      ],
    },
    select: {
      id: true,
      evidence_type: true,
      source_url: true,
      snapshot_path: true,
      html_hash: true,
      observed_at: true,
      extracted_at: true,
    },
  });

  if (!evidence) {
    throw new AdminEvidenceRetrievalError();
  }
  if (!evidence.snapshot_path) {
    throw new EvidenceArtifactRetrievalError("ARTIFACT_NOT_AVAILABLE");
  }
  if (!evidence.html_hash) {
    throw new EvidenceArtifactRetrievalError("ARTIFACT_INTEGRITY_FAILED");
  }

  const artifactReader =
    dependencies.artifactReader ?? new EvidenceArtifactRetrievalService();
  const artifact = await artifactReader.readArtifact({
    locator: evidence.snapshot_path,
    expectedHtmlHash: evidence.html_hash,
  });

  return {
    id: evidence.id,
    evidenceType: evidence.evidence_type,
    sourceUrl: evidence.source_url,
    observedAt: evidence.observed_at.toISOString(),
    extractedAt: evidence.extracted_at.toISOString(),
    htmlHash: artifact.htmlHash,
    locatorType: artifact.locatorType,
    byteSize: artifact.byteSize,
    availability: "AVAILABLE",
    content: decodeExactUtf8(artifact.bytes),
  };
}
