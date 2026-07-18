import { prisma } from "@savvyedge/database";

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  priority?: "HIGH" | "NORMAL" | "LOW";
  domain?: string;
  deduplicate?: boolean;
}

export interface ProcessJobOptions {
  workerId?: string;
  domainLimiter?: {
    checkDomainAllowed: (domain: string) => boolean;
    recordDomainAccess: (domain: string) => void;
  };
}

export class JobQueueService {
  /**
   * Enqueue a job into the database with priority, domain, and optional deduplication
   */
  public static async enqueue(
    queueName: string,
    taskType: string,
    payload: Record<string, any>,
    options?: EnqueueOptions
  ) {
    const stringifiedPayload = JSON.stringify(payload);
    const domain = options?.domain || payload.domain || this.extractDomainFromPayload(payload);
    const priority = options?.priority || "NORMAL";

    // Deduplication check
    if (options?.deduplicate) {
      const existing = await prisma.jobQueue.findFirst({
        where: {
          queue_name: queueName,
          task_type: taskType,
          status: { in: ["PENDING", "PROCESSING"] },
          payload: stringifiedPayload,
        },
      });

      if (existing) {
        console.log(`[JobQueueService] Duplicate job skipped for ${taskType} (${existing.id})`);
        return existing;
      }
    }

    return prisma.jobQueue.create({
      data: {
        queue_name: queueName,
        task_type: taskType,
        payload: stringifiedPayload,
        status: "PENDING",
        priority,
        domain,
        attempts: 0,
        max_attempts: options?.maxAttempts ?? 3,
        run_at: options?.runAt ?? new Date(),
      },
    });
  }

  /**
   * Helper to extract domain from payload if present
   */
  private static extractDomainFromPayload(payload: Record<string, any>): string | undefined {
    if (payload.url && typeof payload.url === "string") {
      try {
        return new URL(payload.url).hostname.replace(/^www\./, "");
      } catch {}
    }
    return undefined;
  }

  /**
   * Process the next available job in a queue based on priority (HIGH > NORMAL > LOW) and domain throttling
   */
  public static async processNextJob(
    queueName: string,
    handlers: Record<string, (payload: any) => Promise<any>>,
    options?: ProcessJobOptions
  ): Promise<boolean> {
    const now = new Date();
    const workerId = options?.workerId || "worker-default";

    // Priority order for candidate selection
    const priorityOrder = ["HIGH", "NORMAL", "LOW"];

    let candidateJob: any = null;

    // Transactionally find and lock one candidate job respecting priority
    for (const priority of priorityOrder) {
      candidateJob = await prisma.$transaction(async (tx) => {
        const candidate = await tx.jobQueue.findFirst({
          where: {
            queue_name: queueName,
            status: "PENDING",
            priority,
            run_at: { lte: now },
            OR: [
              { locked_until: null },
              { locked_until: { lt: now } },
            ],
          },
          orderBy: { run_at: "asc" },
        });

        if (!candidate) return null;

        // Domain rate limit check
        if (candidate.domain && options?.domainLimiter) {
          const allowed = options.domainLimiter.checkDomainAllowed(candidate.domain);
          if (!allowed) {
            return null; // Skip candidate due to rate limit, try next priority/job
          }
        }

        const lockedUntil = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes lock
        const updateResult = await tx.jobQueue.updateMany({
          where: {
            id: candidate.id,
            status: "PENDING",
            OR: [
              { locked_until: null },
              { locked_until: { lt: now } },
            ],
          },
          data: {
            status: "PROCESSING",
            worker_id: workerId,
            locked_until: lockedUntil,
            started_at: now,
            attempts: { increment: 1 },
          },
        });

        if (updateResult.count === 0) {
          // Another worker raced and locked this job first
          return null;
        }

        return tx.jobQueue.findUnique({ where: { id: candidate.id } });
      });

      if (candidateJob) break;
    }

    if (!candidateJob) {
      return false; // No due/eligible jobs found
    }

    const job = candidateJob;
    if (job.domain && options?.domainLimiter) {
      options.domainLimiter.recordDomainAccess(job.domain);
    }

    console.log(
      `[JobQueueWorker] [${queueName}] Worker ${workerId} processing job ${job.id} (Type: ${job.task_type}, Priority: ${job.priority}, Attempt: ${job.attempts}/${job.max_attempts})`
    );

    const handler = handlers[job.task_type];
    if (!handler) {
      const errorMsg = `No handler registered for task type: ${job.task_type}`;
      console.error(`[JobQueueWorker] [${queueName}] ${errorMsg}`);
      await this.handleJobFailure(job.id, new Error(errorMsg), job.attempts, job.max_attempts);
      return true;
    }

    try {
      const parsedPayload = JSON.parse(job.payload);
      await handler(parsedPayload);

      await prisma.jobQueue.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completed_at: new Date(),
          locked_until: null,
          error_log: null,
        },
      });
      console.log(`[JobQueueWorker] [${queueName}] Job ${job.id} completed successfully`);
    } catch (err: any) {
      console.error(`[JobQueueWorker] [${queueName}] Job ${job.id} failed:`, err.message);
      await this.handleJobFailure(job.id, err, job.attempts, job.max_attempts);
    }

    return true;
  }

  /**
   * Handle worker failure and schedule retries with exponential backoff
   */
  private static async handleJobFailure(
    jobId: string,
    error: Error,
    attempts: number,
    maxAttempts: number
  ) {
    const isFinalFailure = attempts >= maxAttempts;
    const status = isFinalFailure ? "FAILED" : "PENDING";

    const backoffMs = Math.pow(2, attempts) * 1000;
    const runAt = new Date(Date.now() + backoffMs);

    await prisma.jobQueue.update({
      where: { id: jobId },
      data: {
        status,
        locked_until: null,
        error_log: error.stack || error.message || String(error),
        run_at: isFinalFailure ? undefined : runAt,
      },
    });
  }

  /**
   * Stale Job Crash Recovery: Resets PROCESSING jobs locked by dead/crashed workers
   */
  public static async recoverStaleJobs(): Promise<number> {
    const now = new Date();
    const staleJobs = await prisma.jobQueue.findMany({
      where: {
        status: "PROCESSING",
        locked_until: { lt: now },
      },
    });

    for (const job of staleJobs) {
      const isFinal = job.attempts >= job.max_attempts;
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: {
          status: isFinal ? "FAILED" : "PENDING",
          locked_until: null,
          error_log: `Recovered from crashed/stale worker ${job.worker_id || "unknown"}`,
        },
      });
    }

    if (staleJobs.length > 0) {
      console.log(`[JobQueueService] Crash Recovery: Recovered ${staleJobs.length} stale jobs.`);
    }

    return staleJobs.length;
  }

  /**
   * Collect detailed job queue metrics
   */
  public static async getMetrics() {
    const [queued, processing, completed, failed, totalJobs] = await Promise.all([
      prisma.jobQueue.count({ where: { status: "PENDING" } }),
      prisma.jobQueue.count({ where: { status: "PROCESSING" } }),
      prisma.jobQueue.count({ where: { status: "COMPLETED" } }),
      prisma.jobQueue.count({ where: { status: "FAILED" } }),
      prisma.jobQueue.count(),
    ]);

    const completedWithDuration = await prisma.jobQueue.findMany({
      where: {
        status: "COMPLETED",
        started_at: { not: null },
        completed_at: { not: null },
      },
      take: 100,
      orderBy: { completed_at: "desc" },
    });

    let totalDurationMs = 0;
    for (const job of completedWithDuration) {
      if (job.started_at && job.completed_at) {
        totalDurationMs += job.completed_at.getTime() - job.started_at.getTime();
      }
    }
    const avgExecutionTimeMs =
      completedWithDuration.length > 0 ? Math.round(totalDurationMs / completedWithDuration.length) : 0;

    // Jobs completed in last 1 minute
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const jobsLastMinute = await prisma.jobQueue.count({
      where: {
        status: "COMPLETED",
        completed_at: { gte: oneMinuteAgo },
      },
    });

    const totalRetriesResult = await prisma.jobQueue.aggregate({
      _sum: { attempts: true },
    });
    const totalRetries = totalRetriesResult._sum.attempts || 0;

    return {
      queuedJobs: queued,
      processingJobs: processing,
      completedJobs: completed,
      failedJobs: failed,
      totalJobs,
      totalRetries,
      avgExecutionTimeMs,
      jobsPerMinute: jobsLastMinute,
    };
  }

  /**
   * Start polling loop in worker mode
   */
  public static startWorker(
    queueName: string,
    handlers: Record<string, (payload: any) => Promise<any>>,
    pollIntervalMs: number = 1000,
    options?: ProcessJobOptions
  ) {
    let active = true;

    const runLoop = async () => {
      if (!active) return;

      try {
        let processed = true;
        while (processed && active) {
          processed = await this.processNextJob(queueName, handlers, options);
        }
      } catch (err: any) {
        console.error(`[JobQueueWorker] [${queueName}] Error in run loop:`, err.message);
      } finally {
        if (active) {
          setTimeout(runLoop, pollIntervalMs);
        }
      }
    };

    runLoop();

    return {
      stop: () => {
        console.log(`[JobQueueWorker] [${queueName}] Stopping worker...`);
        active = false;
      },
    };
  }
}
