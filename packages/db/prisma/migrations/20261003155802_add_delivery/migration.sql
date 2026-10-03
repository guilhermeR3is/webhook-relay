-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'in_progress', 'succeeded', 'dead');

-- CreateTable
CREATE TABLE "delivery" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "succeeded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_status_next_attempt_at_idx" ON "delivery"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_event_id_destination_id_key" ON "delivery"("event_id", "destination_id");

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery" ADD CONSTRAINT "delivery_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
