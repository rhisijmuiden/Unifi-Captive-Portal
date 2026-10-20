CREATE TYPE "public"."backup_target_type" AS ENUM('local', 'ftp', 'ftps', 'scp');--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" uuid,
	"target_name" text NOT NULL,
	"set_id" text,
	"type" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"entries" integer,
	"size_bytes" bigint,
	"stored_bytes" bigint,
	"removed_sets" integer,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "backup_target_type" NOT NULL,
	"host" text DEFAULT '' NOT NULL,
	"port" integer DEFAULT 0 NOT NULL,
	"username" text DEFAULT '' NOT NULL,
	"password" text DEFAULT '' NOT NULL,
	"tls_mode" text DEFAULT 'explicit' NOT NULL,
	"verify_certificate" boolean DEFAULT true NOT NULL,
	"auth_method" text DEFAULT 'key' NOT NULL,
	"host_key" text DEFAULT '' NOT NULL,
	"path" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"keep_full" integer DEFAULT 4 NOT NULL,
	"last_manifest" jsonb,
	"last_full_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_target_id_backup_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."backup_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_runs_started_idx" ON "backup_runs" USING btree ("started_at");