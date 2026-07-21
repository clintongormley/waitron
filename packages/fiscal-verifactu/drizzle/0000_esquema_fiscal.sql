CREATE TABLE "cadenas" (
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"secuencia" integer DEFAULT 0 NOT NULL,
	"ultimo_registro_id" uuid,
	"ultima_huella" text,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cadenas_tenant_id_till_id_pk" PRIMARY KEY("tenant_id","till_id"),
	CONSTRAINT "cadenas_puntero_ck" CHECK (("cadenas"."ultimo_registro_id" is null) = ("cadenas"."ultima_huella" is null))
);
--> statement-breakpoint
ALTER TABLE "cadenas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contadores_instalacion" (
	"nif" text NOT NULL,
	"id_sistema_informatico" text NOT NULL,
	"proximo_numero" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contadores_instalacion_nif_id_sistema_informatico_pk" PRIMARY KEY("nif","id_sistema_informatico")
);
--> statement-breakpoint
CREATE TABLE "envios" (
	"registro_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"proximo_intento_en" timestamp with time zone DEFAULT now() NOT NULL,
	"incidencia" boolean DEFAULT false NOT NULL,
	"csv" text,
	"codigo_error" text,
	"mensaje_error" text,
	"enviado_en" timestamp with time zone,
	"confirmado_en" timestamp with time zone,
	CONSTRAINT "envios_estado_ck" CHECK ("envios"."estado" in ('pendiente', 'enviando', 'aceptado', 'aceptado_con_errores', 'rechazado', 'detenido'))
);
--> statement-breakpoint
ALTER TABLE "envios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registro_sif" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"nif" text NOT NULL,
	"id_sistema_informatico" text NOT NULL,
	"numero_instalacion" integer NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"revocado_en" timestamp with time zone,
	CONSTRAINT "registro_sif_numero_ck" CHECK ("registro_sif"."numero_instalacion" > 0)
);
--> statement-breakpoint
ALTER TABLE "registro_sif" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "registros_facturacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"till_id" uuid NOT NULL,
	"sif_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"secuencia" integer NOT NULL,
	"tipo_registro" text NOT NULL,
	"id_emisor_factura" text NOT NULL,
	"num_serie_factura" text NOT NULL,
	"fecha_expedicion_factura" date NOT NULL,
	"nombre_razon_emisor" text NOT NULL,
	"tipo_factura" text,
	"descripcion_operacion" text,
	"desglose" jsonb,
	"cuota_total" text,
	"importe_total" text,
	"primer_registro" boolean NOT NULL,
	"anterior_id_emisor_factura" text,
	"anterior_num_serie_factura" text,
	"anterior_fecha_expedicion_factura" date,
	"anterior_huella" text,
	"sistema_informatico" jsonb NOT NULL,
	"fecha_hora_huso_gen_registro" timestamp with time zone NOT NULL,
	"offset_minutos" integer NOT NULL,
	"tipo_huella" text NOT NULL,
	"huella" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registros_tipo_registro_ck" CHECK ("registros_facturacion"."tipo_registro" in ('alta', 'anulacion')),
	CONSTRAINT "registros_tipo_huella_ck" CHECK ("registros_facturacion"."tipo_huella" = '01'),
	CONSTRAINT "registros_huella_ck" CHECK ("registros_facturacion"."huella" ~ '^[0-9A-F]{64}$'),
	CONSTRAINT "registros_secuencia_ck" CHECK ("registros_facturacion"."secuencia" > 0),
	CONSTRAINT "registros_encadenamiento_ck" CHECK (("registros_facturacion"."primer_registro"
             and "registros_facturacion"."anterior_id_emisor_factura" is null
             and "registros_facturacion"."anterior_num_serie_factura" is null
             and "registros_facturacion"."anterior_fecha_expedicion_factura" is null
             and "registros_facturacion"."anterior_huella" is null)
           or (not "registros_facturacion"."primer_registro"
             and "registros_facturacion"."anterior_id_emisor_factura" is not null
             and "registros_facturacion"."anterior_num_serie_factura" is not null
             and "registros_facturacion"."anterior_fecha_expedicion_factura" is not null
             and "registros_facturacion"."anterior_huella" is not null))
);
--> statement-breakpoint
ALTER TABLE "registros_facturacion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadenas" ADD CONSTRAINT "cadenas_ultimo_registro_id_registros_facturacion_id_fk" FOREIGN KEY ("ultimo_registro_id") REFERENCES "public"."registros_facturacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios" ADD CONSTRAINT "envios_registro_id_registros_facturacion_id_fk" FOREIGN KEY ("registro_id") REFERENCES "public"."registros_facturacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "envios" ADD CONSTRAINT "envios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registro_sif" ADD CONSTRAINT "registro_sif_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registro_sif" ADD CONSTRAINT "registro_sif_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_facturacion" ADD CONSTRAINT "registros_facturacion_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_facturacion" ADD CONSTRAINT "registros_facturacion_till_id_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_facturacion" ADD CONSTRAINT "registros_facturacion_sif_id_registro_sif_id_fk" FOREIGN KEY ("sif_id") REFERENCES "public"."registro_sif"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registros_facturacion" ADD CONSTRAINT "registros_facturacion_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "envios_drenaje_idx" ON "envios" USING btree ("tenant_id","estado","proximo_intento_en");--> statement-breakpoint
CREATE UNIQUE INDEX "registro_sif_instalacion_uq" ON "registro_sif" USING btree ("nif","id_sistema_informatico","numero_instalacion");--> statement-breakpoint
CREATE UNIQUE INDEX "registro_sif_activo_uq" ON "registro_sif" USING btree ("tenant_id","till_id") WHERE "registro_sif"."revocado_en" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "registros_tenant_till_secuencia_uq" ON "registros_facturacion" USING btree ("tenant_id","till_id","secuencia");--> statement-breakpoint
CREATE UNIQUE INDEX "registros_identidad_uq" ON "registros_facturacion" USING btree ("tenant_id","id_emisor_factura","num_serie_factura","fecha_expedicion_factura","tipo_registro");--> statement-breakpoint
CREATE INDEX "registros_sale_idx" ON "registros_facturacion" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE INDEX "registros_till_secuencia_idx" ON "registros_facturacion" USING btree ("tenant_id","till_id","secuencia");