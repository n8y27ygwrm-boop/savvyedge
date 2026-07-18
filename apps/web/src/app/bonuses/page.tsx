import Link from "next/link";
import { prisma } from "@savvyedge/database";

export const metadata = {
  title: "Verified Bonus Intelligence | SavvyEdge",
  description:
    "Compare online casino bonuses with True Value Scores that account for wagering requirements, caps, and time limits.",
};

const filterPills = ["All", "Welcome Bonus", "Free Spins", "Reload"] as const;

function tvsColor(score: number): string {
  if (score > 60) return "#10b981";
  if (score >= 30) return "#f59e0b";
  return "#ef4444";
}

function typeBadgeColor(type: string): string {
  switch (type) {
    case "WELCOME":
      return "#0ea5e9";
    case "FREE_SPINS":
      return "#a855f7";
    case "RELOAD":
      return "#f59e0b";
    default:
      return "#94a3b8";
  }
}

function formatType(type: string): string {
  switch (type) {
    case "WELCOME":
      return "Welcome Bonus";
    case "FREE_SPINS":
      return "Free Spins";
    case "RELOAD":
      return "Reload";
    default:
      return type;
  }
}

export default async function BonusesPage() {
  const bonuses = await prisma.bonus.findMany({
    take: 50,
    orderBy: { true_value_score: "desc" },
    include: { casino: true },
  });

  return (
    <div className="space-y-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-slate-400 font-medium">
        <Link href="/" className="hover:text-[#0ea5e9] transition-colors">
          Home
        </Link>
        <span>/</span>
        <span className="text-slate-200">Bonuses</span>
      </nav>

      {/* Page Header */}
      <div className="border-b border-slate-800/80 pb-6 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#0ea5e9] uppercase tracking-wider">
          <span>Intelligence</span> &bull; <span>True Value Scoring</span>{" "}
          &bull; <span>Verified</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Verified Bonus Intelligence
        </h1>
        <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
          Every bonus is scraped directly from operator T&amp;Cs, scored with
          our True Value formula, and independently verified. No casino pays for
          placement.
        </p>
      </div>

      {/* Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {filterPills.map((pill) => (
          <span
            key={pill}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
              pill === "All"
                ? "bg-[#0ea5e9] text-slate-950 border-[#0ea5e9]"
                : "bg-[#161e2e] text-slate-300 border-slate-700/60 hover:border-slate-600 hover:text-white"
            }`}
          >
            {pill}
          </span>
        ))}
      </div>

      {/* Bonus Cards Grid */}
      {bonuses.length === 0 ? (
        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-xl">
            🎁
          </div>
          <h3 className="text-lg font-bold text-white">No Bonuses Found</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            No bonus records are available yet. Check back soon as our system
            continuously discovers and verifies new offers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {bonuses.map((bonus, i) => {
            const tvs = bonus.true_value_score ?? 0;
            const wageringStr = bonus.wagering_requirement
              ? `${bonus.wagering_requirement}x`
              : "N/A";
            const validUntilStr = bonus.valid_until
              ? new Date(bonus.valid_until).toISOString().split("T")[0]
              : "Recurring";

            return (
              <div
                key={bonus.id}
                className="bg-[#161e2e] border border-white/[0.06] rounded-2xl p-6 space-y-4 transition-all duration-300 hover:-translate-y-1 hover:border-slate-700"
                style={{
                  borderLeft: "3px solid #0ea5e9",
                  animation: `fade-up 0.4s ease ${i * 0.08}s both`,
                }}
              >
                {/* Casino Name + Badges */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#0b0f19] border border-slate-800 flex items-center justify-center text-[#0ea5e9] font-extrabold text-lg">
                      {bonus.casino.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">
                        {bonus.casino.name}
                      </h3>
                      <span className="bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/30 font-semibold text-[9px] px-1.5 py-0.5 rounded-full tracking-wider uppercase">
                        Verified
                      </span>
                    </div>
                  </div>
                  {/* Type Badge */}
                  <span
                    className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border"
                    style={{
                      color: typeBadgeColor(bonus.type),
                      borderColor: typeBadgeColor(bonus.type) + "40",
                      backgroundColor: typeBadgeColor(bonus.type) + "10",
                    }}
                  >
                    {formatType(bonus.type)}
                  </span>
                </div>

                {/* Headline Value */}
                <p className="text-lg font-bold text-white leading-snug">
                  {bonus.headline_value || "Bonus Available"}
                </p>

                {/* Metrics Row */}
                <div className="grid grid-cols-3 gap-3">
                  {/* TVS */}
                  <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                      True Value
                    </span>
                    <span
                      className="text-2xl font-extrabold font-mono"
                      style={{ color: tvsColor(tvs) }}
                    >
                      {Math.round(tvs)}
                    </span>
                    <span className="text-slate-500 text-xs">/100</span>
                  </div>
                  {/* Wagering */}
                  <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                      Wagering
                    </span>
                    <span className="text-2xl font-extrabold font-mono text-white">
                      {wageringStr}
                    </span>
                  </div>
                  {/* Valid Until */}
                  <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                    <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                      Valid Until
                    </span>
                    <span className="text-xs font-mono text-slate-300">
                      {validUntilStr}
                    </span>
                  </div>
                </div>

                {/* CTA */}
                <a
                  href="#"
                  className="block text-center bg-[#0b0f19] hover:bg-slate-800 border border-slate-700/60 text-[#0ea5e9] font-semibold text-xs py-2.5 rounded-xl transition-all hover:border-[#0ea5e9]/40"
                >
                  View Full Terms →
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
