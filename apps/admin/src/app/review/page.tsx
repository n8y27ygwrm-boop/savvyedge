import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import { prisma, ReviewStatus, WorkflowEventType } from "@savvyedge/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityTypeBadge } from "@/components/ui/EntityTypeBadge";
import { EmptyState } from "@/components/ui/EmptyState";

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
  const typeFilter = searchParams.type?.toUpperCase() || "ALL"; // "ALL", "CASINO", "BONUS"
  const statusFilter = searchParams.status?.toUpperCase() || "ALL"; // "ALL", "AWAITING_REVIEW", "IN_REVIEW"

  const targetReviewStatuses =
    statusFilter === "AWAITING_REVIEW"
      ? [ReviewStatus.AWAITING_REVIEW]
      : statusFilter === "IN_REVIEW"
      ? [ReviewStatus.IN_REVIEW]
      : [ReviewStatus.AWAITING_REVIEW, ReviewStatus.IN_REVIEW];

  // Calculate real summary metrics from persisted database records
  const [awaitingCasinoCount, awaitingBonusCount, inReviewCasinoCount, inReviewBonusCount, quarantinedCasinoCount, quarantinedBonusCount] =
    await Promise.all([
      prisma.casino.count({ where: { review_status: ReviewStatus.AWAITING_REVIEW } }),
      prisma.bonus.count({ where: { review_status: ReviewStatus.AWAITING_REVIEW } }),
      prisma.casino.count({ where: { review_status: ReviewStatus.IN_REVIEW } }),
      prisma.bonus.count({ where: { review_status: ReviewStatus.IN_REVIEW } }),
      prisma.casino.count({ where: { review_status: ReviewStatus.QUARANTINED } }),
      prisma.bonus.count({ where: { review_status: ReviewStatus.QUARANTINED } }),
    ]);

  const awaitingTotal = awaitingCasinoCount + awaitingBonusCount;
  const inReviewTotal = inReviewCasinoCount + inReviewBonusCount;
  const quarantinedTotal = quarantinedCasinoCount + quarantinedBonusCount;

  let rawCasinos: RawCasinoQueueItem[] = [];
  if (typeFilter === "ALL" || typeFilter === "CASINO") {
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
  if (typeFilter === "ALL" || typeFilter === "BONUS") {
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
      <PageHeader
        title="Workflow Review Queue"
        subtitle="Operational workstation for reviewing extracted evidence, validating claims, and managing governance lifecycle."
      />

      {/* Summary KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="Awaiting Review"
          value={awaitingTotal}
          subtext="Pending human inspection"
          accentColor="amber"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <MetricCard
          label="In Review"
          value={inReviewTotal}
          subtext="Currently being evaluated"
          accentColor="blue"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          }
        />
        <MetricCard
          label="Quarantined Entities"
          value={quarantinedTotal}
          subtext="Blocked due to discrepancy"
          accentColor="rose"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          }
        />
      </div>

      {/* Filter Control Bar */}
      <GlassPanel padding="14px 20px" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
            {/* Entity Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Entity:
              </span>
              <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.4)", padding: 2, borderRadius: 6, border: "1px solid var(--admin-border)" }}>
                {(["ALL", "CASINO", "BONUS"] as const).map((t) => (
                  <Link
                    key={t}
                    href={`/review?type=${t}&status=${statusFilter}`}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: typeFilter === t ? 600 : 400,
                      color: typeFilter === t ? "#ffffff" : "var(--admin-muted)",
                      background: typeFilter === t ? "rgba(255, 255, 255, 0.12)" : "transparent",
                      textDecoration: "none",
                    }}
                  >
                    {t === "ALL" ? "All Entities" : t.charAt(0) + t.slice(1).toLowerCase()}
                  </Link>
                ))}
              </div>
            </div>

            {/* Status Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Status:
              </span>
              <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.4)", padding: 2, borderRadius: 6, border: "1px solid var(--admin-border)" }}>
                {(["ALL", "AWAITING_REVIEW", "IN_REVIEW"] as const).map((s) => (
                  <Link
                    key={s}
                    href={`/review?type=${typeFilter}&status=${s}`}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: statusFilter === s ? 600 : 400,
                      color: statusFilter === s ? "#ffffff" : "var(--admin-muted)",
                      background: statusFilter === s ? "rgba(255, 255, 255, 0.12)" : "transparent",
                      textDecoration: "none",
                    }}
                  >
                    {s === "ALL" ? "All Active" : s === "AWAITING_REVIEW" ? "Awaiting" : "In Review"}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
            Showing <strong style={{ color: "var(--admin-text)" }}>{items.length}</strong> items awaiting action
          </div>
        </div>
      </GlassPanel>

      {/* Main Queue Data Table */}
      {items.length === 0 ? (
        <EmptyState
          title="No Entities Pending Review"
          description="All extracted evidence and governance items are fully processed or meet active publication criteria."
        />
      ) : (
        <GlassPanel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(0, 0, 0, 0.4)", borderBottom: "1px solid var(--admin-border)" }}>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Entity Name / Headline
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Type
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Review Status
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Publication
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Latest Event
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Timestamp
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em", textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={`${item.entityType}-${item.id}`}
                    style={{
                      borderBottom: "1px solid var(--admin-border)",
                      transition: "background 0.15s ease",
                    }}
                  >
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {item.isMaterialChange && (
                          <span
                            style={{
                              padding: "1px 6px",
                              borderRadius: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              background: "rgba(245, 158, 11, 0.2)",
                              color: "#fbbf24",
                              border: "1px solid rgba(245, 158, 11, 0.4)",
                              letterSpacing: "0.05em",
                            }}
                          >
                            MATERIAL CHANGE
                          </span>
                        )}
                        <span style={{ fontWeight: 600, color: "var(--admin-text)", fontSize: 14 }}>
                          {item.nameOrHeadline}
                        </span>
                      </div>
                    </td>

                    <td style={{ padding: "14px 16px" }}>
                      <EntityTypeBadge type={item.entityType} size="sm" />
                    </td>

                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge status={item.reviewStatus} size="sm" />
                    </td>

                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge status={item.publicationStatus} size="sm" />
                    </td>

                    <td style={{ padding: "14px 16px", fontFamily: "monospace", fontSize: 12, color: "var(--admin-text-secondary)" }}>
                      {item.latestEventType}
                    </td>

                    <td style={{ padding: "14px 16px", fontSize: 12, color: "var(--admin-muted)" }} className="tabular-nums">
                      {item.latestEventTimestamp.toISOString().replace("T", " ").slice(0, 19)}
                    </td>

                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <Link
                        href={item.detailUrl}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: "rgba(37, 99, 235, 0.15)",
                          color: "#60a5fa",
                          border: "1px solid rgba(37, 99, 235, 0.3)",
                          padding: "5px 12px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          textDecoration: "none",
                          transition: "all 0.15s ease",
                        }}
                      >
                        Inspect & Review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
