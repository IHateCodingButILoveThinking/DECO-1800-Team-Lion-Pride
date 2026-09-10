CREATE TABLE `event_interest` (
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `event_id`),
	FOREIGN KEY (`user_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_interest_event_idx` ON `event_interest` (`event_id`);