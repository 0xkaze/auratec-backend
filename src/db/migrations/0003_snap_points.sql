-- Refator: snap_pose → input_pose (renomeada). output_snap (single)
-- → snap_points (array de N pontos, cada um com connectors específicos
-- por categoria/peça).
--
-- Migração de dados: cumeeira (que já tinha output_snap) vira um
-- snap_point único id='main' com um connector pra categoria 'Torres'
-- (mantém o comportamento atual: torre encaixa na ponta).

-- 1. Rename snap_pose → input_pose (sem perder dados)
ALTER TABLE "piece_catalog" RENAME COLUMN "snap_pose" TO "input_pose";
--> statement-breakpoint

-- 2. Cria snap_points (vazio por default)
ALTER TABLE "piece_catalog" ADD COLUMN "snap_points" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint

-- 3. Migra output_snap (legado) → snap_points com 1 entrada e Torres como connector default
UPDATE "piece_catalog"
SET "snap_points" = jsonb_build_array(
  jsonb_build_object(
    'id', 'main',
    'label', 'Conexão principal',
    'position', "output_snap"->'position',
    'rotation', "output_snap"->'rotation',
    'connectors', jsonb_build_array(
      jsonb_build_object(
        'match', jsonb_build_object('type', 'category', 'category', 'Torres'),
        'offset', jsonb_build_object(
          'position', jsonb_build_array(0, 0, 0),
          'rotation', jsonb_build_array(0, 0, 0)
        )
      )
    )
  )
)
WHERE "output_snap" IS NOT NULL;
--> statement-breakpoint

-- 4. Dropa coluna output_snap (substituída por snap_points)
ALTER TABLE "piece_catalog" DROP COLUMN "output_snap";
