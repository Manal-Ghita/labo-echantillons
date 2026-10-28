-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RESEARCHER');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "creatorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FabricationStep" (
    "id" UUID NOT NULL,
    "sampleId" UUID NOT NULL,
    "operationName" TEXT NOT NULL,
    "performedAt" TIMESTAMPTZ(3) NOT NULL,
    "parameters" TEXT,
    "observations" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FabricationStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_reference_key" ON "Sample"("reference");

-- CreateIndex
CREATE INDEX "Sample_creatorId_idx" ON "Sample"("creatorId");

-- CreateIndex
CREATE INDEX "FabricationStep_sampleId_performedAt_idx" ON "FabricationStep"("sampleId", "performedAt");

-- CreateIndex
CREATE INDEX "FabricationStep_recordedById_idx" ON "FabricationStep"("recordedById");

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricationStep" ADD CONSTRAINT "FabricationStep_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricationStep" ADD CONSTRAINT "FabricationStep_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
