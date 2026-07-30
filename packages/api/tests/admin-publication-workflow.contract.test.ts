import { describe, expect, it } from "vitest";
import {
  GovernedSubjectType,
  PublicationStatus,
  ReviewStatus,
} from "@savvyedge/database";
import { getEvidenceEligibilityError } from "../src/services/workflow-transition.policy";
import { governanceDetailUrl } from "../../../apps/admin/src/lib/governance-links";
import {
  isPublicationQueueCandidate,
  PUBLICATION_QUEUE_FILTER,
} from "../../../apps/admin/src/lib/publication-queue";

const subjectId = "11111111-1111-4111-8111-111111111111";

describe("Admin publication workflow contracts", () => {
  it("selects only approved and unpublished publication candidates", () => {
    expect(PUBLICATION_QUEUE_FILTER).toEqual({
      review_status: ReviewStatus.APPROVED,
      publication_status: PublicationStatus.UNPUBLISHED,
    });
    expect(
      isPublicationQueueCandidate({
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.UNPUBLISHED,
      }),
    ).toBe(true);
    expect(
      isPublicationQueueCandidate({
        review_status: ReviewStatus.APPROVED,
        publication_status: PublicationStatus.PUBLISHED,
      }),
    ).toBe(false);
  });

  it("reopens an approved bonus on its existing governance detail page", () => {
    expect(governanceDetailUrl(GovernedSubjectType.BONUS, subjectId)).toBe(
      `/review/bonus/${subjectId}`,
    );
  });

  it("builds audit subject deep links from subject type and subject ID", () => {
    expect(governanceDetailUrl(GovernedSubjectType.CASINO, subjectId)).toBe(
      `/review/casino/${subjectId}`,
    );
    expect(governanceDetailUrl(GovernedSubjectType.SLOT, subjectId)).toBe(
      `/quarantine/slot/${subjectId}`,
    );
    expect(governanceDetailUrl(GovernedSubjectType.LICENSE, subjectId)).toBe(
      `/quarantine/license/${subjectId}`,
    );
  });

  it("keeps contradictory publication evidence fail-closed", () => {
    expect(
      getEvidenceEligibilityError(
        {
          verdict: "CONTRADICTS",
          sourceUrl: "https://operator.example.com/offer",
          observedAt: new Date("2026-07-01T00:00:00.000Z"),
          extractedAt: new Date("2026-07-01T00:00:00.000Z"),
          validFrom: null,
          expiresAt: null,
        },
        new Date("2026-07-30T00:00:00.000Z"),
      ),
    ).toBe("EVIDENCE_CONTRADICTORY");
  });
});
