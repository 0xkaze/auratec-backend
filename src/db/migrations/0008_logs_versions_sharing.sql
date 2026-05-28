-- FASE 2: logs de atividade, versionamento de projetos e compartilhamento.

-- 1. Logs de atividade ------------------------------------------------
CREATE TABLE "activity_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(64) NOT NULL,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" uuid,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE SET NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "activity_logs_created_idx" ON "activity_logs" ("created_at");
CREATE INDEX "activity_logs_user_idx" ON "activity_logs" ("user_id");
CREATE INDEX "activity_logs_project_idx" ON "activity_logs" ("project_id");

-- 2. Versões de projeto ----------------------------------------------
CREATE TABLE "project_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "pieces" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "thumbnail" text,
  "label" varchar(120),
  "is_auto" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "project_versions_project_idx" ON "project_versions" ("project_id", "created_at");

-- 3. Compartilhamento de projeto -------------------------------------
ALTER TABLE "projects" ADD COLUMN "share_id" varchar(24) UNIQUE;
ALTER TABLE "projects" ADD COLUMN "is_public" boolean NOT NULL DEFAULT false;
