ALTER TABLE `profiles` ADD `password_hash` text;
--> statement-breakpoint
ALTER TABLE `profiles` ADD `password_salt` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_email_unique_ci` ON `profiles` (lower(`email`));
