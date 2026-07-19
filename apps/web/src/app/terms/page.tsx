import Link from "next/link";

export const metadata = {
  title: "Terms of Service | SavvyEdge",
  description:
    "SavvyEdge Terms of Service governing platform usage, data accuracy disclaimers, affiliate disclosures, and limitation of liability.",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p className="text-xs text-slate-400 font-mono">
          Last Updated: July 2026
        </p>
      </div>

      {/* Mandatory Disclaimer Callout */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 sm:p-5 text-amber-200 text-xs sm:text-sm leading-relaxed">
        <span className="font-bold">Operational Notice:</span> SavvyEdge is a data intelligence platform. We do not operate gambling services. All gambling decisions are made at the user&apos;s own risk.
      </div>

      {/* Content Sections */}
      <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">1. Acceptance of Terms</h2>
          <p>
            By accessing or using SavvyEdge (&quot;the Platform&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, you must discontinue platform use immediately. Access is restricted to individuals who are 18 years of age or older (or the legal age for gambling in your jurisdiction).
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">2. Use of the Platform</h2>
          <p>
            SavvyEdge grants users a limited, non-exclusive, non-transferable license to access and view public casino ratings, RTP data, and True Value Score calculations for personal, non-commercial research purposes.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">3. Data Accuracy Disclaimer</h2>
          <p>
            While our autonomous intelligence engine continuously verifies operator data against source T&amp;Cs, bonus terms and licensing details are controlled by third-party operators and may change without notice. Users are responsible for confirming terms directly on operator websites prior to depositing funds.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">4. Affiliate Disclosure</h2>
          <p>
            SavvyEdge maintains commercial affiliate relationships with certain featured operators. Clicking links on our platform may generate referral commissions. Referral agreements do not influence mathematical scoring algorithms, True Value ratings, or audit verification statuses.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">5. Prohibited Uses</h2>
          <p>
            Users agree not to: (a) scrape, index, or extract platform datasets for commercial competition without express written consent; (b) attempt to disrupt platform security or latency; (c) misrepresent affiliation with SavvyEdge.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">6. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, SavvyEdge and its operators shall not be liable for any direct, indirect, incidental, or consequential financial losses incurred as a result of relying on platform data or engaging with third-party casinos.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">7. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles.
          </p>
        </section>
      </div>
    </div>
  );
}
