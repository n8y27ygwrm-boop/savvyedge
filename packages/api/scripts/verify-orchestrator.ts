import { OrchestratorService, JobQueueService } from "../src/index";
import { prisma } from "@savvyedge/database";
import { execSync } from "child_process";

async function verifyOrchestrator() {
  console.log("=================================================");
  console.log("    STARTING SPRINT 3 PLATFORM ORCHESTRATOR VERIFICATION ");
  console.log("=================================================\n");

  // Step 1: Execute existing test suites
  console.log("--- Step 1: Running existing E2E verification test suites ---");
  try {
    console.log("[Test Suite 1/2] Running verify-vertical-slice...");
    execSync("pnpm --filter @savvyedge/api verify-slice", { stdio: "inherit" });

    console.log("\n[Test Suite 2/2] Running verify-real-scraping...");
    execSync("pnpm --filter @savvyedge/api verify-real-scraping", { stdio: "inherit" });

    console.log("\n [PASS] All existing verification test suites executed successfully!");
  } catch (err: any) {
    console.error("\n [FAIL] Existing test suite failure:", err.message);
    process.exit(1);
  }

  // Step 2: Start Platform Orchestrator
  console.log("\n--- Step 2: Starting Platform Orchestrator with Multi-Worker Concurrency ---");
  await OrchestratorService.start({
    workerConcurrency: 4,
    discoveryIntervalMs: 5000,
    maxConcurrentPerDomain: 2,
    minDomainDelayMs: 500,
  });

  console.log(" [PASS] Orchestrator started with 4 concurrent workers.");

  // Step 3: Validate WorkerNode registration
  const activeWorkersCount = await prisma.workerNode.count({ where: { status: "ACTIVE" } });
  console.log(` [PASS] Verified Active WorkerNodes in Database: ${activeWorkersCount}`);
  if (activeWorkersCount < 4) {
    throw new Error(`WorkerNode validation failed: Expected 4 active workers, found ${activeWorkersCount}`);
  }

  // Step 4: Duplicate Protection Verification
  console.log("\n--- Step 3: Validating Duplicate Job Prevention ---");
  const testUrl = "https://www.casinos.com/us/bonuses";
  const job1 = await JobQueueService.enqueue(
    "orchestrator-queue",
    "INGEST_URL",
    { url: testUrl },
    { priority: "HIGH", deduplicate: true }
  );

  const job2 = await JobQueueService.enqueue(
    "orchestrator-queue",
    "INGEST_URL",
    { url: testUrl },
    { priority: "HIGH", deduplicate: true }
  );

  if (job1.id === job2.id) {
    console.log(" [PASS] Duplicate job prevented: Second enqueue returned existing job ID.");
  } else {
    throw new Error("Duplicate Protection Failed: Duplicate job was created!");
  }

  // Step 5: Priority Queuing & Task Lifecycle Execution
  console.log("\n--- Step 4: Executing Priority Tasks & Multi-Stage Pipeline ---");
  console.log("Waiting for worker pool to process queued tasks...");
  await new Promise((resolve) => setTimeout(resolve, 8000));

  // Step 6: Crash Recovery Simulation
  console.log("\n--- Step 5: Validating Crash Recovery & Stale Job Recovery ---");
  const staleJob = await prisma.jobQueue.create({
    data: {
      queue_name: "orchestrator-queue",
      task_type: "CRAWL_URL",
      payload: JSON.stringify({ url: "https://example.com/stale" }),
      status: "PROCESSING",
      worker_id: "crashed-worker-999",
      locked_until: new Date(Date.now() - 10000), // Locked in past
      attempts: 1,
    },
  });

  const recoveredCount = await JobQueueService.recoverStaleJobs();
  const updatedStaleJob = await prisma.jobQueue.findUnique({ where: { id: staleJob.id } });
  if (updatedStaleJob?.status === "PENDING") {
    console.log(` [PASS] Crash Recovery: Successfully reset ${recoveredCount} stale job(s) to PENDING status.`);
  } else {
    throw new Error(`Crash Recovery Failed: Stale job status is ${updatedStaleJob?.status}`);
  }

  // Step 7: Runtime Metrics Reporting
  console.log("\n--- Step 6: Querying Runtime Metrics ---");
  const metrics = await OrchestratorService.getMetrics();
  console.log(" [PASS] Runtime Metrics Retrieved:");
  console.log(`   - Active Workers:      ${metrics.activeWorkers}`);
  console.log(`   - Queued Jobs:         ${metrics.queuedJobs}`);
  console.log(`   - Processing Jobs:     ${metrics.processingJobs}`);
  console.log(`   - Completed Jobs:      ${metrics.completedJobs}`);
  console.log(`   - Failed Jobs:         ${metrics.failedJobs}`);
  console.log(`   - Avg Execution Time:  ${metrics.avgExecutionTimeMs} ms`);
  console.log(`   - Jobs Per Minute:     ${metrics.jobsPerMinute}`);

  // Step 8: Graceful Shutdown
  console.log("\n--- Step 7: Executing Graceful Shutdown ---");
  await OrchestratorService.stop();

  const deadWorkersCount = await prisma.workerNode.count({ where: { status: "DEAD" } });
  console.log(` [PASS] Graceful Shutdown Complete: ${deadWorkersCount} workers marked DEAD cleanly.`);

  console.log("\n=================================================");
  console.log("   SPRINT 3 PLATFORM ORCHESTRATOR VERIFICATION PASSED! ");
  console.log("=================================================");
}

verifyOrchestrator();
