/**
 * Process-Local Limitations:
 * Domain rate limiting and concurrency enforcement apply only within a single
 * process-local WorkerPool instance. Distributed enforcement across multi-worker
 * clusters requires a shared coordination mechanism (e.g. Redis or DB leases).
 */
export class DomainConcurrencyManager {
  private readonly activeCounts = new Map<string, number>();

  constructor(public readonly maxConcurrentPerDomain: number = 2) {
    if (
      typeof maxConcurrentPerDomain !== "number" ||
      maxConcurrentPerDomain <= 0 ||
      !Number.isInteger(maxConcurrentPerDomain)
    ) {
      throw new Error("maxConcurrentPerDomain must be a positive integer");
    }
  }

  public canAcquire(domain: string | undefined): boolean {
    if (!domain) return true;
    const current = this.activeCounts.get(domain) ?? 0;
    return current < this.maxConcurrentPerDomain;
  }

  public acquire(domain: string | undefined): boolean {
    if (!domain) return true;
    const current = this.activeCounts.get(domain) ?? 0;
    if (current >= this.maxConcurrentPerDomain) {
      return false;
    }
    this.activeCounts.set(domain, current + 1);
    return true;
  }

  public release(domain: string | undefined): void {
    if (!domain) return;
    const current = this.activeCounts.get(domain) ?? 0;
    if (current <= 1) {
      this.activeCounts.delete(domain);
    } else {
      this.activeCounts.set(domain, current - 1);
    }
  }

  public getActiveCount(domain: string): number {
    return this.activeCounts.get(domain) ?? 0;
  }
}

import { assertIngestionQueueJob } from "../contracts/ingestion-queue.contract";
import { INGESTION_QUEUE_NAME } from "../constants/queue-names";
import { prisma } from "@savvyedge/database";

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  priority?: "HIGH" | "NORMAL" | "LOW";
  domain?: string;
  deduplicate?: boolean;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

export interface LegacyDomainLimiter {
  checkDomainAllowed(domain: string): boolean;
  recordDomainAccess?(domain: string): void;
}

export type DomainLimiterOption = DomainConcurrencyManager | LegacyDomainLimiter;

export const DEFAULT_JOB_LEASE_DURATION_MS = 120_000;
export const DEFAULT_JOB_LEASE_RENEW_INTERVAL_MS = 30_000;

export interface ProcessJobOptions {
  workerId?: string;
  maxAttempts?: number;
  runAt?: Date;
  maxConcurrentPerDomain?: number;
  domainLimiter?: DomainLimiterOption;
  concurrency?: number;
  leaseDurationMs?: number;
  leaseRenewIntervalMs?: number;
  claimAdapter?: (
    queueName: string,
    workerId: string,
    canAcquireDomain: (domain: string | undefined) => boolean,
  ) => Promise<{
    id: string;
    task_type: string;
    payload: string;
    attempts: number;
    max_attempts: number;
    domain?: string;
  } | null>;
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
    assertIngestionQueueJob(queueName, taskType, payload);
    const stringifiedPayload = JSON.stringify(payload);
    const rawDomain = (payload as Record<string, unknown>).domain;
    const domain = options?.domain || (typeof rawDomain === "string" ? rawDomain : undefined) || this.extractDomainFromPayload(payload);
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
  public static extractDomainFromPayload(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") {
      return undefined;
    }
    const rawUrl = (payload as Record<string, unknown>).url;
    if (typeof rawUrl !== "string") {
      return undefined;
    }
    try {
      const parsed = new URL(rawUrl);
      let hostname = parsed.hostname.toLowerCase();
      if (hostname.endsWith(".")) {
        hostname = hostname.slice(0, -1);
      }
      if (hostname.startsWith("www.")) {
        hostname = hostname.slice(4);
      }
      return hostname || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Process the next available job in a queue based on priority (HIGH > NORMAL > LOW) and domain throttling
   */
  public static async processNextJob(
    queueName: string,
    handlers: Record<string, (payload: any) => Promise<any>>,
    options?: ProcessJobOptions,
  ): Promise<boolean> {
    const now = new Date();
    const workerId = options?.workerId || "worker-default";
    const domainLimiter: DomainLimiterOption | undefined =
      options?.domainLimiter ??
      (options?.maxConcurrentPerDomain !== undefined
        ? new DomainConcurrencyManager(options.maxConcurrentPerDomain)
        : undefined);

    const leaseDurationMs =
      options?.leaseDurationMs !== undefined && options.leaseDurationMs > 0
        ? options.leaseDurationMs
        : DEFAULT_JOB_LEASE_DURATION_MS;

    if (leaseDurationMs <= 2) {
      throw new RangeError(
        "leaseDurationMs must be greater than 2 to allow a valid leaseRenewIntervalMs",
      );
    }

    let leaseRenewIntervalMs: number;
    if (
      options?.leaseRenewIntervalMs !== undefined &&
      options.leaseRenewIntervalMs > 0
    ) {
      if (options.leaseRenewIntervalMs >= leaseDurationMs / 2) {
        throw new RangeError(
          "leaseRenewIntervalMs must be less than half of leaseDurationMs",
        );
      }
      leaseRenewIntervalMs = options.leaseRenewIntervalMs;
    } else {
      leaseRenewIntervalMs = Math.min(
        DEFAULT_JOB_LEASE_RENEW_INTERVAL_MS,
        Math.max(1, Math.floor(leaseDurationMs / 4)),
      );
      if (leaseRenewIntervalMs >= leaseDurationMs / 2) {
        throw new RangeError(
          "leaseRenewIntervalMs must be less than half of leaseDurationMs",
        );
      }
    }

    const checkDomainCapacity = (dom: string | undefined): boolean => {
      if (!domainLimiter) return true;
      if (domainLimiter instanceof DomainConcurrencyManager) {
        return domainLimiter.canAcquire(dom);
      }
      return dom ? domainLimiter.checkDomainAllowed(dom) : true;
    };

    let candidateJob: any = null;

    const claimFn = options?.claimAdapter;
    if (claimFn) {
      candidateJob = await claimFn(queueName, workerId, checkDomainCapacity);
    } else {
      const priorityOrder = ["HIGH", "NORMAL", "LOW"];
      for (const priority of priorityOrder) {
        candidateJob = await prisma.$transaction(async (tx) => {
          const candidate = await tx.jobQueue.findFirst({
            where: {
              queue_name: queueName,
              status: "PENDING",
              priority,
              run_at: { lte: now },
              OR: [{ locked_until: null }, { locked_until: { lt: now } }],
            },
            orderBy: { run_at: "asc" },
          });

          if (!candidate) return null;

          const jobPayload = (() => {
            try {
              return JSON.parse(candidate.payload);
            } catch {
              return null;
            }
          })();

          const targetDomain =
            candidate.domain || JobQueueService.extractDomainFromPayload(jobPayload);

          if (!checkDomainCapacity(targetDomain)) {
            return null;
          }

          const lockedUntil = new Date(Date.now() + leaseDurationMs);
          const updateResult = await tx.jobQueue.updateMany({
            where: {
              id: candidate.id,
              status: "PENDING",
              OR: [{ locked_until: null }, { locked_until: { lt: now } }],
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
            return null;
          }

          return tx.jobQueue.findUnique({ where: { id: candidate.id } });
        });

        if (candidateJob) break;
      }
    }

    if (!candidateJob) {
      return false;
    }

    const job = candidateJob;
    const parsedPayload = (() => {
      try {
        return JSON.parse(job.payload);
      } catch {
        return {};
      }
    })();
    const targetDomain =
      job.domain || JobQueueService.extractDomainFromPayload(parsedPayload);

    if (domainLimiter) {
      if (domainLimiter instanceof DomainConcurrencyManager) {
        domainLimiter.acquire(targetDomain);
      } else if (targetDomain && typeof domainLimiter.recordDomainAccess === "function") {
        domainLimiter.recordDomainAccess(targetDomain);
      }
    }

    console.log(
      `[JobQueueWorker] [${queueName}] Worker ${workerId} processing job ${job.id} (Type: ${job.task_type}, Priority: ${job.priority || "NORMAL"}, Attempt: ${job.attempts}/${job.max_attempts})`,
    );

    const handler = handlers[job.task_type];
    if (!handler) {
      try {
        const errorMsg = `No handler registered for task type: ${job.task_type}`;
        console.error(`[JobQueueWorker] [${queueName}] ${errorMsg}`);
        if (!options?.claimAdapter) {
          await JobQueueService.handleJobFailure(
            job.id,
            new Error(errorMsg),
            job.attempts,
            job.max_attempts,
            queueName,
            workerId,
          );
        }
      } finally {
        if (domainLimiter instanceof DomainConcurrencyManager) {
          domainLimiter.release(targetDomain);
        }
      }
      return true;
    }

    let renewTimer: NodeJS.Timeout | undefined;
    let inFlightRenewalPromise: Promise<void> | null = null;
    let isRenewingActive = true;

    const scheduleNextRenewal = () => {
      if (!isRenewingActive) return;
      renewTimer = setTimeout(async () => {
        if (!isRenewingActive) return;
        renewTimer = undefined;
        inFlightRenewalPromise = (async () => {
          try {
            const updateResult = await prisma.jobQueue.updateMany({
              where: {
                id: job.id,
                queue_name: queueName,
                status: "PROCESSING",
                worker_id: workerId,
                attempts: job.attempts,
              },
              data: {
                locked_until: new Date(Date.now() + leaseDurationMs),
              },
            });

            if (updateResult.count === 0) {
              isRenewingActive = false;
              console.warn(
                `[JobQueueWorker] [${queueName}] Worker ${workerId} lost lease ownership for job ${job.id} (attempt ${job.attempts}); renewal stopped.`,
              );
              return;
            }
          } catch (err: unknown) {
            const errorClassification =
              err instanceof Error
                ? `Lease renewal database operation failed (${err.name || "Error"})`
                : "Lease renewal database operation failed";
            console.warn(
              `[JobQueueWorker] [${queueName}] Failed to renew lease for job ${job.id}: ${errorClassification}`,
            );
          } finally {
            inFlightRenewalPromise = null;
          }

          if (isRenewingActive) {
            scheduleNextRenewal();
          }
        })();
        await inFlightRenewalPromise;
      }, leaseRenewIntervalMs);
    };

    try {
      assertIngestionQueueJob(queueName, job.task_type, parsedPayload);
      if (!options?.claimAdapter) {
        scheduleNextRenewal();
      }
      await handler(parsedPayload);

      if (!options?.claimAdapter) {
        isRenewingActive = false;
        if (renewTimer !== undefined) {
          clearTimeout(renewTimer);
          renewTimer = undefined;
        }
        if (inFlightRenewalPromise) {
          try {
            await inFlightRenewalPromise;
          } catch {
            // Settle in-flight renewal
          }
        }

        const updateResult = await prisma.jobQueue.updateMany({
          where: {
            id: job.id,
            queue_name: queueName,
            status: "PROCESSING",
            worker_id: workerId,
            attempts: job.attempts,
          },
          data: {
            status: "COMPLETED",
            completed_at: new Date(),
            locked_until: null,
          },
        });

        if (updateResult.count === 0) {
          console.warn(
            `[JobQueueWorker] [${queueName}] Worker ${workerId} lost ownership of job ${job.id} during completion (attempt ${job.attempts}); skipping terminal write.`,
          );
        }
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[JobQueueWorker] [${queueName}] Job ${job.id} failed:`,
        errorMsg,
      );
      if (!options?.claimAdapter) {
        isRenewingActive = false;
        if (renewTimer !== undefined) {
          clearTimeout(renewTimer);
          renewTimer = undefined;
        }
        if (inFlightRenewalPromise) {
          try {
            await inFlightRenewalPromise;
          } catch {
            // Settle in-flight renewal
          }
        }

        await JobQueueService.handleJobFailure(
          job.id,
          err,
          job.attempts,
          job.max_attempts,
          queueName,
          workerId,
        );
      }
    } finally {
      isRenewingActive = false;
      if (renewTimer !== undefined) {
        clearTimeout(renewTimer);
        renewTimer = undefined;
      }
      if (inFlightRenewalPromise) {
        try {
          await inFlightRenewalPromise;
        } catch {
          // Guarantee cleanup
        }
      }
      if (domainLimiter instanceof DomainConcurrencyManager) {
        domainLimiter.release(targetDomain);
      }
    }

    return true;
  }

  private static async handleJobFailure(
    jobId: string,
    error: unknown,
    attempts: number,
    maxAttempts: number,
    queueName: string,
    workerId: string,
  ) {
    const isFinalFailure = attempts >= maxAttempts;
    const status = isFinalFailure ? "FAILED" : "PENDING";

    const backoffMs = Math.pow(2, attempts) * 1000;
    const runAt = new Date(Date.now() + backoffMs);
    const errorClassification =
      error instanceof Error
        ? `Job handler execution failed (${error.name || "Error"})`
        : "Job handler execution failed";

    const updateResult = await prisma.jobQueue.updateMany({
      where: {
        id: jobId,
        queue_name: queueName,
        status: "PROCESSING",
        worker_id: workerId,
        attempts,
      },
      data: {
        status,
        worker_id: isFinalFailure ? workerId : null,
        locked_until: null,
        error_log: errorClassification,
        run_at: isFinalFailure ? undefined : runAt,
      },
    });

    if (updateResult.count === 0) {
      console.warn(
        `[JobQueueWorker] [${queueName}] Worker ${workerId} lost ownership of job ${jobId} during failure handling; skipping state mutation.`,
      );
    }
  }

  /**
   * Stale Job Crash Recovery: Resets PROCESSING jobs locked by dead/crashed workers
   */
  public static async recoverStaleJobs(
    queueName: string,
    _staleTimeoutMs?: number,
  ): Promise<number> {
    const now = new Date();
    const staleJobs = await prisma.jobQueue.findMany({
      where: {
        queue_name: queueName,
        status: "PROCESSING",
        locked_until: { lt: now },
      },
      orderBy: { locked_until: "asc" },
      take: 100,
    });

    let recoveredCount = 0;

    for (const job of staleJobs) {
      const isFinal = job.attempts >= job.max_attempts;
      const backoffMs = Math.pow(2, job.attempts) * 1000;
      const nextRunAt = new Date(now.getTime() + backoffMs);

      const updateResult = await prisma.jobQueue.updateMany({
        where: {
          id: job.id,
          queue_name: queueName,
          status: "PROCESSING",
          worker_id: job.worker_id,
          attempts: job.attempts,
          locked_until: job.locked_until,
        },
        data: {
          status: isFinal ? "FAILED" : "PENDING",
          worker_id: isFinal ? job.worker_id : null,
          locked_until: null,
          run_at: isFinal ? undefined : nextRunAt,
          error_log: isFinal
            ? `Failed after max attempts (${job.attempts}/${job.max_attempts}) - stale worker recovery`
            : `Recovered from crashed/stale worker (${job.worker_id || "unknown"})`,
        },
      });

      recoveredCount += updateResult.count;
    }

    if (recoveredCount > 0) {
      console.log(
        `[JobQueueService] Crash Recovery: Recovered ${recoveredCount} stale jobs in '${queueName}'.`,
      );
    }

    return recoveredCount;
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
  ): WorkerHandle {
    let active = true;
    let pollTimer: NodeJS.Timeout | undefined;
    let currentLoopPromise: Promise<void> | null = null;
    let stopPromise: Promise<void> | null = null;

    const executeCycle = async () => {
      if (!active) return;

      try {
        let processed = true;
        while (processed && active) {
          processed = await this.processNextJob(queueName, handlers, options);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[JobQueueWorker] [${queueName}] Error in run loop:`, errorMsg);
      } finally {
        if (active) {
          pollTimer = setTimeout(runLoop, pollIntervalMs);
        }
      }
    };

    const runLoop = () => {
      if (!active) return;
      pollTimer = undefined;
      currentLoopPromise = executeCycle();
    };

    runLoop();

    return {
      stop: (): Promise<void> => {
        if (stopPromise) {
          return stopPromise;
        }

        console.log(`[JobQueueWorker] [${queueName}] Stopping worker...`);
        active = false;

        if (pollTimer !== undefined) {
          clearTimeout(pollTimer);
          pollTimer = undefined;
        }

        stopPromise = (async () => {
          if (currentLoopPromise) {
            try {
              await currentLoopPromise;
            } catch {
              // Gracefully handle any loop error during shutdown
            }
          }
        })();

        return stopPromise;
      },
    };
  }
}
