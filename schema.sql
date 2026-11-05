-- Cadet HF-1 test site. Paste into the D1 Console (README step 3).
CREATE TABLE IF NOT EXISTS feedback (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  version TEXT,
  name    TEXT,
  role    TEXT,
  rating  INTEGER,
  good    TEXT,
  bad     TEXT,
  device  TEXT,
  screen  TEXT,
  state   TEXT
);
CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  version      TEXT,
  tester       TEXT,
  mission      TEXT NOT NULL,
  points       INTEGER,
  max_points   INTEGER,
  passed       INTEGER,
  licence_fail INTEGER,
  rules        TEXT,
  txs          INTEGER,
  changes      INTEGER,
  secs         INTEGER
);
CREATE INDEX IF NOT EXISTS attempts_mission ON attempts (mission);
