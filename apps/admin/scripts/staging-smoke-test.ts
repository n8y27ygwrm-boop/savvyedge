import http from "http";
import https from "https";

export interface SmokeTestResult {
  url: string;
  passed: boolean;
  checks: Array<{ name: string; success: boolean; message: string }>;
}

function fetchUrl(targetUrl: string, options: { followRedirects?: boolean } = {}): Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === "https:" ? https : http;

    const req = client.get(targetUrl, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (options.followRedirects && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location) {
          const redirectTarget = new URL(res.headers.location, targetUrl).toString();
          fetchUrl(redirectTarget, options).then(resolve).catch(reject);
          return;
        }
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body,
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${targetUrl}`));
    });
  });
}

export async function runStagingSmokeTest(baseUrlArg?: string): Promise<SmokeTestResult> {
  const rawUrl = baseUrlArg || process.env.STAGING_BASE_URL || "http://localhost:3000";
  const baseUrl = rawUrl.replace(/\/$/, "");

  const result: SmokeTestResult = {
    url: baseUrl,
    passed: true,
    checks: [],
  };

  function recordCheck(name: string, success: boolean, message: string) {
    result.checks.push({ name, success, message });
    if (!success) {
      result.passed = false;
    }
  }

  try {
    // 1. Health Endpoint Test
    const healthUrl = `${baseUrl}/api/health`;
    const healthRes = await fetchUrl(healthUrl);
    if (healthRes.statusCode === 200) {
      try {
        const json = JSON.parse(healthRes.body);
        if (json.status === "ok") {
          recordCheck("Health Endpoint", true, `HTTP 200 OK (environment: ${json.environment})`);
        } else {
          recordCheck("Health Endpoint", false, `HTTP 200 but status reported as '${json.status}'`);
        }
      } catch {
        recordCheck("Health Endpoint", false, "HTTP 200 but invalid JSON payload");
      }
    } else {
      recordCheck("Health Endpoint", false, `Expected HTTP 200, received ${healthRes.statusCode}`);
    }

    // 2. Login Page Reachable Test
    const loginUrl = `${baseUrl}/login`;
    const loginRes = await fetchUrl(loginUrl);
    if (loginRes.statusCode === 200) {
      recordCheck("Login Page Reachability", true, "HTTP 200 OK - Login page reachable");
    } else {
      recordCheck("Login Page Reachability", false, `Expected HTTP 200, received ${loginRes.statusCode}`);
    }

    // 3. Protected Route Fails Closed (Unauthenticated /review)
    const reviewUrl = `${baseUrl}/review`;
    const reviewRes = await fetchUrl(reviewUrl);
    const isProtected =
      reviewRes.statusCode === 302 ||
      reviewRes.statusCode === 307 ||
      reviewRes.statusCode === 401 ||
      reviewRes.statusCode === 403 ||
      (reviewRes.statusCode === 200 && reviewRes.body.includes("Sign In"));

    if (isProtected) {
      recordCheck("Protected Route Access Control", true, `Unauthenticated request correctly protected (HTTP ${reviewRes.statusCode})`);
    } else {
      recordCheck("Protected Route Access Control", false, `Unauthenticated request exposed protected content! (HTTP ${reviewRes.statusCode})`);
    }

    // 4. Security Headers Presence
    const nosniff = healthRes.headers["x-content-type-options"];
    if (nosniff) {
      recordCheck("Security Headers", true, `x-content-type-options header present (${nosniff})`);
    } else {
      recordCheck("Security Headers", false, "x-content-type-options header missing");
    }
  } catch (err) {
    recordCheck("Connectivity", false, err instanceof Error ? err.message : "Network error");
  }

  return result;
}

// CLI Execution
if (require.main === module) {
  const cliTarget = process.argv[2];
  console.log(`[Smoke Test] Starting non-destructive staging smoke test...`);
  runStagingSmokeTest(cliTarget)
    .then((res) => {
      console.log(`[Smoke Test Target] ${res.url}`);
      for (const check of res.checks) {
        const symbol = check.success ? "✓" : "✗";
        console.log(`  ${symbol} [${check.name}] ${check.message}`);
      }

      if (res.passed) {
        console.log(`\n[Smoke Test PASSED] Staging environment verified safely.`);
        process.exit(0);
      } else {
        console.error(`\n[Smoke Test FAILED] One or more staging checks failed.`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[Smoke Test ERROR]", err.message);
      process.exit(1);
    });
}
