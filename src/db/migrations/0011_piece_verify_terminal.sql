-- Bancada de Encaixes: dois flags aditivos por peça.
--
-- is_terminal: peça que NÃO encaixa em nada de propósito (vs. config pela
--   metade). Distingue "terminal intencional" de "ainda não configurada".
-- verified_at: timestamp do último "Testar montagem" que passou. O selo
--   verde do catálogo passa a ler isto (verde = testado e funciona), em vez
--   da heurística antiga. Qualquer edição limpa (front envia null no save).
--
-- O runtime IGNORA ambas — são só pra status/UX do admin.

ALTER TABLE "piece_catalog" ADD COLUMN "is_terminal" boolean;
--> statement-breakpoint
ALTER TABLE "piece_catalog" ADD COLUMN "verified_at" timestamp with time zone;
