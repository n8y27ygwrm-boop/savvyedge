import Link from "next/link";

export const metadata = {
  title: "Disclaimer | SavvyEdge",
  description:
    "SavvyEdge Platform Disclaimer regarding data sourcing, True Value Scoring™, affiliate disclosures, and age restrictions.",
};

export default function DisclaimerPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Back Link */}
      <div>
        <Link
          href="/"
          className="text-xs font-semibold text-[#0ea5e9] hover:underline flex items-center gap-1"
        >
          ← Back to home
        </Link>
      </div>

      {/* Header */}
      <div className="border-b border-slate-800/80 pb-6 space-y-3">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Platform Disclaimer
        </h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Important disclosures regarding our data engine, ratings methodology, and legal compliance.
        </p>
      </div>

      {/* Grid of Key Points */}
      <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>🏛️</span> Not a Gambling Operator
          </h2>
          <p>
            SavvyEdge is an independent data intelligence platform. We do not own, operate, or provide online gambling, casino games, or betting services. We do not process wagers or handle player deposits.
          </p>
        </div>

        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>⚙️</span> Autonomous Data Sourcing
          </h2>
          <p>
            Bonus values, RTP figures, and licensing details are sourced from public operator terms and autonomously verified by our software engine. While we strive for 100% accuracy, operator terms can change dynamically. Always confirm terms on the operator website before playing.
          </p>
        </div>

        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>📊</span> Proprietary True Value Score™
          </h2>
          <p>
            The True Value Score™ is an algorithmic estimate calculated using wagering multipliers, caps, and time decay formulas. It is provided for analytical comparison only and should not be treated as financial advice or a guarantee of outcome.
          </p>
        </div>

        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>🤝</span> Independent Rankings &amp; Commercial Relationships
          </h2>
          <p>
            SavvyEdge receives referral commissions from featured partner casinos. However, commercial partnerships have zero impact on data verification, True Value Score calculations, or automated license checks.
          </p>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 space-y-3 text-amber-200">
          <h2 className="text-lg font-bold text-amber-300 flex items-center gap-2">
            <span>🔞</span> Age &amp; Jurisdictional Eligibility
          </h2>
          <p className="text-xs sm:text-sm">
            Access to online gambling is strictly restricted to individuals aged 18+ or 21+ depending on regional jurisdiction. It is your sole responsibility to ensure online gambling is legal within your country, state, or municipality before participating.
          </p>
        </div>
      </div>
    </div>
  );
}
