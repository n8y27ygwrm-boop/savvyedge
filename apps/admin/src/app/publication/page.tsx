import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth";
import { governanceDetailUrl } from "@/lib/governance-links";
import { PUBLICATION_QUEUE_FILTER } from "@/lib/publication-queue";
import {
  GovernedSubjectType,
  prisma,
  type PublicationStatus,
  type ReviewStatus,
} from "@savvyedge/database";
import { EmptyState } from "@/components/ui/EmptyState";
import { EntityTypeBadge } from "@/components/ui/EntityTypeBadge";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface PublicationQueueItem {
  id: string;
  label: string;
  context: string;
  entityType: "CASINO" | "BONUS";
  reviewStatus: ReviewStatus;
  publicationStatus: PublicationStatus;
  evidenceCount: number;
  updatedAt: Date;
  detailUrl: string;
}

export default async function PublicationQueuePage() {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const [casinos, bonuses] = await Promise.all([
    prisma.casino.findMany({
      where: PUBLICATION_QUEUE_FILTER,
      select: {
        id: true,
        name: true,
        slug: true,
        review_status: true,
        publication_status: true,
        updated_at: true,
        _count: { select: { evidence_claims: true } },
      },
      orderBy: [{ updated_at: "asc" }, { id: "asc" }],
    }),
    prisma.bonus.findMany({
      where: PUBLICATION_QUEUE_FILTER,
      select: {
        id: true,
        headline_value: true,
        type: true,
        review_status: true,
        publication_status: true,
        updated_at: true,
        casino: { select: { name: true } },
        _count: { select: { evidence_claims: true } },
      },
      orderBy: [{ updated_at: "asc" }, { id: "asc" }],
    }),
  ]);

  const items: PublicationQueueItem[] = [
    ...casinos.map((casino) => ({
      id: casino.id,
      label: casino.name,
      context: casino.slug,
      entityType: GovernedSubjectType.CASINO as "CASINO",
      reviewStatus: casino.review_status,
      publicationStatus: casino.publication_status,
      evidenceCount: casino._count.evidence_claims,
      updatedAt: casino.updated_at,
      detailUrl: governanceDetailUrl(GovernedSubjectType.CASINO, casino.id)!,
    })),
    ...bonuses.map((bonus) => ({
      id: bonus.id,
      label: bonus.headline_value || `${bonus.type} Bonus`,
      context: bonus.casino.name,
      entityType: GovernedSubjectType.BONUS as "BONUS",
      reviewStatus: bonus.review_status,
      publicationStatus: bonus.publication_status,
      evidenceCount: bonus._count.evidence_claims,
      updatedAt: bonus.updated_at,
      detailUrl: governanceDetailUrl(GovernedSubjectType.BONUS, bonus.id)!,
    })),
  ].sort((left, right) => {
    const timeDifference = left.updatedAt.getTime() - right.updatedAt.getTime();
    return timeDifference || left.id.localeCompare(right.id);
  });

  const missingEvidenceCount = items.filter(
    (item) => item.evidenceCount === 0,
  ).length;

  return (
    <div>
      <PageHeader
        title="Publication Queue"
        subtitle="Approved entities awaiting an explicit publication decision."
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <MetricCard
          label="Ready for Publication Review"
          value={items.length}
          subtext="Approved and unpublished"
          accentColor="emerald"
        />
        <MetricCard
          label="Casinos"
          value={casinos.length}
          subtext="Approved casino records"
          accentColor="blue"
        />
        <MetricCard
          label="Bonuses"
          value={bonuses.length}
          subtext="Approved bonus records"
          accentColor="neutral"
        />
        <MetricCard
          label="Missing Evidence"
          value={missingEvidenceCount}
          subtext="Publication remains blocked"
          accentColor={missingEvidenceCount > 0 ? "rose" : "emerald"}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No Entities Awaiting Publication"
          description="There are no approved, unpublished casinos or bonuses."
          guide="Items appear here only after review approval. Publication remains a separate explicit, evidence-gated action."
        />
      ) : (
        <GlassPanel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: 13,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "rgba(0, 0, 0, 0.4)",
                    borderBottom: "1px solid var(--admin-border)",
                  }}
                >
                  <th style={{ padding: "12px 16px" }}>Entity</th>
                  <th style={{ padding: "12px 16px" }}>Subject</th>
                  <th style={{ padding: "12px 16px" }}>Review</th>
                  <th style={{ padding: "12px 16px" }}>Publication</th>
                  <th style={{ padding: "12px 16px" }}>Evidence</th>
                  <th style={{ padding: "12px 16px", textAlign: "right" }}>
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={`${item.entityType}:${item.id}`}
                    style={{
                      borderBottom: "1px solid var(--admin-border)",
                    }}
                  >
                    <td style={{ padding: "14px 16px" }}>
                      <EntityTypeBadge type={item.entityType} size="sm" />
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <Link
                        href={item.detailUrl}
                        style={{
                          color: "var(--admin-text)",
                          fontWeight: 700,
                          textDecoration: "none",
                        }}
                      >
                        {item.label}
                      </Link>
                      <div
                        style={{
                          color: "var(--admin-muted)",
                          fontSize: 11,
                          marginTop: 3,
                        }}
                      >
                        {item.context}
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge status={item.reviewStatus} size="sm" />
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <StatusBadge status={item.publicationStatus} size="sm" />
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          color:
                            item.evidenceCount > 0
                              ? "#34d399"
                              : "var(--admin-warning)",
                          fontWeight: 700,
                        }}
                      >
                        {item.evidenceCount}
                      </span>
                      <span
                        style={{
                          color: "var(--admin-muted)",
                          marginLeft: 5,
                        }}
                      >
                        claim{item.evidenceCount === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "14px 16px",
                        textAlign: "right",
                      }}
                    >
                      <Link
                        href={item.detailUrl}
                        style={{
                          color: "#60a5fa",
                          fontWeight: 700,
                          textDecoration: "none",
                        }}
                      >
                        Inspect &amp; publish →
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
