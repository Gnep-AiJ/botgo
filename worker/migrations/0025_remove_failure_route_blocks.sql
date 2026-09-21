-- An interrupted request is audit history, never a shared upstream outage.
-- Do not alter explicit administrative route switches or unrelated health reasons.
DELETE FROM agent_route_health WHERE reason IN ('abandoned','usage_review');
