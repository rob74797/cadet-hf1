-- Run once in the D1 Console if you set the database up before missions and callsigns were added.
CREATE TABLE IF NOT EXISTS missions (
  id      TEXT PRIMARY KEY,
  title   TEXT NOT NULL,
  data    TEXT NOT NULL,
  active  INTEGER NOT NULL DEFAULT 1,
  updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_tester ON attempts (tester);
