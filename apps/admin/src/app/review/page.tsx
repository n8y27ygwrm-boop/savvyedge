import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import { prisma, ReviewStatus, WorkflowEventType } from "@savvyedge/database";

export interface ReviewQueuePageProps {
  searchParams: Promise<{
    type?: string;
    status?: string;
  }>;
}

interface UnifiedQueueItem {
  id: string;
  nameOrHeadline: string;
  entityType: "CASINO" | "BONUS";
  reviewStatus: string;
  publicationStatus: string;
  quarantineReason: string | null;
  latestEventType: string;
  latestEventTimestamp: Date;
  isMaterialChange: boolean;
  detailUrl: string;
}

interface RawCasinoQueueItem {
  id: string;
  name: string;
  review_status: string;
  publication_status: string;
  quarantine_reason: string | null;
  created_at: Date;
  updated_at: Date;
  workflow_events: Array<{ event_type: string; occurred_at: Date }>;
}

interface RawBonusQueueItem {
  id: string;
  headline_value: string | null;
  type: string;
  review_status: string;
  publication_status: string;
  quarantine_reason: string | null;
  created_at: Date;
  updated_at: Date;
  workflow_events: Array<{ event_type: string; occurred_at: Date }>;
}

export default async function ReviewQueuePage(props: ReviewQueuePageProps) {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const searchParams = await props.searchParams;
  const typeFilter = searchParams.type?.toUpperCase(); // "ALL", "CASINO", "BONUS"
  const statusFilter = searchParams.status?.toUpperCase(); // "ALL", "AWAITING_REVIEW", "IN_REVIEW"

  const targetReviewStatuses =
    statusFilter === "AWAITING_REVIEW"
      ? [ReviewStatus.AWAITING_REVIEW]
      : statusFilter === "IN_REVIEW"
      ? [ReviewStatus.IN_REVIEW]
      : [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW];

  let rawCasinos: RawCasinoQueueItem[] = [];
  if (!typeFilter || typeFilter === "ALL" || typeFilter === "CASINO") {
    rawCasinos = await prisma.casino.findMany({
      where: {
        review_status: { in: targetReviewStatuses },
      },
      select: {
        id: true,
        name: true,
        review_status: true,
        publication_status: true,
        quarantine_reason: true,
        created_at: true,
        updated_at: true,
        workflow_events: {
          orderBy: { occurred_at: "desc" },
          take: 1,
          select: {
            event_type: true,
            occurred_at: true,
          },
        },
      },
    });
  }

  let rawBonuses: RawBonusQueueItem[] = [];
  if (!typeFilter || typeFilter === "ALL" || typeFilter === "BONUS") {
    rawBonuses = await prisma.bonus.findMany({
      where: {
        review_status: { in: targetReviewStatuses },
      },
      select: {
        id: true,
        headline_value: true,
        type: true,
        review_status: true,
        publication_status: true,
        quarantine_reason: true,
        created_at: true,
        updated_at: true,
        workflow_events: {
          orderBy: { occurred_at: "desc" },
          take: 1,
          select: {
            event_type: true,
            occurred_at: true,
          },
        },
      },
    });
  }

  const items: UnifiedQueueItem[] = [];

  for (const c of rawCasinos) {
    const latestEvent = c.workflow_events[0];
    const eventType = latestEvent?.event_type || WorkflowEventType.REVIEW_REQUESTED;
    const eventTime = latestEvent?.occurred_at || c.updated_at || c.created_at;
    const isMaterial = eventType === WorkflowEventType.MATERIAL_CHANGE_DETECTED;

    items.push({
      id: c.id,
      nameOrHeadline: c.name,
      entityType: "CASINO",
      reviewStatus: c.review_status,
      publicationStatus: c.publication_status,
      quarantineReason: c.quarantine_reason,
      latestEventType: eventType,
      latestEventTimestamp: new Date(eventTime),
      isMaterialChange: isMaterial,
      detailUrl: `/review/casino/${c.id}`,
    });
  }

  for (const b of rawBonuses) {
    const latestEvent = b.workflow_events[0];
    const eventType = latestEvent?.event_type || WorkflowEventType.REVIEW_REQUESTED;
    const eventTime = latestEvent?.occurred_at || b.updated_at || b.created_at;
    const isMaterial = eventType === WorkflowEventType.MATERIAL_CHANGE_DETECTED;

    items.push({
      id: b.id,
      nameOrHeadline: b.headline_value || `${b.type} Bonus`,
      entityType: "BONUS",
      reviewStatus: b.review_status,
      publicationStatus: b.publication_status,
      quarantineReason: b.quarantine_reason,
      latestEventType: eventType,
      latestEventTimestamp: new Date(eventTime),
      isMaterialChange: isMaterial,
      detailUrl: `/review/bonus/${b.id}`,
    });
  }

  // Deterministic sorting:
  // 1. Material change items first
  // 2. Oldest waiting item first (ascending timestamp)
  // 3. ID comparison tie-breaker
  items.sort((a, b) => {
    if (a.isMaterialChange !== b.isMaterialChange) {
      return a.isMaterialChange ? -1 : 1;
    }
    const timeDiff = a.latestEventTimestamp.getTime() - b.latestEventTimestamp.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>Workflow Review Queue</h1>
          <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
            Manage entity reviews, verify evidence claims, and approve items for publication.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {/* Filtering UI */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <strong>Entity:</strong>
            <Link href={`/review?type=ALL&status=${statusFilter || "ALL"}`} style={{ textDecoration: !typeFilter || typeFilter === "ALL" ? "underline" : "none", fontWeight: !typeFilter || typeFilter === "ALL" ? "bold" : "normal" }}>All</Link> |
            <Link href={`/review?type=CASINO&status=${statusFilter || "ALL"}`} style={{ textDecoration: typeFilter === "CASINO" ? "underline" : "none", fontWeight: typeFilter === "CASINO" ? "bold" : "normal" }}>Casino</Link> |
            <Link href={`/review?type=BONUS&status=${statusFilter || "ALL"}`} style={{ textDecoration: typeFilter === "BONUS" ? "underline" : "none", fontWeight: typeFilter === "BONUS" ? "bold" : "normal" }}>Bonus</Link>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <strong>Status:</strong>
            <Link href={`/review?type=${typeFilter || "ALL"}&status=ALL`} style={{ textDecoration: !statusFilter || statusFilter === "ALL" ? "underline" : "none", fontWeight: !statusFilter || statusFilter === "ALL" ? "bold" : "normal" }}>All</Link> |
            <Link href={`/review?type=${typeFilter || "ALL"}&status=AWAITING_REVIEW`} style={{ textDecoration: statusFilter === "AWAITING_REVIEW" ? "underline" : "none", fontWeight: statusFilter === "AWAITING_REVIEW" ? "bold" : "normal" }}>Awaiting</Link> |
            <Link href={`/review?type=${typeFilter || "ALL"}&status=IN_REVIEW`} style={{ textDecoration: statusFilter === "IN_REVIEW" ? "underline" : "none", fontWeight: statusFilter === "IN_REVIEW" ? "bold" : "normal" }}>In Review</Link>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", background: "#fff", border: "1px dashed #cbd5e1", borderRadius: 8 }}>
          <h3 style={{ margin: "0 0 8px 0", color: "#475569" }}>No Entities Awaiting Review</h3>
          <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
            All extracted evidence and entities are currently processed or reviewed.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1" }}>
                <th style={{ padding: "12px 16px" }}>Entity Name / Headline</th>
                <th style={{ padding: "12px 16px" }}>Type</th>
                <th style={{ padding: "12px 16px" }}>Review Status</th>
                <th style={{ padding: "12px 16px" }}>Publication</th>
                <th style={{ padding: "12px 16px" }}>Quarantine</th>
                <th style={{ padding: "12px 16px" }}>Latest Workflow Event</th>
                <th style={{ padding: "12px 16px" }}>Timestamp</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.entityType}-${item.id}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "12px 16px", fontWeight: "bold" }}>
                    {item.isMaterialChange && (
                      <span style={{ display: "inline-block", background: "#fef3c7", color: "#92400e", fontSize: 11, padding: "2px 6px", borderRadius: 4, marginRight: 8, fontWeight: "bold" }}>
                        MATERIAL CHANGE
                      </span>
                    )}
                    {item.nameOrHeadline}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: item.entityType === "CASINO" ? "#e0f2fe" : "#f3e8ff", color: item.entityType === "CASINO" ? "#0369a1" : "#6b21a8", fontWeight: "bold" }}>
                      {item.entityType}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontWeight: "bold", color: item.reviewStatus === "AWAITING_REVIEW" ? "#d97706" : "#2563eb" }}>
                      {item.reviewStatus}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ color: item.publicationStatus === "PUBLISHED" ? "#16a34a" : "#64748b" }}>
                      {item.publicationStatus}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {item.quarantineReason ? (
                      <span style={{ color: "#dc2626", fontWeight: "bold" }}>{item.quarantineReason}</span>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, fontFamily: "monospace" }}>
                    {item.latestEventType}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "#64748b" }}>
                    {item.latestEventTimestamp.toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    <Link
                      href={item.detailUrl}
                      style={{ background: "#2563eb", color: "#fff", padding: "6px 12px", borderRadius: 4, textDecoration: "none", fontSize: 13, fontWeight: "bold" }}
                    >
                      Open Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
