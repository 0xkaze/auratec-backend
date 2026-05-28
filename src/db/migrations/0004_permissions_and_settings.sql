-- Permissões granulares por usuário + tabela de settings da plataforma.
--
-- Permissões: admin tem TUDO implícito (legado). Pra users normais
-- (role='user'), as permissões em users.permissions definem o que
-- conseguem fazer no painel /admin.
--
-- Settings: chave-valor em jsonb, uma row por feature group. Permite
-- alterar comportamento da plataforma sem deploy.

-- 1. users.permissions text[]
ALTER TABLE "users" ADD COLUMN "permissions" text[] NOT NULL DEFAULT '{}';

-- 2. platform_settings
CREATE TABLE "platform_settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- 3. Seeds de defaults — politica de signup + limites por user.
INSERT INTO "platform_settings" ("key", "value") VALUES
  ('signup_policy', jsonb_build_object(
    'enabled', true,
    'requireApproval', false,
    'allowedDomains', '[]'::jsonb
  )),
  ('user_limits', jsonb_build_object(
    'maxProjects', 50,
    'maxUploadMB', 60
  ))
ON CONFLICT ("key") DO NOTHING;
