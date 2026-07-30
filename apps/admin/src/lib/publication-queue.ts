import { PublicationStatus, ReviewStatus } from "@savvyedge/database";

export const PUBLICATION_QUEUE_FILTER = {
  review_status: ReviewStatus.APPROVED,
  publication_status: PublicationStatus.UNPUBLISHED,
} as const;

export function isPublicationQueueCandidate(input: {
  review_status: ReviewStatus;
  publication_status: PublicationStatus;
}): boolean {
  return (
    input.review_status === PUBLICATION_QUEUE_FILTER.review_status &&
    input.publication_status === PUBLICATION_QUEUE_FILTER.publication_status
  );
}
