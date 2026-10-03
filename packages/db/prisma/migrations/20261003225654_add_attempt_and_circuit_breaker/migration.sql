-- CreateEnum
CREATE TYPE "circuit_state" AS ENUM ('closed', 'open', 'half_open');

-- AlterTable
ALTER TABLE "delivery" ALTER COLUMN "next_attempt_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "destination" ADD COLUMN     "circuit_opened_at" TIMESTAMPTZ(3),
ADD COLUMN     "circuit_state" "circuit_state" NOT NULL DEFAULT 'closed',
ADD COLUMN     "consecutive_failures" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "attempt" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "http_status" INTEGER,
    "response_snippet" TEXT,
    "error" TEXT,

    CONSTRAINT "attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attempt_delivery_id_started_at_idx" ON "attempt"("delivery_id", "started_at");

-- AddForeignKey
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
