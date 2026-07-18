import { prisma } from "@savvyedge/database";
import { DiscoveryAgent } from "@savvyedge/ai-agents";
import { JobQueueService } from "./job-queue.service";

export class DiscoveryService {
  private static discoveryAgent = new DiscoveryAgent();

  public static async discoverAndEnqueue(seedUrls: string[]) {
    console.log(`[DiscoveryService] Starting autonomous discovery for ${seedUrls.length} seed URLs...`);

    const discoveryOutput = await this.discoveryAgent.run({ seedUrls });

    let totalEnqueued = 0;
    const records = [];

    for (const candidate of discoveryOutput.candidateUrls) {
      try {
        // Upsert DiscoveredUrl record into PostgreSQL
        const record = await prisma.discoveredUrl.upsert({
          where: { normalized_url: candidate.normalizedUrl },
          update: {
            source_seed: candidate.sourceSeed,
          },
          create: {
            url: candidate.normalizedUrl,
            normalized_url: candidate.normalizedUrl,
            domain: candidate.domain,
            source_seed: candidate.sourceSeed,
            status: "DISCOVERED",
          },
        });

        // Enqueue into existing Job Queue for asynchronous ingestion
        if (record.status === "DISCOVERED" || record.status === "ENQUEUED") {
          await JobQueueService.enqueue("ingestion-queue", "INGEST_URL", {
            url: candidate.normalizedUrl,
            discovered_id: record.id,
          });

          await prisma.discoveredUrl.update({
            where: { id: record.id },
            data: { status: "ENQUEUED" },
          });

          totalEnqueued++;
        }

        records.push(record);
      } catch (err: any) {
        console.warn(`[DiscoveryService] Error persisting discovered URL ${candidate.normalizedUrl}: ${err.message}`);
      }
    }

    console.log(
      `[DiscoveryService] Completed: ${discoveryOutput.totalDiscovered} candidate URLs discovered, ${totalEnqueued} valid URLs enqueued into Job Queue.`
    );

    return {
      totalSeeds: discoveryOutput.totalSeeds,
      totalDiscovered: discoveryOutput.totalDiscovered,
      totalEnqueued,
      filteredCount: discoveryOutput.filteredCount,
      discoveredRecords: records,
    };
  }

  public static async getDiscoveredUrls({ page = 1, limit = 50 }: { page?: number; limit?: number }) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.discoveredUrl.findMany({
        skip,
        take: limit,
        orderBy: { discovered_at: "desc" },
      }),
      prisma.discoveredUrl.count(),
    ]);

    return { data, meta: { page, limit, total } };
  }
}
