-- A moved occurrence needs its new start; a skipped one has no times; end never precedes start.
ALTER TABLE "EventException" ADD CONSTRAINT "EventException_times_match_kind"
    CHECK (
        ("kind" = 'MOVED' AND "startAt" IS NOT NULL)
        OR ("kind" = 'SKIPPED' AND "startAt" IS NULL AND "endAt" IS NULL)
    );
ALTER TABLE "EventException" ADD CONSTRAINT "EventException_end_after_start"
    CHECK ("endAt" IS NULL OR "endAt" >= "startAt");
