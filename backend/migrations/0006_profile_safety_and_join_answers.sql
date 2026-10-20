-- Private profile controls and club-owner review. No child names or birthdays are stored.
ALTER TABLE club_join_requests ADD COLUMN join_answers text NOT NULL DEFAULT '[]';

CREATE TABLE user_blocks (
  blocker_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at integer NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_target_idx ON user_blocks(blocked_id, blocker_id);

CREATE TABLE user_reports (
  id text PRIMARY KEY NOT NULL,
  reporter_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('harassment','spam','unsafe','inappropriate','privacy','other')),
  details text NOT NULL DEFAULT '',
  club_id text REFERENCES clubs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  created_at integer NOT NULL,
  reviewed_at integer,
  CHECK (reporter_id <> reported_id)
);
CREATE INDEX user_reports_reporter_time_idx ON user_reports(reporter_id, created_at);
CREATE INDEX user_reports_club_status_idx ON user_reports(club_id, status, created_at);
