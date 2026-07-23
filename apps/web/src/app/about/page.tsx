import Link from "next/link";

export const metadata = {
  title: "About SavvyEdge | Verifiable Casino & Bonus Intelligence",
  description:
    "Learn about SavvyEdge — an autonomous iGaming data engine delivering source-tracked casino ratings, bonus analysis, and transparent metrics.",
};

export default function AboutPage() {
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

      {/* Page Header */}
      <div className="border-b border-slate-800/80 pb-6 space-y-3">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          About SavvyEdge
        </h1>
        <p className="text-slate-400 text-base leading-relaxed">
          The independent data intelligence layer for the online gambling industry.
        </p>
      </div>

      {/* Content Cards */}
      <div className="space-y-6 text-slate-300 leading-relaxed text-sm">
        {/* Section 1 */}
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">What We Do</h2>
          <p>
            SavvyEdge is an autonomous iGaming intelligence engine that continuously
            discovers, crawls, fingerprints, and validates casino and bonus data across
            regulated markets. We are not a casino. We do not accept payments from
            operators to influence rankings or alter our mathematical evaluations.
          </p>
        </section>

        {/* Section 2 */}
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">Our Mission</h2>
          <p>
            To give every player access to the same quality of source-tracked, structured
            gambling intelligence that was previously only available to industry
            insiders. We replace guesswork and marketing hype with objective,
            timestamped metrics.
          </p>
        </section>

        {/* Section 3 */}
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Our Technology</h2>
          <p>
            Our core architecture operates a multi-stage autonomous pipeline:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
              <span className="text-[#0ea5e9] font-bold text-xs uppercase tracking-wider block mb-1">
                1. Discovery &amp; Crawling
              </span>
              <p className="text-xs text-slate-400">
                Automated workers discover operator domain updates and extract terms directly from source HTML.
              </p>
            </div>
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
              <span className="text-[#0ea5e9] font-bold text-xs uppercase tracking-wider block mb-1">
                2. Fingerprinting &amp; Source Review
              </span>
              <p className="text-xs text-slate-400">
                Every extracted offer is cryptographically fingerprinted (SHA-256) to detect silent term modifications.
              </p>
            </div>
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
              <span className="text-[#0ea5e9] font-bold text-xs uppercase tracking-wider block mb-1">
                3. Entity Resolution
              </span>
              <p className="text-xs text-slate-400">
                AI agents map licenses, operators, regulators, and jurisdictions into canonical entity records.
              </p>
            </div>
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800">
              <span className="text-[#0ea5e9] font-bold text-xs uppercase tracking-wider block mb-1">
                4. True Value Scoring™
              </span>
              <p className="text-xs text-slate-400">
                Our mathematical algorithm evaluates wagering multipliers, caps, and time decay to rank real bonus value.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4 */}
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">Contact &amp; Data Disputes</h2>
          <p>
            Have a question about our platform or spotted a data discrepancy? Reach
            out directly through our{" "}
            <Link href="/contact" className="text-[#0ea5e9] font-semibold hover:underline">
              Contact Page
            </Link>
            . We review all accuracy reports within 48 hours.
          </p>
        </section>
      </div>
    </div>
  );
}
