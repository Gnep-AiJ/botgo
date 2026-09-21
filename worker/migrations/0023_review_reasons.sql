-- Separate auditable cancellations from records that require manual billing review.
ALTER TABLE metered_requests ADD COLUMN review_reason TEXT;
ALTER TABLE metered_requests ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1));

-- Existing unresolved reviews predate reason tracking. Keep them visible until
-- an administrator classifies them; do not infer that they were cancellations.
UPDATE metered_requests
SET review_required=1,review_reason='legacy_unclassified'
WHERE state='review' AND reviewed_at IS NULL;

DROP TRIGGER agent_request_limits;
CREATE TRIGGER agent_request_limits BEFORE INSERT ON metered_requests
WHEN NEW.channel='desktop_opencode' BEGIN
 SELECT RAISE(ABORT,'AGENT_CONCURRENCY_LIMIT') WHERE
  (SELECT COUNT(*) FROM metered_requests WHERE account_id=NEW.account_id AND state='reserved') >= 8;
 SELECT RAISE(ABORT,'AGENT_REVIEW_LIMIT') WHERE
  (SELECT COUNT(*) FROM metered_requests WHERE account_id=NEW.account_id
   AND channel=NEW.channel AND state='review' AND reviewed_at IS NULL AND review_required=1) >= 3;
END;

CREATE INDEX IF NOT EXISTS metered_pending_review
ON metered_requests(review_required,reviewed_at,created_at);
