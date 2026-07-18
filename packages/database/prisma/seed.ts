import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding SavvyEdge database...\n");

  // ── Jurisdictions ──
  const jurisdictions = [
    { slug: "malta", name: "Malta", country: "MT" },
    { slug: "uk", name: "United Kingdom", country: "GB" },
    { slug: "gibraltar", name: "Gibraltar", country: "GI" },
  ] as const;

  const jurisdictionMap: Record<string, string> = {};
  for (const j of jurisdictions) {
    const record = await prisma.jurisdiction.upsert({
      where: { slug: j.slug },
      update: { name: j.name, country: j.country },
      create: { slug: j.slug, name: j.name, country: j.country },
    });
    jurisdictionMap[j.slug] = record.id;
    console.log(`  ✓ Jurisdiction: ${j.name}`);
  }

  // ── Regulators ──
  const regulators = [
    { slug: "mga", name: "Malta Gaming Authority", jurisdiction: "malta", website_url: "https://www.mga.org.mt" },
    { slug: "ukgc", name: "UK Gambling Commission", jurisdiction: "uk", website_url: "https://www.gamblingcommission.gov.uk" },
    { slug: "gib-rga", name: "Gibraltar Regulatory Authority", jurisdiction: "gibraltar", website_url: "https://www.gra.gi" },
  ] as const;

  const regulatorMap: Record<string, string> = {};
  for (const r of regulators) {
    const record = await prisma.regulator.upsert({
      where: { slug: r.slug },
      update: {
        name: r.name,
        jurisdiction_id: jurisdictionMap[r.jurisdiction],
        website_url: r.website_url,
      },
      create: {
        slug: r.slug,
        name: r.name,
        jurisdiction_id: jurisdictionMap[r.jurisdiction],
        website_url: r.website_url,
      },
    });
    regulatorMap[r.slug] = record.id;
    console.log(`  ✓ Regulator: ${r.name}`);
  }

  // ── Casinos + Licenses ──
  const casinos = [
    { slug: "leovegas", name: "LeoVegas", website_url: "https://www.leovegas.com", regulator: "mga", license_no: "MGA/B2C/218/2012" },
    { slug: "bet365", name: "Bet365", website_url: "https://www.bet365.com", regulator: "ukgc", license_no: "39563" },
    { slug: "casumo", name: "Casumo", website_url: "https://www.casumo.com", regulator: "mga", license_no: "MGA/B2C/217/2012" },
    { slug: "888casino", name: "888 Casino", website_url: "https://www.888casino.com", regulator: "gib-rga", license_no: "RGL No.047" },
    { slug: "unibet", name: "Unibet", website_url: "https://www.unibet.com", regulator: "mga", license_no: "MGA/B2C/304/2014" },
    { slug: "betway", name: "Betway", website_url: "https://www.betway.com", regulator: "ukgc", license_no: "39372" },
  ] as const;

  const casinoMap: Record<string, string> = {};
  for (const c of casinos) {
    const casino = await prisma.casino.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        website_url: c.website_url,
        status: "VERIFIED",
        verified_at: new Date(),
      },
      create: {
        slug: c.slug,
        name: c.name,
        website_url: c.website_url,
        status: "VERIFIED",
        verified_at: new Date(),
      },
    });
    casinoMap[c.slug] = casino.id;

    // Upsert license (find existing or create)
    const existingLicense = await prisma.license.findFirst({
      where: { casino_id: casino.id, regulator_id: regulatorMap[c.regulator] },
    });
    if (existingLicense) {
      await prisma.license.update({
        where: { id: existingLicense.id },
        data: { license_no: c.license_no, status: "ACTIVE", verified_at: new Date() },
      });
    } else {
      await prisma.license.create({
        data: {
          casino_id: casino.id,
          regulator_id: regulatorMap[c.regulator],
          license_no: c.license_no,
          status: "ACTIVE",
          verified_at: new Date(),
        },
      });
    }

    console.log(`  ✓ Casino: ${c.name} (License: ${c.license_no})`);
  }

  // ── Bonuses ──
  const bonuses = [
    { casino: "leovegas", type: "WELCOME", headline_value: "100% up to €500 + 20 Free Spins", wagering_requirement: 35, max_conversion: 500, true_value_score: 72, valid_until: new Date("2026-12-31") },
    { casino: "bet365", type: "WELCOME", headline_value: "Up to €100 in Bet Credits", wagering_requirement: 10, max_conversion: 100, true_value_score: 58, valid_until: new Date("2026-09-30") },
    { casino: "casumo", type: "FREE_SPINS", headline_value: "50 Free Spins No Deposit", wagering_requirement: 40, max_conversion: 50, true_value_score: 45, valid_until: new Date("2026-08-15") },
    { casino: "888casino", type: "RELOAD", headline_value: "50% up to €200 every Friday", wagering_requirement: 30, max_conversion: 200, true_value_score: 61, valid_until: null },
    { casino: "unibet", type: "WELCOME", headline_value: "€25 Free Bet + €500 Bonus", wagering_requirement: 25, max_conversion: 500, true_value_score: 68, valid_until: new Date("2026-10-31") },
    { casino: "betway", type: "FREE_SPINS", headline_value: "100 Free Spins on Starburst", wagering_requirement: 50, max_conversion: 100, true_value_score: 38, valid_until: new Date("2026-07-31") },
  ] as const;

  for (const b of bonuses) {
    // Find existing active bonus for this casino to upsert
    const existingBonus = await prisma.bonus.findFirst({
      where: { casino_id: casinoMap[b.casino], status: "ACTIVE" },
    });

    if (existingBonus) {
      await prisma.bonus.update({
        where: { id: existingBonus.id },
        data: {
          type: b.type,
          headline_value: b.headline_value,
          wagering_requirement: b.wagering_requirement,
          max_conversion: b.max_conversion,
          true_value_score: b.true_value_score,
          status: "ACTIVE",
          valid_until: b.valid_until,
          verified_at: new Date(),
        },
      });
    } else {
      await prisma.bonus.create({
        data: {
          casino_id: casinoMap[b.casino],
          type: b.type,
          headline_value: b.headline_value,
          wagering_requirement: b.wagering_requirement,
          max_conversion: b.max_conversion,
          true_value_score: b.true_value_score,
          status: "ACTIVE",
          valid_until: b.valid_until,
          verified_at: new Date(),
        },
      });
    }

    console.log(`  ✓ Bonus: ${b.casino} → ${b.type}`);
  }

  // ── Providers ──
  const providers = [
    { slug: "netent", name: "NetEnt" },
    { slug: "playngo", name: "Play'n GO" },
  ] as const;

  const providerMap: Record<string, string> = {};
  for (const p of providers) {
    const record = await prisma.provider.upsert({
      where: { slug: p.slug },
      update: { name: p.name },
      create: { slug: p.slug, name: p.name },
    });
    providerMap[p.slug] = record.id;
    console.log(`  ✓ Provider: ${p.name}`);
  }

  // ── Slots + RTP History ──
  const slots = [
    { slug: "starburst", name: "Starburst", provider: "netent", rtp_current: 96.1, volatility: "LOW", max_win: 500, rtp_history: [96.0, 96.1, 96.1, 96.1] },
    { slug: "book-of-dead", name: "Book of Dead", provider: "playngo", rtp_current: 96.2, volatility: "HIGH", max_win: 5000, rtp_history: [96.3, 96.2, 96.1, 96.2] },
    { slug: "gonzos-quest", name: "Gonzo's Quest", provider: "netent", rtp_current: 95.97, volatility: "MEDIUM", max_win: 2500, rtp_history: [96.1, 96.0, 95.9, 95.97] },
    { slug: "bonanza-megaways", name: "Bonanza Megaways", provider: "netent", rtp_current: 96.0, volatility: "HIGH", max_win: 10000, rtp_history: [96.2, 96.1, 96.0, 96.0] },
    { slug: "jammin-jars", name: "Jammin' Jars", provider: "playngo", rtp_current: 96.83, volatility: "HIGH", max_win: 20000, rtp_history: [96.8, 96.9, 96.8, 96.83] },
    { slug: "dead-or-alive-2", name: "Dead or Alive 2", provider: "netent", rtp_current: 96.8, volatility: "HIGH", max_win: 100000, rtp_history: [96.7, 96.8, 96.8, 96.8] },
  ] as const;

  for (const s of slots) {
    const slot = await prisma.slot.upsert({
      where: { slug: s.slug },
      update: {
        name: s.name,
        provider_id: providerMap[s.provider],
        rtp_current: s.rtp_current,
        volatility: s.volatility,
        max_win: s.max_win,
      },
      create: {
        slug: s.slug,
        name: s.name,
        provider_id: providerMap[s.provider],
        rtp_current: s.rtp_current,
        volatility: s.volatility,
        max_win: s.max_win,
      },
    });

    // Clear old RTP history for this slot and insert fresh entries
    await prisma.slotRtpHistory.deleteMany({ where: { slot_id: slot.id } });

    const baseDate = new Date();
    for (let i = 0; i < s.rtp_history.length; i++) {
      await prisma.slotRtpHistory.create({
        data: {
          slot_id: slot.id,
          rtp_value: s.rtp_history[i],
          recorded_at: new Date(baseDate.getTime() - (s.rtp_history.length - 1 - i) * 6 * 60 * 60 * 1000),
        },
      });
    }

    console.log(`  ✓ Slot: ${s.name} (RTP: ${s.rtp_current}%)`);
  }

  console.log("\n✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
