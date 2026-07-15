CREATE INDEX "email_deliveries_status_updated_idx" ON "email_deliveries" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "invitations_expiry_idx" ON "invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expiry_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_sessions_expiry_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_updated_idx" ON "webhook_deliveries" USING btree ("status","updated_at");