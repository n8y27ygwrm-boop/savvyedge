import { describe, it, expect } from "vitest";
import { GET as healthHandler } from "../../../apps/admin/src/app/api/health/route";

const databaseUrl = process.env.PHASE2_WORKFLOW_TEST_DATABASE_URL || process.env.DATABASE_URL;

describe.runIf(Boolean(databaseUrl))("Health Endpoint Integration Tests", () => {
  it("returns HTTP 200 with status ok and zero secret leakage when database is healthy", async () => {
    const response = await healthHandler();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
    expect(body.environment).toBeDefined();

    // Verify zero secret or connection string leakage
    const jsonStr = JSON.stringify(body);
    expect(jsonStr).not.toContain("postgresql://");
    expect(jsonStr).not.toContain("password");
    expect(jsonStr).not.toContain("user");
    expect(jsonStr).not.toContain("host");
    expect(jsonStr).not.toContain("table");
  });
});
