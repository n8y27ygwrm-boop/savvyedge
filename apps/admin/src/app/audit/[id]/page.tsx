import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import { getAuditEventDetail } from "@/lib/audit";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { EntityTypeBadge } from "@/components/ui/EntityTypeBadge";
import { InlineAlert } from "@/components/ui/InlineAlert";

export interface AuditEventDetailPageProps {
  params: Promise<{ id: string }>;
}

function eventTypeBadgeStyle(eventType: string): { bg: string; text: string; border: string } {
  switch (eventType) {
    case "APPROVED":
    case "PUBLISHED":
      return { bg: "rgba(16, 185, 129, 0.15)", text: "#34d399", border: "rgba(16, 185, 129, 0.3)" };
    case "REJECTED":
    case "UNPUBLISHED":
    case "WITHDRAWN":
      return { bg: "rgba(239, 68, 68, 0.15)", text: "#f87171", border: "rgba(239, 68, 68, 0.3)" };
    case "QUARANTINED":
      return { bg: "rgba(245, 158, 11, 0.15)", text: "#fbbf24", border: "rgba(245, 158, 11, 0.3)" };
    case "QUARANTINE_CLEARED":
      return { bg: "rgba(59, 130, 246, 0.15)", text: "#60a5fa", border: "rgba(59, 130, 246, 0.3)" };
    case "REVIEW_REQUESTED":
    case "REVIEW_STARTED":
      return { bg: "rgba(245, 158, 11, 0.15)", text: "#f59e0b", border: "rgba(245, 158, 11, 0.3)" };
    case "MATERIAL_CHANGE_DETECTED":
      return { bg: "rgba(168, 85, 247, 0.15)", text: "#c084fc", border: "rgba(168, 85, 247, 0.3)" };
    default:
      return { bg: "rgba(255, 255, 255, 0.05)", text: "var(--admin-muted)", border: "var(--admin-border)" };
  }
}

export default async function AuditEventDetailPage(props: AuditEventDetailPageProps) {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const params = await props.params;
  const eventId = params.id;
  const event = await getAuditEventDetail(eventId);

  if (!event) {
    notFound();
  }

  const bStyle = eventTypeBadgeStyle(event.eventType);

  return (
    <div>
      <PageHeader
        title={`Audit Record: ${event.eventType}`}
        subtitle={`Event ID: ${event.id} | Subject ID: ${event.subjectId}`}
        badge={
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 700,
              background: bStyle.bg,
              color: bStyle.text,
              border: `1px solid ${bStyle.border}`,
            }}
          >
            {event.eventType}
          </span>
        }
        breadcrumbs={[
          { label: "Audit Log", href: "/audit" },
          { label: event.id.slice(0, 8) + "..." },
        ]}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <EntityTypeBadge type={event.subjectType} />
            <span
              className="tabular-nums"
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 4,
                background: "rgba(255, 255, 255, 0.05)",
                color: "var(--admin-muted)",
                border: "1px solid var(--admin-border)",
              }}
            >
              v{event.expectedVersion} → v{event.resultingVersion}
            </span>
          </div>
        }
      />

      {/* Contextual Navigation Buttons */}
      {(event.reviewDetailUrl || event.quarantineDetailUrl) && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {event.reviewDetailUrl && (
            <Link
              href={event.reviewDetailUrl}
              style={{
                padding: "7px 14px",
                background: "rgba(59, 130, 246, 0.15)",
                color: "#60a5fa",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Inspect in Review Queue →
            </Link>
          )}
          {event.quarantineDetailUrl && (
            <Link
              href={event.quarantineDetailUrl}
              style={{
                padding: "7px 14px",
                background: "rgba(239, 68, 68, 0.15)",
                color: "#f87171",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Inspect in Quarantine Queue →
            </Link>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
        {/* State Transition Details */}
        <GlassPanel padding="20px">
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
            State Transition Summary
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Review Status Transition
              </div>
              <div>
                {event.fromReviewStatus && event.toReviewStatus ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <span style={{ color: "var(--admin-muted)" }}>{event.fromReviewStatus}</span>
                    <span style={{ color: "var(--admin-muted-dark)" }}>→</span>
                    <strong style={{ color: "#34d399" }}>{event.toReviewStatus}</strong>
                  </div>
                ) : (
                  <span style={{ color: "var(--admin-muted-dark)", fontSize: 13 }}>No review status change</span>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Publication Status Transition
              </div>
              <div>
                {event.fromPublicationStatus && event.toPublicationStatus ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                    <span style={{ color: "var(--admin-muted)" }}>{event.fromPublicationStatus}</span>
                    <span style={{ color: "var(--admin-muted-dark)" }}>→</span>
                    <strong style={{ color: "#60a5fa" }}>{event.toPublicationStatus}</strong>
                  </div>
                ) : (
                  <span style={{ color: "var(--admin-muted-dark)", fontSize: 13 }}>No publication status change</span>
                )}
              </div>
            </div>

            {event.quarantineReason && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Quarantine Reason
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#fbbf24" }}>
                  {event.quarantineReason}
                </div>
              </div>
            )}
          </div>
        </GlassPanel>

        {/* Actor & Metadata */}
        <GlassPanel padding="20px">
          <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
            Actor &amp; Event Metadata
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Executed By Actor
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text)" }}>
                {event.actorName} <span style={{ fontSize: 12, color: "var(--admin-muted)", fontWeight: 400 }}>({event.actorKind})</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Exact Timestamp
              </div>
              <div className="tabular-nums" style={{ fontSize: 13, fontFamily: "monospace", color: "var(--admin-text)" }}>
                {new Date(event.occurredAt).toISOString()}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Governance Version
              </div>
              <div className="tabular-nums" style={{ fontSize: 13, fontFamily: "monospace", color: "var(--admin-text)" }}>
                v{event.expectedVersion} → v{event.resultingVersion}
              </div>
            </div>
          </div>
        </GlassPanel>
      </div>

      {/* Internal Note / Explanation */}
      <GlassPanel padding="20px" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
          Internal Reason &amp; Explanation
        </h3>
        {event.internalNote ? (
          <div style={{ padding: 14, borderRadius: 6, background: "rgba(0, 0, 0, 0.4)", border: "1px solid var(--admin-border)", fontSize: 13, color: "var(--admin-text-secondary)", fontStyle: "italic" }}>
            &quot;{event.internalNote}&quot;
          </div>
        ) : (
          <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>No internal note recorded for this audit event.</div>
        )}
      </GlassPanel>

      {/* Linked Evidence Claims */}
      <GlassPanel padding="20px">
        <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
          Linked Evidence Claims ({event.claims.length})
        </h3>

        {event.claims.length === 0 ? (
          <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>No evidence claims linked to this audit event.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {event.claims.map((claim) => (
              <div
                key={claim.id}
                style={{
                  padding: 14,
                  borderRadius: 6,
                  background: claim.isSubjectMismatch ? "rgba(239, 68, 68, 0.08)" : "rgba(0, 0, 0, 0.3)",
                  border: claim.isSubjectMismatch ? "1px solid var(--admin-danger-border)" : "1px solid var(--admin-border)",
                }}
              >
                {claim.isSubjectMismatch && (
                  <InlineAlert
                    type="error"
                    title="Subject Discrepancy Warning"
                    message={`Linked evidence claim subject (${claim.subjectId}) does not match audit event subject (${event.subjectId}).`}
                    style={{ marginBottom: 12 }}
                  />
                )}

                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", textTransform: "uppercase" }}>Field: {claim.field}</span>
                  <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.3)", fontWeight: 700 }}>
                    {claim.verdict}
                  </span>
                </div>

                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text)", marginBottom: 8 }}>
                  Observed Value: <span style={{ color: "#ffffff", fontWeight: 700 }}>&quot;{claim.observedValue}&quot;</span>
                </div>

                <div style={{ fontSize: 12, color: "var(--admin-muted)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <span>
                    Source URL:{" "}
                    {claim.isSafeSourceUrl ? (
                      <a href={claim.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                        {claim.sourceUrl}
                      </a>
                    ) : (
                      <span style={{ color: "var(--admin-warning)" }}>{claim.sourceUrl} (Unsafe Protocol)</span>
                    )}
                  </span>
                  <span className="tabular-nums">Observed: {new Date(claim.observedAt).toISOString().slice(0, 19).replace("T", " ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
