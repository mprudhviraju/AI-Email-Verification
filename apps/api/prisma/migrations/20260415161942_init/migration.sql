-- CreateEnum
CREATE TYPE "EmailVerificationStatus" AS ENUM ('VALID', 'RISKY', 'INVALID', 'UNKNOWN', 'CATCH_ALL', 'DISPOSABLE', 'ROLE_BASED');

-- CreateEnum
CREATE TYPE "VerificationConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('VERIFY_EMAIL_BATCH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "label" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "riskyCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "jobId" TEXT,

    CONSTRAINT "EmailVerificationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationResult" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "syntaxValid" BOOLEAN NOT NULL DEFAULT false,
    "isDisposable" BOOLEAN NOT NULL DEFAULT false,
    "isRoleBased" BOOLEAN NOT NULL DEFAULT false,
    "isUnicode" BOOLEAN NOT NULL DEFAULT false,
    "mxFound" BOOLEAN NOT NULL DEFAULT false,
    "mxHost" TEXT,
    "mxFallback" BOOLEAN NOT NULL DEFAULT false,
    "dnsTtl" INTEGER,
    "dnsResponseMs" INTEGER,
    "smtpReachable" BOOLEAN NOT NULL DEFAULT false,
    "smtpCode" INTEGER,
    "smtpMessage" TEXT,
    "isCatchAll" BOOLEAN NOT NULL DEFAULT false,
    "isHoneypot" BOOLEAN NOT NULL DEFAULT false,
    "status" "EmailVerificationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "score" INTEGER NOT NULL DEFAULT 0,
    "confidence" "VerificationConfidence" NOT NULL DEFAULT 'LOW',
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseTimeMs" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "EmailVerificationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationBatch_jobId_key" ON "EmailVerificationBatch"("jobId");

-- CreateIndex
CREATE INDEX "EmailVerificationBatch_userId_idx" ON "EmailVerificationBatch"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationBatch_createdAt_idx" ON "EmailVerificationBatch"("createdAt");

-- CreateIndex
CREATE INDEX "EmailVerificationResult_batchId_idx" ON "EmailVerificationResult"("batchId");

-- CreateIndex
CREATE INDEX "EmailVerificationResult_email_idx" ON "EmailVerificationResult"("email");

-- CreateIndex
CREATE INDEX "EmailVerificationResult_domain_idx" ON "EmailVerificationResult"("domain");

-- CreateIndex
CREATE INDEX "EmailVerificationResult_status_idx" ON "EmailVerificationResult"("status");

-- CreateIndex
CREATE INDEX "EmailVerificationResult_verifiedAt_idx" ON "EmailVerificationResult"("verifiedAt");

-- AddForeignKey
ALTER TABLE "EmailVerificationBatch" ADD CONSTRAINT "EmailVerificationBatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationBatch" ADD CONSTRAINT "EmailVerificationBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationResult" ADD CONSTRAINT "EmailVerificationResult_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EmailVerificationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
