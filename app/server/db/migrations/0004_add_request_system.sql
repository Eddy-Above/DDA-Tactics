-- Add request/response system for player interaction in encounters
ALTER TABLE encounters
ADD COLUMN pending_requests TEXT NOT NULL DEFAULT '[]',
ADD COLUMN request_responses TEXT NOT NULL DEFAULT '[]';
