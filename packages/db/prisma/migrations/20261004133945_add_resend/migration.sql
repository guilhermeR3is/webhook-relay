-- CreateTable
CREATE TABLE "resend" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts_before" INTEGER NOT NULL,

    CONSTRAINT "resend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resend_delivery_id_requested_at_idx" ON "resend"("delivery_id", "requested_at");

-- AddForeignKey
ALTER TABLE "resend" ADD CONSTRAINT "resend_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
