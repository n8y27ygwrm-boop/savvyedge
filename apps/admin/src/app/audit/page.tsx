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
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { EntityTypeBadge } from "@/components/ui/EntityTypeBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineAlert } from "@/components/ui/InlineAlert";

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

function eventTypeBadgeStyle(eventType: string): {
  bg: string;
  text: string;
  border: string;
} {
  switch (eventType) {
    case "APPROVED":
    case "PUBLISHED":
      return {
        bg: "rgba(16, 185, 129, 0.15)",
        text: "#34d399",
        border: "rgba(16, 185, 129, 0.3)",
      };
    case "REJECTED":
    case "UNPUBLISHED":
    case "WITHDRAWN":
      return {
        bg: "rgba(239, 68, 68, 0.15)",
        text: "#f87171",
        border: "rgba(239, 68, 68, 0.3)",
      };
    case "QUARANTINED":
      return {
        bg: "rgba(245, 158, 11, 0.15)",
        text: "#fbbf24",
        border: "rgba(245, 158, 11, 0.3)",
      };
    case "QUARANTINE_CLEARED":
      return {
        bg: "rgba(59, 130, 246, 0.15)",
        text: "#60a5fa",
        border: "rgba(59, 130, 246, 0.3)",
      };
    case "REVIEW_REQUESTED":
    case "REVIEW_STARTED":
      return {
        bg: "rgba(245, 158, 11, 0.15)",
        text: "#f59e0b",
        border: "rgba(245, 158, 11, 0.3)",
      };
    case "MATERIAL_CHANGE_DETECTED":
      return {
        bg: "rgba(168, 85, 247, 0.15)",
        text: "#c084fc",
        border: "rgba(168, 85, 247, 0.3)",
      };
    default:
      return {
        bg: "rgba(255, 255, 255, 0.05)",
        text: "var(--admin-muted)",
        border: "var(--admin-border)",
      };
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
      <PageHeader
        title="Governance Audit Log"
        subtitle="Read-only immutable history of all automated engine and human governance transitions."
        actions={
          <div style={{ fontSize: 13, color: "var(--admin-muted)" }}>
            Total Recorded Events:{" "}
            <strong
              style={{ color: "var(--admin-text)" }}
              className="tabular-nums"
            >
              {result.totalCount}
            </strong>
          </div>
        }
      />

      {filters.isDateRangeInvalid && (
        <InlineAlert
          type="error"
          title="Invalid Date Range"
          message="Date From cannot be later than Date To. Displaying zero results."
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Search & Filter Bar */}
      <GlassPanel padding="18px 20px" style={{ marginBottom: 20 }}>
        <form method="GET" action="/audit">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--admin-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Entity / UUID Search
              </label>
              <input
                type="text"
                name="search"
                defaultValue={rawParams.search || ""}
                placeholder="UUID, brand name, license..."
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--admin-border-bright)",
                  background: "rgba(0, 0, 0, 0.4)",
                  color: "var(--admin-text)",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--admin-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Transition Event
              </label>
              <select
                name="eventType"
                defaultValue={filters.eventType || ""}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--admin-border-bright)",
                  background: "#12141d",
                  color: "var(--admin-text)",
                  outline: "none",
                }}
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
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--admin-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Subject Entity Type
              </label>
              <select
                name="subjectType"
                defaultValue={filters.subjectType || ""}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--admin-border-bright)",
                  background: "#12141d",
                  color: "var(--admin-text)",
                  outline: "none",
                }}
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
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--admin-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                From Date
              </label>
              <input
                type="date"
                name="dateFrom"
                defaultValue={rawParams.dateFrom || ""}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--admin-border-bright)",
                  background: "#12141d",
                  color: "var(--admin-text)",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--admin-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                To Date
              </label>
              <input
                type="date"
                name="dateTo"
                defaultValue={rawParams.dateTo || ""}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--admin-border-bright)",
                  background: "#12141d",
                  color: "var(--admin-text)",
                  outline: "none",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="submit"
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: "#059669",
                color: "#ffffff",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                cursor: "pointer",
              }}
            >
              Filter Audit Trail
            </button>
            <Link
              href="/audit"
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                background: "rgba(255, 255, 255, 0.08)",
                color: "var(--admin-text)",
                border: "1px solid var(--admin-border)",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Reset Filters
            </Link>
          </div>
        </form>
      </GlassPanel>

      {/* Main Audit Data Table */}
      {result.items.length === 0 ? (
        <EmptyState
          title="No Governance Audit Records"
          description="No workflow transition events match your current search and filter parameters."
          guide="The Audit Log preserves an immutable history of every automated ingestion event, reviewer decision, quarantine override, and publication status change."
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
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                      minWidth: 150,
                    }}
                  >
                    Timestamp
                  </th>
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                      minWidth: 160,
                    }}
                  >
                    Transition Event
                  </th>
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                      minWidth: 90,
                    }}
                  >
                    Subject
                  </th>
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      minWidth: 180,
                    }}
                  >
                    Entity Target Label
                  </th>
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                      minWidth: 140,
                    }}
                  >
                    Operator Actor
                  </th>
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                      minWidth: 190,
                    }}
                  >
                    State Transition
                  </th>
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      whiteSpace: "nowrap",
                      minWidth: 80,
                    }}
                  >
                    Version
                  </th>
                  <th
                    style={{
                      padding: "12px 14px",
                      color: "var(--admin-muted)",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      fontSize: 11,
                      letterSpacing: "0.05em",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      minWidth: 90,
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => {
                  const bStyle = eventTypeBadgeStyle(item.eventType);
                  return (
                    <tr
                      key={item.id}
                      style={{
                        borderBottom: "1px solid var(--admin-border)",
                        transition: "background 0.15s ease",
                      }}
                    >
                      <td
                        style={{
                          padding: "12px 14px",
                          fontFamily: "monospace",
                          fontSize: 12,
                          color: "var(--admin-muted)",
                          whiteSpace: "nowrap",
                        }}
                        className="tabular-nums"
                      >
                        {new Date(item.occurredAt)
                          .toISOString()
                          .slice(0, 19)
                          .replace("T", " ")}
                      </td>

                      <td
                        style={{ padding: "12px 14px", whiteSpace: "nowrap" }}
                      >
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                            background: bStyle.bg,
                            color: bStyle.text,
                            border: `1px solid ${bStyle.border}`,
                            letterSpacing: "0.02em",
                          }}
                        >
                          {item.eventType}
                        </span>
                      </td>

                      <td
                        style={{ padding: "12px 14px", whiteSpace: "nowrap" }}
                      >
                        {item.subjectDetailUrl ? (
                          <Link
                            href={item.subjectDetailUrl}
                            title={`Open ${item.subjectType} ${item.subjectId}`}
                            style={{ textDecoration: "none" }}
                          >
                            <EntityTypeBadge
                              type={item.subjectType}
                              size="sm"
                            />
                          </Link>
                        ) : (
                          <EntityTypeBadge type={item.subjectType} size="sm" />
                        )}
                      </td>

                      <td style={{ padding: "12px 14px" }}>
                        {item.subjectDetailUrl ? (
                          <Link
                            href={item.subjectDetailUrl}
                            title={`Open ${item.subjectType} ${item.subjectId}`}
                            style={{
                              display: "block",
                              fontWeight: 600,
                              color: "var(--admin-text)",
                              fontSize: 13,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 220,
                              textDecoration: "none",
                            }}
                          >
                            {item.entityLabel}
                          </Link>
                        ) : (
                          <div
                            style={{
                              fontWeight: 600,
                              color: "var(--admin-text)",
                              fontSize: 13,
                            }}
                            title={item.entityLabel}
                          >
                            {item.entityLabel}
                          </div>
                        )}
                        {item.entityUnavailable && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--admin-muted-dark)",
                              fontStyle: "italic",
                            }}
                          >
                            Archived entity
                          </span>
                        )}
                      </td>

                      <td
                        style={{ padding: "12px 14px", whiteSpace: "nowrap" }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            color: "var(--admin-text)",
                            fontSize: 12,
                          }}
                        >
                          {item.actorName}
                        </div>
                        <div
                          style={{ fontSize: 10, color: "var(--admin-muted)" }}
                        >
                          ({item.actorKind})
                        </div>
                      </td>

                      <td
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.fromReviewStatus && item.toReviewStatus ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span style={{ color: "var(--admin-muted)" }}>
                              {item.fromReviewStatus}
                            </span>
                            <span style={{ color: "var(--admin-muted-dark)" }}>
                              →
                            </span>
                            <strong style={{ color: "#34d399" }}>
                              {item.toReviewStatus}
                            </strong>
                          </div>
                        ) : item.fromPublicationStatus &&
                          item.toPublicationStatus ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span style={{ color: "var(--admin-muted)" }}>
                              {item.fromPublicationStatus}
                            </span>
                            <span style={{ color: "var(--admin-muted-dark)" }}>
                              →
                            </span>
                            <strong style={{ color: "#60a5fa" }}>
                              {item.toPublicationStatus}
                            </strong>
                          </div>
                        ) : (
                          <span style={{ color: "var(--admin-muted-dark)" }}>
                            —
                          </span>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "12px 14px",
                          fontFamily: "monospace",
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--admin-text)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        v{item.resultingVersion}
                      </td>

                      <td
                        style={{
                          padding: "12px 14px",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <Link
                          href={item.detailUrl}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            color: "#e5e7eb",
                            fontSize: 12,
                            fontWeight: 600,
                            textDecoration: "none",
                          }}
                        >
                          Detail →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              padding: "12px 20px",
              background: "rgba(0, 0, 0, 0.4)",
              borderTop: "1px solid var(--admin-border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <div style={{ color: "var(--admin-muted)" }}>
              Page{" "}
              <strong style={{ color: "var(--admin-text)" }}>
                {result.page}
              </strong>{" "}
              of{" "}
              <strong style={{ color: "var(--admin-text)" }}>
                {result.totalPages || 1}
              </strong>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {result.hasPrevPage ? (
                <Link
                  href={buildUrl(result.page - 1)}
                  style={{
                    padding: "5px 12px",
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "var(--admin-text)",
                    textDecoration: "none",
                    borderRadius: 6,
                    border: "1px solid var(--admin-border)",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  ← Previous
                </Link>
              ) : (
                <span
                  style={{
                    padding: "5px 12px",
                    background: "rgba(255, 255, 255, 0.03)",
                    color: "var(--admin-muted-dark)",
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: "not-allowed",
                  }}
                >
                  ← Previous
                </span>
              )}

              {result.hasNextPage ? (
                <Link
                  href={buildUrl(result.page + 1)}
                  style={{
                    padding: "5px 12px",
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "var(--admin-text)",
                    textDecoration: "none",
                    borderRadius: 6,
                    border: "1px solid var(--admin-border)",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Next →
                </Link>
              ) : (
                <span
                  style={{
                    padding: "5px 12px",
                    background: "rgba(255, 255, 255, 0.03)",
                    color: "var(--admin-muted-dark)",
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: "not-allowed",
                  }}
                >
                  Next →
                </span>
              )}
            </div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
