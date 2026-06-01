-- AoE2 Insta Scout telemetry — D1 schema.
-- One row per install per day. PRIMARY KEY (id, day) dedupes re-launches so a
-- heavy user counts once/day; COUNT(DISTINCT id) = total installs.
CREATE TABLE IF NOT EXISTS pings (
  id      TEXT NOT NULL,   -- anonymous random UUID from the client
  day     TEXT NOT NULL,   -- YYYY-MM-DD (UTC)
  version TEXT,            -- app version, e.g. "0.3.0"
  os      TEXT,            -- coarse OS tag, e.g. "win"
  PRIMARY KEY (id, day)
);
CREATE INDEX IF NOT EXISTS idx_pings_day ON pings(day);
