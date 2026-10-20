CREATE TYPE "public"."billing_interval" AS ENUM('month', 'quarter', 'year');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"interval" "billing_interval" DEFAULT 'month' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_ref" text,
	"checkout_url" text,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"prefix" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"number" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"issue_date" date,
	"due_date" date,
	"period_start" date,
	"period_end" date,
	"seller" jsonb,
	"customer" jsonb NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vat_rate_bp" integer DEFAULT 2100 NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"pay_token" text NOT NULL,
	"sent_at" timestamp with time zone,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"last_reminder_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"paid_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_pay_token_unique" UNIQUE("pay_token")
);
--> statement-breakpoint
CREATE TABLE "tenant_billing" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"vat_number" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"vat_rate_bp" integer DEFAULT 2100 NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"subscription_active" boolean DEFAULT false NOT NULL,
	"plan_id" uuid,
	"plan_name" text DEFAULT '' NOT NULL,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"interval" "billing_interval" DEFAULT 'month' NOT NULL,
	"start_date" date,
	"next_invoice_date" date,
	"auto_suspend" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_payments_ref_idx" ON "invoice_payments" USING btree ("provider","provider_ref");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","due_date");