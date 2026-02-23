ALTER TABLE "ip_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ip_events" CASCADE;--> statement-breakpoint
ALTER TABLE "daily_tokens" ALTER COLUMN "date" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN "delivered";