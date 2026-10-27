CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkerHeartbeat_checkedAt_idx" ON "WorkerHeartbeat"("checkedAt");
