import Link from "next/link";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";

export const metadata = {
  title: "Verified Casino Directory | SavvyEdge",
  description:
    "Browse verified online casinos with audited licenses, active bonuses, and real-time data transparency.",
};

export default async function CasinosPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const page = parseInt(params.page || "1", 10);
  const limit = parseInt(params.limit || "50", 10);
  const skip = (page - 1) * limit;

  const publicWhere = PublicationGateService.whereCasinoPublic();

  const allPublicCasinos = await prisma.casino.findMany({
    where: publicWhere,
    orderBy: { name: "asc" },
    include: {
      history_events: true,
      bonuses: {
        where: PublicationGateService.whereBonusPublic(),
        include: {
          history_events: true,
        },
      },
      licenses: {
        include: {
          regulator: {
            include: {
              jurisdiction: true,
            },
          },
        },
      },
    },
  });

  const eligibleCasinos = allPublicCasinos.filter((c) =>
    PublicationGateService.isCasinoPubliclyEligible(c)
  );

  const total = eligibleCasinos.length;
  const casinos = eligibleCasinos.slice(skip, skip + limit);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="space-y-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-slate-400 font-medium">
        <Link href="/" className="hover:text-[#0ea5e9] transition-colors">
          Home
        </Link>
        <span>/</span>
        <span className="text-slate-200">Casinos</span>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Casino Directory
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Independent, verifiable dataset of licensed online casino operators.
          </p>
        </div>
        <div className="bg-[#161e2e] border border-slate-800 px-4 py-2 rounded-xl text-xs font-mono text-[#0ea5e9] shrink-0 self-start sm:self-auto">
          Showing{" "}
          <span className="font-bold text-white">{total}</span> verified
          operators
        </div>
      </div>

      {/* Main Grid: Sidebar + Listing */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Filter Panel Skeleton */}
        <aside className="lg:col-span-1 space-y-6">
          <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-5 space-y-6 sticky top-24">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
              <h2 className="font-bold text-sm text-white uppercase tracking-wider">
                Filter Directory
              </h2>
              <span className="text-xs text-[#0ea5e9] font-mono cursor-pointer hover:underline">
                Reset
              </span>
            </div>

            {/* Filter Group: License Status */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-300 block">
                License Status
              </label>
              <div className="space-y-2 text-xs text-slate-400">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="rounded border-slate-700 text-[#0ea5e9] focus:ring-0 bg-[#0b0f19]"
                  />
                  <span>Active Licensing (UKGC/MGA)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer opacity-60">
                  <input
                    type="checkbox"
                    className="rounded border-slate-700 text-[#0ea5e9] focus:ring-0 bg-[#0b0f19]"
                  />
                  <span>Curacao eGaming</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer opacity-60">
                  <input
                    type="checkbox"
                    className="rounded border-slate-700 text-[#0ea5e9] focus:ring-0 bg-[#0b0f19]"
                  />
                  <span>Pending Verification</span>
                </label>
              </div>
            </div>

            {/* Filter Group: Active Bonuses */}
            <div className="space-y-3 pt-2 border-t border-slate-800/60">
              <label className="text-xs font-semibold text-slate-300 block">
                Features &amp; Perks
              </label>
              <div className="space-y-2 text-xs text-slate-400">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="rounded border-slate-700 text-[#0ea5e9] focus:ring-0 bg-[#0b0f19]"
                  />
                  <span>Active Welcome Match</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-700 text-[#0ea5e9] focus:ring-0 bg-[#0b0f19]"
                  />
                  <span>No Deposit Free Spins</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-slate-700 text-[#0ea5e9] focus:ring-0 bg-[#0b0f19]"
                  />
                  <span>Instant Payout Support</span>
                </label>
              </div>
            </div>

            {/* Filter Group: Jurisdiction */}
            <div className="space-y-3 pt-2 border-t border-slate-800/60">
              <label className="text-xs font-semibold text-slate-300 block">
                Region
              </label>
              <select className="w-full bg-[#0b0f19] border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-[#0ea5e9]">
                <option>All Jurisdictions</option>
                <option>United States (NJ / PA / MI)</option>
                <option>United Kingdom</option>
                <option>Europe &amp; International</option>
              </select>
            </div>
          </div>
        </aside>

        {/* Casino Listing Cards */}
        <div className="lg:col-span-3 space-y-4">
          {casinos.length === 0 ? (
            <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center mx-auto text-xl">
                🔍
              </div>
              <h3 className="text-lg font-bold text-white">
                No Verified Casinos Found
              </h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                No casino records matched your current page query. Try resetting
                your search filters or navigating back to page 1.
              </p>
              <Link
                href="/casinos?page=1"
                className="inline-block bg-[#0ea5e9] text-slate-950 font-semibold px-4 py-2 rounded-lg text-xs hover:bg-[#0ea5e9]/90 transition-all"
              >
                Reset to Page 1
              </Link>
            </div>
          ) : (
            casinos.map((casino) => {
              const activeBonus = casino.bonuses?.[0];
              const license = casino.licenses?.[0];
              const licenseLabel = license
                ? `${license.regulator.name}`
                : casino.license_info || "License Pending";
              const lastVerifiedStr = casino.verified_at
                ? new Date(casino.verified_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "Verification Pending";

              return (
                <div
                  key={casino.id}
                  className="bg-[#161e2e] border border-slate-800/80 hover:border-slate-700 rounded-2xl p-5 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-6 group"
                >
                  {/* Left Column: Logo & Main Details */}
                  <div className="flex items-center gap-5">
                    {/* Aspect-Ratio Locked Logo Container */}
                    <div className="w-16 h-16 rounded-xl bg-[#0b0f19] border border-slate-800 flex items-center justify-center shrink-0 overflow-hidden shadow-inner font-extrabold text-2xl text-[#0ea5e9] group-hover:border-[#0ea5e9]/40 transition-colors">
                      {casino.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg font-bold text-white group-hover:text-[#0ea5e9] transition-colors">
                          {casino.name}
                        </h3>
                        <span className="bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/30 font-semibold text-[10px] px-2 py-0.5 rounded-full tracking-wider uppercase">
                          {licenseLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span>
                          Last Verified:{" "}
                          <span className="font-mono text-slate-300">
                            {lastVerifiedStr}
                          </span>
                        </span>
                      </div>

                      {activeBonus && (
                        <div className="text-xs text-slate-300 font-medium pt-1">
                          🎁{" "}
                          {activeBonus.headline_value ||
                            "Welcome Bonus Available"}
                          {activeBonus.wagering_requirement && (
                            <span className="text-slate-400 font-mono ml-2">
                              ({activeBonus.wagering_requirement}x wagering)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Column: CTA & Affiliate Disclosure */}
                  <div className="flex flex-col items-stretch md:items-end gap-2 w-full md:w-auto shrink-0 border-t md:border-t-0 border-slate-800/80 pt-4 md:pt-0">
                    <Link
                      href={`/casinos/${casino.slug}`}
                      className="bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs text-center shadow-md shadow-[#0ea5e9]/10 transition-all hover:scale-[1.02]"
                    >
                      See Verified Data
                    </Link>
                    <span className="text-[10px] text-slate-500 italic text-center md:text-right">
                      *We may earn a commission
                    </span>
                  </div>
                </div>
              );
            })
          )}

          {/* Numbered Pagination Anchors */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-6">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                const isActive = p === page;
                return (
                  <Link
                    key={p}
                    href={`/casinos?page=${p}`}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-mono font-bold transition-all ${
                      isActive
                        ? "bg-[#0ea5e9] text-slate-950 shadow-md shadow-[#0ea5e9]/20"
                        : "bg-[#161e2e] text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-800"
                    }`}
                  >
                    {p}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
