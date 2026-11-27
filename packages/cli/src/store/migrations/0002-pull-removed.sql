-- Sheet imports also remove rows; record how many, and which file was read.
ALTER TABLE pulls ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pulls ADD COLUMN source_file TEXT;
