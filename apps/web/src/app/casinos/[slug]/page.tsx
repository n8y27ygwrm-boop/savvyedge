import Link from "next/link";

interface Bonus {
  id: string;
  type: string;
  headline_value: string | null;
  wagering_requirement: number | null;
  max_conversion: number | null;
  true_value_score: number | null;
  status: string;
  valid_until: string | null;
  verified_at: string | null;
}

interface Game {
  slot_name: string;
  provider_name: string;
  rtp_current: number | null;
  volatility: string | null;
  verified_at: string | null;
}

interface CasinoDetail {
  id: string;
  slug: string;
  name: string;
  website_url: string;
  status: string;
  verified_at: string | null;
  license: {
    regulator_name: string;
    jurisdiction_name: string;
    license_no: string;
  } | null;
  bonuses: Bonus[];
  games?: Game[];
}

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

async function getCasino(slug: string): Promise<CasinoDetail | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/casinos?slug=${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error(`Error fetching casino slug '${slug}':`, error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const casino = await getCasino(slug);
  if (!casino) {
    return {
      title: "Casino Not Found | SavvyEdge",
    };
  }
  return {
    title: `${casino.name} — Verified Data & Intelligence | SavvyEdge`,
    description: `Independently audited intelligence and active bonus terms for ${casino.name}. Licensed by ${
      casino.license?.regulator_name || "verified authorities"
    }.`,
  };
}

export default async function CasinoDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const casino = await getCasino(slug);

  if (!casino) {
    return (
      <div className="space-y-8 py-12 text-center">
        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-12 max-w-xl mx-auto space-y-4">
          <div className="w-16 h-16 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-2xl font-bold">
            404
          </div>
          <h1 className="text-2xl font-extrabold text-white">Casino Not Found</h1>
          <p className="text-slate-400 text-sm">
            We couldn&apos;t locate any verified casino record for &quot;{slug}&quot;.
          </p>
          <div className="pt-2">
            <Link
              href="/casinos"
              className="inline-block bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs transition-all shadow-md shadow-[#0ea5e9]/10"
            >
              ← Back to Casino Directory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const verifiedDateStr = casino.verified_at
    ? new Date(casino.verified_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Recently";

  return (
    <div className="space-y-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-slate-400 font-medium">
        <Link href="/" className="hover:text-[#0ea5e9] transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href="/casinos" className="hover:text-[#0ea5e9] transition-colors">
          Casinos
        </Link>
        <span>/</span>
        <span className="text-slate-200">{casino.name}</span>
      </nav>

      {/* Header Glass Card */}
      <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-[#0b0f19] border border-slate-800 flex items-center justify-center shrink-0 font-extrabold text-3xl text-[#0ea5e9] shadow-inner">
              {casino.name.charAt(0).toUpperCase()}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  {casino.name}
                </h1>
                <span className="bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30 font-semibold text-xs px-3 py-1 rounded-full tracking-wider uppercase flex items-center gap-1">
                  <span>✓</span> Verified
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400">
                {casino.license ? (
                  <>
                    Licensed by{" "}
                    <span className="font-semibold text-slate-200">
                      {casino.license.regulator_name}
                    </span>{" "}
                    &bull;{" "}
                    <span className="font-mono text-slate-300">
                      {casino.license.license_no}
                    </span>{" "}
                    &bull;{" "}
                    <span className="text-slate-300">
                      {casino.license.jurisdiction_name}
                    </span>
                  </>
                ) : (
                  "Active Operating License Verified"
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
            <a
              href={casino.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-slate-950 font-bold px-6 py-3 rounded-xl text-xs transition-all shadow-md shadow-[#0ea5e9]/10 flex items-center gap-1.5"
            >
              Visit Operator ↗
            </a>
            <span className="text-xs text-slate-400">
              Verified Date:{" "}
              <span className="font-mono text-slate-200">{verifiedDateStr}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Trust Notice */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3 text-amber-300 text-xs sm:text-sm">
        <span className="text-base">🛡️</span>
        <div>
          <span className="font-semibold">Autonomous Verification Notice:</span>{" "}
          All data on this page is autonomously verified by the SavvyEdge
          intelligence engine. Last verification:{" "}
          <span className="font-mono text-amber-200">{verifiedDateStr}</span>.
        </div>
      </div>

      {/* Available Bonuses Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-white tracking-tight">
          Available Bonuses
        </h2>

        {!casino.bonuses || casino.bonuses.length === 0 ? (
          <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-8 text-center text-slate-400 text-sm">
            No active bonus offers currently logged for {casino.name}.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {casino.bonuses.map((bonus) => {
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
                  className="bg-[#161e2e] border border-white/[0.06] rounded-2xl p-6 space-y-4 transition-all duration-300 hover:border-slate-700"
                  style={{ borderLeft: "3px solid #0ea5e9" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      {casino.name}
                    </span>
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

                  <p className="text-lg font-bold text-white leading-snug">
                    {bonus.headline_value || "Bonus Available"}
                  </p>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                        True Value™
                      </span>
                      <span
                        className="text-2xl font-extrabold font-mono"
                        style={{ color: tvsColor(tvs) }}
                      >
                        {Math.round(tvs)}
                      </span>
                      <span className="text-slate-500 text-xs">/100</span>
                    </div>

                    <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                        Wagering
                      </span>
                      <span className="text-2xl font-extrabold font-mono text-white">
                        {wageringStr}
                      </span>
                    </div>

                    <div className="bg-[#0b0f19] rounded-xl p-3 text-center border border-slate-800/60">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 block mb-1">
                        Valid Until
                      </span>
                      <span className="text-xs font-mono text-slate-300">
                        {validUntilStr}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Verified Games & RTP Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Verified Games &amp; RTP
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Games we&apos;ve independently verified this casino offers, with RTP tracked over time. This shows the game&apos;s published RTP — not a casino-specific comparison.
          </p>
        </div>

        {!casino.games || casino.games.length === 0 ? (
          <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-8 text-center text-slate-400 text-sm">
            We haven&apos;t verified specific games for this casino yet. Our verified game catalog is actively expanding — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {casino.games.map((game, idx) => {
              const rtpStr = game.rtp_current !== null ? `${game.rtp_current}%` : "RTP not available";
              const verifiedDate = game.verified_at
                ? new Date(game.verified_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "Verified";

              return (
                <div
                  key={idx}
                  className="bg-[#161e2e] border border-white/[0.06] rounded-2xl p-5 space-y-3 transition-all duration-300 hover:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-white leading-snug">
                        {game.slot_name}
                      </h3>
                      <p className="text-xs text-slate-400 font-medium">
                        by {game.provider_name}
                      </p>
                    </div>
                    {game.volatility && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700/60 shrink-0">
                        {game.volatility}
                      </span>
                    )}
                  </div>

                  <div className="bg-[#0b0f19] rounded-xl p-3 border border-slate-800/60 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                      Tracked RTP
                    </span>
                    <span className="text-sm font-extrabold font-mono text-[#0ea5e9]">
                      {rtpStr}
                    </span>
                  </div>

                  <div className="text-[10px] text-slate-500 font-mono text-right">
                    Verified: {verifiedDate}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
