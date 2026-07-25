import { redirect } from "next/navigation";
import Link from "next/link";
import { verifyAdminSession } from "@/lib/auth";
import {
  getAuditQueue,
  parseAuditPagination,
  parseAuditQueueFilters,
  AUDIT_SUBJECT_TYPES,
} from "@/lib/audit";
import { WorkflowEventType } from "@savvyedge/database";

export interface AuditLogPageProps {
  searchParams: Promise<{
    eventType?: string;
    subjectType?: string;
    actorId?: string;
    subjectId?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: string;
    limit?: string;
  }>;
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

export default async function AuditLogPage(props: AuditLogPageProps) {
  const { authenticated } = await verifyAdminSession();
  if (!authenticated) {
    redirect("/login");
  }

  const rawParams = await props.searchParams;
  const filters = parseAuditQueueFilters(rawParams);
  const pagination = parseAuditPagination(rawParams);

  const result = await getAuditQueue(filters, pagination);

  function buildUrl(overridePage: number) {
    const params = new URLSearchParams();
    if (rawParams.eventType) params.set("eventType", rawParams.eventType);
    if (rawParams.subjectType) params.set("subjectType", rawParams.subjectType);
    if (rawParams.actorId) params.set("actorId", rawParams.actorId);
    if (rawParams.subjectId) params.set("subjectId", rawParams.subjectId);
    if (rawParams.search) params.set("search", rawParams.search);
    if (rawParams.dateFrom) params.set("dateFrom", rawParams.dateFrom);
    if (rawParams.dateTo) params.set("dateTo", rawParams.dateTo);
    if (rawParams.limit) params.set("limit", rawParams.limit);
    params.set("page", String(overridePage));
    return `/audit?${params.toString()}`;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a" }}>Governance Audit Log</h1>
          <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: 14 }}>
            Read-only immutable history of all system and human governance transitions.
          </p>
        </div>
        <div style={{ fontSize: 14, color: "#475569", background: "#fff", padding: "8px 16px", borderRadius: 6, border: "1px solid #e2e8f0" }}>
          Total Events: <strong>{result.totalCount}</strong>
        </div>
      </div>

      {filters.isDateRangeInvalid && (
        <div style={{ padding: 12, marginBottom: 16, background: "#fee2e2", color: "#991b1b", borderRadius: 6, fontSize: 14 }}>
          <strong>Invalid Date Range:</strong> Date From cannot be later than Date To. Showing zero results.
        </div>
      )}

      {/* Filter Form */}
      <form method="GET" action="/audit" style={{ background: "#fff", padding: 20, borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 24 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", color: "#475569", marginBottom: 4 }}>
              Search Identifier / Name
            </label>
            <input
              type="text"
              name="search"
              defaultValue={rawParams.search || ""}
              placeholder="UUID, brand name, license no..."
              style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", color: "#475569", marginBottom: 4 }}>
              Event Type
            </label>
            <select
              name="eventType"
              defaultValue={filters.eventType || ""}
              style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 4, boxSizing: "border-box" }}
            >
              <option value="">All Event Types</option>
              {Object.values(WorkflowEventType).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", color: "#475569", marginBottom: 4 }}>
              Subject Type
            </label>
            <select
              name="subjectType"
              defaultValue={filters.subjectType || ""}
              style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 4, boxSizing: "border-box" }}
            >
              <option value="">All Subject Types</option>
              {AUDIT_SUBJECT_TYPES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", color: "#475569", marginBottom: 4 }}>
              Date From
            </label>
            <input
              type="date"
              name="dateFrom"
              defaultValue={rawParams.dateFrom || ""}
              style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: "bold", color: "#475569", marginBottom: 4 }}>
              Date To
            </label>
            <input
              type="date"
              name="dateTo"
              defaultValue={rawParams.dateTo || ""}
              style={{ width: "100%", padding: 8, fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <button
            type="submit"
            style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, fontWeight: "bold", cursor: "pointer", fontSize: 13 }}
          >
            Apply Filters
          </button>
          <Link
            href="/audit"
            style={{ padding: "8px 16px", background: "#94a3b8", color: "#fff", textDecoration: "none", borderRadius: 4, fontSize: 13, display: "inline-block" }}
          >
            Reset Filters
          </Link>
        </div>
      </form>

      {/* Audit Log Table */}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
          <thead>
            <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
              <th style={{ padding: 12 }}>Timestamp</th>
              <th style={{ padding: 12 }}>Event Type</th>
              <th style={{ padding: 12 }}>Subject</th>
              <th style={{ padding: 12 }}>Entity Label</th>
              <th style={{ padding: 12 }}>Actor</th>
              <th style={{ padding: 12 }}>Review Transition</th>
              <th style={{ padding: 12 }}>Publication Transition</th>
              <th style={{ padding: 12 }}>Version</th>
              <th style={{ padding: 12 }}>Note</th>
              <th style={{ padding: 12, textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                  No workflow audit events found matching the criteria.
                </td>
              </tr>
            ) : (
              result.items.map((item) => {
                const badge = eventTypeBadgeColor(item.eventType);
                return (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: 12, whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 12 }}>
                      {new Date(item.occurredAt).toISOString().slice(0, 19).replace("T", " ")}
                    </td>
                    <td style={{ padding: 12 }}>
                      <span style={{ padding: "2px 6px", borderRadius: 4, background: badge.bg, color: badge.text, fontWeight: "bold", fontSize: 11 }}>
                        {item.eventType}
                      </span>
                    </td>
                    <td style={{ padding: 12 }}>
                      <span style={{ padding: "2px 6px", borderRadius: 4, background: "#f1f5f9", color: "#334155", fontWeight: "bold", fontSize: 11 }}>
                        {item.subjectType}
                      </span>
                    </td>
                    <td style={{ padding: 12 }}>
                      <div style={{ fontWeight: "bold", color: "#0f172a" }}>{item.entityLabel}</div>
                      {item.entityUnavailable && (
                        <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>Deleted / Unavailable</span>
                      )}
                    </td>
                    <td style={{ padding: 12 }}>
                      <div style={{ color: "#334155" }}>{item.actorName}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>({item.actorKind})</div>
                    </td>
                    <td style={{ padding: 12, fontSize: 12, color: "#334155" }}>
                      {item.fromReviewStatus && item.toReviewStatus ? (
                        <span>
                          {item.fromReviewStatus} &rarr; <strong>{item.toReviewStatus}</strong>
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>&mdash;</span>
                      )}
                    </td>
                    <td style={{ padding: 12, fontSize: 12, color: "#334155" }}>
                      {item.fromPublicationStatus && item.toPublicationStatus ? (
                        <span>
                          {item.fromPublicationStatus} &rarr; <strong>{item.toPublicationStatus}</strong>
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>&mdash;</span>
                      )}
                    </td>
                    <td style={{ padding: 12, fontFamily: "monospace", fontWeight: "bold" }}>
                      v{item.resultingVersion}
                    </td>
                    <td style={{ padding: 12, textAlign: "center" }}>
                      {item.hasInternalNote ? (
                        <span style={{ padding: "2px 6px", borderRadius: 4, background: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: "bold" }} title="Internal note present">
                          Note
                        </span>
                      ) : (
                        <span style={{ color: "#cbd5e1" }}>&mdash;</span>
                      )}
                    </td>
                    <td style={{ padding: 12, textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link href={item.detailUrl} style={{ color: "#2563eb", textDecoration: "none", fontWeight: "bold" }}>
                        View Detail &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* Pagination Bar */}
        <div style={{ padding: 16, background: "#f8fafc", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14 }}>
          <div>
            Page <strong>{result.page}</strong> of <strong>{result.totalPages || 1}</strong> (Showing {result.items.length} items)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {result.hasPrevPage ? (
              <Link
                href={buildUrl(result.page - 1)}
                style={{ padding: "6px 12px", background: "#e2e8f0", color: "#1e293b", textDecoration: "none", borderRadius: 4, fontWeight: "bold", fontSize: 13 }}
              >
                &larr; Previous
              </Link>
            ) : (
              <span style={{ padding: "6px 12px", background: "#f1f5f9", color: "#94a3b8", borderRadius: 4, fontSize: 13, cursor: "not-allowed" }}>
                &larr; Previous
              </span>
            )}

            {result.hasNextPage ? (
              <Link
                href={buildUrl(result.page + 1)}
                style={{ padding: "6px 12px", background: "#e2e8f0", color: "#1e293b", textDecoration: "none", borderRadius: 4, fontWeight: "bold", fontSize: 13 }}
              >
                Next &rarr;
              </Link>
            ) : (
              <span style={{ padding: "6px 12px", background: "#f1f5f9", color: "#94a3b8", borderRadius: 4, fontSize: 13, cursor: "not-allowed" }}>
                Next &rarr;
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
