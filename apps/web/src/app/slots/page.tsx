import Link from "next/link";
import { prisma } from "@savvyedge/database";

export const metadata = {
  title: "Live RTP Tracker | SavvyEdge",
  description:
    "Monitor real-time Return to Player percentages for popular online slots. Independently verified RTP data updated every 6 hours.",
};

function rtpColor(rtp: number): string {
  if (rtp > 96) return "#10b981";
  if (rtp >= 94) return "#f59e0b";
  return "#ef4444";
}

function volatilityStyle(vol: string) {
  switch (vol) {
    case "LOW":
      return {
        color: "#10b981",
        borderColor: "#10b98140",
        backgroundColor: "#10b98110",
        label: "Low",
      };
    case "MEDIUM":
      return {
        color: "#f59e0b",
        borderColor: "#f59e0b40",
        backgroundColor: "#f59e0b10",
        label: "Medium",
      };
    case "HIGH":
      return {
        color: "#ef4444",
        borderColor: "#ef444440",
        backgroundColor: "#ef444410",
        label: "High",
      };
    default:
      return {
        color: "#94a3b8",
        borderColor: "#94a3b840",
        backgroundColor: "#94a3b810",
        label: vol,
      };
  }
}

function Sparkline({ values }: { values: number[] }) {
  const min = 95.5;
  const max = 97.0;
  const range = max - min;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "3px",
        height: "32px",
      }}
    >
      {values.map((v, i) => {
        const normalized = Math.max(0, Math.min(1, (v - min) / range));
        const height = Math.max(4, normalized * 28);
        return (
          <div
            key={i}
            style={{
              width: "8px",
              height: `${height}px`,
              borderRadius: "2px",
              backgroundColor: rtpColor(v),
              opacity: i === values.length - 1 ? 1 : 0.5,
              transition: "height 0.3s ease",
            }}
          />
        );
      })}
    </div>
  );
}

function formatMaxWin(maxWin: number | null): string {
  if (!maxWin) return "N/A";
  return maxWin >= 1000
    ? `${maxWin.toLocaleString("en-US")}x`
    : `${maxWin}x`;
}

export default async function SlotsPage() {
  const slots = await prisma.slot.findMany({
    take: 50,
    orderBy: { rtp_current: "desc" },
    include: {
      provider: true,
      rtp_history: {
        orderBy: { recorded_at: "asc" },
      },
    },
  });

  return (
    <div className="space-y-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-slate-400 font-medium">
        <Link href="/" className="hover:text-[#0ea5e9] transition-colors">
          Home
        </Link>
        <span>/</span>
        <span className="text-slate-200">Slots</span>
      </nav>

      {/* Page Header */}
      <div className="border-b border-slate-800/80 pb-6 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#0ea5e9] uppercase tracking-wider">
          <span>RTP Monitoring</span> &bull; <span>Provider Data</span> &bull;{" "}
          <span>Verified</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Live RTP Tracker
        </h1>
        <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
          Real-time Return to Player percentages scraped and verified every 6
          hours against official provider specifications. No guesswork, no
          estimates.
        </p>
      </div>

      {/* Slot Cards Grid */}
      {slots.length === 0 ? (
        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-xl">
            🎰
          </div>
          <h3 className="text-lg font-bold text-white">No Slots Found</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            No slot records are available yet. Check back soon as our system
            continuously monitors RTP data from providers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {slots.map((slot, i) => {
            const rtp = slot.rtp_current ?? 0;
            const vol = volatilityStyle(slot.volatility ?? "MEDIUM");
            const history = slot.rtp_history.map((h) => h.rtp_value);

            return (
              <div
                key={slot.id}
                className="bg-[#161e2e] border border-white/[0.06] rounded-2xl p-6 space-y-4 transition-all duration-300 hover:-translate-y-1 hover:border-slate-700"
                style={{
                  borderLeft: "3px solid #0ea5e9",
                  animation: `fade-up 0.4s ease ${i * 0.08}s both`,
                }}
              >
                {/* Slot name + Provider */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {slot.name}
                    </h3>
                    <span className="text-xs text-slate-400">
                      {slot.provider.name}
                    </span>
                  </div>
                  {/* Volatility Badge */}
                  <span
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border"
                    style={{
                      color: vol.color,
                      borderColor: vol.borderColor,
                      backgroundColor: vol.backgroundColor,
                    }}
                  >
                    {vol.label} Vol
                  </span>
                </div>

                {/* RTP + Sparkline Row */}
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                      Current RTP
                    </span>
                    <span
                      className="text-4xl font-extrabold font-mono"
                      style={{ color: rtpColor(rtp) }}
                    >
                      {rtp.toFixed(2)}
                      <span className="text-lg text-slate-400">%</span>
                    </span>
                  </div>
                  <div className="text-right space-y-1">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block">
                      RTP History
                    </span>
                    {history.length > 0 ? (
                      <Sparkline values={history} />
                    ) : (
                      <span className="text-xs text-slate-500">No data</span>
                    )}
                  </div>
                </div>

                {/* Metrics Strip */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                      Max Win
                    </span>
                    <span className="text-sm font-extrabold font-mono text-white">
                      {formatMaxWin(slot.max_win)}
                    </span>
                  </div>
                  <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                      Volatility
                    </span>
                    <span
                      className="text-sm font-bold"
                      style={{ color: vol.color }}
                    >
                      {vol.label}
                    </span>
                  </div>
                  <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                      Verified
                    </span>
                    <span className="text-xs font-mono text-slate-300">
                      Recently
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
