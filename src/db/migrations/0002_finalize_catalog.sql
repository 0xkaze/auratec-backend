-- Etapa 2: roda DEPOIS de 0001 commitar 'Outros' e 'Cubos' no enum.
-- Migra dados existentes (Acessórios → Outros), recria o enum sem
-- 'Acessórios', adiciona colunas de snap config e dropa piece_configs.

-- Migra todas as linhas que ainda estão como 'Acessórios' pra 'Outros'
UPDATE "piece_catalog" SET "category" = 'Outros' WHERE "category" = 'Acessórios';
--> statement-breakpoint

-- CUBO_5F e SLEEVE têm lógica própria de snap por face (categoria Cubos)
UPDATE "piece_catalog" SET "category" = 'Cubos'
  WHERE "type" IN ('CUBO_5F', 'SLEEVE_AL_P30_P50');
--> statement-breakpoint

-- Recria o enum sem 'Acessórios'. ALTER TYPE não suporta DROP VALUE,
-- então fazemos rename + recreate + cast da coluna.
ALTER TYPE "public"."piece_category" RENAME TO "piece_category_old";
--> statement-breakpoint
CREATE TYPE "public"."piece_category" AS ENUM('Torres', 'Bases', 'Cubos', 'Outros');
--> statement-breakpoint
ALTER TABLE "piece_catalog"
  ALTER COLUMN "category" TYPE "public"."piece_category"
  USING "category"::text::"public"."piece_category";
--> statement-breakpoint
DROP TYPE "public"."piece_category_old";
--> statement-breakpoint

-- Colunas de snap config (preenchidas pelo admin no Configurador, só
-- relevantes pra category='Outros'). NULL = sem config.
ALTER TABLE "piece_catalog" ADD COLUMN IF NOT EXISTS "snap_pose" jsonb;
--> statement-breakpoint
ALTER TABLE "piece_catalog" ADD COLUMN IF NOT EXISTS "output_snap" jsonb;
--> statement-breakpoint

-- piece_configs era per-user. Agora é global na pieça (colunas acima),
-- configurada pelo admin uma vez. Dropa a tabela antiga.
DROP TABLE IF EXISTS "piece_configs";
