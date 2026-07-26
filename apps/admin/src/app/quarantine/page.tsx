import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import {
  getQuarantineQueue,
  parseQuarantineQueueFilters,
} from "@/lib/quarantine";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EntityTypeBadge } from "@/components/ui/EntityTypeBadge";
import { EmptyState } from "@/components/ui/EmptyState";

export interface QuarantineQueuePageProps {
  searchParams: Promise<{
    type?: string;
    reason?: string;
    status?: string;
    publication?: string;
  }>;
}

export default async function QuarantineQueuePage(
  props: QuarantineQueuePageProps,
) {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const searchParams = await props.searchParams;
  const filters = parseQuarantineQueueFilters(searchParams);
  const items = await getQuarantineQueue(filters);
  const typeFilter = filters.entityType ?? "ALL";
  const reasonFilter = filters.quarantineReason ?? "ALL";

  return (
    <div>
      <PageHeader
        title="Quarantine Governance Queue"
        subtitle="High-risk entity workstation for evaluating evidence discrepancies and clearing quarantine overrides."
      />

      {/* Summary KPI Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="Quarantined Entities"
          value={items.length}
          subtext="Active risk overrides"
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ fontWeight: 600, color: "var(--admin-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Filter by Entity:
            </span>
            <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.4)", padding: 2, borderRadius: 6, border: "1px solid var(--admin-border)" }}>
              {(["ALL", "CASINO", "BONUS", "SLOT", "LICENSE"] as const).map((t) => (
                <Link
                  key={t}
                  href={`/quarantine?type=${t}&reason=${reasonFilter}`}
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
                  {t === "ALL" ? "All Types" : t.charAt(0) + t.slice(1).toLowerCase()}
                </Link>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--admin-muted)" }}>
            Showing <strong style={{ color: "var(--admin-text)" }}>{items.length}</strong> quarantined items
          </div>
        </div>
      </GlassPanel>

      {/* Main Quarantine Data Table */}
      {items.length === 0 ? (
        <EmptyState
          title="No Quarantined Entities"
          description="All governed entities are operating under standard review lifecycle status without active quarantine overrides."
        />
      ) : (
        <GlassPanel padding={0} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(239, 68, 68, 0.08)", borderBottom: "1px solid var(--admin-danger-border)" }}>
                  <th style={{ padding: "12px 16px", color: "#f87171", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Entity Name / Headline
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Type
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Quarantine Reason
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Review / Publication
                  </th>
                  <th style={{ padding: "12px 16px", color: "var(--admin-muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.05em" }}>
                    Quarantine Date & Actor
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
                    style={{ borderBottom: "1px solid var(--admin-border)", transition: "background 0.15s ease" }}
                  >
                    <td style={{ padding: "14px 16px" }}>
                      <Link
                        href={item.detailUrl}
                        style={{ fontWeight: 600, color: "var(--admin-text)", textDecoration: "none", fontSize: 14 }}
                        className="hover:underline"
                      >
                        {item.nameOrHeadline}
                      </Link>
                    </td>

                    <td style={{ padding: "14px 16px" }}>
                      <EntityTypeBadge type={item.entityType} size="sm" />
                    </td>

                    <td style={{ padding: "14px 16px" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          background: "rgba(245, 158, 11, 0.15)",
                          color: "#fbbf24",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                        }}
                      >
                        {item.quarantineReason}
                      </span>
                    </td>

                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <StatusBadge status={item.reviewStatus} size="sm" />
                        {item.publicationStatus && <StatusBadge status={item.publicationStatus} size="sm" />}
                      </div>
                    </td>

                    <td style={{ padding: "14px 16px", fontSize: 12, color: "var(--admin-muted)" }}>
                      <div className="tabular-nums">
                        {item.quarantineTimestamp ? item.quarantineTimestamp.toISOString().slice(0, 19).replace("T", " ") : "No event timestamp"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--admin-muted-dark)" }}>Actor: {item.actorName}</div>
                    </td>

                    <td style={{ padding: "14px 16px", textAlign: "right" }}>
                      <Link
                        href={item.detailUrl}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          background: "rgba(239, 68, 68, 0.15)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          padding: "5px 12px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
                      >
                        Inspect & Clear...
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
