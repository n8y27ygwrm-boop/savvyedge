"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import BonusCalculator from "./BonusCalculator";

export interface BonusItem {
  id: string;
  type: string;
  headline_value: string | null;
  wagering_requirement: number | null;
  max_conversion: number | null;
  true_value_score: number | null;
  status: string;
  valid_until: Date | string | null;
  verified_at: Date | string | null;
  casino: {
    id: string;
    slug: string;
    name: string;
  };
}

const filterPills = ["All", "Welcome Bonus", "Free Spins", "Reload"] as const;
type FilterPill = (typeof filterPills)[number];

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

function mapPillToType(pill: FilterPill): string | null {
  switch (pill) {
    case "Welcome Bonus":
      return "WELCOME";
    case "Free Spins":
      return "FREE_SPINS";
    case "Reload":
      return "RELOAD";
    default:
      return null;
  }
}

export default function BonusesClient({ bonuses }: { bonuses: BonusItem[] }) {
  const [activePill, setActivePill] = useState<FilterPill>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBonuses = useMemo(() => {
    const requiredType = mapPillToType(activePill);
    const query = searchQuery.trim().toLowerCase();

    return bonuses.filter((b) => {
      // Filter by Pill type
      if (requiredType && b.type !== requiredType) {
        return false;
      }
      // Filter by Casino Name Search
      if (query && !b.casino.name.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [bonuses, activePill, searchQuery]);

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

      {/* Search Input & Filter Pills Container */}
      <div className="space-y-4">
        {/* Real-time Search Input */}
        <div className="relative max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by casino name..."
            className="w-full bg-[#161e2e] text-sm text-[#f3f4f6] placeholder-slate-400 px-4 py-2.5 rounded-xl border border-slate-700/80 focus:outline-none focus:border-[#0ea5e9] focus:ring-1 focus:ring-[#0ea5e9] transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap gap-2">
          {filterPills.map((pill) => {
            const isActive = pill === activePill;
            return (
              <button
                key={pill}
                onClick={() => setActivePill(pill)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  isActive
                    ? "bg-[#0ea5e9] text-slate-950 border-[#0ea5e9]"
                    : "bg-[#161e2e] text-slate-300 border-slate-700/60 hover:border-slate-600 hover:text-white"
                }`}
              >
                {pill}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bonus Cards Grid */}
      {filteredBonuses.length === 0 ? (
        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-xl">
            🎁
          </div>
          <h3 className="text-lg font-bold text-white">No Bonuses Found</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            No bonus records matched your current search and type filters. Try adjusting your search query or pill selection.
          </p>
          {(activePill !== "All" || searchQuery) && (
            <button
              onClick={() => {
                setActivePill("All");
                setSearchQuery("");
              }}
              className="inline-block bg-[#0ea5e9] text-slate-950 font-semibold px-4 py-2 rounded-lg text-xs hover:bg-[#0ea5e9]/90 transition-all"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredBonuses.map((bonus, i) => {
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
                      <Link
                        href={`/casinos/${bonus.casino.slug}`}
                        className="text-base font-bold text-white hover:text-[#0ea5e9] transition-colors"
                      >
                        {bonus.casino.name}
                      </Link>
                      <div>
                        <span className="bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/30 font-semibold text-[9px] px-1.5 py-0.5 rounded-full tracking-wider uppercase">
                          Verified
                        </span>
                      </div>
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

                {/* Bonus Calculator */}
                <BonusCalculator
                  bonusId={bonus.id}
                  headlineValue={bonus.headline_value}
                  wageringRequirement={bonus.wagering_requirement}
                  maxConversion={bonus.max_conversion}
                  validUntil={bonus.valid_until}
                />

                {/* CTA */}
                <Link
                  href={`/casinos/${bonus.casino.slug}`}
                  className="block text-center bg-[#0b0f19] hover:bg-slate-800 border border-slate-700/60 text-[#0ea5e9] font-semibold text-xs py-2.5 rounded-xl transition-all hover:border-[#0ea5e9]/40"
                >
                  View Full Terms →
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
