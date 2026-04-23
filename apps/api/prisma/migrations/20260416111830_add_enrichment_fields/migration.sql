-- AlterTable
ALTER TABLE "EmailVerificationResult" ADD COLUMN     "gravatarFound" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hibpBreachCount" INTEGER NOT NULL DEFAULT 0;
