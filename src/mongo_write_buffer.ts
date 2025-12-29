type InsertManyOptions = {
  ordered?: boolean;
};

type InsertManyCollection = {
  insertMany: (docs: unknown[], options?: InsertManyOptions) => Promise<unknown>;
};

type WriteBufferConfig = {
  txCollection: InsertManyCollection;
  jobCollection: InsertManyCollection;
  batchSize: number;
  flushMs: number;
  fatalTxError: boolean;
  fatalJobError: boolean;
};

function clampPositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function isOnlyDuplicateKeyErrors(error: unknown): boolean {
  const maybe = error as any;
  if (!maybe) return false;
  if (maybe.code === 11000) return true;
  const writeErrors = maybe?.writeErrors;
  if (!Array.isArray(writeErrors) || writeErrors.length === 0) return false;
  return writeErrors.every((we) => we?.code === 11000);
}

export class MongoWriteBuffer {
  private readonly txCollection: InsertManyCollection;
  private readonly jobCollection: InsertManyCollection;
  private readonly batchSize: number;
  private readonly flushMs: number;
  private readonly fatalTxError: boolean;
  private readonly fatalJobError: boolean;

  private txBuffer: unknown[] = [];
  private jobBuffer: unknown[] = [];

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> | null = null;

  constructor(config: WriteBufferConfig) {
    this.txCollection = config.txCollection;
    this.jobCollection = config.jobCollection;
    this.batchSize = clampPositiveInt(config.batchSize, 200);
    this.flushMs = clampPositiveInt(config.flushMs, 50);
    this.fatalTxError = config.fatalTxError;
    this.fatalJobError = config.fatalJobError;
  }

  enqueueTx(doc: unknown) {
    this.txBuffer.push(doc);
    if (this.txBuffer.length >= this.batchSize) {
      void this.flush("tx_batch_full");
      return;
    }
    this.schedule();
  }

  enqueueJob(doc: unknown) {
    this.jobBuffer.push(doc);
    if (this.jobBuffer.length >= this.batchSize) {
      void this.flush("job_batch_full");
      return;
    }
    this.schedule();
  }

  async flush(reason = "manual") {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.flushInFlight) {
      await this.flushInFlight;
      if (this.txBuffer.length === 0 && this.jobBuffer.length === 0) return;
    }

    this.flushInFlight = this.flushInternal(reason)
      .catch((err) => {
        console.error(`[mongo-batch] flush failed (${reason})`, err);
      })
      .finally(() => {
        this.flushInFlight = null;
      });

    await this.flushInFlight;
  }

  private schedule() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush("timer");
    }, this.flushMs);
  }

  private async flushInternal(reason: string) {
    while (this.txBuffer.length > 0 || this.jobBuffer.length > 0) {
      const txBatch = this.txBuffer.splice(0, this.batchSize);
      if (txBatch.length > 0) {
        try {
          await this.txCollection.insertMany(txBatch, { ordered: false });
        } catch (err) {
          console.error(`[mongo-batch] tx insertMany failed (${reason})`, err);
          if (this.fatalTxError) {
            console.error("[mongo-batch] fatal: tx store failed, process will terminate");
            process.exit(1);
          }
        }
      }

      const jobBatch = this.jobBuffer.splice(0, this.batchSize);
      if (jobBatch.length > 0) {
        try {
          await this.jobCollection.insertMany(jobBatch, { ordered: false });
        } catch (err) {
          if (isOnlyDuplicateKeyErrors(err)) {
            continue;
          }
          console.error(`[mongo-batch] job insertMany failed (${reason})`, err);
          if (this.fatalJobError) {
            console.error("[mongo-batch] fatal: job store failed, process will terminate");
            process.exit(1);
          }
        }
      }
    }
  }
}

