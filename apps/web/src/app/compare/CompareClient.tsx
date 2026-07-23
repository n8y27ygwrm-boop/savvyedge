"use client";

import { useState } from "react";

interface CasinoBasic {
  id: string;
  slug: string;
  name: string;
}

interface CompareCasinoItem {
  slug: string;
  name: string;
  website_url: string | null;
  verified_at: string | null;
  license: {
    regulator_name: string;
    jurisdiction_name: string;
    country: string | null;
    license_no: string;
    status: string;
  } | null;
  activeBonus: {
    headline_value: string | null;
    wagering_requirement: number | null;
    max_conversion: number | null;
    valid_until: string | null;
    trueValueScore: number | null;
  } | null;
  bonusChangeCount: number;
}

export default function CompareClient({ casinos }: { casinos: CasinoBasic[] }) {
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [comparisonData, setComparisonData] = useState<CompareCasinoItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSlug = (slug: string) => {
    setSelectedSlugs((prev) => {
      if (prev.includes(slug)) {
        return prev.filter((s) => s !== slug);
      } else {
        if (prev.length >= 3) return prev;
        return [...prev, slug];
      }
    });
  };

  const handleCompare = async () => {
    if (selectedSlugs.length < 2 || selectedSlugs.length > 3) return;

    setLoading(true);
    setError(null);
    setComparisonData(null);

    try {
      const res = await fetch(`/api/v1/casinos/compare?slugs=${selectedSlugs.join(",")}`);
      const json = await res.json();

      if (!res.ok || json.error) {
        setError(json.error?.message || "Failed to compare casinos.");
      } else {
        setComparisonData(json.data);
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const isMaxReached = selectedSlugs.length >= 3;
  const canCompare = selectedSlugs.length >= 2 && selectedSlugs.length <= 3;

  return (
    <div className="space-y-8">
      {/* Casino Selection Panel */}
      <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-base font-bold text-white">Select Casinos to Compare</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Choose 2 or 3 operators from the eligible directory ({selectedSlugs.length}/3 selected).
            </p>
          </div>
          <button
            onClick={handleCompare}
            disabled={!canCompare || loading}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${
              canCompare && !loading
                ? "bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-slate-950 shadow-md shadow-[#0ea5e9]/10 cursor-pointer hover:scale-[1.02]"
                : "bg-slate-800 text-slate-500 cursor-not-allowed"
            }`}
          >
            {loading ? "Loading..." : `Compare Selected (${selectedSlugs.length}/3)`}
          </button>
        </div>

        {/* Checkbox Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {casinos.map((casino) => {
            const isChecked = selectedSlugs.includes(casino.slug);
            const isDisabled = !isChecked && isMaxReached;

            return (
              <label
                key={casino.id}
                className={`flex items-center gap-3 p-3 rounded-xl border text-xs transition-all cursor-pointer ${
                  isChecked
                    ? "bg-[#0ea5e9]/10 border-[#0ea5e9]/40 text-white"
                    : isDisabled
                    ? "bg-[#0b0f19]/50 border-slate-800/40 text-slate-600 cursor-not-allowed"
                    : "bg-[#0b0f19] border-slate-800 text-slate-300 hover:border-slate-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={() => toggleSlug(casino.slug)}
                  className="rounded border-slate-700 text-[#0ea5e9] focus:ring-0 bg-[#0b0f19]"
                />
                <span className="font-medium truncate flex-1">{casino.name}</span>
                {isDisabled && <span className="text-[10px] text-slate-600 font-mono">Max 3</span>}
              </label>
            );
          })}
        </div>
      </div>

      {/* Error Box */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-xs text-red-400">
          <p className="font-semibold">Comparison Error</p>
          <p className="mt-1 text-red-300/90">{error}</p>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-8 text-center text-slate-400 text-sm animate-pulse">
          Fetching side-by-side comparison data...
        </div>
      )}

      {/* Comparison Grid */}
      {comparisonData && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {comparisonData.map((item) => {
            const lastCheckedStr = item.verified_at
              ? new Date(item.verified_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "Recently";

            const validUntilStr = item.activeBonus?.valid_until
              ? new Date(item.activeBonus.valid_until).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : "No expiry";

            return (
              <div
                key={item.slug}
                className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-6 flex flex-col justify-between"
              >
                {/* Header Section */}
                <div className="space-y-3 pb-4 border-b border-slate-800/80">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-bold text-white">{item.name}</h3>
                    {item.website_url && (
                      <a
                        href={item.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#0ea5e9] hover:underline font-mono"
                      >
                        Visit Website ↗
                      </a>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">
                    Last checked: <span className="font-mono text-slate-300">{lastCheckedStr}</span>
                  </div>
                </div>

                {/* Main Comparison Specs */}
                <div className="space-y-5 flex-1 text-xs">
                  {/* Licensing Status */}
                  <div className="space-y-1.5">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider block">
                      Licensing &amp; Regulation
                    </span>
                    {item.license ? (
                      <div className="space-y-1">
                        <span className="bg-slate-800 text-slate-300 border border-slate-700/60 font-semibold px-2 py-0.5 rounded-full inline-block">
                          {item.license.regulator_name} ({item.license.jurisdiction_name})
                        </span>
                        <div className="text-slate-400 font-mono text-[11px]">
                          License #{item.license.license_no} • {item.license.status}
                        </div>
                      </div>
                    ) : (
                      <span className="bg-amber-500/10 text-amber-400 border border-amber-500/30 font-semibold px-2.5 py-1 rounded-lg inline-block">
                        License details unavailable
                      </span>
                    )}
                  </div>

                  {/* Active Bonus */}
                  <div className="space-y-2 border-t border-slate-800/60 pt-4">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider block">
                      Active Bonus Offer
                    </span>
                    {item.activeBonus ? (
                      <div className="bg-[#0b0f19] border border-slate-800 rounded-xl p-3 space-y-2">
                        <div className="font-bold text-white text-sm">
                          🎁 {item.activeBonus.headline_value || "Bonus Available"}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-300 font-mono pt-1">
                          <div>
                            <span className="text-slate-500 block text-[10px]">Wagering</span>
                            {item.activeBonus.wagering_requirement
                              ? `${item.activeBonus.wagering_requirement}x wagering`
                              : "N/A"}
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[10px]">Max Payout</span>
                            {item.activeBonus.max_conversion ?? "No cap"}
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-500 block text-[10px]">Validity</span>
                            {validUntilStr}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-400 italic bg-[#0b0f19] border border-slate-800 rounded-xl p-3">
                        No active bonus
                      </div>
                    )}
                  </div>

                  {/* True Value Score */}
                  <div className="space-y-1.5 border-t border-slate-800/60 pt-4">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider block">
                      True Value Score
                    </span>
                    {item.activeBonus?.trueValueScore !== null &&
                    item.activeBonus?.trueValueScore !== undefined ? (
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-extrabold font-mono text-[#0ea5e9]">
                          {item.activeBonus.trueValueScore}
                        </span>
                        <span className="text-slate-400 text-[11px]">/ 100</span>
                      </div>
                    ) : (
                      <div className="text-slate-400 text-[11px] bg-[#0b0f19] border border-slate-800 rounded-xl p-2.5">
                        Not available for this bonus format
                      </div>
                    )}
                  </div>

                  {/* Bonus Stability */}
                  <div className="space-y-1.5 border-t border-slate-800/60 pt-4">
                    <span className="text-slate-400 font-semibold uppercase text-[10px] tracking-wider block">
                      Bonus Term Stability (Last 90 Days)
                    </span>
                    {item.bonusChangeCount === 0 ? (
                      <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-mono text-[11px] inline-block font-semibold">
                        0 term changes in last 90 days (Stable)
                      </span>
                    ) : (
                      <span className="text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg font-mono text-[11px] inline-block font-semibold">
                        {item.bonusChangeCount} term change(s) in last 90 days
                      </span>
                    )}
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
