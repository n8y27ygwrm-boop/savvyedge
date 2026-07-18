import { prisma } from "@savvyedge/database";

export class JobQueueService {
  /**
   * Enqueue a job into the database
   */
  public static async enqueue(
    queueName: string,
    taskType: string,
    payload: Record<string, any>,
    options?: { runAt?: Date; maxAttempts?: number }
  ) {
    return prisma.jobQueue.create({
      data: {
        queue_name: queueName,
        task_type: taskType,
        payload: JSON.stringify(payload),
        status: "PENDING",
        attempts: 0,
        max_attempts: options?.maxAttempts ?? 3,
        run_at: options?.runAt ?? new Date(),
      },
    });
  }

  /**
   * Process the next available job in a queue
   */
  public static async processNextJob(
    queueName: string,
    handlers: Record<string, (payload: any) => Promise<any>>
  ): Promise<boolean> {
    const now = new Date();

    // 1. Transactionally find and lock one pending job
    const job = await prisma.$transaction(async (tx) => {
      // Find a job that is PENDING, due to run, and not locked
      const candidate = await tx.jobQueue.findFirst({
        where: {
          queue_name: queueName,
          status: "PENDING",
          run_at: { lte: now },
          OR: [
            { locked_until: null },
            { locked_until: { lt: now } },
          ],
        },
        orderBy: { run_at: "asc" },
      });

      if (!candidate) {
        return null;
      }

      // Lock the job for 2 minutes to prevent other workers from picking it up
      const lockedUntil = new Date(Date.now() + 2 * 60 * 1000);
      return tx.jobQueue.update({
        where: { id: candidate.id },
        data: {
          status: "PROCESSING",
          locked_until: lockedUntil,
          attempts: { increment: 1 },
        },
      });
    });

    if (!job) {
      return false; // No jobs processed
    }

    console.log(`[JobQueueWorker] [${queueName}] Processing job ${job.id} (Type: ${job.task_type}, Attempt: ${job.attempts}/${job.max_attempts})`);

    const handler = handlers[job.task_type];
    if (!handler) {
      const errorMsg = `No handler registered for task type: ${job.task_type}`;
      console.error(`[JobQueueWorker] [${queueName}] ${errorMsg}`);
      await this.handleJobFailure(job.id, new Error(errorMsg), job.attempts, job.max_attempts);
      return true;
    }

    try {
      const parsedPayload = JSON.parse(job.payload);
      // Execute handler
      await handler(parsedPayload);

      // Mark completed
      await prisma.jobQueue.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
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
    
    // Exponential backoff: 2^attempts seconds (e.g. 2s, 4s, 8s, 16s...)
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
   * Start polling loop in worker mode
   */
  public static startWorker(
    queueName: string,
    handlers: Record<string, (payload: any) => Promise<any>>,
    pollIntervalMs: number = 1000
  ) {
    let active = true;

    const runLoop = async () => {
      if (!active) return;
      
      try {
        let processed = true;
        // Keep processing jobs until queue is empty for this loop
        while (processed && active) {
          processed = await this.processNextJob(queueName, handlers);
        }
      } catch (err: any) {
        console.error(`[JobQueueWorker] [${queueName}] Error in run loop:`, err.message);
      } finally {
        if (active) {
          setTimeout(runLoop, pollIntervalMs);
        }
      }
    };

    // Kick off loop
    runLoop();

    return {
      stop: () => {
        console.log(`[JobQueueWorker] [${queueName}] Stopping worker...`);
        active = false;
      },
    };
  }
}
