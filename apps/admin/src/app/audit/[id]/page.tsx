import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import { getAuditEventDetail } from "@/lib/audit";

export interface AuditEventDetailPageProps {
  params: Promise<{ id: string }>;
}

function eventTypeBadgeColor(eventType: string): { bg: string; text: string } {
  switch (eventType) {
    case "APPROVED":
    case "PUBLISHED":
      return { bg: "#dcfce7", text: "#15803d" };
    case "REJECTED":
    case "UNPUBLISHED":
    case "WITHDRAWN":
      return { bg: "#fee2e2", text: "#b91c1c" };
    case "QUARANTINED":
      return { bg: "#ffedd5", text: "#c2410c" };
    case "QUARANTINE_CLEARED":
      return { bg: "#e0f2fe", text: "#0369a1" };
    case "REVIEW_REQUESTED":
    case "REVIEW_STARTED":
      return { bg: "#fef3c7", text: "#b45309" };
    case "MATERIAL_CHANGE_DETECTED":
      return { bg: "#f3e8ff", text: "#6b21a8" };
    default:
      return { bg: "#f1f5f9", text: "#475569" };
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

  const badge = eventTypeBadgeColor(event.eventType);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/audit" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14 }}>
          &larr; Back to Audit Log
        </Link>
      </div>

      {/* Header Banner */}
      <div style={{ background: "#fff", border: "1px solid #cbd5e1", padding: 24, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: badge.bg, color: badge.text, fontWeight: "bold" }}>
                EVENT: {event.eventType}
              </span>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "#f1f5f9", color: "#334155", fontWeight: "bold" }}>
                {event.subjectType}
              </span>
              <h1 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>{event.entityLabel}</h1>
            </div>
            <p style={{ margin: 0, color: "#64748b", fontSize: 14, fontFamily: "monospace" }}>
              Event ID: {event.id} | Subject ID: {event.subjectId}
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>Version Transition</div>
            <div style={{ fontSize: 20, fontWeight: "bold", fontFamily: "monospace" }}>
              v{event.expectedVersion} &rarr; v{event.resultingVersion}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 20, paddingTop: 16, borderTop: "1px solid #f1f5f9", fontSize: 14 }}>
          <div>
            <span style={{ color: "#64748b" }}>Timestamp: </span>
            <strong style={{ fontFamily: "monospace" }}>
              {new Date(event.occurredAt).toISOString()}
            </strong>
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Actor: </span>
            <strong>{event.actorName}</strong> ({event.actorKind})
          </div>
        </div>
      </div>

      {/* Contextual Navigation Buttons */}
      {(event.reviewDetailUrl || event.quarantineDetailUrl) && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          {event.reviewDetailUrl && (
            <Link
              href={event.reviewDetailUrl}
              style={{ padding: "8px 16px", background: "#0284c7", color: "#fff", textDecoration: "none", borderRadius: 4, fontWeight: "bold", fontSize: 13 }}
            >
              View in Review Queue &rarr;
            </Link>
          )}
          {event.quarantineDetailUrl && (
            <Link
              href={event.quarantineDetailUrl}
              style={{ padding: "8px 16px", background: "#ea580c", color: "#fff", textDecoration: "none", borderRadius: 4, fontWeight: "bold", fontSize: 13 }}
            >
              View in Quarantine Queue &rarr;
            </Link>
          )}
        </div>
      )}

      {/* State Transitions Card */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
          State Transition Details
        </h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            <tr style={{ borderBottom: "1px solid #f8fafc" }}>
              <td style={{ padding: "10px 0", color: "#64748b", width: 220 }}>Review Status Change</td>
              <td style={{ padding: "10px 0" }}>
                {event.fromReviewStatus && event.toReviewStatus ? (
                  <span>
                    <span style={{ color: "#475569" }}>{event.fromReviewStatus}</span> &rarr;{" "}
                    <strong style={{ color: "#0f172a" }}>{event.toReviewStatus}</strong>
                  </span>
                ) : (
                  <span style={{ color: "#94a3b8" }}>No review status transition recorded</span>
                )}
              </td>
            </tr>

            <tr style={{ borderBottom: "1px solid #f8fafc" }}>
              <td style={{ padding: "10px 0", color: "#64748b" }}>Publication Status Change</td>
              <td style={{ padding: "10px 0" }}>
                {event.fromPublicationStatus && event.toPublicationStatus ? (
                  <span>
                    <span style={{ color: "#475569" }}>{event.fromPublicationStatus}</span> &rarr;{" "}
                    <strong style={{ color: "#0f172a" }}>{event.toPublicationStatus}</strong>
                  </span>
                ) : (
                  <span style={{ color: "#94a3b8" }}>No publication status transition recorded</span>
                )}
              </td>
            </tr>

            {event.quarantineReason && (
              <tr style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "10px 0", color: "#64748b" }}>Quarantine Reason</td>
                <td style={{ padding: "10px 0" }}>
                  <strong style={{ color: "#c2410c" }}>{event.quarantineReason}</strong>
                </td>
              </tr>
            )}

            {event.canonicalTargetId && (
              <tr style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "10px 0", color: "#64748b" }}>Canonical Target (Superseded)</td>
                <td style={{ padding: "10px 0" }}>
                  <strong>{event.canonicalTargetLabel}</strong> (ID: {event.canonicalTargetId})
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Internal Note / Explanation */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8, marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 12px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
          Internal Reason &amp; Explanation
        </h3>
        {event.internalNote ? (
          <div style={{ background: "#f8fafc", padding: 14, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 14, color: "#334155", fontStyle: "italic" }}>
            &quot;{event.internalNote}&quot;
          </div>
        ) : (
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>No internal note recorded for this audit event.</p>
        )}
      </div>

      {/* Linked Evidence Claims */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
          Linked Evidence Claims ({event.claims.length})
        </h3>

        {event.claims.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>No evidence claims linked to this audit event.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {event.claims.map((claim) => (
              <div
                key={claim.id}
                style={{
                  padding: 16,
                  border: claim.isSubjectMismatch ? "1px solid #fca5a5" : "1px solid #e2e8f0",
                  borderRadius: 6,
                  background: claim.isSubjectMismatch ? "#fef2f2" : "#fafafa",
                }}
              >
                {claim.isSubjectMismatch && (
                  <div style={{ padding: 8, marginBottom: 12, background: "#fee2e2", color: "#991b1b", borderRadius: 4, fontSize: 12, fontWeight: "bold" }}>
                    Warning: Linked evidence claim subject ({claim.subjectId}) does not match audit event subject ({event.subjectId}).
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <strong style={{ fontSize: 14, color: "#0369a1" }}>Field: {claim.field}</strong>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#dcfce7", color: "#15803d", fontWeight: "bold" }}>
                    Verdict: {claim.verdict}
                  </span>
                </div>

                <div style={{ fontSize: 14, marginBottom: 8 }}>
                  Observed Value: <strong>&quot;{claim.observedValue}&quot;</strong>
                </div>

                <div style={{ fontSize: 12, color: "#64748b", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <span>
                    Source URL:{" "}
                    {claim.isSafeSourceUrl ? (
                      <a href={claim.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                        {claim.sourceUrl}
                      </a>
                    ) : (
                      <span style={{ color: "#475569" }}>{claim.sourceUrl} (Unsafe Protocol)</span>
                    )}
                  </span>
                  <span>Observed: {new Date(claim.observedAt).toISOString().slice(0, 19).replace("T", " ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
