-- Enforce one row per (set, order) / (phase, order) so display order + per-sentence score
-- mapping are deterministic. Verified 0 duplicates in prod (2026-07-05) before adding, so
-- these succeed. Sentence.phaseId is nullable and SQLite treats NULL as distinct in unique
-- indexes → legacy phase-less sentences never collide (equivalent to a partial index).
CREATE UNIQUE INDEX "Chunk_chunkSetId_order_key" ON "Chunk"("chunkSetId", "order");
CREATE UNIQUE INDEX "Sentence_phaseId_order_key" ON "Sentence"("phaseId", "order");
