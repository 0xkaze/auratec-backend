-- Etapa 1: adicionar os novos valores 'Outros' e 'Cubos' ao enum.
-- Postgres exige que esses valores sejam commitados antes de serem
-- usados; por isso ficam em migration separada do resto (drizzle
-- envolve cada arquivo de migration em sua própria transação).
ALTER TYPE "public"."piece_category" ADD VALUE IF NOT EXISTS 'Outros';
--> statement-breakpoint
ALTER TYPE "public"."piece_category" ADD VALUE IF NOT EXISTS 'Cubos';
