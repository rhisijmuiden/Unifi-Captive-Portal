ALTER TABLE "console_devices" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "console_devices" ADD COLUMN "offline_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consoles" ADD COLUMN "offline_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "method" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_pending_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;