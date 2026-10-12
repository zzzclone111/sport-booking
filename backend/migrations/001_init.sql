CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('RENTER', 'OWNER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('ACTIVE', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE venue_status AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'RENTER',
  status user_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(160) NOT NULL,
  description TEXT,
  address VARCHAR(255) NOT NULL,
  ward VARCHAR(100),
  district VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  image_url TEXT,
  amenities TEXT[] NOT NULL DEFAULT '{}',
  open_time TIME NOT NULL DEFAULT '06:00',
  close_time TIME NOT NULL DEFAULT '23:00',
  status venue_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS courts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sport_type VARCHAR(60) NOT NULL,
  surface VARCHAR(80),
  price_per_hour NUMERIC(12,2) NOT NULL CHECK (price_per_hour >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (venue_id, name)
);

CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  price_per_hour NUMERIC(12,2) NOT NULL CHECK (price_per_hour >= 0),
  CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code VARCHAR(16) NOT NULL UNIQUE,
  renter_id UUID NOT NULL REFERENCES users(id),
  court_id UUID NOT NULL REFERENCES courts(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  status booking_status NOT NULL DEFAULT 'PENDING',
  note VARCHAR(500),
  owner_note VARCHAR(500),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at)
);

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT no_overlapping_active_bookings
  EXCLUDE USING gist (
    court_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_venues_search ON venues (status, city, district);
CREATE INDEX IF NOT EXISTS idx_courts_sport ON courts (sport_type, active);
CREATE INDEX IF NOT EXISTS idx_bookings_renter ON bookings (renter_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_court ON bookings (court_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_venues_owner ON venues (owner_id, status);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_touch_updated_at ON users;
CREATE TRIGGER users_touch_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS venues_touch_updated_at ON venues;
CREATE TRIGGER venues_touch_updated_at BEFORE UPDATE ON venues
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS bookings_touch_updated_at ON bookings;
CREATE TRIGGER bookings_touch_updated_at BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
