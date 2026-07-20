import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SavvyEdge | Verifiable Casino & Bonus Intelligence",
  description: "Autonomous casino data verification, bonus true value scoring, and real-time RTP monitoring.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0b0f19] text-[#f3f4f6] font-sans selection:bg-[#0ea5e9]/30 selection:text-[#0ea5e9]">
        {/* Sticky Navbar (64px) */}
        <header className="sticky top-0 z-50 h-16 bg-[#0b0f19]/95 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-8 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#0ea5e9] to-[#10b981] flex items-center justify-center font-bold text-slate-950 text-lg shadow-md shadow-[#0ea5e9]/20 group-hover:scale-105 transition-transform">
                S
              </div>
              <span className="font-extrabold text-xl tracking-tight text-white group-hover:text-[#0ea5e9] transition-colors">
                Savvy<span className="text-[#0ea5e9]">Edge</span>
              </span>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
              <Link href="/casinos" className="hover:text-[#0ea5e9] transition-colors">
                Casinos
              </Link>
              <Link href="/compare" className="hover:text-[#0ea5e9] transition-colors">
                Compare
              </Link>
              <Link href="/bonuses" className="hover:text-[#0ea5e9] transition-colors">
                Bonuses
              </Link>
              <Link href="/slots" className="hover:text-[#0ea5e9] transition-colors">
                Slots
              </Link>
              <Link href="/methodology" className="hover:text-[#0ea5e9] transition-colors">
                Methodology
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <input
                type="text"
                placeholder="Search casinos, bonuses..."
                className="bg-[#161e2e] text-sm text-[#f3f4f6] placeholder-[#9ca3af] px-3 py-1.5 rounded-lg border border-slate-700/60 focus:outline-none focus:border-[#0ea5e9] focus:ring-1 focus:ring-[#0ea5e9] w-48 lg:w-64 transition-all"
              />
            </div>
            <Link
              href="/casinos"
              className="bg-[#0ea5e9] hover:bg-[#0ea5e9]/90 text-slate-950 font-semibold px-4 py-1.5 rounded-lg text-sm shadow-sm transition-all"
            >
              Verify Now
            </Link>
          </div>
        </header>

        {/* Main Content Container */}
        <main className="max-w-[1280px] mx-auto w-full px-4 sm:px-8 py-8 flex-1">
          {children}
        </main>

        {/* Global Footer */}
        <footer className="bg-[#080b12] border-t border-slate-800/80 mt-16 pt-12 pb-8 px-4 sm:px-8 text-sm text-slate-400">
          <div className="max-w-[1280px] mx-auto space-y-8">
            {/* Responsible Gambling Warning Banner */}
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-amber-300">
              <div className="flex items-center gap-3">
                <span className="bg-amber-500/20 text-amber-400 font-extrabold text-xs px-2 py-1 rounded border border-amber-500/40">
                  18+ / 21+
                </span>
                <span className="font-medium text-xs sm:text-sm">
                  Gambling involves financial risk and may be addictive. Please gamble responsibly.
                </span>
              </div>
              <Link
                href="/responsible-gambling"
                className="text-xs font-semibold underline hover:text-amber-200 whitespace-nowrap"
              >
                Responsible Gambling Resources &rarr;
              </Link>
            </div>

            {/* Affiliate Relationship Disclosure */}
            <div className="text-xs text-slate-500 leading-relaxed border-b border-slate-800/60 pb-6">
              <span className="font-semibold text-slate-400">Affiliate Disclosure:</span> SavvyEdge is an independent casino comparison and data intelligence engine. We may receive financial compensation when users click links or sign up with partner operators featured on this platform. This does not alter our objective methodology or mathematical True Value calculations.
            </div>

            {/* Four-Column Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <div>
                <h4 className="font-semibold text-slate-200 mb-3 text-xs uppercase tracking-wider">Product</h4>
                <ul className="space-y-2 text-xs">
                  <li>
                    <Link href="/casinos" className="hover:text-[#0ea5e9] transition-colors">
                      Casino Directory
                    </Link>
                  </li>
                  <li>
                    <Link href="/bonuses" className="hover:text-[#0ea5e9] transition-colors">
                      Verified Bonuses
                    </Link>
                  </li>
                  <li>
                    <Link href="/slots" className="hover:text-[#0ea5e9] transition-colors">
                      RTP Tracker
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-200 mb-3 text-xs uppercase tracking-wider">Company</h4>
                <ul className="space-y-2 text-xs">
                  <li>
                    <Link href="/methodology" className="hover:text-[#0ea5e9] transition-colors">
                      Evaluation Methodology
                    </Link>
                  </li>
                  <li>
                    <Link href="/about" className="hover:text-[#0ea5e9] transition-colors">
                      About SavvyEdge
                    </Link>
                  </li>
                  <li>
                    <Link href="/contact" className="hover:text-[#0ea5e9] transition-colors">
                      Contact Us
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-200 mb-3 text-xs uppercase tracking-wider">Trust & Integrity</h4>
                <ul className="space-y-2 text-xs">
                  <li>
                    <Link href="/methodology#provenance" className="hover:text-[#0ea5e9] transition-colors">
                      Data Provenance
                    </Link>
                  </li>
                  <li>
                    <Link href="/responsible-gambling" className="hover:text-[#0ea5e9] transition-colors">
                      Responsible Gambling
                    </Link>
                  </li>
                  <li>
                    <Link href="/methodology#audit-trail" className="hover:text-[#0ea5e9] transition-colors">
                      Audit Trail
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-slate-200 mb-3 text-xs uppercase tracking-wider">Legal</h4>
                <ul className="space-y-2 text-xs">
                  <li>
                    <Link href="/privacy" className="hover:text-[#0ea5e9] transition-colors">
                      Privacy Policy
                    </Link>
                  </li>
                  <li>
                    <Link href="/terms" className="hover:text-[#0ea5e9] transition-colors">
                      Terms of Service
                    </Link>
                  </li>
                  <li>
                    <Link href="/disclaimer" className="hover:text-[#0ea5e9] transition-colors">
                      Disclaimer
                    </Link>
                  </li>
                </ul>
              </div>
            </div>

            {/* Copyright */}
            <div className="pt-4 text-center text-xs text-slate-600">
              &copy; {new Date().getFullYear()} SavvyEdge Intelligence Platform. All rights reserved.
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
