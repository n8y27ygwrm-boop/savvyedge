import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import {
  getQuarantineQueue,
  parseQuarantineQueueFilters,
} from "@/lib/quarantine";

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: "0 0 4px 0", color: "#c2410c" }}>Quarantine Governance Queue</h1>
          <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
            Inspect quarantined entities, evaluate evidence risk, and clear quarantine overrides through strict governance policy.
          </p>
        </div>

        <div style={{ display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <strong>Entity:</strong>{" "}
            <Link href={`/quarantine?type=ALL&reason=${reasonFilter}`} style={{ fontWeight: typeFilter === "ALL" ? "bold" : "normal" }}>All</Link> |{" "}
            <Link href={`/quarantine?type=CASINO&reason=${reasonFilter}`} style={{ fontWeight: typeFilter === "CASINO" ? "bold" : "normal" }}>Casino</Link> |{" "}
            <Link href={`/quarantine?type=BONUS&reason=${reasonFilter}`} style={{ fontWeight: typeFilter === "BONUS" ? "bold" : "normal" }}>Bonus</Link> |{" "}
            <Link href={`/quarantine?type=SLOT&reason=${reasonFilter}`} style={{ fontWeight: typeFilter === "SLOT" ? "bold" : "normal" }}>Slot</Link> |{" "}
            <Link href={`/quarantine?type=LICENSE&reason=${reasonFilter}`} style={{ fontWeight: typeFilter === "LICENSE" ? "bold" : "normal" }}>License</Link>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ background: "#fff", padding: 40, textAlign: "center", border: "1px solid #e2e8f0", borderRadius: 8, color: "#64748b" }}>
          <h3 style={{ margin: "0 0 8px 0", color: "#166534" }}>No Quarantined Entities Found</h3>
          <p style={{ margin: 0 }}>All governed entities are operating under standard review lifecycle status.</p>
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#fff7ed", borderBottom: "1px solid #fed7aa", color: "#9a3412" }}>
                <th style={{ padding: "12px 16px" }}>Entity</th>
                <th style={{ padding: "12px 16px" }}>Type</th>
                <th style={{ padding: "12px 16px" }}>Quarantine Reason</th>
                <th style={{ padding: "12px 16px" }}>Review / Pub Status</th>
                <th style={{ padding: "12px 16px" }}>Version</th>
                <th style={{ padding: "12px 16px" }}>Quarantine Date & Actor</th>
                <th style={{ padding: "12px 16px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.entityType}-${item.id}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px 16px", fontWeight: "bold" }}>
                    <Link href={item.detailUrl} style={{ color: "#2563eb", textDecoration: "none" }}>
                      {item.nameOrHeadline}
                    </Link>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#f1f5f9", fontWeight: "bold" }}>
                      {item.entityType}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 4, background: "#fef3c7", color: "#92400e", fontWeight: "bold" }}>
                      {item.quarantineReason}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13 }}>
                    <div>Review: <strong>{item.reviewStatus}</strong></div>
                    <div style={{ color: "#64748b" }}>Pub: <strong>{item.publicationStatus ?? "Not applicable"}</strong></div>
                  </td>
                  <td style={{ padding: "12px 16px", fontFamily: "monospace" }}>
                    v{item.governanceVersion}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748b" }}>
                    <div>{item.quarantineTimestamp ? item.quarantineTimestamp.toISOString().slice(0, 19).replace("T", " ") : "No quarantine audit event"}</div>
                    <div style={{ color: "#94a3b8" }}>By: {item.actorName}</div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <Link href={item.detailUrl} style={{ padding: "6px 12px", background: "#ea580c", color: "#fff", borderRadius: 4, textDecoration: "none", fontSize: 13, fontWeight: "bold" }}>
                      Inspect & Clear...
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
