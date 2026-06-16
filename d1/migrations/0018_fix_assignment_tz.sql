-- One-time data fix: assignment open/due times were stored 8 hours late.
--
-- Before #73, the publish form's <input type="datetime-local"> sent a *local*
-- wall-clock string (e.g. teacher in China picked 09:00), which the UTC Cloudflare
-- server read as 09:00 UTC = 17:00 China — so students saw assignments "not open
-- yet". This shifts those pre-fix rows back 8 hours (UTC+8).
--
-- Notes:
--  * Prisma's D1 adapter stores DateTime as TEXT "YYYY-MM-DDTHH:MM:SS.SSS+00:00"
--    (toISOString().replace('Z','+00:00')); strftime(...)||'+00:00' reproduces that
--    exact format so reads stay correct (plain datetime() would drop the offset).
--  * The updatedAt guard leaves any assignment created/edited AFTER the fix went
--    live (~08:01 UTC) untouched — those already carry the correct UTC instant.
--  * Only non-null times; review assignments (no dates) are unaffected.
--  * Verified the shift + exact-format round-trip with better-sqlite3 before shipping.

UPDATE "Assignment"
SET "openAt" = strftime('%Y-%m-%dT%H:%M:%f', datetime("openAt", '-8 hours')) || '+00:00'
WHERE "openAt" IS NOT NULL
  AND "updatedAt" < '2026-06-16T08:02:00.000+00:00';

UPDATE "Assignment"
SET "dueAt" = strftime('%Y-%m-%dT%H:%M:%f', datetime("dueAt", '-8 hours')) || '+00:00'
WHERE "dueAt" IS NOT NULL
  AND "updatedAt" < '2026-06-16T08:02:00.000+00:00';
