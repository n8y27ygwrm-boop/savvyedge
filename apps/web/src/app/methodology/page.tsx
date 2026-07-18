import Link from "next/link";

export const metadata = {
  title: "Evaluation Methodology & Data Transparency | SavvyEdge",
  description: "Learn how SavvyEdge independently scrapes, verifies, calculates True Value scores, and tracks audit trails for online casinos.",
};

export default function MethodologyPage() {
  return (
    <div className="space-y-12">
      {/* Page Header */}
      <div className="border-b border-slate-800/80 pb-8 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#0ea5e9] uppercase tracking-wider">
          <span>Transparency</span> &bull; <span>Data Integrity</span> &bull; <span>Mathematics</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          SavvyEdge Evaluation Methodology
        </h1>
        <p className="text-slate-400 text-base max-w-3xl leading-relaxed">
          SavvyEdge operates on strict data provenance, automated web scraping with Playwright, content hashing, and mathematical True Value scoring to eliminate affiliate bias.
        </p>
      </div>

      {/* Section 1: Core Principles */}
      <section id="provenance" className="space-y-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-[#0ea5e9]/10 text-[#0ea5e9] border border-[#0ea5e9]/30 flex items-center justify-center text-sm font-extrabold">
            1
          </span>
          Data Provenance & Autonomous Verification
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold text-lg text-white">Playwright Scraping</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every data point is scraped directly from live promotional pages and terms using headless Chromium instances. Full raw HTML snapshots are stored permanently on disk.
            </p>
          </div>
          <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold text-white text-lg">Canonical Extraction</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Pages are linked to their canonical URLs extracted via DOM queries (<code className="text-[#0ea5e9] font-mono text-xs">link[rel=canonical]</code>), preventing duplicate indexing across regional mirrors.
            </p>
          </div>
          <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold text-white text-lg">SHA-256 Fingerprinting</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Cleaned text and raw HTML strings are hashed with SHA-256 algorithms. Unchanged content automatically short-circuits the pipeline, saving LLM compute while guaranteeing freshness.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Mathematical True Value Formula */}
      <section className="space-y-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/30 flex items-center justify-center text-sm font-extrabold">
            2
          </span>
          True Value Score Calculation
        </h2>
        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 md:p-8 space-y-6">
          <p className="text-sm text-slate-300 leading-relaxed">
            Headline bonus amounts (e.g. &quot;$1,000 Deposit Match&quot;) can be misleading due to high wagering requirements and strict withdrawal caps. Our True Value Score normalizes these offers into an objective metric:
          </p>
          
          <div className="bg-[#0b0f19] border border-slate-700/80 rounded-xl p-4 sm:p-6 font-mono text-xs sm:text-sm text-[#0ea5e9] space-y-2 overflow-x-auto">
            <div className="text-slate-400 text-xs font-sans font-semibold">// True Value Scoring Formula</div>
            <div>TrueValueScore = (HeadlineValue / WageringRequirement) * ConversionMultiplier</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-[#0b0f19] rounded-xl border border-slate-800 space-y-1">
              <span className="text-slate-400 font-semibold">Headline Value</span>
              <p className="text-slate-300">The total nominal dollar value of the promotional match or free spins.</p>
            </div>
            <div className="p-4 bg-[#0b0f19] rounded-xl border border-slate-800 space-y-1">
              <span className="text-slate-400 font-semibold">Wagering Requirement</span>
              <p className="text-slate-300">The turnover multiplier required before bonus funds convert to cash.</p>
            </div>
            <div className="p-4 bg-[#0b0f19] rounded-xl border border-slate-800 space-y-1">
              <span className="text-slate-400 font-semibold">Conversion Cap</span>
              <p className="text-slate-300">Maximum cashout limit imposed on bonus winnings.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Audit Trail & Standards Table */}
      <section id="audit-trail" className="space-y-6">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center text-sm font-extrabold">
            3
          </span>
          Evaluation Standards & Audit Trail
        </h2>

        <div className="bg-[#161e2e] border border-slate-800/80 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-[#0b0f19] text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Evaluation Metric</th>
                  <th className="px-6 py-4">Verification Method</th>
                  <th className="px-6 py-4">Audit Event Logging</th>
                  <th className="px-6 py-4">Standard Threshold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                <tr className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 font-semibold text-white">License Status</td>
                  <td className="px-6 py-4">Cross-referenced with regulatory registries (MGA, UKGC, NVGC).</td>
                  <td className="px-6 py-4 font-mono text-[#0ea5e9]">CasinoHistoryEvent</td>
                  <td className="px-6 py-4">Active & Verified</td>
                </tr>
                <tr className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 font-semibold text-white">Wagering Requirement</td>
                  <td className="px-6 py-4">Scraped from T&Cs & parsed via BonusAgent.</td>
                  <td className="px-6 py-4 font-mono text-[#0ea5e9]">BonusHistoryEvent</td>
                  <td className="px-6 py-4">&le; 40x Turnover</td>
                </tr>
                <tr className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 font-semibold text-white">RTP Current Values</td>
                  <td className="px-6 py-4">Monitored periodically against game provider specs.</td>
                  <td className="px-6 py-4 font-mono text-[#0ea5e9]">SlotRtpHistory</td>
                  <td className="px-6 py-4">&ge; 96.0% Baseline</td>
                </tr>
                <tr className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 font-semibold text-white">Verification Recency</td>
                  <td className="px-6 py-4">Automated job queue re-verification interval.</td>
                  <td className="px-6 py-4 font-mono text-[#0ea5e9]">ScrapeJob</td>
                  <td className="px-6 py-4">Re-verified &lt; 24 hours</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
