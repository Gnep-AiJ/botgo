-- Keep the account-wide concurrent reservation and balance guards. A missing
-- usage report on an older channel must not disable a verified Agent channel.
-- Historical reviews and financial account blocks remain untouched.
DROP TRIGGER agent_request_limits;
CREATE TRIGGER agent_request_limits BEFORE INSERT ON metered_requests
WHEN NEW.channel='desktop_opencode' BEGIN
 SELECT RAISE(ABORT,'AGENT_CONCURRENCY_LIMIT') WHERE
  (SELECT COUNT(*) FROM metered_requests WHERE account_id=NEW.account_id AND state='reserved') >= 8;
 SELECT RAISE(ABORT,'AGENT_REVIEW_LIMIT') WHERE
  (SELECT COUNT(*) FROM metered_requests WHERE account_id=NEW.account_id
   AND channel=NEW.channel AND state='review' AND reviewed_at IS NULL) >= 3;
END;
