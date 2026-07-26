import { redirect, notFound } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth";
import { prisma } from "@savvyedge/database";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityTypeBadge } from "@/components/ui/EntityTypeBadge";
import { ReviewActionControls } from "../../components/ReviewActionControls";

export interface CasinoDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CasinoReviewDetailPage(props: CasinoDetailPageProps) {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const params = await props.params;
  const { id } = params;

  const casino = await prisma.casino.findUnique({
    where: { id },
    include: {
      licenses: true,
      evidence_claims: {
        include: {
          evidence: true,
        },
        orderBy: { created_at: "desc" },
      },
      workflow_events: {
        include: {
          actor: true,
        },
        orderBy: { occurred_at: "desc" },
        take: 10,
      },
    },
  });

  if (!casino) {
    notFound();
  }

  const claimIds = casino.evidence_claims.map((c) => c.id);

  return (
    <div>
      <PageHeader
        title={casino.name}
        subtitle={`Casino ID: ${casino.id}`}
        badge={<EntityTypeBadge type="CASINO" />}
        breadcrumbs={[
          { label: "Review Queue", href: "/review" },
          { label: casino.name },
        ]}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusBadge status={casino.review_status} />
            <StatusBadge status={casino.publication_status} />
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
              v{casino.governance_version}
            </span>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
        {/* Left Column: Main Evidence & Database Values */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Current Stored Database Values */}
          <GlassPanel padding="20px">
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
              Current Stored Database Values
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Brand Name
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text)" }}>{casino.name}</div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Slug
                </div>
                <div style={{ fontSize: 13, fontFamily: "monospace", color: "var(--admin-text-secondary)" }}>{casino.slug}</div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Official Website
                </div>
                <div>
                  {casino.website_url ? (
                    <a href={casino.website_url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }} className="hover:underline">
                      {casino.website_url} ↗
                    </a>
                  ) : (
                    <span style={{ color: "var(--admin-muted)", fontSize: 13 }}>—</span>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Provenance Type
                </div>
                <div style={{ fontSize: 13, color: "var(--admin-text)" }}>{casino.data_source_type}</div>
              </div>

              <div style={{ gridColumn: "span 2" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Registered Licenses
                </div>
                <div>
                  {casino.licenses.length > 0 ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {casino.licenses.map((l) => (
                        <span key={l.id} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "rgba(255, 255, 255, 0.05)", border: "1px solid var(--admin-border)", color: "var(--admin-text)" }}>
                          {l.license_no || l.status}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: "var(--admin-muted)", fontSize: 13 }}>No active registered licenses found</span>
                  )}
                </div>
              </div>
            </div>
          </GlassPanel>

          {/* Incoming Evidence Claims */}
          <GlassPanel padding="20px">
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
              Incoming Evidence Claims ({casino.evidence_claims.length})
            </h3>

            {casino.evidence_claims.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--admin-muted)", fontSize: 13, background: "rgba(0, 0, 0, 0.2)", borderRadius: 6, border: "1px dashed var(--admin-border)" }}>
                No evidence claims recorded. Approval requires at least one active evidence claim.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {casino.evidence_claims.map((claim) => (
                  <div key={claim.id} style={{ padding: 14, borderRadius: 6, background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--admin-border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", textTransform: "uppercase" }}>{claim.field}</span>
                      <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.3)", fontWeight: 700 }}>
                        {claim.verdict}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text)", marginBottom: 8 }}>
                      Observed Value: <span style={{ color: "#ffffff", fontWeight: 700 }}>&quot;{claim.observed_value}&quot;</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted)", display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Source: <a href={claim.evidence.source_url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>{claim.evidence.source_url}</a>
                      </span>
                      <span className="tabular-nums" style={{ whiteSpace: "nowrap" }}>
                        Observed: {new Date(claim.evidence.observed_at).toISOString().slice(0, 19).replace("T", " ")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>

          {/* Recent Audit Context */}
          <GlassPanel padding="20px">
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
              Recent Audit Events ({casino.workflow_events.length})
            </h3>

            {casino.workflow_events.length === 0 ? (
              <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>No workflow audit events recorded.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--admin-border)", color: "var(--admin-muted)" }}>
                      <th style={{ padding: "8px 0", textAlign: "left" }}>Event</th>
                      <th style={{ padding: "8px 0", textAlign: "left" }}>Actor</th>
                      <th style={{ padding: "8px 0", textAlign: "left" }}>Transition</th>
                      <th style={{ padding: "8px 0", textAlign: "right" }}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {casino.workflow_events.map((evt) => (
                      <tr key={evt.id} style={{ borderBottom: "1px solid var(--admin-border)" }}>
                        <td style={{ padding: "8px 0", fontFamily: "monospace", fontWeight: 600, color: "var(--admin-text)" }}>{evt.event_type}</td>
                        <td style={{ padding: "8px 0", color: "var(--admin-text-secondary)" }}>{evt.actor?.display_name || evt.actor?.kind || "System"}</td>
                        <td style={{ padding: "8px 0", color: "var(--admin-muted)" }}>
                          {evt.from_review_status || "—"} → <strong style={{ color: "var(--admin-text)" }}>{evt.to_review_status || "—"}</strong>
                        </td>
                        <td style={{ padding: "8px 0", textAlign: "right", color: "var(--admin-muted)" }} className="tabular-nums">
                          {new Date(evt.occurred_at).toISOString().slice(0, 19).replace("T", " ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassPanel>
        </div>

        {/* Right Column: Sticky Governance Action Panel */}
        <div style={{ position: "sticky", top: 76 }}>
          <ReviewActionControls
            subjectType="CASINO"
            subjectId={casino.id}
            reviewStatus={casino.review_status}
            publicationStatus={casino.publication_status}
            quarantineReason={casino.quarantine_reason}
            expectedVersion={casino.governance_version}
            claimIds={claimIds}
          />
        </div>
      </div>
    </div>
  );
}
