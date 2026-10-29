-- Additive migration. No data backfill, deletion or historical type conversion.
BEGIN;

-- CreateEnum
CREATE TYPE "ParameterDataType" AS ENUM ('NUMBER', 'TEXT', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "StepResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('ACTIVE', 'ABANDONED');

-- AlterTable
ALTER TABLE "Sample" ADD COLUMN     "batchId" UUID,
ADD COLUMN     "originStepId" UUID,
ADD COLUMN     "parentId" UUID,
ADD COLUMN     "status" "SampleStatus";

-- AlterTable
ALTER TABLE "FabricationStep" ADD COLUMN     "operatorId" UUID,
ADD COLUMN     "result" "StepResult",
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stepTypeId" UUID;

-- CreateTable
CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepType" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParameterDefinition" (
    "id" UUID NOT NULL,
    "stepTypeId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dataType" "ParameterDataType" NOT NULL,
    "unit" TEXT,
    "isRequired" BOOLEAN NOT NULL,

    CONSTRAINT "ParameterDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepParameterValue" (
    "id" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "numericValue" DECIMAL(65,30),
    "textValue" TEXT,
    "booleanValue" BOOLEAN,

    CONSTRAINT "StepParameterValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepCorrection" (
    "id" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "correctedById" UUID NOT NULL,
    "correctedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "beforeSnapshot" JSONB NOT NULL,
    "afterSnapshot" JSONB NOT NULL,

    CONSTRAINT "StepCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Batch_reference_key" ON "Batch"("reference");

-- CreateIndex
CREATE INDEX "Batch_createdById_idx" ON "Batch"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "StepType_code_key" ON "StepType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ParameterDefinition_stepTypeId_key_key" ON "ParameterDefinition"("stepTypeId", "key");

-- CreateIndex
CREATE INDEX "StepParameterValue_definitionId_numericValue_idx" ON "StepParameterValue"("definitionId", "numericValue");

-- CreateIndex
CREATE UNIQUE INDEX "StepParameterValue_stepId_definitionId_key" ON "StepParameterValue"("stepId", "definitionId");

-- CreateIndex
CREATE INDEX "StepCorrection_correctedById_correctedAt_idx" ON "StepCorrection"("correctedById", "correctedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StepCorrection_stepId_revision_key" ON "StepCorrection"("stepId", "revision");

-- CreateIndex
CREATE INDEX "Sample_batchId_idx" ON "Sample"("batchId");

-- CreateIndex
CREATE INDEX "Sample_parentId_idx" ON "Sample"("parentId");

-- CreateIndex
CREATE INDEX "Sample_originStepId_idx" ON "Sample"("originStepId");

-- CreateIndex
CREATE INDEX "Sample_status_idx" ON "Sample"("status");

-- CreateIndex
CREATE INDEX "FabricationStep_stepTypeId_performedAt_idx" ON "FabricationStep"("stepTypeId", "performedAt");

-- CreateIndex
CREATE INDEX "FabricationStep_operatorId_idx" ON "FabricationStep"("operatorId");

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Sample"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_originStepId_fkey" FOREIGN KEY ("originStepId") REFERENCES "FabricationStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricationStep" ADD CONSTRAINT "FabricationStep_stepTypeId_fkey" FOREIGN KEY ("stepTypeId") REFERENCES "StepType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FabricationStep" ADD CONSTRAINT "FabricationStep_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParameterDefinition" ADD CONSTRAINT "ParameterDefinition_stepTypeId_fkey" FOREIGN KEY ("stepTypeId") REFERENCES "StepType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepParameterValue" ADD CONSTRAINT "StepParameterValue_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FabricationStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepParameterValue" ADD CONSTRAINT "StepParameterValue_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ParameterDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepCorrection" ADD CONSTRAINT "StepCorrection_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "FabricationStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepCorrection" ADD CONSTRAINT "StepCorrection_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints are maintained in SQL because Prisma does not express them.
-- False, zero and an empty string are values; absence is represented by NULL.
ALTER TABLE "StepParameterValue"
    ADD CONSTRAINT "StepParameterValue_exactly_one_value_check"
        CHECK (num_nonnulls("numericValue", "textValue", "booleanValue") = 1),
    ADD CONSTRAINT "StepParameterValue_finite_numeric_check"
        CHECK ("numericValue" IS NULL OR "numericValue" NOT IN
            ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric));

ALTER TABLE "Sample"
    ADD CONSTRAINT "Sample_parent_not_self_check"
        CHECK ("parentId" IS NULL OR "parentId" <> "id"),
    ADD CONSTRAINT "Sample_origin_requires_parent_check"
        CHECK ("originStepId" IS NULL OR "parentId" IS NOT NULL);

ALTER TABLE "FabricationStep"
    ADD CONSTRAINT "FabricationStep_revision_nonnegative_check"
        CHECK ("revision" >= 0);

ALTER TABLE "StepCorrection"
    ADD CONSTRAINT "StepCorrection_revision_positive_check"
        CHECK ("revision" > 0),
    ADD CONSTRAINT "StepCorrection_reason_not_blank_check"
        CHECK ("reason" ~ '[^[:space:]]'),
    ADD CONSTRAINT "StepCorrection_snapshot_objects_check"
        CHECK (jsonb_typeof("beforeSnapshot") = 'object'
            AND jsonb_typeof("afterSnapshot") = 'object');

COMMIT;
