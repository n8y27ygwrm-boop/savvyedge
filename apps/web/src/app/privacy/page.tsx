import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | SavvyEdge",
  description:
    "SavvyEdge Privacy Policy detailing data collection practices, cookie usage, third-party disclosures, and GDPR/CCPA user rights.",
};

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p className="text-xs text-slate-400 font-mono">
          Last Updated: July 2026
        </p>
      </div>

      {/* Content */}
      <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">1. Data We Collect</h2>
          <p>
            SavvyEdge collects minimal personal information. When you access our platform, we may process:
          </p>
          <ul className="list-disc list-inside space-y-1 text-slate-400 text-xs pl-2">
            <li>Technical metadata (IP address, browser type, device identifiers, referring URL).</li>
            <li>Information you voluntarily submit via our contact form (Name, Email, Message content).</li>
            <li>Aggregated usage metrics and click-stream analytics.</li>
          </ul>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">2. How We Use Information</h2>
          <p>
            We process collected data solely to deliver, secure, and improve our autonomous intelligence services. Specifically:
          </p>
          <ul className="list-disc list-inside space-y-1 text-slate-400 text-xs pl-2">
            <li>To respond to data accuracy reports and user inquiries.</li>
            <li>To detect technical bugs, prevent abuse, and optimize platform latency.</li>
            <li>To evaluate affiliate referral traffic performance.</li>
          </ul>
          <p className="text-xs text-[#10b981] font-semibold pt-1">
            ✓ SavvyEdge does not sell personal data to third parties under any circumstances.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">3. Third Parties &amp; External Links</h2>
          <p>
            Our website contains outbound links to regulated casino operators and gambling help services. When leaving SavvyEdge, you become subject to the external party&apos;s privacy policies and terms. We encourage you to review their disclosures independently.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">4. Cookies &amp; Tracking</h2>
          <p>
            We use essential cookies and lightweight privacy-friendly analytics to maintain active session states and measure feature engagement. You can control cookie settings directly within your web browser.
          </p>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">5. Your Rights (GDPR &amp; CCPA)</h2>
          <p>
            Depending on your jurisdiction, you hold legal rights regarding your personal data:
          </p>
          <ul className="list-disc list-inside space-y-1 text-slate-400 text-xs pl-2">
            <li>Right to access, correct, or delete any personal information held by us.</li>
            <li>Right to restrict or object to automated processing.</li>
            <li>Right to non-discrimination for exercising your privacy rights.</li>
          </ul>
        </section>

        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">6. Contact for Data Requests</h2>
          <p>
            To submit a formal data privacy request or ask questions regarding this policy, please email us via our{" "}
            <Link href="/contact" className="text-[#0ea5e9] font-semibold hover:underline">
              Contact Page
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
