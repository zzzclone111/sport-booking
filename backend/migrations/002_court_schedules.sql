ALTER TABLE courts ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE bookings ALTER COLUMN renter_id DROP NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'ONLINE';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_name VARCHAR(120);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(20);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE bookings ADD CONSTRAINT booking_source_valid CHECK (source IN ('ONLINE','WALK_IN','BLOCK'));
ALTER TABLE bookings ADD CONSTRAINT booking_renter_valid CHECK (source <> 'ONLINE' OR renter_id IS NOT NULL);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS review_note VARCHAR(1000);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id);
ALTER TABLE venues ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
-- Completed sessions still occupy historical time when owners enter walk-ins.
ALTER TABLE bookings DROP CONSTRAINT no_overlapping_active_bookings;
ALTER TABLE bookings ADD CONSTRAINT no_overlapping_active_bookings
EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
WHERE (status IN ('PENDING','CONFIRMED','COMPLETED'));
CREATE INDEX IF NOT EXISTS idx_pricing_court ON pricing_rules(court_id, day_of_week);
