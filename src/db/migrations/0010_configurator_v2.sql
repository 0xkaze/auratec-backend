-- Configurador v2: modelo bidirecional por slots.
--
-- Lado GUEST (como ESTA peça encaixa num host):
--   dock_above: âncora quando a peça entra EM CIMA de um host (snap top).
--   dock_below: âncora quando a peça entra EMBAIXO de um host (snap bottom).
--   (attachable_to continua igual.)
-- Lado HOST (como cada alvo encaixa NESTA peça):
--   host_slots: array de { target, enabled, direction, pose }.
--
-- Substitui input_pose + snap_points (connectors/offset) do modelo antigo.
-- Reconfiguração do zero — sem migração de dados.

ALTER TABLE "piece_catalog" ADD COLUMN "dock_above" jsonb;
--> statement-breakpoint
ALTER TABLE "piece_catalog" ADD COLUMN "dock_below" jsonb;
--> statement-breakpoint
ALTER TABLE "piece_catalog" ADD COLUMN "host_slots" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "piece_catalog" DROP COLUMN IF EXISTS "input_pose";
--> statement-breakpoint
ALTER TABLE "piece_catalog" DROP COLUMN IF EXISTS "snap_points";
