-- Failed or unmetered requests are retained for audit and automatically refunded.
-- Historical failures must never block a later request.
DROP TRIGGER agent_request_limits;
CREATE TRIGGER agent_request_limits BEFORE INSERT ON metered_requests
WHEN NEW.channel='desktop_opencode' BEGIN
 SELECT RAISE(ABORT,'AGENT_CONCURRENCY_LIMIT') WHERE
  (SELECT COUNT(*) FROM metered_requests WHERE account_id=NEW.account_id AND state='reserved') >= 8;
END;

DROP TRIGGER metering_settle;
CREATE TRIGGER metering_settle AFTER UPDATE OF state ON metered_requests
WHEN OLD.state='reserved' AND NEW.state<>'reserved' BEGIN
 UPDATE metered_requests SET charged_micros=MIN(NEW.cost_micros,MAX(0,(SELECT credit_balance*10000+credit_remainder_micros-billing_reserved_micros+OLD.reserved_micros FROM accounts WHERE id=NEW.account_id))) WHERE id=NEW.id;
 UPDATE accounts SET
  billing_blocked=0,
  credit_remainder_micros=(credit_balance*10000+credit_remainder_micros-(SELECT charged_micros FROM metered_requests WHERE id=NEW.id))%10000,
  credit_balance=(credit_balance*10000+credit_remainder_micros-(SELECT charged_micros FROM metered_requests WHERE id=NEW.id))/10000,
  billing_reserved_micros=billing_reserved_micros-OLD.reserved_micros
 WHERE id=NEW.account_id;
 UPDATE metered_requests SET
  state=NEW.state,
  review_reason=CASE WHEN NEW.state='completed' AND NEW.cost_micros>charged_micros THEN 'insufficient_balance' ELSE NEW.review_reason END,
  review_required=0,
  settled_at=CURRENT_TIMESTAMP
 WHERE id=NEW.id;
END;

UPDATE metered_requests SET
 state=CASE WHEN usage_json IS NULL THEN 'refunded' ELSE 'completed' END,
 review_required=0,
 reviewed_at=COALESCE(reviewed_at,CURRENT_TIMESTAMP),
 review_note=COALESCE(review_note,'系统自动处理：失败或缺少有效用量，本次不再要求人工核对。')
WHERE state='review';

UPDATE accounts SET billing_blocked=0 WHERE billing_blocked<>0;
DELETE FROM agent_route_health WHERE reason='usage_review';
