/*
  Warnings:

  - The values [HIDDEN] on the enum `SubmissionStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `blocked` on the `Guest` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'HIDDEN');

-- AlterEnum
BEGIN;
CREATE TYPE "SubmissionStatus_new" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');
ALTER TABLE "public"."Submission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Submission" ALTER COLUMN "status" TYPE "SubmissionStatus_new" USING ("status"::text::"SubmissionStatus_new");
ALTER TYPE "SubmissionStatus" RENAME TO "SubmissionStatus_old";
ALTER TYPE "SubmissionStatus_new" RENAME TO "SubmissionStatus";
DROP TYPE "public"."SubmissionStatus_old";
ALTER TABLE "Submission" ALTER COLUMN "status" SET DEFAULT 'UPLOADING';
COMMIT;

-- AlterTable
ALTER TABLE "Guest" DROP COLUMN "blocked",
ADD COLUMN     "blockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Submission" ADD COLUMN     "moderationStatus" "ModerationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL';
