ALTER TABLE clubs ADD COLUMN is_private integer DEFAULT 0 NOT NULL;
ALTER TABLE clubs ADD COLUMN is_starter integer DEFAULT 0 NOT NULL;
ALTER TABLE memberships ADD COLUMN rules_accepted_at integer;

CREATE TABLE club_join_requests (
  club_id text NOT NULL,
  user_id text NOT NULL,
  requested_at integer NOT NULL,
  rules_accepted_at integer NOT NULL,
  PRIMARY KEY (club_id, user_id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE club_blocks (
  club_id text NOT NULL,
  user_id text NOT NULL,
  blocked_at integer NOT NULL,
  PRIMARY KEY (club_id, user_id),
  FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO profiles (id, auth_id, email, name, suburb, bio, interests, ages, created_at)
VALUES ('family-finds-host', 'system:family-finds-host', 'community@familyfinds.invalid', 'Family Finds', 'Brisbane', 'Local family club host.', '[]', '[]', CAST(strftime('%s','now') AS integer) * 1000);

INSERT OR IGNORE INTO clubs (id, owner_id, name, suburb, description, interests, ages, color, is_starter, created_at)
VALUES
  ('family-weekends', 'family-finds-host', 'Brisbane Family Weekends', 'Brisbane', 'Plan free and low-cost weekend outings with other families.', '["Outdoor play","Weekend adventures"]', '["All ages"]', 'green', 1, CAST(strftime('%s','now') AS integer) * 1000),
  ('little-readers', 'family-finds-host', 'Little Readers & Library Days', 'Brisbane', 'Find storytimes and library activities for little readers.', '["Books & stories","Parent support"]', '["0–3 years","4–7 years"]', 'purple', 1, CAST(strftime('%s','now') AS integer) * 1000),
  ('market-mates', 'family-finds-host', 'Family Market Mates', 'Brisbane', 'Share family-friendly markets, swaps and second-hand finds.', '["Markets & swaps","Weekend adventures"]', '["All ages"]', 'orange', 1, CAST(strftime('%s','now') AS integer) * 1000);

INSERT OR IGNORE INTO memberships (club_id, user_id, created_at, rules_accepted_at)
VALUES
  ('family-weekends', 'family-finds-host', CAST(strftime('%s','now') AS integer) * 1000, CAST(strftime('%s','now') AS integer) * 1000),
  ('little-readers', 'family-finds-host', CAST(strftime('%s','now') AS integer) * 1000, CAST(strftime('%s','now') AS integer) * 1000),
  ('market-mates', 'family-finds-host', CAST(strftime('%s','now') AS integer) * 1000, CAST(strftime('%s','now') AS integer) * 1000);
