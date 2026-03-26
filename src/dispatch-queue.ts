import { createClient } from "redis";
import type { CaseRepository } from "./case-repository";

type RedisQueueClient = ReturnType<typeof createClient>;

export type DispatchQueueStage = "inference" | "delivery";

export interface DispatchQueueJob {
  queueEntryId: string;
  caseId: string;
  stage: DispatchQueueStage;
  attempt: number;
  attemptId: string;
  enqueuedAt: string;
  retryEligibleAt: string;
}

export interface DispatchQueueClaimInput {
  stage: DispatchQueueStage;
  workerId: string;
  leaseSeconds: number;
  now: string;
}

export interface DispatchQueueConfig {
  provider: "local" | "redis";
  redisUrl?: string;
  keyPrefix: string;
}

export interface DispatchQueueAdapter {
  enqueue(job: DispatchQueueJob): Promise<void>;
  claim(input: DispatchQueueClaimInput): Promise<DispatchQueueJob | null>;
}

export function createDefaultDispatchQueueConfig(): DispatchQueueConfig {
  return {
    provider: "local",
    redisUrl: "redis://127.0.0.1:6379",
    keyPrefix: "mri-second-opinion:queue",
  };
}

export function createDispatchQueueFromConfig(
  config: DispatchQueueConfig,
  repository: CaseRepository,
): DispatchQueueAdapter {
  if (config.provider === "redis") {
    return new RedisDispatchQueueAdapter(config);
  }

  return createLocalDispatchQueueAdapter(repository);
}

export function createLocalDispatchQueueAdapter(repository: CaseRepository): DispatchQueueAdapter {
  return new LocalDispatchQueueAdapter(repository);
}

class LocalDispatchQueueAdapter implements DispatchQueueAdapter {
  constructor(private readonly repository: CaseRepository) {}

  async enqueue(_job: DispatchQueueJob) {}

  async claim({ stage, now }: DispatchQueueClaimInput): Promise<DispatchQueueJob | null> {
    const candidate = (await this.repository.list())
      .flatMap((caseRecord) =>
        caseRecord.workflowQueue
          .filter((entry) => entry.stage === stage && entry.status === "queued")
          .map((entry) => ({
            queueEntryId: entry.queueEntryId,
            caseId: caseRecord.caseId,
            stage: entry.stage,
            attempt: entry.attempt,
            attemptId: entry.attemptId,
            enqueuedAt: entry.enqueuedAt,
            retryEligibleAt: entry.retryEligibleAt,
          })),
      )
      .filter((entry) => entry.retryEligibleAt <= now)
      .sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt))[0];

    return candidate ?? null;
  }
}

class RedisDispatchQueueAdapter implements DispatchQueueAdapter {
  private clientPromise: Promise<RedisQueueClient> | undefined;

  constructor(private readonly config: DispatchQueueConfig) {}

  async enqueue(job: DispatchQueueJob) {
    const client = await this.getClient();
    await client.rPush(this.queueKey(job.stage), JSON.stringify(job));
  }

  async claim({ stage }: DispatchQueueClaimInput): Promise<DispatchQueueJob | null> {
    const client = await this.getClient();
    const rawJob = await client.lPop(this.queueKey(stage));

    if (!rawJob) {
      return null;
    }

    return parseDispatchQueueJob(rawJob, stage);
  }

  private queueKey(stage: DispatchQueueStage) {
    return `${this.config.keyPrefix}:${stage}`;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = this.connectClient();
    }

    return this.clientPromise;
  }

  private async connectClient() {
    const client = createClient({ url: this.config.redisUrl });
    client.on("error", (error) => {
      process.stderr.write(`[mri-second-opinion] redis queue error: ${String(error)}\n`);
    });
    await client.connect();
    return client;
  }
}

function parseDispatchQueueJob(rawJob: string, expectedStage: DispatchQueueStage): DispatchQueueJob {
  const parsed = JSON.parse(rawJob) as Partial<DispatchQueueJob>;

  if (
    typeof parsed.queueEntryId !== "string" ||
    typeof parsed.caseId !== "string" ||
    (parsed.stage !== "inference" && parsed.stage !== "delivery") ||
    parsed.stage !== expectedStage ||
    typeof parsed.attempt !== "number" ||
    typeof parsed.attemptId !== "string" ||
    typeof parsed.enqueuedAt !== "string" ||
    typeof parsed.retryEligibleAt !== "string"
  ) {
    throw new Error(`Invalid dispatch queue job payload for stage ${expectedStage}`);
  }

  return {
    queueEntryId: parsed.queueEntryId,
    caseId: parsed.caseId,
    stage: parsed.stage,
    attempt: parsed.attempt,
    attemptId: parsed.attemptId,
    enqueuedAt: parsed.enqueuedAt,
    retryEligibleAt: parsed.retryEligibleAt,
  };
}