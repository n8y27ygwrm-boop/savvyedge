import Link from "next/link";
import { prisma } from "@savvyedge/database";
import { PublicationGateService } from "@savvyedge/api";
import CompareClient from "./CompareClient";

export const metadata = {
  title: "Compare Online Casinos | SavvyEdge",
  description: "Compare verified online casino operators side by side.",
};

export default async function ComparePage() {
  const rawCasinos = await prisma.casino.findMany({
    where: PublicationGateService.whereCasinoPublic(),
    include: {
      history_events: true,
      licenses: true,
    },
    orderBy: {
      name: "asc",
    },
  });

  const casinos = rawCasinos
    .filter((c) => PublicationGateService.isCasinoPubliclyEligible(c))
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
    }));

  return (
    <div className="space-y-8">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-2 text-xs text-slate-400 font-medium">
        <Link href="/" className="hover:text-[#0ea5e9] transition-colors">
          Home
        </Link>
        <span>/</span>
        <span className="text-slate-200">Compare</span>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Compare Casinos
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Side-by-side comparison of verified online casino operators, licensing, and bonus terms.
          </p>
        </div>
      </div>

      <CompareClient casinos={casinos} />
    </div>
  );
}
