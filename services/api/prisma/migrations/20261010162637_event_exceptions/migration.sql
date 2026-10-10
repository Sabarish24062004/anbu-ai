-- CreateEnum
CREATE TYPE "EventExceptionKind" AS ENUM ('SKIPPED', 'MOVED');

-- CreateTable
CREATE TABLE "EventException" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "originalStart" TIMESTAMPTZ(3) NOT NULL,
    "kind" "EventExceptionKind" NOT NULL,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EventException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventException_userId_startAt_idx" ON "EventException"("userId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventException_eventId_originalStart_key" ON "EventException"("eventId", "originalStart");

-- AddForeignKey
ALTER TABLE "EventException" ADD CONSTRAINT "EventException_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventException" ADD CONSTRAINT "EventException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
