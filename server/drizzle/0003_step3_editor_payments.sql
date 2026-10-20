CREATE TYPE "public"."payment_provider" AS ENUM('mollie', 'stripe');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('open', 'paid', 'failed', 'canceled', 'expired');--> statement-breakpoint
CREATE TABLE "mail_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text NOT NULL,
	"mode" text NOT NULL,
	"design" jsonb,
	"html" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_cents" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"data_limit_mb" integer,
	"down_kbps" integer,
	"up_kbps" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guest_session_id" uuid,
	"package_id" uuid,
	"package_name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_ref" text,
	"checkout_url" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_status" DEFAULT 'open' NOT NULL,
	"email" text,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"batch" text,
	"note" text,
	"duration_minutes" integer NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"data_limit_mb" integer,
	"down_kbps" integer,
	"up_kbps" integer,
	"valid_until" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"first_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD COLUMN "design" jsonb;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD COLUMN "auth" jsonb DEFAULT '{"methods":["free"],"emailName":"optional","emailPhone":"off","marketingOptIn":false,"welcomeMail":false,"paymentEmail":"required"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD COLUMN "languages" jsonb DEFAULT '["en","nl"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_packages" ADD CONSTRAINT "payment_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_package_id_payment_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."payment_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_templates_lookup" ON "mail_templates" USING btree ("kind","locale");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_once" ON "notification_log" USING btree ("tenant_id","kind","ref");--> statement-breakpoint
CREATE INDEX "notification_created_idx" ON "notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_ref_idx" ON "payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_code_unique" ON "vouchers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "vouchers_batch_idx" ON "vouchers" USING btree ("tenant_id","batch");--> statement-breakpoint
CREATE INDEX "guest_sessions_authorized_idx" ON "guest_sessions" USING btree ("tenant_id","authorized_at");