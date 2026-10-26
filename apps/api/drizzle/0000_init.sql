CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`mode` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_app_idx` ON `api_keys` (`app_id`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`webhook_url` text,
	`webhook_secret_enc` text NOT NULL,
	`settle_coin` text NOT NULL,
	`settle_network` text NOT NULL,
	`settle_address` text NOT NULL,
	`settle_memo` text,
	`underpay_tol_bps` integer DEFAULT 50 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `apps_owner_idx` ON `apps` (`owner_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`app_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_code` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`app_id`, `key`),
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payment_events_payment_idx` ON `payment_events` (`payment_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`mode` text NOT NULL,
	`order_id` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`description` text,
	`settle_coin` text NOT NULL,
	`settle_network` text NOT NULL,
	`settle_address` text NOT NULL,
	`settle_memo` text,
	`settle_expected` text NOT NULL,
	`settle_received` text,
	`underpay_tol_bps` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`success_url` text,
	`cancel_url` text,
	`metadata` text,
	`expires_at` integer NOT NULL,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_app_created_idx` ON `payments` (`app_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payments_app_order_idx` ON `payments` (`app_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `payments_status_expires_idx` ON `payments` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `provider_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`disabled_until` integer,
	`last_error` text,
	`last_error_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_order_id` text NOT NULL,
	`provider_token` text,
	`deposit_coin` text NOT NULL,
	`deposit_network` text NOT NULL,
	`deposit_address` text NOT NULL,
	`deposit_memo` text,
	`deposit_amount` text NOT NULL,
	`settle_amount` text NOT NULL,
	`settled_amount` text,
	`rate` text NOT NULL,
	`refund_address` text,
	`quote_expires_at` integer NOT NULL,
	`status` text DEFAULT 'AWAITING_DEPOSIT' NOT NULL,
	`provider_status` text NOT NULL,
	`deposit_tx_hash` text,
	`settle_tx_hash` text,
	`raw` text,
	`next_poll_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `swaps_provider_order_uq` ON `swaps` (`provider`,`provider_order_id`);--> statement-breakpoint
CREATE INDEX `swaps_payment_idx` ON `swaps` (`payment_id`);--> statement-breakpoint
CREATE INDEX `swaps_poll_idx` ON `swaps` (`next_poll_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'MERCHANT' NOT NULL,
	`disabled_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`event_id` text NOT NULL,
	`url` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_status_code` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `payment_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_due_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_app_idx` ON `webhook_deliveries` (`app_id`,`created_at`);