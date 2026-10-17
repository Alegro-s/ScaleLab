CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  full_name     text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'operator' CHECK (role IN ('operator','admin')),
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number      integer GENERATED ALWAYS AS IDENTITY,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','in_progress','review','ready')),
  step        text NOT NULL DEFAULT 'upload'
              CHECK (step IN ('upload','calibration','measurement','comparison','report')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path       text NOT NULL,
  filename   text NOT NULL,
  mime       text NOT NULL,
  size_bytes bigint NOT NULL,
  width      integer NOT NULL,
  height     integer NOT NULL,
  sha256     char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS images_sha_idx ON images(sha256);

CREATE TABLE IF NOT EXISTS samples (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  image_id   uuid NOT NULL REFERENCES images(id),
  slot       smallint NOT NULL DEFAULT 1,
  name       text NOT NULL,
  species    text NOT NULL DEFAULT '',
  tags       text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, slot)
);
CREATE INDEX IF NOT EXISTS samples_session_idx ON samples(session_id);
CREATE INDEX IF NOT EXISTS samples_tags_idx ON samples USING gin(tags);

CREATE TABLE IF NOT EXISTS reference_standards (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('checker','ruler','coin','custom')),
  width_mm   numeric(8,3) NOT NULL CHECK (width_mm > 0),
  height_mm  numeric(8,3) NOT NULL CHECK (height_mm > 0),
  tolerance_mm numeric(6,3) NOT NULL DEFAULT 0.05,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calibrations (
  sample_id      uuid PRIMARY KEY REFERENCES samples(id) ON DELETE CASCADE,
  reference_id   uuid REFERENCES reference_standards(id) ON DELETE SET NULL,
  reference_type text NOT NULL DEFAULT 'checker',
  side_mm        numeric(8,3) NOT NULL DEFAULT 10,
  corners        jsonb NOT NULL CHECK (jsonb_typeof(corners) = 'array' AND jsonb_array_length(corners) = 4),
  px_per_mm      double precision NOT NULL CHECK (px_per_mm > 0),
  confidence     double precision NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  method         text NOT NULL DEFAULT 'auto' CHECK (method IN ('auto','manual')),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS measurements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id  uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  label      text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('polygon','line','angle','circle','mask')),
  vertices   jsonb NOT NULL DEFAULT '[]',
  value      double precision NOT NULL,
  unit       text NOT NULL,
  perimeter_mm double precision,
  area_px    double precision,
  error      double precision NOT NULL DEFAULT 0,
  px_per_mm  double precision,
  in_table   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS measurements_sample_idx ON measurements(sample_id);

CREATE TABLE IF NOT EXISTS report_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  number      integer NOT NULL,
  payload_ref text NOT NULL,
  sha256      char(64) NOT NULL,
  summary     text NOT NULL DEFAULT '',
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, number)
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ui_mode  text NOT NULL DEFAULT 'glass' CHECK (ui_mode IN ('glass','classic')),
  theme    text NOT NULL DEFAULT 'dark'  CHECK (theme IN ('dark','light')),
  language text NOT NULL DEFAULT 'ru',
  units    text NOT NULL DEFAULT 'mm',
  decimals smallint NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
  autosave boolean NOT NULL DEFAULT true,
  hints    boolean NOT NULL DEFAULT true,
  sounds   boolean NOT NULL DEFAULT false,
  extra    jsonb NOT NULL DEFAULT '{}'
);

INSERT INTO reference_standards (owner_id,name,kind,width_mm,height_mm,tolerance_mm,note)
SELECT NULL,v.name,v.kind,v.w,v.h,v.tol,v.note FROM (VALUES
 ('Шахматный квадрат 10 × 10 мм','checker',10,10,0.05,'12 × 12 мм с полем; автопоиск'),
 ('Линейка 30 мм','ruler',30,3,0.05,'Штриховая шкала'),
 ('Монета Ø 24 мм','coin',24,24,0.10,'Круг')
) AS v(name,kind,w,h,tol,note)
WHERE NOT EXISTS (SELECT 1 FROM reference_standards WHERE owner_id IS NULL);
