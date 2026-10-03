-- CreateEnum
CREATE TYPE "signature_scheme" AS ENUM ('none', 'generic_hmac', 'github');

-- CreateTable
CREATE TABLE "endpoint" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "signature_scheme" "signature_scheme" NOT NULL,
    "secret_encrypted" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destination" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "event_types" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "body" BYTEA NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "endpoint_slug_key" ON "endpoint"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "event_endpoint_id_idempotency_key_key" ON "event"("endpoint_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "destination" ADD CONSTRAINT "destination_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "endpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
