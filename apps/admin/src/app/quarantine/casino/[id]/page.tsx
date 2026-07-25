import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import { prisma, GovernedSubjectType } from "@savvyedge/database";
import { quarantinedDetailWhere } from "@/lib/quarantine";
import { ClearQuarantineControls } from "../../components/ClearQuarantineControls";

export interface QuarantineCasinoDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function QuarantineCasinoDetailPage(props: QuarantineCasinoDetailPageProps) {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const params = await props.params;
  const casinoId = params.id;
  const where = quarantinedDetailWhere(casinoId);
  if (!where) {
    notFound();
  }

  const casino = await prisma.casino.findFirst({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      website_url: true,
      review_status: true,
      publication_status: true,
      quarantine_reason: true,
      governance_version: true,
      verified_at: true,
      created_at: true,
      updated_at: true,
      evidence_claims: {
        select: {
          id: true,
          field: true,
          observed_value: true,
          verdict: true,
          evidence: {
            select: {
              id: true,
              source_url: true,
              observed_at: true,
              extracted_at: true,
              evidence_type: true,
              data_source: {
                select: {
                  source_type: true,
                  url: true,
                },
              },
            },
          },
        },
      },
      workflow_events: {
        orderBy: { occurred_at: "desc" },
        take: 10,
        select: {
          id: true,
          event_type: true,
          occurred_at: true,
          from_review_status: true,
          to_review_status: true,
          from_publication_status: true,
          to_publication_status: true,
          quarantine_reason: true,
          internal_note: true,
          expected_version: true,
          resulting_version: true,
          actor: {
            select: {
              display_name: true,
              stable_key: true,
              kind: true,
            },
          },
        },
      },
    },
  });

  if (!casino) {
    notFound();
  }

  const claimIds = casino.evidence_claims.map((c) => c.id);

  function isSafeUrl(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  const quarantineEvent = casino.workflow_events.find(
    (e) => e.quarantine_reason !== null || e.event_type === "QUARANTINED"
  );

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link href="/quarantine" style={{ color: "#2563eb", textDecoration: "none", fontSize: 14 }}>
          &larr; Back to Quarantine Queue
        </Link>
      </div>

      {/* Header Banner */}
      <div style={{ background: "#fff", border: "1px solid #fed7aa", padding: 24, borderRadius: 8, marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: "#ea580c", color: "#fff", fontWeight: "bold" }}>
                CASINO QUARANTINE
              </span>
              <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a" }}>{casino.name}</h1>
            </div>
            <p style={{ margin: 0, color: "#64748b", fontSize: 14, fontFamily: "monospace" }}>
              ID: {casino.id} | Slug: {casino.slug}
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>Governance Version</div>
            <div style={{ fontSize: 24, fontWeight: "bold", fontFamily: "monospace" }}>v{casino.governance_version}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 24, marginTop: 20, paddingTop: 16, borderTop: "1px solid #f1f5f9", fontSize: 14 }}>
          <div>
            <span style={{ color: "#64748b" }}>Review Status: </span>
            <strong style={{ color: casino.review_status === "QUARANTINED" ? "#c2410c" : "#0f172a" }}>
              {casino.review_status}
            </strong>
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Publication Status: </span>
            <strong>{casino.publication_status}</strong>
          </div>
          <div>
            <span style={{ color: "#64748b" }}>Quarantine Override: </span>
            <strong style={{ color: "#c2410c" }}>{casino.quarantine_reason || "None"}</strong>
          </div>
        </div>
      </div>

      {/* Action Controls */}
      <ClearQuarantineControls
        subjectType={GovernedSubjectType.CASINO}
        subjectId={casino.id}
        quarantineReason={casino.quarantine_reason}
        expectedVersion={casino.governance_version}
        claimIds={claimIds}
      />

      {/* Quarantine Audit Context */}
      <div style={{ background: "#fff", border: "1px solid #fed7aa", padding: 20, borderRadius: 8, marginTop: 24 }}>
        <h3 style={{ margin: "0 0 16px 0", fontSize: 18, color: "#9a3412", borderBottom: "1px solid #ffedd5", paddingBottom: 8 }}>
          Quarantine Audit Context
        </h3>

        {quarantineEvent ? (
          <div style={{ background: "#fff7ed", padding: 16, borderRadius: 6, border: "1px solid #ffedd5", fontSize: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong>Event: {quarantineEvent.event_type}</strong>
              <span style={{ color: "#64748b", fontSize: 12 }}>
                {new Date(quarantineEvent.occurred_at).toISOString().slice(0, 19).replace("T", " ")}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#475569", marginBottom: 6 }}>
              Actor: <strong>{quarantineEvent.actor?.display_name || quarantineEvent.actor?.stable_key}</strong> ({quarantineEvent.actor?.kind})
            </div>
            <div style={{ fontSize: 13, color: "#9a3412", fontWeight: "bold" }}>
              Quarantine Reason: {quarantineEvent.quarantine_reason || casino.quarantine_reason}
            </div>
            {quarantineEvent.internal_note && (
              <div style={{ marginTop: 8, fontSize: 13, fontStyle: "italic", color: "#64748b" }}>
                Note: &quot;{quarantineEvent.internal_note}&quot;
              </div>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
            Quarantine reason is set on entity, but no direct historic quarantine event log was found.
          </p>
        )}
      </div>

      {/* Grid: Stored Values vs Evidence Context */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 24 }}>
        {/* Current Stored Values */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
            Current Stored Values
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 0", color: "#64748b" }}>Brand Name</td>
                <td style={{ padding: "8px 0", fontWeight: "bold" }}>{casino.name}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 0", color: "#64748b" }}>Website URL</td>
                <td style={{ padding: "8px 0" }}>
                  {casino.website_url && isSafeUrl(casino.website_url) ? (
                    <a href={casino.website_url} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                      {casino.website_url}
                    </a>
                  ) : (
                    casino.website_url || "N/A"
                  )}
                </td>
              </tr>
              <tr style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 0", color: "#64748b" }}>Verified Timestamp</td>
                <td style={{ padding: "8px 0" }}>
                  {casino.verified_at ? new Date(casino.verified_at).toISOString() : "Unverified (null)"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Incoming Evidence Context */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: 20, borderRadius: 8 }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: 18, borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
            Incoming Evidence Claims
          </h3>
          {casino.evidence_claims.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>No evidence claims linked to this Casino.</p>
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
                    Claimed Value: <span style={{ color: "#0f172a" }}>&quot;{claim.observed_value}&quot;</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", display: "flex", justifyContent: "space-between" }}>
                    <span>
                      Source:{" "}
                      {isSafeUrl(claim.evidence.source_url) ? (
                        <a href={claim.evidence.source_url} target="_blank" rel="noreferrer" style={{ color: "#2563eb" }}>
                          {claim.evidence.source_url}
                        </a>
                      ) : (
                        <span>{claim.evidence.source_url}</span>
                      )}
                    </span>
                    <span>Observed: {new Date(claim.evidence.observed_at).toISOString().slice(0, 19).replace("T", " ")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
