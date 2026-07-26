import { redirect, notFound } from "next/navigation";
import { verifyAdminSession } from "@/lib/auth";
import { prisma, GovernedSubjectType } from "@savvyedge/database";
import { quarantinedDetailWhere } from "@/lib/quarantine";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityTypeBadge } from "@/components/ui/EntityTypeBadge";
import { ClearQuarantineControls } from "../../components/ClearQuarantineControls";

export interface QuarantineSlotDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function QuarantineSlotDetailPage(props: QuarantineSlotDetailPageProps) {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const params = await props.params;
  const slotId = params.id;
  const where = quarantinedDetailWhere(slotId);
  if (!where) {
    notFound();
  }

  const slot = await prisma.slot.findFirst({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      rtp_current: true,
      volatility: true,
      max_win: true,
      review_status: true,
      publication_status: true,
      quarantine_reason: true,
      governance_version: true,
      provider: {
        select: {
          name: true,
          slug: true,
        },
      },
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

  if (!slot) {
    notFound();
  }

  const claimIds = slot.evidence_claims.map((c) => c.id);

  function isSafeUrl(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  const quarantineEvent = slot.workflow_events.find(
    (e) => e.quarantine_reason !== null || e.event_type === "QUARANTINED"
  );

  return (
    <div>
      <PageHeader
        title={slot.name}
        subtitle={`Provider: ${slot.provider.name} | Slot ID: ${slot.id}`}
        badge={<EntityTypeBadge type="SLOT" />}
        breadcrumbs={[
          { label: "Quarantine Queue", href: "/quarantine" },
          { label: slot.name },
        ]}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusBadge status={slot.review_status} />
            <StatusBadge status={slot.publication_status} />
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
              v{slot.governance_version}
            </span>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Quarantine Context */}
          <GlassPanel padding="20px" style={{ background: "rgba(239, 68, 68, 0.05)", border: "1px solid var(--admin-danger-border)" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "#f87171", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
              Quarantine Context &amp; Discrepancy Record
            </h3>

            {quarantineEvent ? (
              <div style={{ padding: 14, borderRadius: 6, background: "rgba(0, 0, 0, 0.4)", border: "1px solid var(--admin-border)", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <strong style={{ color: "#f87171", fontFamily: "monospace" }}>Event: {quarantineEvent.event_type}</strong>
                  <span className="tabular-nums" style={{ color: "var(--admin-muted)", fontSize: 12 }}>
                    {new Date(quarantineEvent.occurred_at).toISOString().slice(0, 19).replace("T", " ")}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--admin-muted)", marginBottom: 8 }}>
                  Triggered By: <strong style={{ color: "var(--admin-text)" }}>{quarantineEvent.actor?.display_name || quarantineEvent.actor?.stable_key}</strong> ({quarantineEvent.actor?.kind})
                </div>
                <div style={{ fontSize: 13, color: "#fbbf24", fontWeight: 700 }}>
                  Quarantine Reason: &quot;{quarantineEvent.quarantine_reason || slot.quarantine_reason}&quot;
                </div>
                {quarantineEvent.internal_note && (
                  <div style={{ marginTop: 8, fontSize: 12, fontStyle: "italic", color: "var(--admin-muted)" }}>
                    Operator Note: &quot;{quarantineEvent.internal_note}&quot;
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>
                Quarantine reason set directly on entity record: <strong style={{ color: "#fbbf24" }}>{slot.quarantine_reason}</strong>.
              </div>
            )}
          </GlassPanel>

          {/* Current Stored Database Values */}
          <GlassPanel padding="20px">
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
              Current Stored Database Values
            </h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Slot Name
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text)" }}>{slot.name}</div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  RTP Current
                </div>
                <div style={{ fontSize: 13, color: "var(--admin-text)" }}>
                  {slot.rtp_current != null ? `${slot.rtp_current}%` : "—"}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                  Volatility
                </div>
                <div style={{ fontSize: 13, color: "var(--admin-text)" }}>{slot.volatility || "—"}</div>
              </div>
            </div>
          </GlassPanel>

          {/* Linked Evidence Claims */}
          <GlassPanel padding="20px">
            <h3 style={{ margin: "0 0 16px 0", fontSize: 16, fontWeight: 700, color: "var(--admin-text)", borderBottom: "1px solid var(--admin-border)", paddingBottom: 12 }}>
              Linked Evidence Claims ({slot.evidence_claims.length})
            </h3>

            {slot.evidence_claims.length === 0 ? (
              <div style={{ color: "var(--admin-muted)", fontSize: 13 }}>No evidence claims linked to this Slot.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {slot.evidence_claims.map((claim) => (
                  <div key={claim.id} style={{ padding: 14, borderRadius: 6, background: "rgba(0, 0, 0, 0.3)", border: "1px solid var(--admin-border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#fb7185", textTransform: "uppercase" }}>{claim.field}</span>
                      <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "rgba(16, 185, 129, 0.15)", color: "#34d399", border: "1px solid rgba(16, 185, 129, 0.3)", fontWeight: 700 }}>
                        {claim.verdict}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--admin-text)", marginBottom: 6 }}>
                      Claimed Value: <span style={{ color: "#ffffff", fontWeight: 700 }}>&quot;{claim.observed_value}&quot;</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--admin-muted)", display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>
                        Source:{" "}
                        {isSafeUrl(claim.evidence.source_url) ? (
                          <a href={claim.evidence.source_url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                            {claim.evidence.source_url}
                          </a>
                        ) : (
                          <span>{claim.evidence.source_url}</span>
                        )}
                      </span>
                      <span className="tabular-nums">Observed: {new Date(claim.evidence.observed_at).toISOString().slice(0, 19).replace("T", " ")}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassPanel>
        </div>

        {/* Right Column: Sticky Clearance Controls */}
        <div style={{ position: "sticky", top: 76 }}>
          <ClearQuarantineControls
            subjectType={GovernedSubjectType.SLOT}
            subjectId={slot.id}
            quarantineReason={slot.quarantine_reason}
            expectedVersion={slot.governance_version}
            claimIds={claimIds}
          />
        </div>
      </div>
    </div>
  );
}
