-- Configurador em wizard: 2 campos novos por peça.
--
-- spawn_pose: pose de repouso da peça quando colocada sozinha (Step 1).
--   jsonb { position:[x,y,z], rotation:[x,y,z] } ou null = identidade.
-- attachable_to: lista de alvos em que ESTA peça pode encaixar (Step 2).
--   array de tokens: 'Torres' | 'Bases' | 'Cubos' | 'Outros' | 'piece:<TYPE>'.

ALTER TABLE "piece_catalog" ADD COLUMN "spawn_pose" jsonb;
ALTER TABLE "piece_catalog" ADD COLUMN "attachable_to" jsonb NOT NULL DEFAULT '[]'::jsonb;
