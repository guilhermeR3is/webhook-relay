-- CreateEnum
CREATE TYPE "demo_quota_kind" AS ENUM ('ip', 'global');

-- CreateTable
CREATE TABLE "demo_quota" (
    "id" UUID NOT NULL,
    "kind" "demo_quota_kind" NOT NULL,
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "demo_quota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demo_quota_kind_key_window_start_key" ON "demo_quota"("kind", "key", "window_start");

-- CreateIndex
CREATE INDEX "event_endpoint_id_received_at_id_idx" ON "event"("endpoint_id", "received_at" DESC, "id" DESC);
