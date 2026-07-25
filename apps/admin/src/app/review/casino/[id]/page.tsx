import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import { prisma } from "@savvyedge/database";
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
      <div style={{ marginBottom: 16 }}>
        <Link href="/review" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14 }}>
          ← Back to Review Queue
        </Link>
      </div>

      {/* Header Banner */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 24, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "#e0f2fe", color: "#0369a1", fontWeight: "bold" }}>
              CASINO GOVERNANCE
            </span>
            <h1 style={{ fontSize: 26, margin: "8px 0" }}>{casino.name}</h1>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13, fontFamily: "monospace" }}>
              ID: {casino.id}
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "#64748b", marginRight: 8 }}>Review:</span>
              <strong style={{ color: casino.review_status === "APPROVED" ? "#16a34a" : "#d97706" }}>
                {casino.review_status}
              </strong>
            </div>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "#64748b", marginRight: 8 }}>Publication:</span>
              <strong style={{ color: casino.publication_status === "PUBLISHED" ? "#16a34a" : "#64748b" }}>
                {casino.publication_status}
              </strong>
            </div>
            <div>
              <span style={{ fontSize: 13, color: "#64748b", marginRight: 8 }}>Version:</span>
              <strong>v{casino.governance_version}</strong>
            </div>
          </div>
        </div>

        {/* State metadata grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginTop: 20, paddingTop: 16, borderTop: "1px solid #f1f5f9" }}>
          <div>
            <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>Quarantine Reason</span>
            <strong>{casino.quarantine_reason || "None (Clear)"}</strong>
          </div>
          <div>
            <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>Verification Timestamp</span>
            <strong>{casino.verified_at ? new Date(casino.verified_at).toISOString() : "Unverified (null)"}</strong>
          </div>
          <div>
            <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>Provenance Type</span>
            <strong>{casino.data_source_type}</strong>
          </div>
          <div>
            <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>Created At</span>
            <strong>{new Date(casino.created_at).toISOString().slice(0, 19).replace("T", " ")}</strong>
          </div>
        </div>
      </div>

      {/* Action Controls */}
      <ReviewActionControls
        subjectType="CASINO"
        subjectId={casino.id}
        reviewStatus={casino.review_status}
        publicationStatus={casino.publication_status}
        quarantineReason={casino.quarantine_reason}
        expectedVersion={casino.governance_version}
        claimIds={claimIds}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 24 }}>
        {/* Current Stored Values */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
            Current Stored Database Values
          </h3>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 0", color: "#64748b", width: 140 }}>Name</td>
                <td style={{ padding: "8px 0", fontWeight: "bold" }}>{casino.name}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 0", color: "#64748b" }}>Slug</td>
                <td style={{ padding: "8px 0", fontFamily: "monospace" }}>{casino.slug}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 0", color: "#64748b" }}>Website URL</td>
                <td style={{ padding: "8px 0" }}>
                  {casino.website_url ? (
                    <a href={casino.website_url} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                      {casino.website_url}
                    </a>
                  ) : (
                    <span style={{ color: "#94a3b8" }}>—</span>
                  )}
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 0", color: "#64748b" }}>License Info</td>
                <td style={{ padding: "8px 0" }}>{casino.license_info || "—"}</td>
              </tr>
              <tr>
                <td style={{ padding: "8px 0", color: "#64748b" }}>Active Licenses</td>
                <td style={{ padding: "8px 0" }}>
                  {casino.licenses.length > 0 ? (
                    casino.licenses.map((l) => (
                      <span key={l.id} style={{ display: "inline-block", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4, fontSize: 12, marginRight: 4 }}>
                        {l.license_no || l.status}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "#94a3b8" }}>No registered licenses</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Incoming Evidence Claims */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
            Incoming Evidence Claims
          </h3>

          {casino.evidence_claims.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: 14 }}>No evidence claims recorded for this casino.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {casino.evidence_claims.map((claim) => (
                <div key={claim.id} style={{ padding: 12, border: "1px solid #f1f5f9", borderRadius: 6, background: "#fafafa" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <strong style={{ fontSize: 13, color: "#0369a1" }}>{claim.field}</strong>
                    <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#dcfce7", color: "#15803d", fontWeight: "bold" }}>
                      {claim.verdict}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 6 }}>
                    Claimed Value: <span style={{ color: "#0f172a" }}>"{claim.observed_value}"</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                    <span>Source: <a href={claim.evidence.source_url} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>{claim.evidence.source_url}</a></span>
                    <span>Observed: {new Date(claim.evidence.observed_at).toISOString().slice(0, 19).replace("T", " ")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Audit Trail Context */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8, marginTop: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
          Recent Workflow Audit Context
        </h3>

        {casino.workflow_events.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: 14 }}>No audit events recorded.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Event Type</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Actor</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>From State</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>To State</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Version</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {casino.workflow_events.map((evt) => (
                <tr key={evt.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: "bold" }}>{evt.event_type}</td>
                  <td style={{ padding: "8px 12px" }}>{evt.actor?.display_name || evt.actor?.kind || "System"}</td>
                  <td style={{ padding: "8px 12px", color: "#64748b" }}>{evt.from_review_status || "—"} / {evt.from_publication_status || "—"}</td>
                  <td style={{ padding: "8px 12px", fontWeight: "bold" }}>{evt.to_review_status || "—"} / {evt.to_publication_status || "—"}</td>
                  <td style={{ padding: "8px 12px" }}>v{evt.expected_version} → v{evt.resulting_version}</td>
                  <td style={{ padding: "8px 12px", color: "#64748b" }}>{new Date(evt.occurred_at).toISOString().slice(0, 19).replace("T", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
