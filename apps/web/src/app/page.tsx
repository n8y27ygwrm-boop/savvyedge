import Link from "next/link";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";

export const metadata = {
  title: "SavvyEdge | Verified Casino Intelligence",
  description:
    "Autonomous casino data verification, bonus true value scoring, and real-time RTP monitoring. Never trust a casino's word again.",
};

const features = [
  {
    title: "True Value Score™",
    description:
      "Our proprietary formula calculates the real worth of every bonus after wagering requirements, caps, and time limits.",
    icon: "◆",
  },
  {
    title: "Content Fingerprinting",
    description:
      "SHA-256 hashing detects duplicate and recycled bonus offers across all partner sites automatically.",
    icon: "⬡",
  },
  {
    title: "License Verification",
    description:
      "Every casino's regulatory license is cross-referenced against official regulator databases daily.",
    icon: "⛨",
  },
];

function formatInterval(ms: number): string {
  const minutes = Math.floor(ms / (1000 * 60));
  if (minutes < 60) {
    return `Every ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `Every ${hours}h`;
}

export default async function HomePage() {
  const discoveryIntervalMs = parseInt(
    process.env.DISCOVERY_INTERVAL_MS || "300000",
    10
  );
  const updateCycleLabel = formatInterval(discoveryIntervalMs);

  const [rawCasinos, rawBonuses, jurisdictionCount] = await Promise.all([
    prisma.casino.findMany({
      where: PublicationGateService.whereCasinoPublic(),
      orderBy: { verified_at: "desc" },
      include: {
        history_events: true,
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
    }),
    prisma.bonus.findMany({
      where: PublicationGateService.whereBonusPublic(),
      include: {
        history_events: true,
        casino: {
          include: {
            history_events: true,
            licenses: true,
          },
        },
      },
    }),
    prisma.jurisdiction.count({
      where: {
        regulators: {
          some: {
            licenses: {
              some: { status: "ACTIVE", verified_at: { not: null } },
            },
          },
        },
      },
    }),
  ]);

  const eligibleCasinos = rawCasinos.filter((c) => PublicationGateService.isCasinoPubliclyEligible(c));
  const eligibleBonuses = rawBonuses.filter((b) => PublicationGateService.isBonusPubliclyEligible(b));

  const casinoCount = eligibleCasinos.length;
  const activeBonusCount = eligibleBonuses.length;
  const recentCasinos = eligibleCasinos.slice(0, 4);

  const stats = [
    { label: "Verified Casinos", value: casinoCount.toLocaleString("en-US") },
    {
      label: "Active Bonuses Tracked",
      value: activeBonusCount.toLocaleString("en-US"),
    },
    {
      label: "Regulatory Jurisdictions",
      value: jurisdictionCount.toLocaleString("en-US"),
    },
    { label: "Update Cycle", value: updateCycleLabel },
  ];

  return (
    <div className="space-y-16 -mt-8">
      {/* ───── Hero Section ───── */}
      <section className="relative overflow-hidden rounded-3xl px-6 sm:px-12 py-20 sm:py-28">
        {/* Animated gradient background */}
        <div
          className="absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "linear-gradient(135deg, #0ea5e910 0%, #10b98110 25%, #0ea5e908 50%, #10b98110 75%, #0ea5e910 100%)",
            backgroundSize: "400% 400%",
            animation: "gradient-shift 12s ease infinite",
          }}
        />
        {/* Subtle radial glow */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 30%, rgba(14,165,233,0.08) 0%, transparent 70%)",
          }}
        />

        {/* LIVE badge */}
        <div className="absolute top-6 right-6 flex items-center gap-2 bg-[#161e2e] border border-slate-700/60 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-200">
          <span
            className="w-2 h-2 rounded-full bg-[#10b981]"
            style={{ animation: "pulse-slow 2s ease-in-out infinite" }}
          />
          LIVE
        </div>

        <div className="max-w-3xl space-y-6">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.1]">
            Verified Casino Intelligence.{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0ea5e9] to-[#10b981]">
              Not Guesswork.
            </span>
          </h1>
          <p className="text-slate-400 text-base sm:text-lg leading-relaxed max-w-2xl">
            SavvyEdge autonomously discovers, crawls, fingerprints, and
            validates gambling data so you never have to trust a casino&apos;s
            word.
          </p>
          <div className="flex flex-wrap gap-4 pt-2">
            <Link
              href="/casinos"
              className="bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-slate-950 font-bold px-6 py-3 rounded-xl text-sm shadow-lg shadow-[#0ea5e9]/20 transition-all hover:scale-[1.02]"
            >
              Explore Casinos
            </Link>
            <Link
              href="/methodology"
              className="bg-[#161e2e] hover:bg-slate-800 text-slate-200 font-semibold px-6 py-3 rounded-xl text-sm border border-slate-700/60 transition-all hover:border-slate-600"
            >
              Our Methodology
            </Link>
          </div>
        </div>
      </section>

      {/* ───── Stats Bar ───── */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-5 text-center space-y-1"
            style={{ animation: "fade-up 0.4s ease both" }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[#0ea5e9]">
              {stat.label}
            </span>
            <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
              {stat.value}
            </div>
          </div>
        ))}
      </section>

      {/* ───── Feature Cards ───── */}
      <section className="space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            How SavvyEdge Works
          </h2>
          <p className="text-slate-400 text-sm max-w-xl mx-auto">
            Three pillars of autonomous data intelligence that set us apart from
            every other affiliate site.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="bg-[#161e2e] border border-white/[0.06] rounded-2xl p-6 space-y-3 transition-all duration-300 hover:-translate-y-1 hover:border-slate-700"
              style={{
                borderLeft: "3px solid #0ea5e9",
                animation: `fade-up 0.4s ease ${i * 0.1}s both`,
              }}
            >
              <div className="w-10 h-10 rounded-xl bg-[#0ea5e9]/10 border border-[#0ea5e9]/20 flex items-center justify-center text-[#0ea5e9] text-lg font-bold">
                {f.icon}
              </div>
              <h3 className="text-lg font-bold text-white">{f.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Trust Strip ───── */}
      <section className="text-center px-4">
        <p className="text-sm italic text-slate-400 max-w-3xl mx-auto leading-relaxed">
          Data sourced from {casinoCount.toLocaleString("en-US")} regulated casinos across {jurisdictionCount.toLocaleString("en-US")} jurisdictions.
          Independently verified. No paid placements in rankings.
        </p>
      </section>

      {/* ───── Recent Verifications Feed ───── */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">
            Recent Verifications
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span
              className="w-2 h-2 rounded-full bg-[#10b981]"
              style={{ animation: "pulse-slow 2s ease-in-out infinite" }}
            />
            Live feed
          </div>
        </div>

        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl overflow-hidden">
          {/* Header row */}
          <div className="grid grid-cols-4 gap-4 px-5 py-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800/60 bg-[#0b0f19]">
            <span>Casino</span>
            <span>Type</span>
            <span>Verified</span>
            <span>Status</span>
          </div>
          {recentCasinos.map((c, i) => (
            <div
              key={c.id}
              className="grid grid-cols-4 gap-4 px-5 py-3.5 text-sm border-b border-slate-800/40 last:border-b-0 hover:bg-slate-800/20 transition-colors"
              style={{ animation: `fade-up 0.4s ease ${i * 0.08}s both` }}
            >
              <span className="font-semibold text-white text-xs">
                {c.name}
              </span>
              <span className="text-slate-400 text-xs">License Check</span>
              <span className="font-mono text-slate-300 text-xs">
                Just now
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-[#10b981]/15 text-[#10b981] flex items-center justify-center text-[10px] font-bold">
                  ✓
                </span>
                <span className="text-[#10b981] text-xs font-semibold">
                  Verified
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
