-- SKU + URL do produto no site comercial. Ambos opcionais.
-- Permite linkar peças do catálogo às páginas de venda.

ALTER TABLE "piece_catalog" ADD COLUMN "sku" varchar(64);
ALTER TABLE "piece_catalog" ADD COLUMN "product_url" text;
