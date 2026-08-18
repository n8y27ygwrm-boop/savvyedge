import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryService, IngestionService } from "@savvyedge/api";
import { POST as postLegacyBonusIngest } from "../../../apps/web/src/app/api/v1/bonuses/ingest/route";
import {
  GET as getDiscovery,
  POST as postDiscovery,
} from "../../../apps/web/src/app/api/v1/discovery/route";

const bonusIngestEndpoint = "http://localhost/api/v1/bonuses/ingest";
const discoveryEndpoint = "http://localhost/api/v1/discovery";
const secret = "test-internal-api-secret";

function bonusIngestRequest(body: unknown, authorization?: string) {
  return new Request(bonusIngestEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

function discoveryPostRequest(body: unknown, authorization?: string) {
  return new Request(discoveryEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

function discoveryGetRequest(authorization?: string) {
  return new Request(discoveryEndpoint, {
    method: "GET",
    headers: {
      ...(authorization ? { authorization } : {}),
    },
  });
}

describe("Legacy synchronous ingestion — production fail-closed guard (D4B3C)", () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;
  const originalSavvyEnv = process.env.SAVVY_ENV;
  const originalNextPublicAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = secret;
    delete process.env.SAVVY_ENV;
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = originalSecret;
    }

    if (originalSavvyEnv === undefined) {
      delete process.env.SAVVY_ENV;
    } else {
      process.env.SAVVY_ENV = originalSavvyEnv;
    }

    if (originalNextPublicAppEnv === undefined) {
      delete process.env.NEXT_PUBLIC_APP_ENV;
    } else {
      process.env.NEXT_PUBLIC_APP_ENV = originalNextPublicAppEnv;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe("POST /api/v1/bonuses/ingest", () => {
    it("rejects with 410 in production before authorization, scraping, AI extraction, or DB work", async () => {
      process.env.SAVVY_ENV = "production";
      const ingest = vi.spyOn(IngestionService, "ingestBonusFromUrl");

      // Deliberately omit the authorization header — if the production guard
      // did not run first, this would fail authorization (401) instead of
      // being rejected as disabled (410), which would prove the ordering is wrong.
      const response = await postLegacyBonusIngest(
        bonusIngestRequest({ url: "https://example.com/bonus" }),
      );
      const json = await response.json();

      expect(response.status).toBe(410);
      expect(json).toMatchObject({
        data: null,
        meta: {
          execution: "disabled",
          reason: "LEGACY_SYNCHRONOUS_INGESTION_DISABLED_IN_PRODUCTION",
        },
        error: {
          message: expect.stringContaining("/api/v1/ingestion/jobs"),
        },
      });
      expect(ingest).not.toHaveBeenCalled();
    });

    it.each([
      ["SAVVY_ENV", "production"],
      ["SAVVY_ENV", "PRODUCTION"],
      ["SAVVY_ENV", "prod"],
      ["NEXT_PUBLIC_APP_ENV", "production"],
      ["NODE_ENV", "production"],
    ])(
      "rejects with 410 when %s=%s (any recognized production signal)",
      async (envName, value) => {
        (process.env as Record<string, string>)[envName] = value;
        const ingest = vi.spyOn(IngestionService, "ingestBonusFromUrl");

        const response = await postLegacyBonusIngest(
          bonusIngestRequest(
            { url: "https://example.com/bonus" },
            `Bearer ${secret}`,
          ),
        );

        expect(response.status).toBe(410);
        expect(ingest).not.toHaveBeenCalled();
      },
    );

    it("still executes normally when SAVVY_ENV is not an explicit production value (dev/test compatibility preserved)", async () => {
      const scrapeJob = { id: "scrape-job-id", status: "COMPLETED" };
      const bonus = { id: "bonus-id" };
      const ingest = vi
        .spyOn(IngestionService, "ingestBonusFromUrl")
        .mockResolvedValue({
          bonus,
          scrapeJob,
          meta: { extracted: true },
        } as never);

      const response = await postLegacyBonusIngest(
        bonusIngestRequest(
          { url: "https://example.com/bonus" },
          `Bearer ${secret}`,
        ),
      );
      const json = await response.json();

      expect(response.status).toBe(201);
      expect(ingest).toHaveBeenCalledOnce();
      expect(ingest).toHaveBeenCalledWith({ url: "https://example.com/bonus" });
      expect(json).toMatchObject({ data: bonus, error: null });
    });

    it("still enforces authorization when not in production", async () => {
      const ingest = vi.spyOn(IngestionService, "ingestBonusFromUrl");

      const response = await postLegacyBonusIngest(
        bonusIngestRequest({ url: "https://example.com/bonus" }),
      );

      expect(response.status).toBe(401);
      expect(ingest).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/v1/discovery", () => {
    it("rejects with 410 in production before authorization or any Playwright discovery work", async () => {
      process.env.SAVVY_ENV = "production";
      const discover = vi.spyOn(DiscoveryService, "discoverAndEnqueue");

      const response = await postDiscovery(
        discoveryPostRequest({ seedUrls: ["https://example.com"] }),
      );
      const json = await response.json();

      expect(response.status).toBe(410);
      expect(json).toMatchObject({
        data: null,
        meta: {
          execution: "disabled",
          reason: "SYNCHRONOUS_DISCOVERY_DISABLED_IN_PRODUCTION",
        },
        error: { message: expect.stringContaining("disabled in production") },
      });
      expect(discover).not.toHaveBeenCalled();
    });

    it("still executes normally when not in production (dev/test compatibility preserved)", async () => {
      const discoveryResult = { discovered: 3, enqueued: 3 };
      const discover = vi
        .spyOn(DiscoveryService, "discoverAndEnqueue")
        .mockResolvedValue(discoveryResult as never);

      const response = await postDiscovery(
        discoveryPostRequest(
          { seedUrls: ["https://example.com"] },
          `Bearer ${secret}`,
        ),
      );
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(discover).toHaveBeenCalledOnce();
      expect(json).toMatchObject({ data: discoveryResult, error: null });
    });
  });

  describe("GET /api/v1/discovery — unaffected by the production guard (read-only, no scraping)", () => {
    it("still serves discovered URLs in production", async () => {
      process.env.SAVVY_ENV = "production";
      const list = vi
        .spyOn(DiscoveryService, "getDiscoveredUrls")
        .mockResolvedValue({ data: [], meta: { page: 1, limit: 50 } } as never);

      const response = await getDiscovery(
        discoveryGetRequest(`Bearer ${secret}`),
      );

      expect(response.status).toBe(200);
      expect(list).toHaveBeenCalledOnce();
    });
  });
});
