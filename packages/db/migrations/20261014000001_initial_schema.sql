-- migrate:up
-- Dental Clinic SaaS schema v3 (see the SRS doc, section 6).
-- =====================================================================
-- Dental Clinic SaaS — PostgreSQL 16 schema (v3 — ready for Sprint 0)
-- Multi-tenant: shared schema, tenant_id on every tenant table, RLS.
-- Conventions
--   * ids: uuid (generate UUIDv7 in the app for index locality; default here is v4)
--   * money: bigint minor units (piasters/cents) + currency char(3)
--   * enums: text + CHECK (cheap to extend in migrations)
--   * same-tenant integrity: tenant tables expose UNIQUE (tenant_id, id) and
--     children reference parents with composite FKs (tenant_id, x_id)
--   * timestamps: timestamptz, stored UTC; tenant timezone in tenants.timezone
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email / hostname
CREATE EXTENSION IF NOT EXISTS btree_gist; -- exclusion constraint on appointments
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy patient name search
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- tenant_id inside the trigram index

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- =====================================================================
-- 1. PLATFORM (no tenant_id, no RLS — accessed by API through services
--    that never expose other tenants' data; admin panel uses these)
-- =====================================================================

CREATE TABLE plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,                 -- basic, pro, enterprise
  name_en               text NOT NULL,
  name_ar               text NOT NULL,
  price_monthly_minor   bigint NOT NULL CHECK (price_monthly_minor >= 0),
  price_yearly_minor    bigint NOT NULL CHECK (price_yearly_minor >= 0),
  currency              char(3) NOT NULL DEFAULT 'EGP',
  trial_days            int NOT NULL DEFAULT 14 CHECK (trial_days >= 0),
  -- {"branches":1,"staff":5,"patients":2000,"sms_credits":200,"storage_mb":2048}
  limits                jsonb NOT NULL DEFAULT '{}',
  -- {"custom_domain":false,"online_payments":false,"inventory":false,"remove_badge":false}
  features              jsonb NOT NULL DEFAULT '{}',
  is_public             boolean NOT NULL DEFAULT true,
  sort_order            int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,                       -- smile, clinic-pro
  name             text NOT NULL,
  preview_url      text,
  sections_schema  jsonb NOT NULL DEFAULT '{}',               -- allowed sections + their fields
  default_theme    jsonb NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  min_plan_code    text,                                       -- null = all plans
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Seeded dental services the onboarding wizard offers
CREATE TABLE service_catalog (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,              -- scaling, filling_composite, rct, implant ...
  category                  text NOT NULL,
  name_en                   text NOT NULL,
  name_ar                   text NOT NULL,
  default_duration_minutes  int NOT NULL CHECK (default_duration_minutes > 0),
  sort_order                int NOT NULL DEFAULT 0
);

CREATE TABLE tenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              citext NOT NULL UNIQUE
                    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$'),
  name_en           text,
  name_ar           text,
  status            text NOT NULL DEFAULT 'onboarding'
                    CHECK (status IN ('onboarding','trialing','active','past_due','suspended','cancelled')),
  onboarding_step   smallint NOT NULL DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 7), -- 7 = done
  country           char(2) NOT NULL DEFAULT 'EG',
  timezone          text NOT NULL DEFAULT 'Africa/Cairo',
  currency          char(3) NOT NULL DEFAULT 'EGP',
  default_locale    text NOT NULL DEFAULT 'ar' CHECK (default_locale IN ('ar','en')),
  logo_file_id      uuid,                                      -- FK added after files
  primary_phone     text,
  whatsapp          text,
  email             citext,
  social_links      jsonb NOT NULL DEFAULT '{}',
  specialties       text[] NOT NULL DEFAULT '{}',
  about_en          text,
  about_ar          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (name_en IS NOT NULL OR name_ar IS NOT NULL)
);

-- Global identity. Role inside a clinic lives on tenant_members.
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext UNIQUE,
  phone               text UNIQUE,                             -- E.164: +2010xxxxxxxx
  password_hash       text,                                    -- argon2id; null for Google-only
  google_sub          text UNIQUE,
  full_name           text NOT NULL,
  avatar_url          text,
  locale              text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  email_verified_at   timestamptz,
  phone_verified_at   timestamptz,
  totp_secret_enc     bytea,                                   -- AES-GCM encrypted
  platform_role       text CHECK (platform_role IN ('super_admin','support')), -- null = clinic user
  is_active           boolean NOT NULL DEFAULT true,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,  -- active tenant for this session
  token_hash    text NOT NULL UNIQUE,                           -- sha256 of the opaque token
  family_id     uuid NOT NULL,                                  -- rotation family; reuse => revoke family
  user_agent    text,
  ip            inet,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON refresh_tokens (user_id);
CREATE INDEX ON refresh_tokens (family_id);

CREATE TABLE otp_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target        text NOT NULL,                                  -- phone or email
  purpose       text NOT NULL CHECK (purpose IN ('verify_phone','verify_email','login','reset_password','booking')),
  code_hash     text NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_codes (target, purpose, created_at DESC);

CREATE TABLE auth_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  identifier  text,                                             -- what was typed at login
  type        text NOT NULL CHECK (type IN ('login_ok','login_failed','logout','password_reset','otp_sent','otp_failed','locked','token_reuse')),
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_events (user_id, created_at DESC);
CREATE INDEX ON auth_events (identifier, created_at DESC);

CREATE TABLE leads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text NOT NULL,
  phone        text NOT NULL,
  email        citext,
  clinic_name  text,
  city         text,
  message      text,
  source       text,                                            -- utm_source / page
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','converted','lost')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Payment-provider webhooks: idempotent processing (platform + clinic gateways)
CREATE TABLE webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,                                  -- paymob, fawry, stripe
  event_id      text NOT NULL,
  tenant_id     uuid REFERENCES tenants(id),
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error         text,
  UNIQUE (provider, event_id)
);

CREATE TABLE platform_audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id  uuid REFERENCES users(id),
  action         text NOT NULL,                                 -- tenant.suspend, plan.update, impersonate.start
  tenant_id      uuid REFERENCES tenants(id),
  details        jsonb NOT NULL DEFAULT '{}',
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 2. TENANT ACCOUNT, SUBSCRIPTION, MEMBERS
-- =====================================================================

CREATE TABLE subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                   uuid NOT NULL REFERENCES plans(id),
  status                    text NOT NULL CHECK (status IN ('trialing','active','past_due','suspended','cancelled')),
  billing_cycle             text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  trial_ends_at             timestamptz,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  grace_ends_at             timestamptz,
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  provider                  text,
  provider_customer_id      text,
  provider_subscription_id  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
-- one live subscription per tenant
CREATE UNIQUE INDEX subscriptions_one_live ON subscriptions (tenant_id)
  WHERE status <> 'cancelled';

CREATE TABLE platform_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  subscription_id  uuid NOT NULL,
  number           text NOT NULL UNIQUE,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  amount_minor     bigint NOT NULL CHECK (amount_minor >= 0),
  tax_minor        bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  currency         char(3) NOT NULL,
  status           text NOT NULL CHECK (status IN ('open','paid','failed','void','refunded')),
  provider         text,
  provider_ref     text,
  pdf_file_key     text,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  paid_at          timestamptz,
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES subscriptions(tenant_id, id),
  CHECK (period_end >= period_start)
);
CREATE INDEX ON platform_invoices (tenant_id, issued_at DESC);

-- Usage per billing period (SMS sent, storage, patients ...) for plan limits
CREATE TABLE usage_counters (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric        text NOT NULL,                                  -- sms, whatsapp, storage_mb, patients
  period_start  date NOT NULL,
  value         bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  PRIMARY KEY (tenant_id, metric, period_start)
);

-- Sequential human numbers per tenant (invoice no., patient file no.)
CREATE TABLE tenant_counters (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,                                     -- invoice:2026, patient_file
  value      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE tenant_settings (
  tenant_id                     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  booking_auto_confirm          boolean NOT NULL DEFAULT false,
  booking_otp_required          boolean NOT NULL DEFAULT true,
  booking_min_notice_minutes    int NOT NULL DEFAULT 120 CHECK (booking_min_notice_minutes >= 0),
  booking_max_days_ahead        int NOT NULL DEFAULT 60 CHECK (booking_max_days_ahead BETWEEN 1 AND 365),
  booking_slot_step_minutes     int NOT NULL DEFAULT 15 CHECK (booking_slot_step_minutes IN (5,10,15,20,30,60)),
  booking_cancel_window_hours   int NOT NULL DEFAULT 12 CHECK (booking_cancel_window_hours >= 0),
  booking_payment_mode          text NOT NULL DEFAULT 'at_clinic'
                                CHECK (booking_payment_mode IN ('at_clinic','deposit','full_online','patient_choice')),
  booking_deposit_minor         bigint CHECK (booking_deposit_minor >= 0),
  reminder_offsets_minutes      int[] NOT NULL DEFAULT '{1440,120}',
  invoice_prefix                text NOT NULL DEFAULT 'INV',
  tax_rate_bp                   int NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000), -- 1400 = 14%
  tax_registration_no           text,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- Roles are per tenant (seeded on signup: owner, doctor, receptionist, assistant, accountant)
CREATE TABLE roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key          text NOT NULL,
  name_en      text NOT NULL,
  name_ar      text NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',                    -- 'patients:read','invoices:write',...
  is_system    boolean NOT NULL DEFAULT false,                  -- seeded roles cannot be deleted
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE tenant_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  all_branches  boolean NOT NULL DEFAULT true,
  job_title     text,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id)
);
CREATE INDEX ON tenant_members (user_id);

CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         citext,
  phone         text,
  role_id       uuid NOT NULL,
  branch_ids    uuid[] NOT NULL DEFAULT '{}',                   -- empty = all branches
  token_hash    text NOT NULL UNIQUE,
  invited_by    uuid NOT NULL,
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles(tenant_id, id),
  FOREIGN KEY (tenant_id, invited_by) REFERENCES tenant_members(tenant_id, id)
);

-- =====================================================================
-- 3. FILES (logos, gallery, X-rays, consents, PDFs)
-- =====================================================================

CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bucket        text NOT NULL,
  object_key    text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  kind          text NOT NULL CHECK (kind IN ('logo','image','gallery','xray','clinical_photo','consent','document','invoice_pdf','other')),
  is_private    boolean NOT NULL DEFAULT true,                  -- medical files always private
  sha256        text,
  uploaded_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_key),
  UNIQUE (tenant_id, id),
  CHECK (NOT (kind IN ('xray','clinical_photo','consent') AND is_private = false))
);

ALTER TABLE tenants
  ADD CONSTRAINT tenants_logo_fk FOREIGN KEY (id, logo_file_id) REFERENCES files(tenant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- =====================================================================
-- 4. CLINIC SETUP: branches, hours, doctors, services
-- =====================================================================

CREATE TABLE branches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_en       text,
  name_ar       text,
  slug          text NOT NULL,
  address_en    text,
  address_ar    text,
  city          text,
  area          text,
  latitude      numeric(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude     numeric(9,6) CHECK (longitude BETWEEN -180 AND 180),
  phone         text,
  whatsapp      text,
  email         citext,
  timezone      text,                                         -- null = tenants.timezone (multi-country chains)
  is_main       boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  UNIQUE (tenant_id, id),
  CHECK (name_en IS NOT NULL OR name_ar IS NOT NULL)
);
CREATE UNIQUE INDEX branches_one_main ON branches (tenant_id) WHERE is_main;

CREATE TABLE member_branches (
  tenant_id  uuid NOT NULL,
  member_id  uuid NOT NULL,
  branch_id  uuid NOT NULL,
  PRIMARY KEY (member_id, branch_id),
  FOREIGN KEY (tenant_id, member_id) REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE
);

-- Several rows per weekday allow a break (09:00-13:00, 17:00-22:00)
CREATE TABLE branch_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  branch_id   uuid NOT NULL,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
  opens_at    time NOT NULL,
  closes_at   time NOT NULL,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE,
  CHECK (closes_at > opens_at)
);
CREATE INDEX ON branch_hours (branch_id, weekday);

CREATE TABLE holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid,                                             -- null = all branches
  date        date NOT NULL,
  name        text NOT NULL,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON holidays (tenant_id, date);

CREATE TABLE rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  branch_id   uuid NOT NULL,
  name        text NOT NULL,                                    -- Chair 1, Surgery room
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (branch_id, name),
  UNIQUE (tenant_id, branch_id, id),                          -- appointments check the room's branch
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE
);

-- A doctor shown on the site / bookable; may or may not have a login (member_id)
CREATE TABLE doctors (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id               uuid,
  name_en                 text,
  name_ar                 text,
  title_en                text,                                 -- Orthodontist, BDS MSc
  title_ar                text,
  bio_en                  text,
  bio_ar                  text,
  photo_file_id           uuid,
  specialties             text[] NOT NULL DEFAULT '{}',
  consultation_fee_minor  bigint CHECK (consultation_fee_minor >= 0),
  commission_bp           int CHECK (commission_bp BETWEEN 0 AND 10000),
  calendar_color          text,
  show_on_website         boolean NOT NULL DEFAULT true,
  accepts_online_booking  boolean NOT NULL DEFAULT true,
  is_active               boolean NOT NULL DEFAULT true,
  sort_order              int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, member_id) REFERENCES tenant_members(tenant_id, id) ON DELETE SET NULL (member_id),
  FOREIGN KEY (tenant_id, photo_file_id) REFERENCES files(tenant_id, id) ON DELETE SET NULL (photo_file_id),
  CHECK (name_en IS NOT NULL OR name_ar IS NOT NULL)
);
CREATE UNIQUE INDEX doctors_member_unique ON doctors (member_id) WHERE member_id IS NOT NULL;

CREATE TABLE doctor_branches (
  tenant_id  uuid NOT NULL,
  doctor_id  uuid NOT NULL,
  branch_id  uuid NOT NULL,
  PRIMARY KEY (doctor_id, branch_id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE doctor_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  doctor_id   uuid NOT NULL,
  branch_id   uuid NOT NULL,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE,
  CHECK (ends_at > starts_at),
  -- a doctor cannot be scheduled in two places at overlapping times on the same weekday
  EXCLUDE USING gist (
    doctor_id WITH =, weekday WITH =,
    tsrange('2000-01-01'::date + starts_at, '2000-01-01'::date + ends_at) WITH &&
  )
);

CREATE TABLE doctor_time_off (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  doctor_id   uuid NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  reason      text,
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id) ON DELETE CASCADE,
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON doctor_time_off (doctor_id, starts_at);

CREATE TABLE service_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_en     text,
  name_ar     text,
  sort_order  int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id)
);

CREATE TABLE services (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id         uuid,
  catalog_code        text REFERENCES service_catalog(code),
  name_en             text,
  name_ar             text,
  description_en      text,
  description_ar      text,
  price_minor         bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  price_max_minor     bigint,                                   -- set => shown as range "from X to Y"
  duration_minutes    int NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  image_file_id       uuid,
  bookable_online     boolean NOT NULL DEFAULT true,
  show_on_website     boolean NOT NULL DEFAULT true,
  is_active           boolean NOT NULL DEFAULT true,
  sort_order          int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES service_categories(tenant_id, id) ON DELETE SET NULL (category_id),
  FOREIGN KEY (tenant_id, image_file_id) REFERENCES files(tenant_id, id) ON DELETE SET NULL (image_file_id),
  CHECK (price_max_minor IS NULL OR price_max_minor >= price_minor),
  CHECK (name_en IS NOT NULL OR name_ar IS NOT NULL)
);

CREATE TABLE doctor_services (
  tenant_id   uuid NOT NULL,
  doctor_id   uuid NOT NULL,
  service_id  uuid NOT NULL,
  PRIMARY KEY (doctor_id, service_id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON doctor_services (service_id);

-- =====================================================================
-- 5. PATIENTS & CLINICAL
-- =====================================================================

CREATE TABLE patients (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_no              bigint NOT NULL,                         -- from tenant_counters('patient_file')
  full_name            text NOT NULL,
  gender               text CHECK (gender IN ('male','female')),
  date_of_birth        date,
  phone                text NOT NULL,
  phone_alt            text,
  email                citext,
  address              text,
  city                 text,
  occupation           text,
  referral_source      text,                                    -- website, facebook, friend, ...
  preferred_branch_id  uuid,
  preferred_locale     text NOT NULL DEFAULT 'ar' CHECK (preferred_locale IN ('ar','en')),
  tags                 text[] NOT NULL DEFAULT '{}',
  notes                text,
  is_blocked           boolean NOT NULL DEFAULT false,          -- repeated no-shows / fake bookings
  -- guardian for children (and patients who cannot consent themselves)
  guardian_name        text,
  guardian_phone       text,
  guardian_relation    text CHECK (guardian_relation IN ('father','mother','sibling','spouse','legal_guardian','other')),
  guardian_patient_id  uuid,                                    -- when the guardian is also a patient
  -- marketing consent (Egypt PDPL 151/2020): offers only with explicit opt-in
  marketing_opt_in     boolean NOT NULL DEFAULT false,
  marketing_opt_in_at  timestamptz,
  -- duplicate handling: the losing record points to the surviving one
  merged_into_id       uuid,
  merged_at            timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  UNIQUE (tenant_id, file_no),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, preferred_branch_id) REFERENCES branches(tenant_id, id) ON DELETE SET NULL (preferred_branch_id),
  FOREIGN KEY (tenant_id, guardian_patient_id) REFERENCES patients(tenant_id, id) ON DELETE SET NULL (guardian_patient_id),
  FOREIGN KEY (tenant_id, merged_into_id) REFERENCES patients(tenant_id, id),
  CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE),
  CHECK (guardian_patient_id IS DISTINCT FROM id),
  CHECK (merged_into_id IS DISTINCT FROM id),
  CHECK ((merged_into_id IS NULL) = (merged_at IS NULL)),
  CHECK (NOT marketing_opt_in OR marketing_opt_in_at IS NOT NULL)
);
CREATE INDEX patients_active ON patients (tenant_id, created_at DESC) WHERE deleted_at IS NULL AND merged_into_id IS NULL;
-- phone is NOT unique: family members share a phone
CREATE INDEX ON patients (tenant_id, phone);
CREATE INDEX patients_name_trgm ON patients USING gin (tenant_id, full_name gin_trgm_ops);

CREATE TABLE patient_medical_history (
  patient_id    uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL,
  allergies     text[] NOT NULL DEFAULT '{}',
  conditions    text[] NOT NULL DEFAULT '{}',                   -- diabetes, hypertension, heart, bleeding ...
  medications   text[] NOT NULL DEFAULT '{}',
  is_pregnant   boolean,
  is_smoker     boolean,
  notes         text,
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE patient_files (
  tenant_id   uuid NOT NULL,
  patient_id  uuid NOT NULL,
  file_id     uuid NOT NULL,
  visit_id    uuid,                                             -- FK added after visits
  caption     text,
  taken_at    date,
  PRIMARY KEY (patient_id, file_id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, file_id) REFERENCES files(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE appointments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id            uuid NOT NULL,
  patient_id           uuid,                                    -- null only while a website slot is 'held'
  doctor_id            uuid NOT NULL,
  room_id              uuid,
  service_id           uuid,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  -- held = website slot reserved during OTP/payment; released after hold_expires_at
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('held','expired','pending','confirmed','checked_in','in_progress','completed','cancelled','no_show')),
  hold_expires_at      timestamptz,
  -- booking code: one-time 6-digit code (+ QR) the patient shows at reception.
  -- Only an HMAC of the code is stored; the plain code is sent once by SMS/WhatsApp/email.
  check_in_code_hash        text,
  check_in_code_expires_at  timestamptz,                        -- end of the appointment day (branch timezone)
  check_in_code_used_at     timestamptz,
  check_in_method           text CHECK (check_in_method IN ('code','qr','manual','walk_in')),
  check_in_note             text,                               -- required for manual check-in (e.g. "ID checked, phone lost")
  checked_in_by             uuid,                               -- tenant_members.id of the receptionist
  source               text NOT NULL CHECK (source IN ('website','dashboard','phone','walk_in','whatsapp')),
  payment_mode         text NOT NULL DEFAULT 'at_clinic' CHECK (payment_mode IN ('at_clinic','deposit','full_online')),
  quoted_price_minor   bigint CHECK (quoted_price_minor >= 0),
  patient_notes        text,                                    -- typed by the patient when booking
  internal_notes       text,
  cancel_reason        text,
  cancelled_by         text CHECK (cancelled_by IN ('patient','clinic','system')),
  manage_token_hash    text UNIQUE,                             -- signed link to cancel/reschedule
  booked_by            uuid,                                    -- tenant_members.id; null only for website bookings
  override_reason      text,                                    -- staff booked outside schedule/hours (needs appointments:override)
  confirmed_at         timestamptz,
  checked_in_at        timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)  REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)  REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id, room_id) REFERENCES rooms(tenant_id, branch_id, id),  -- room must be in the same branch
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '8 hours'),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status NOT IN ('held','expired') OR hold_expires_at IS NOT NULL),
  CHECK (patient_id IS NOT NULL OR status IN ('held','expired')),
  CHECK ((check_in_code_hash IS NULL) = (check_in_code_expires_at IS NULL)),
  CHECK (check_in_code_used_at IS NULL OR check_in_method IN ('code','qr')),
  CHECK (status NOT IN ('checked_in','in_progress','completed') OR (check_in_method IS NOT NULL AND checked_in_at IS NOT NULL)),
  CHECK (check_in_method IS DISTINCT FROM 'manual' OR check_in_note IS NOT NULL),
  FOREIGN KEY (tenant_id, checked_in_by) REFERENCES tenant_members(tenant_id, id),
  FOREIGN KEY (tenant_id, booked_by) REFERENCES tenant_members(tenant_id, id),
  -- website bookings have no staff author; every staff booking (dashboard, phone, WhatsApp, walk-in) names who booked it
  CHECK ((source = 'website') = (booked_by IS NULL)),
  CHECK (override_reason IS NULL OR source <> 'website'),
  -- BOOK-09: no double booking of a doctor (or a room). Held slots block too;
  -- stale holds are released by release_expired_holds() before every insert.
  CONSTRAINT appointments_no_doctor_overlap EXCLUDE USING gist (
    doctor_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status NOT IN ('cancelled','no_show','expired')),
  CONSTRAINT appointments_no_room_overlap EXCLUDE USING gist (
    room_id WITH =, tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (room_id IS NOT NULL AND status NOT IN ('cancelled','no_show','expired'))
);
CREATE INDEX appointments_holds ON appointments (hold_expires_at) WHERE status = 'held';
-- an unused code is unique inside the clinic, so reception lookup returns exactly one booking
CREATE UNIQUE INDEX appointments_open_code ON appointments (tenant_id, check_in_code_hash)
  WHERE check_in_code_used_at IS NULL AND check_in_code_hash IS NOT NULL;
CREATE INDEX ON appointments (tenant_id, branch_id, starts_at);
CREATE INDEX ON appointments (tenant_id, doctor_id, starts_at);
CREATE INDEX ON appointments (tenant_id, patient_id, starts_at DESC);
CREATE INDEX appointments_pending ON appointments (tenant_id, created_at) WHERE status = 'pending';

CREATE TABLE visits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id   uuid,
  patient_id       uuid NOT NULL,
  doctor_id        uuid NOT NULL,
  branch_id        uuid NOT NULL,
  visit_at         timestamptz NOT NULL DEFAULT now(),
  chief_complaint  text,
  diagnosis        text,
  clinical_notes   text,
  next_visit_note  text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (appointment_id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)  REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)  REFERENCES branches(tenant_id, id)
);
CREATE INDEX ON visits (tenant_id, patient_id, visit_at DESC);

ALTER TABLE patient_files
  ADD FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE SET NULL (visit_id);

-- Dental chart: append-only history; current state = latest row per (patient, tooth)
CREATE TABLE tooth_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  patient_id   uuid NOT NULL,
  visit_id     uuid,
  tooth_code   smallint NOT NULL CHECK (
                 (tooth_code / 10 BETWEEN 1 AND 4 AND tooth_code % 10 BETWEEN 1 AND 8)   -- permanent 11-48 (FDI)
              OR (tooth_code / 10 BETWEEN 5 AND 8 AND tooth_code % 10 BETWEEN 1 AND 5)), -- primary 51-85
  surfaces     text[] NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M','O','D','B','L','I','F','P']::text[]),
  condition    text NOT NULL CHECK (condition IN ('healthy','caries','filled','crown','bridge','missing','implant',
                                                  'root_canal','fractured','extraction_needed','veneer','sealant','other')),
  notes        text,
  recorded_by  uuid,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, visit_id) REFERENCES visits(tenant_id, id) ON DELETE SET NULL (visit_id)
);
CREATE INDEX ON tooth_records (tenant_id, patient_id, tooth_code, recorded_at DESC);

CREATE TABLE treatment_plans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id             uuid NOT NULL,
  doctor_id              uuid NOT NULL,
  title                  text NOT NULL,
  status                 text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','proposed','accepted','in_progress','completed','cancelled')),
  total_estimate_minor   bigint NOT NULL DEFAULT 0 CHECK (total_estimate_minor >= 0),
  notes                  text,
  accepted_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)  REFERENCES doctors(tenant_id, id)
);
CREATE INDEX ON treatment_plans (tenant_id, patient_id);

CREATE TABLE treatment_plan_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  plan_id          uuid NOT NULL,
  service_id       uuid NOT NULL,
  tooth_code       smallint,
  surfaces         text[] NOT NULL DEFAULT '{}',
  price_minor      bigint NOT NULL CHECK (price_minor >= 0),
  discount_minor   bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  status           text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','scheduled','done','cancelled')),
  appointment_id   uuid,
  sort_order       int NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id)        REFERENCES treatment_plans(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id)     REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id) ON DELETE SET NULL (appointment_id),
  CHECK (discount_minor <= price_minor)
);

-- What was actually done in a visit (source for invoicing and doctor commission)
CREATE TABLE visit_procedures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  visit_id       uuid NOT NULL,
  service_id     uuid NOT NULL,
  doctor_id      uuid NOT NULL,
  plan_item_id   uuid,
  tooth_code     smallint,
  surfaces       text[] NOT NULL DEFAULT '{}',
  price_minor    bigint NOT NULL CHECK (price_minor >= 0),
  -- commission frozen at the time of the procedure; later % changes don't rewrite history
  commission_bp      int NOT NULL DEFAULT 0 CHECK (commission_bp BETWEEN 0 AND 10000),
  commission_minor   bigint GENERATED ALWAYS AS (price_minor * commission_bp / 10000) STORED,
  payout_id          uuid,                                     -- FK added with doctor_payouts
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, visit_id)     REFERENCES visits(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id)   REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)    REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, plan_item_id) REFERENCES treatment_plan_items(tenant_id, id) ON DELETE SET NULL (plan_item_id)
);

CREATE TABLE prescriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  visit_id     uuid NOT NULL,
  patient_id   uuid NOT NULL,
  doctor_id    uuid NOT NULL,
  notes        text,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, visit_id)   REFERENCES visits(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)  REFERENCES doctors(tenant_id, id)
);

CREATE TABLE prescription_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  prescription_id  uuid NOT NULL,
  drug_name        text NOT NULL,
  dose             text,
  frequency        text,
  duration         text,
  instructions     text,
  sort_order       int NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id, prescription_id) REFERENCES prescriptions(tenant_id, id) ON DELETE CASCADE
);

-- =====================================================================
-- 5b. DENTAL OPERATIONS: consents, lab orders, recalls, waitlist
-- =====================================================================

CREATE TABLE consent_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         text NOT NULL,                                    -- general, extraction, implant, ortho, anesthesia
  version     int NOT NULL DEFAULT 1 CHECK (version > 0),
  title_ar    text,
  title_en    text,
  body_ar     text,
  body_en     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key, version),
  UNIQUE (tenant_id, id),
  CHECK (body_ar IS NOT NULL OR body_en IS NOT NULL)
);

-- Signed consent keeps a snapshot of the exact text the patient signed
CREATE TABLE patient_consents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  patient_id         uuid NOT NULL,
  template_id        uuid NOT NULL,
  visit_id           uuid,
  treatment_plan_id  uuid,
  locale             text NOT NULL CHECK (locale IN ('ar','en')),
  body_snapshot      text NOT NULL,
  signer_name        text NOT NULL,
  signer_relation    text NOT NULL DEFAULT 'self'
                     CHECK (signer_relation IN ('self','father','mother','spouse','legal_guardian','other')),
  signature_file_id  uuid NOT NULL,
  witness_member_id  uuid,
  signed_at          timestamptz NOT NULL DEFAULT now(),
  signed_ip          inet,
  revoked_at         timestamptz,
  FOREIGN KEY (tenant_id, patient_id)        REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, template_id)       REFERENCES consent_templates(tenant_id, id),
  FOREIGN KEY (tenant_id, visit_id)          REFERENCES visits(tenant_id, id),
  FOREIGN KEY (tenant_id, treatment_plan_id) REFERENCES treatment_plans(tenant_id, id),
  FOREIGN KEY (tenant_id, signature_file_id) REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, witness_member_id) REFERENCES tenant_members(tenant_id, id)
);
CREATE INDEX ON patient_consents (tenant_id, patient_id, signed_at DESC);

CREATE TABLE labs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,
  whatsapp    text,
  email       citext,
  address     text,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

CREATE TABLE lab_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lab_id          uuid NOT NULL,
  patient_id      uuid NOT NULL,
  doctor_id       uuid NOT NULL,
  branch_id       uuid NOT NULL,
  visit_id        uuid,
  plan_item_id    uuid,
  work_type       text NOT NULL CHECK (work_type IN ('crown','bridge','veneer','inlay_onlay','denture_full','denture_partial',
                                                     'implant_crown','aligner','retainer','night_guard','other')),
  teeth           smallint[] NOT NULL DEFAULT '{}',
  shade           text,                                         -- A2, B1 ...
  material        text,                                         -- zirconia, e.max, PFM ...
  instructions    text,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','in_progress','received','fitted','remake','cancelled')),
  sent_at         timestamptz,
  due_date        date,
  received_at     timestamptz,
  fitted_at       timestamptz,
  cost_minor      bigint CHECK (cost_minor >= 0),
  currency        char(3),
  remake_of_id    uuid,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lab_id)       REFERENCES labs(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)   REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)    REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)    REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, visit_id)     REFERENCES visits(tenant_id, id),
  FOREIGN KEY (tenant_id, plan_item_id) REFERENCES treatment_plan_items(tenant_id, id),
  FOREIGN KEY (tenant_id, remake_of_id) REFERENCES lab_orders(tenant_id, id),
  CHECK (status = 'draft' OR sent_at IS NOT NULL),
  CHECK (status NOT IN ('received','fitted') OR received_at IS NOT NULL),
  CHECK (cost_minor IS NULL OR currency IS NOT NULL)
);
CREATE INDEX lab_orders_open ON lab_orders (tenant_id, due_date) WHERE status IN ('sent','in_progress');

-- Recall: "come back for your 6-month check-up"
CREATE TABLE recalls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL,
  doctor_id          uuid,
  reason             text NOT NULL CHECK (reason IN ('checkup','cleaning','ortho_adjustment','post_op','implant_followup','other')),
  due_date           date NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','booked','done','dismissed')),
  appointment_id     uuid,
  source_visit_id    uuid,
  last_contacted_at  timestamptz,
  contact_attempts   smallint NOT NULL DEFAULT 0,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id)      REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, doctor_id)       REFERENCES doctors(tenant_id, id) ON DELETE SET NULL (doctor_id),
  FOREIGN KEY (tenant_id, appointment_id)  REFERENCES appointments(tenant_id, id) ON DELETE SET NULL (appointment_id),
  FOREIGN KEY (tenant_id, source_visit_id) REFERENCES visits(tenant_id, id) ON DELETE SET NULL (source_visit_id),
  CHECK (status <> 'booked' OR appointment_id IS NOT NULL)
);
CREATE INDEX recalls_due ON recalls (tenant_id, due_date) WHERE status IN ('pending','contacted');

CREATE TABLE waitlist_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id              uuid NOT NULL,
  branch_id               uuid NOT NULL,
  doctor_id               uuid,                                 -- null = any doctor
  service_id              uuid,
  earliest_date           date NOT NULL,
  latest_date             date NOT NULL,
  preferred_period        text CHECK (preferred_period IN ('morning','afternoon','evening','any')),
  status                  text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','expired','cancelled')),
  offered_appointment_id  uuid,
  offer_expires_at        timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id)  REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)  REFERENCES doctors(tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, offered_appointment_id) REFERENCES appointments(tenant_id, id) ON DELETE SET NULL (offered_appointment_id),
  CHECK (latest_date >= earliest_date),
  CHECK (status <> 'offered' OR (offered_appointment_id IS NOT NULL AND offer_expires_at IS NOT NULL))
);
CREATE INDEX waitlist_open ON waitlist_entries (tenant_id, branch_id, earliest_date) WHERE status = 'waiting';

-- =====================================================================
-- 6. CLINIC BILLING (patient pays clinic)
-- =====================================================================

CREATE TABLE invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        uuid NOT NULL,
  patient_id       uuid NOT NULL,
  number           text,                                        -- assigned on issue: INV-2026-000123
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','issued','partially_paid','paid','void')),
  currency         char(3) NOT NULL,
  subtotal_minor   bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor   bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor        bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor      bigint NOT NULL DEFAULT 0,                    -- derived by trigger
  paid_minor       bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  balance_minor    bigint GENERATED ALWAYS AS (total_minor - paid_minor) STORED,
  issue_date       date,
  due_date         date,
  notes            text,
  void_reason      text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)  REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id),
  CHECK (total_minor = subtotal_minor - discount_minor + tax_minor),
  CHECK (status = 'draft' OR total_minor >= 0),             -- a draft may hold a discount before its lines
  CHECK (status = 'draft' OR paid_minor <= total_minor),
  CHECK (status IN ('draft','void') OR number IS NOT NULL),   -- a never-issued draft can be voided
  CHECK (status <> 'void' OR void_reason IS NOT NULL)
);
CREATE INDEX ON invoices (tenant_id, patient_id, created_at DESC);
CREATE INDEX invoices_open ON invoices (tenant_id, due_date) WHERE status IN ('issued','partially_paid');

CREATE TABLE invoice_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  invoice_id          uuid NOT NULL,
  service_id          uuid,
  visit_procedure_id  uuid,                                     -- billed once outside void invoices (trigger)
  doctor_id           uuid,
  description         text NOT NULL,
  tooth_code          smallint,
  quantity            int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor    bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor      bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor    bigint NOT NULL CHECK (line_total_minor >= 0),
  sort_order          int NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id, invoice_id)         REFERENCES invoices(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id)         REFERENCES services(tenant_id, id),
  FOREIGN KEY (tenant_id, visit_procedure_id) REFERENCES visit_procedures(tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id)          REFERENCES doctors(tenant_id, id),
  CHECK (line_total_minor = quantity * unit_price_minor - discount_minor)
);

-- Installments (braces, implants): a plan of dated amounts, paid through normal payments
CREATE TABLE payment_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id          uuid NOT NULL,
  invoice_id          uuid,
  treatment_plan_id   uuid,
  currency            char(3) NOT NULL,
  total_minor         bigint NOT NULL CHECK (total_minor > 0),
  down_payment_minor  bigint NOT NULL DEFAULT 0 CHECK (down_payment_minor >= 0),
  installments_count  smallint NOT NULL CHECK (installments_count BETWEEN 1 AND 60),
  start_date          date NOT NULL,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','defaulted','cancelled')),
  notes               text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)        REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id)        REFERENCES invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, treatment_plan_id) REFERENCES treatment_plans(tenant_id, id),
  CHECK (down_payment_minor < total_minor)
);

CREATE TABLE installments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  plan_id       uuid NOT NULL,
  seq           smallint NOT NULL CHECK (seq > 0),
  due_date      date NOT NULL,
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  paid_minor    bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  status        text NOT NULL DEFAULT 'due' CHECK (status IN ('due','partially_paid','paid','waived')),
  paid_at       timestamptz,
  UNIQUE (plan_id, seq),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES payment_plans(tenant_id, id) ON DELETE CASCADE,
  CHECK (paid_minor <= amount_minor),
  CHECK (status <> 'paid' OR paid_minor = amount_minor)
);
-- "overdue" is computed: status in (due, partially_paid) and due_date < today
CREATE INDEX installments_open ON installments (tenant_id, due_date) WHERE status IN ('due','partially_paid');

-- Clinic's own gateway credentials (encrypted with app key, never returned by the API)
CREATE TABLE payment_gateways (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('paymob','fawry','stripe')),
  mode             text NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live')),
  credentials_enc  bytea NOT NULL,
  public_config    jsonb NOT NULL DEFAULT '{}',                 -- integration ids, iframe id
  is_active        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL,
  patient_id        uuid NOT NULL,
  invoice_id        uuid,
  appointment_id    uuid,                                       -- online deposit before an invoice exists
  installment_id    uuid,
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  currency          char(3) NOT NULL,
  method            text NOT NULL CHECK (method IN ('cash','card','wallet','bank_transfer','instapay','online','insurance')),
  status            text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded')),
  refunded_minor    bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  provider          text,
  provider_ref      text,
  idempotency_key   text,
  received_by       uuid,
  paid_at           timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, provider, provider_ref),
  FOREIGN KEY (tenant_id, branch_id)      REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)     REFERENCES patients(tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id)     REFERENCES invoices(tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id),
  FOREIGN KEY (tenant_id, installment_id) REFERENCES installments(tenant_id, id),
  CHECK (refunded_minor <= amount_minor),
  CHECK (status <> 'succeeded' OR paid_at IS NOT NULL),
  CHECK (method <> 'online' OR provider IS NOT NULL)
);
CREATE INDEX ON payments (tenant_id, paid_at DESC);
CREATE INDEX ON payments (tenant_id, invoice_id);

CREATE TABLE refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  payment_id    uuid NOT NULL,
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  reason        text NOT NULL,
  provider_ref  text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES payments(tenant_id, id)
);

CREATE TABLE expense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id)
);

CREATE TABLE suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  phone       text,
  email       citext,
  notes       text,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, id)
);

CREATE TABLE expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL,
  category_id   uuid NOT NULL,
  supplier_id   uuid,
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      char(3) NOT NULL,
  spent_on      date NOT NULL,
  description   text,
  file_id       uuid,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id)   REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES expense_categories(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, file_id)     REFERENCES files(tenant_id, id)
);
CREATE INDEX ON expenses (tenant_id, spent_on DESC);

-- Doctor commission payouts; commission amounts come from visit_procedures snapshots
CREATE TABLE doctor_payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doctor_id     uuid NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  currency      char(3) NOT NULL,
  amount_minor  bigint NOT NULL CHECK (amount_minor >= 0),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','void')),
  approved_by   uuid,
  paid_at       timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES doctors(tenant_id, id),
  CHECK (period_end >= period_start),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
ALTER TABLE visit_procedures
  ADD FOREIGN KEY (tenant_id, payout_id) REFERENCES doctor_payouts(tenant_id, id) ON DELETE SET NULL (payout_id);

-- ---------------------------------------------------------------------
-- 6b. BILLING INTEGRITY: totals, paid amounts and statuses are derived
--     by the database, never trusted from the client. The parent row is
--     locked (FOR UPDATE) before a child changes, so concurrent payments
--     or refunds are serialized and never lose an update.
-- ---------------------------------------------------------------------

-- invoices: subtotal, paid, total and status always recomputed from children
CREATE OR REPLACE FUNCTION invoices_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
      RAISE EXCEPTION 'invoice % cannot go back to draft', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'void' AND NEW.status <> 'void' THEN
      RAISE EXCEPTION 'a void invoice cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.discount_minor <> OLD.discount_minor OR NEW.tax_minor <> OLD.tax_minor
        OR NEW.currency <> OLD.currency OR NEW.patient_id <> OLD.patient_id) THEN
      RAISE EXCEPTION 'issued invoice % is locked (discount, tax, currency, patient)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.subtotal_minor := (SELECT coalesce(sum(line_total_minor), 0) FROM invoice_items WHERE invoice_id = NEW.id);
  NEW.paid_minor     := (SELECT coalesce(sum(amount_minor - refunded_minor), 0) FROM payments
                         WHERE invoice_id = NEW.id AND status IN ('succeeded','partially_refunded','refunded'));
  NEW.total_minor    := NEW.subtotal_minor - NEW.discount_minor + NEW.tax_minor;
  IF NEW.status = 'void' AND NEW.paid_minor > 0 THEN
    RAISE EXCEPTION 'refund the % already paid before voiding invoice %', NEW.paid_minor, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('draft','void') THEN
    NEW.status := CASE WHEN NEW.paid_minor >= NEW.total_minor THEN 'paid'      -- includes 100% discount
                       WHEN NEW.paid_minor = 0 THEN 'issued'
                       ELSE 'partially_paid' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_derive BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_derive();

-- only drafts can be deleted (void instead); tenant hard-delete sets app.allow_hard_delete = 'on'
CREATE OR REPLACE FUNCTION invoices_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND coalesce(current_setting('app.allow_hard_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'invoice % is %; void it instead of deleting', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER invoices_guard_delete BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_guard_delete();

-- touching the invoice makes invoices_derive recompute everything
CREATE OR REPLACE FUNCTION recalc_invoice(p_invoice uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE invoices SET updated_at = now() WHERE id = p_invoice
$$;

-- invoice lines: only on drafts (old AND new invoice), a procedure billed once outside void invoices
CREATE OR REPLACE FUNCTION invoice_items_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_inv uuid; v_status text;
BEGIN
  FOR v_inv IN SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END]) AS x WHERE x IS NOT NULL
  LOOP
    SELECT status INTO v_status FROM invoices WHERE id = v_inv FOR UPDATE;
    IF FOUND AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'invoice % is %, lines can only change on a draft', v_inv, v_status USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF TG_OP <> 'DELETE' AND NEW.visit_procedure_id IS NOT NULL THEN
    PERFORM 1 FROM visit_procedures WHERE id = NEW.visit_procedure_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
               WHERE ii.visit_procedure_id = NEW.visit_procedure_id AND ii.id <> NEW.id AND i.status <> 'void') THEN
      RAISE EXCEPTION 'procedure % is already billed', NEW.visit_procedure_id USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_items_validate BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_validate();

CREATE OR REPLACE FUNCTION invoice_items_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM recalc_invoice(NEW.invoice_id); END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.invoice_id <> NEW.invoice_id) THEN
    PERFORM recalc_invoice(OLD.invoice_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER invoice_items_changed AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_changed();

-- payments: lock the invoice/installment, then check patient, currency and invoice state
CREATE OR REPLACE FUNCTION payments_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record; pl record; v_appt_patient uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS NOT NULL AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM 1 FROM invoices WHERE id = OLD.invoice_id FOR UPDATE;
  END IF;
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, status, patient_id INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
    IF inv.currency <> NEW.currency THEN
      RAISE EXCEPTION 'payment currency % differs from invoice currency %', NEW.currency, inv.currency
        USING ERRCODE = 'check_violation';
    END IF;
    IF inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the invoice patient' USING ERRCODE = 'check_violation';
    END IF;
    IF inv.status IN ('draft','void') AND NEW.status IN ('succeeded','partially_refunded')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.invoice_id IS DISTINCT FROM NEW.invoice_id) THEN
      RAISE EXCEPTION 'cannot pay a % invoice', inv.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.installment_id IS NOT NULL THEN
    SELECT p.currency, p.patient_id INTO pl
    FROM installments s JOIN payment_plans p ON p.id = s.plan_id
    WHERE s.id = NEW.installment_id FOR UPDATE OF s;
    IF pl.currency <> NEW.currency OR pl.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment currency/patient does not match the installment plan' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.appointment_id IS NOT NULL THEN
    SELECT patient_id INTO v_appt_patient FROM appointments WHERE id = NEW.appointment_id;
    IF v_appt_patient IS NOT NULL AND v_appt_patient <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment patient does not match the appointment patient' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_validate BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_validate();

-- after a payment changes: refresh its invoice, installment and plan
CREATE OR REPLACE FUNCTION payments_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT x.inv, x.inst FROM (VALUES
             (NEW.invoice_id, NEW.installment_id), (OLD.invoice_id, OLD.installment_id)) AS x(inv, inst)
  LOOP
    IF r.inv IS NOT NULL THEN PERFORM recalc_invoice(r.inv); END IF;
    IF r.inst IS NOT NULL THEN
      UPDATE installments s SET
        paid_minor = least(s.amount_minor, (SELECT coalesce(sum(amount_minor - refunded_minor), 0) FROM payments
                     WHERE installment_id = r.inst AND status IN ('succeeded','partially_refunded','refunded')))
      WHERE s.id = r.inst;
      UPDATE installments s SET
        status  = CASE WHEN s.status = 'waived' THEN 'waived'
                       WHEN s.paid_minor = 0 THEN 'due'
                       WHEN s.paid_minor >= s.amount_minor THEN 'paid'
                       ELSE 'partially_paid' END,
        paid_at = CASE WHEN s.paid_minor >= s.amount_minor THEN coalesce(s.paid_at, now()) END
      WHERE s.id = r.inst;
      UPDATE payment_plans pp SET status =
        CASE WHEN EXISTS (SELECT 1 FROM installments WHERE plan_id = pp.id AND status IN ('due','partially_paid'))
             THEN 'active' ELSE 'completed' END
      WHERE pp.id = (SELECT plan_id FROM installments WHERE id = r.inst) AND pp.status IN ('active','completed');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER payments_changed AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_changed();

-- refunds: only on succeeded payments, never more than was paid; locks invoice then payment
CREATE OR REPLACE FUNCTION refunds_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; v_inv uuid; v_other bigint;
BEGIN
  SELECT invoice_id INTO v_inv FROM payments WHERE id = NEW.payment_id;
  IF v_inv IS NOT NULL THEN PERFORM 1 FROM invoices WHERE id = v_inv FOR UPDATE; END IF;
  SELECT status, amount_minor INTO p FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF p.status NOT IN ('succeeded','partially_refunded') THEN
    RAISE EXCEPTION 'only a succeeded payment can be refunded (status %)', p.status USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_minor), 0) INTO v_other FROM refunds WHERE payment_id = NEW.payment_id AND id <> NEW.id;
  IF v_other + NEW.amount_minor > p.amount_minor THEN
    RAISE EXCEPTION 'refunds (% + %) exceed the payment %', v_other, NEW.amount_minor, p.amount_minor
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refunds_validate BEFORE INSERT OR UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_validate();

CREATE OR REPLACE FUNCTION refunds_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pay uuid := coalesce(NEW.payment_id, OLD.payment_id);
BEGIN
  UPDATE payments p SET refunded_minor = (SELECT coalesce(sum(amount_minor), 0) FROM refunds WHERE payment_id = v_pay)
  WHERE p.id = v_pay;
  UPDATE payments p SET status = CASE WHEN p.refunded_minor = 0 THEN 'succeeded'
                                      WHEN p.refunded_minor >= p.amount_minor THEN 'refunded'
                                      ELSE 'partially_refunded' END
  WHERE p.id = v_pay AND p.status IN ('succeeded','partially_refunded','refunded');
  RETURN NULL;
END $$;
CREATE TRIGGER refunds_changed AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_changed();

-- installment plan must match its invoice's patient and currency
CREATE OR REPLACE FUNCTION payment_plans_validate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv record;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT currency, patient_id INTO inv FROM invoices WHERE id = NEW.invoice_id;
    IF inv.currency <> NEW.currency OR inv.patient_id <> NEW.patient_id THEN
      RAISE EXCEPTION 'payment plan currency/patient does not match the invoice' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_plans_validate BEFORE INSERT OR UPDATE ON payment_plans
  FOR EACH ROW EXECUTE FUNCTION payment_plans_validate();

-- ---------------------------------------------------------------------
-- 6c. PAYOUT AND WORKFLOW GUARDS
-- ---------------------------------------------------------------------

-- payout amount = sum of its procedures' frozen commissions; periods never overlap
ALTER TABLE doctor_payouts ADD CONSTRAINT doctor_payouts_no_overlap EXCLUDE USING gist (
  doctor_id WITH =, daterange(period_start, period_end, '[]') WITH &&
) WHERE (status <> 'void');

CREATE OR REPLACE FUNCTION doctor_payouts_derive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'payout % is already paid', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.amount_minor := (SELECT coalesce(sum(commission_minor), 0) FROM visit_procedures WHERE payout_id = NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER doctor_payouts_derive BEFORE INSERT OR UPDATE ON doctor_payouts
  FOR EACH ROW EXECUTE FUNCTION doctor_payouts_derive();

-- a procedure joins only a draft payout of the same doctor; attached to an approved payout it is frozen
CREATE OR REPLACE FUNCTION visit_procedures_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE po record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.payout_id IS NOT NULL THEN
    SELECT status INTO po FROM doctor_payouts WHERE id = OLD.payout_id FOR UPDATE;
    IF po.status <> 'draft' AND (NEW.payout_id IS DISTINCT FROM OLD.payout_id OR NEW.price_minor <> OLD.price_minor
        OR NEW.commission_bp <> OLD.commission_bp OR NEW.doctor_id <> OLD.doctor_id) THEN
      RAISE EXCEPTION 'procedure % belongs to a % payout and is frozen', OLD.id, po.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.payout_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.payout_id IS DISTINCT FROM OLD.payout_id) THEN
    SELECT doctor_id, status INTO po FROM doctor_payouts WHERE id = NEW.payout_id FOR UPDATE;
    IF po.doctor_id <> NEW.doctor_id OR po.status <> 'draft' THEN
      RAISE EXCEPTION 'procedure can join only a draft payout of the same doctor' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_procedures_payout_guard BEFORE INSERT OR UPDATE ON visit_procedures
  FOR EACH ROW EXECUTE FUNCTION visit_procedures_payout_guard();

CREATE OR REPLACE FUNCTION visit_procedures_payout_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE doctor_payouts SET status = status
  WHERE id IN (CASE WHEN TG_OP <> 'DELETE' THEN NEW.payout_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.payout_id END);
  RETURN NULL;
END $$;
CREATE TRIGGER visit_procedures_payout_changed AFTER INSERT OR UPDATE OR DELETE ON visit_procedures
  FOR EACH ROW EXECUTE FUNCTION visit_procedures_payout_changed();

-- appointment status machine (section 4.10 of the SRS)
CREATE OR REPLACE FUNCTION appointments_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) NOT IN (
      ('held','expired'), ('held','pending'), ('held','confirmed'), ('held','cancelled'),
      ('pending','confirmed'), ('pending','checked_in'), ('pending','cancelled'), ('pending','no_show'),
      ('confirmed','checked_in'), ('confirmed','cancelled'), ('confirmed','no_show'),
      ('checked_in','in_progress'), ('checked_in','completed'), ('checked_in','cancelled'),
      ('in_progress','completed')) THEN
    RAISE EXCEPTION 'appointment cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointments_transition BEFORE UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_transition();

-- Reception: check a patient in with the booking code (runs as app_user under RLS).
-- One UPDATE finds and consumes the code atomically, so a code can never be used twice.
-- Returns what the receptionist needs to see, including what is still to be paid.
CREATE OR REPLACE FUNCTION check_in_by_code(p_code_hash text, p_branch uuid, p_member uuid, p_method text DEFAULT 'code')
RETURNS TABLE (appointment_id uuid, patient_id uuid, doctor_id uuid, service_id uuid, starts_at timestamptz,
               payment_mode text, quoted_price_minor bigint, paid_online_minor bigint, amount_due_minor bigint)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_method NOT IN ('code','qr') THEN
    RAISE EXCEPTION 'check_in_by_code accepts code or qr only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY
  WITH hit AS (
    UPDATE appointments a SET
      status = 'checked_in', checked_in_at = now(), check_in_code_used_at = now(),
      check_in_method = p_method, checked_in_by = p_member
    WHERE a.check_in_code_hash = p_code_hash
      AND a.check_in_code_used_at IS NULL
      AND a.check_in_code_expires_at > now()
      AND a.branch_id = p_branch
      AND a.status IN ('pending','confirmed')
    RETURNING a.id, a.patient_id, a.doctor_id, a.service_id, a.starts_at, a.payment_mode, a.quoted_price_minor)
  SELECT h.id, h.patient_id, h.doctor_id, h.service_id, h.starts_at, h.payment_mode, h.quoted_price_minor,
         coalesce(pay.paid, 0)::bigint,
         greatest(coalesce(h.quoted_price_minor, 0) - coalesce(pay.paid, 0), 0)::bigint
  FROM hit h
  LEFT JOIN LATERAL (SELECT sum(p.amount_minor - p.refunded_minor) AS paid FROM payments p
                     WHERE p.appointment_id = h.id AND p.status IN ('succeeded','partially_refunded')) pay ON true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking code not valid for this branch today (wrong, used, expired or cancelled)'
      USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- indexes for trigger lookups, ledgers and reports
CREATE INDEX ON invoice_items (invoice_id);
CREATE INDEX ON invoice_items (visit_procedure_id) WHERE visit_procedure_id IS NOT NULL;
CREATE INDEX ON refunds (payment_id);
CREATE INDEX ON payments (installment_id) WHERE installment_id IS NOT NULL;
CREATE INDEX ON payments (tenant_id, patient_id, paid_at DESC);
CREATE INDEX ON payments (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX ON visit_procedures (visit_id);
CREATE INDEX ON visit_procedures (tenant_id, doctor_id, created_at);
CREATE INDEX ON visit_procedures (payout_id) WHERE payout_id IS NOT NULL;
CREATE INDEX ON treatment_plan_items (plan_id);
CREATE INDEX ON prescriptions (visit_id);
CREATE INDEX ON prescription_items (prescription_id);
CREATE INDEX ON patient_files (file_id);
CREATE INDEX ON member_branches (branch_id);
CREATE INDEX ON doctor_branches (branch_id);
CREATE INDEX ON invoices (tenant_id, issue_date) WHERE status <> 'void';
CREATE INDEX ON payment_plans (tenant_id, patient_id);
CREATE INDEX ON lab_orders (tenant_id, patient_id);
CREATE INDEX ON appointments (room_id, starts_at) WHERE room_id IS NOT NULL;

-- =====================================================================
-- 7. INVENTORY
-- =====================================================================

CREATE TABLE inventory_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku              text NOT NULL,
  name             text NOT NULL,
  category         text,                                        -- consumables, instruments, medicines
  unit             text NOT NULL DEFAULT 'pcs',                 -- pcs, box, ml, g
  min_stock        numeric(12,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  last_cost_minor  bigint CHECK (last_cost_minor >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku),
  UNIQUE (tenant_id, id)
);

-- Current stock is maintained from movements in the same transaction
CREATE TABLE inventory_stock (
  tenant_id   uuid NOT NULL,
  item_id     uuid NOT NULL,
  branch_id   uuid NOT NULL,
  quantity    numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, branch_id),
  FOREIGN KEY (tenant_id, item_id)   REFERENCES inventory_items(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE inventory_movements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  item_id          uuid NOT NULL,
  branch_id        uuid NOT NULL,
  type             text NOT NULL CHECK (type IN ('purchase','usage','adjustment','transfer_in','transfer_out','return','expired')),
  quantity         numeric(12,3) NOT NULL CHECK (quantity <> 0),  -- signed: + in, - out
  unit_cost_minor  bigint CHECK (unit_cost_minor >= 0),
  supplier_id      uuid,
  visit_id         uuid,
  transfer_id      uuid,                                         -- pairs transfer_out with transfer_in
  reference        text,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, item_id)     REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)   REFERENCES branches(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id),
  FOREIGN KEY (tenant_id, visit_id)    REFERENCES visits(tenant_id, id),
  CHECK ((type IN ('purchase','transfer_in','return') AND quantity > 0)
      OR (type IN ('usage','transfer_out','expired') AND quantity < 0)
      OR  type = 'adjustment')
);
CREATE INDEX ON inventory_movements (tenant_id, item_id, created_at DESC);

-- =====================================================================
-- 8. WEBSITE
-- =====================================================================

CREATE TABLE sites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  template_id        uuid NOT NULL REFERENCES templates(id),
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','maintenance')),
  -- theme: {"primary":"#0E7C86","secondary":"...","font_ar":"Cairo","font_en":"Inter","radius":"md"}
  draft_theme        jsonb NOT NULL DEFAULT '{}',
  published_theme    jsonb,
  published_version  int NOT NULL DEFAULT 0,
  published_at       timestamptz,
  locales            text[] NOT NULL DEFAULT '{ar,en}' CHECK (locales <@ ARRAY['ar','en']::text[] AND cardinality(locales) > 0),
  favicon_file_id    uuid,
  show_powered_by    boolean NOT NULL DEFAULT true,
  ga_measurement_id  text,
  meta_pixel_id      text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, favicon_file_id) REFERENCES files(tenant_id, id) ON DELETE SET NULL (favicon_file_id)
);

-- Pages hold ordered sections; draft vs published copies so edits don't go live until Publish
CREATE TABLE site_pages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  site_id             uuid NOT NULL,
  slug                text NOT NULL,                            -- '' = home, about, services, doctors, contact
  title_en            text,
  title_ar            text,
  -- [{"type":"hero","enabled":true,"props":{"heading_ar":"...","cta":"book"}}, ...]
  draft_sections      jsonb NOT NULL DEFAULT '[]',
  published_sections  jsonb,
  seo                 jsonb NOT NULL DEFAULT '{}',              -- {"title_ar","desc_ar","title_en","desc_en","og_file_id"}
  show_in_nav         boolean NOT NULL DEFAULT true,
  is_enabled          boolean NOT NULL DEFAULT true,
  sort_order          int NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE CASCADE,
  CHECK (slug ~ '^([a-z0-9-]{1,64})?$')
);

-- Hostname -> tenant. Read by the public-site middleware via a SECURITY DEFINER lookup.
CREATE TABLE domains (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hostname            citext NOT NULL,                          -- dr-ahmed.yourbrand.com, drahmed.com
  type                text NOT NULL CHECK (type IN ('subdomain','custom')),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','active','failed','removed')),
  is_primary          boolean NOT NULL DEFAULT false,
  verification_token  text,
  verified_at         timestamptz,
  last_checked_at     timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX domains_one_primary ON domains (tenant_id) WHERE is_primary;
-- a hostname is owned only once verified by DNS; pending claims cannot squat it
CREATE UNIQUE INDEX domains_live_hostname ON domains (hostname) WHERE status IN ('verified','active');
CREATE UNIQUE INDEX domains_tenant_hostname ON domains (tenant_id, hostname) WHERE status <> 'removed';

CREATE TABLE faqs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id  uuid,
  question_en text, answer_en text,
  question_ar text, answer_ar text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id, service_id) REFERENCES services(tenant_id, id) ON DELETE SET NULL (service_id)
);

-- Before/after cases and gallery; patient consent is mandatory to publish
CREATE TABLE gallery_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type               text NOT NULL CHECK (type IN ('photo','before_after')),
  service_id         uuid,
  image_file_id      uuid NOT NULL,                             -- photo, or the "after" image
  before_file_id     uuid,
  caption_en         text,
  caption_ar         text,
  consent_confirmed  boolean NOT NULL DEFAULT false,
  is_published       boolean NOT NULL DEFAULT false,
  sort_order         int NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, service_id)     REFERENCES services(tenant_id, id) ON DELETE SET NULL (service_id),
  FOREIGN KEY (tenant_id, image_file_id)  REFERENCES files(tenant_id, id),
  FOREIGN KEY (tenant_id, before_file_id) REFERENCES files(tenant_id, id),
  CHECK (type <> 'before_after' OR before_file_id IS NOT NULL),
  CHECK (NOT is_published OR type = 'photo' OR consent_confirmed)
);

CREATE TABLE reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id      uuid,
  appointment_id  uuid UNIQUE,                                  -- one review per visit
  doctor_id       uuid,
  author_name     text NOT NULL,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
  source          text NOT NULL DEFAULT 'link' CHECK (source IN ('link','manual','google_import')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, patient_id)     REFERENCES patients(tenant_id, id) ON DELETE SET NULL (patient_id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id) ON DELETE SET NULL (appointment_id),
  FOREIGN KEY (tenant_id, doctor_id)      REFERENCES doctors(tenant_id, id) ON DELETE SET NULL (doctor_id)
);
CREATE INDEX reviews_approved ON reviews (tenant_id, created_at DESC) WHERE status = 'approved';

CREATE TABLE posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  locale          text NOT NULL CHECK (locale IN ('ar','en')),
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9-]{1,120}$' OR locale = 'ar'),
  title           text NOT NULL,
  excerpt         text,
  body            text NOT NULL,                                -- sanitized HTML / MDX
  cover_file_id   uuid,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  seo             jsonb NOT NULL DEFAULT '{}',
  published_at    timestamptz,
  author_member_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, locale, slug),
  FOREIGN KEY (tenant_id, cover_file_id) REFERENCES files(tenant_id, id) ON DELETE SET NULL (cover_file_id),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- =====================================================================
-- 9. NOTIFICATIONS, AUDIT, OUTBOX
-- =====================================================================

CREATE TABLE notification_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event       text NOT NULL,                                    -- booking.created, appointment.reminder ...
  channel     text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  locale      text NOT NULL CHECK (locale IN ('ar','en')),
  subject     text,
  body        text NOT NULL,                                    -- with {{variables}}
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event, channel, locale)
);

CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event                text NOT NULL,
  channel              text NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  recipient            text NOT NULL,
  patient_id           uuid,
  member_id            uuid,
  subject              text,
  body                 text NOT NULL,
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','cancelled')),
  provider             text,
  provider_message_id  text,
  attempts             smallint NOT NULL DEFAULT 0,
  last_error           text,
  dedupe_key           text,                                    -- e.g. reminder:<appointment_id>:1440
  related_type         text,
  related_id           uuid,
  scheduled_at         timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES patients(tenant_id, id) ON DELETE SET NULL (patient_id),
  FOREIGN KEY (tenant_id, member_id)  REFERENCES tenant_members(tenant_id, id) ON DELETE SET NULL (member_id)
);
CREATE INDEX notifications_due ON notifications (scheduled_at) WHERE status = 'queued';
CREATE INDEX ON notifications (tenant_id, created_at DESC);

CREATE TABLE in_app_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  member_id   uuid NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, member_id) REFERENCES tenant_members(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX in_app_unread ON in_app_notifications (member_id, created_at DESC) WHERE read_at IS NULL;

-- Partition audit_log and notifications by month (pg_partman) at ~1M rows.
-- Optional: app-level encryption (AES-GCM) for visits.clinical_notes and
-- patient_medical_history.notes; those fields then cannot be searched in SQL.
CREATE TABLE audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type      text NOT NULL CHECK (actor_type IN ('member','patient','system','platform_admin')),
  actor_user_id   uuid,
  action          text NOT NULL,                                -- patient.view, invoice.void, settings.update
  entity_type     text NOT NULL,
  entity_id       uuid,
  changes         jsonb,                                        -- {"field":[old,new]}; no medical free text
  ip              inet,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (tenant_id, created_at DESC);
CREATE INDEX ON audit_log (tenant_id, entity_type, entity_id);

-- Transactional outbox: write the event in the same tx as the change, a worker publishes it
CREATE TABLE outbox_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  type          text NOT NULL,                                  -- appointment.created, site.published
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  attempts      int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending ON outbox_events (id) WHERE processed_at IS NULL;

-- =====================================================================
-- 10. updated_at triggers
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END $$;

-- =====================================================================
-- 11. ROW-LEVEL SECURITY
-- The API connects as role app_user (no BYPASSRLS) and, inside each
-- request transaction, runs:  SET LOCAL app.tenant_id = '<uuid>';
-- Platform tables (plans, templates, service_catalog, users, tenants,
-- refresh_tokens, otp_codes, auth_events, leads, webhook_events,
-- platform_audit_log, domains lookup) are guarded in the service layer.
-- =====================================================================

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('webhook_events','platform_audit_log','refresh_tokens')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                     USING (tenant_id IS NOT DISTINCT FROM current_tenant_id())
                     WITH CHECK (tenant_id IS NOT DISTINCT FROM current_tenant_id())$p$, t);
  END LOOP;
END $$;

-- tenants has no tenant_id column: a clinic may see only its own row
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING (id = current_tenant_id()) WITH CHECK (id = current_tenant_id());
-- Signup: the API generates the tenant uuid, runs SET LOCAL app.tenant_id = it, then inserts.
-- Super-admin and billing jobs connect as a separate role with BYPASSRLS.

-- Release website holds whose time ran out (called by the booking insert and a 1-minute job)
CREATE OR REPLACE FUNCTION release_expired_holds(p_doctor uuid DEFAULT NULL) RETURNS int
LANGUAGE sql AS $$
  WITH x AS (
    UPDATE appointments SET status = 'expired'
    WHERE status = 'held' AND hold_expires_at < now()
      AND (p_doctor IS NULL OR doctor_id = p_doctor)
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;

-- Public-site hostname lookup without a tenant context (only returns the id).
-- Owner role must have BYPASSRLS (domains and tenants are both under RLS).
CREATE OR REPLACE FUNCTION resolve_tenant_by_host(p_host text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.tenant_id FROM domains d
  JOIN tenants t ON t.id = d.tenant_id
  WHERE d.hostname = p_host::citext
    AND d.status IN ('verified','active')
    AND t.status IN ('trialing','active','past_due')
    AND t.deleted_at IS NULL
  LIMIT 1
$$;

-- Caddy on-demand TLS "ask" endpoint uses this to allow certificate issuance
CREATE OR REPLACE FUNCTION domain_allowed_for_tls(p_host text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM domains WHERE hostname = p_host::citext AND status IN ('verified','active'))
$$;

-- Atomic per-tenant sequence (invoice numbers, patient file numbers)
CREATE OR REPLACE FUNCTION next_tenant_counter(p_key text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO tenant_counters (tenant_id, key, value)
  VALUES (current_tenant_id(), p_key, 1)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + 1
  RETURNING value
$$;

-- ---------------------------------------------------------------------
-- Cross-tenant lookups needed BEFORE a tenant is chosen. Each one returns
-- only what its flow needs. Owner must be a role with BYPASSRLS
-- (app_definer below); EXECUTE is granted to app_user only.
-- ---------------------------------------------------------------------

-- login / tenant picker: which clinics does this user belong to?
CREATE OR REPLACE FUNCTION memberships_for_user(p_user uuid)
RETURNS TABLE (tenant_id uuid, slug citext, name_en text, name_ar text, tenant_status text, role_key text, member_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.slug, t.name_en, t.name_ar, t.status, r.key, m.status
  FROM tenant_members m
  JOIN tenants t ON t.id = m.tenant_id
  JOIN roles r ON r.id = m.role_id
  WHERE m.user_id = p_user AND t.deleted_at IS NULL
$$;

-- invitation link: find the open invitation by its hashed token
CREATE OR REPLACE FUNCTION invitation_by_token(p_token_hash text)
RETURNS TABLE (invitation_id uuid, tenant_id uuid, email citext, phone text, role_id uuid, branch_ids uuid[], expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, tenant_id, email, phone, role_id, branch_ids, expires_at
  FROM invitations
  WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
$$;

-- payment webhook: which clinic owns this gateway reference?
CREATE OR REPLACE FUNCTION tenant_for_payment(p_provider text, p_provider_ref text)
RETURNS TABLE (tenant_id uuid, payment_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id, id FROM payments WHERE provider = p_provider AND provider_ref = p_provider_ref
$$;

-- 1-minute job: release expired holds in every clinic
CREATE OR REPLACE FUNCTION release_all_expired_holds() RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH x AS (
    UPDATE appointments SET status = 'expired'
    WHERE status = 'held' AND hold_expires_at < now()
    RETURNING 1)
  SELECT count(*)::int FROM x
$$;

-- warn at migration time if the SECURITY DEFINER functions above would see nothing
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE WARNING 'run this migration as a role with BYPASSRLS (or ALTER FUNCTION ... OWNER TO app_definer), '
                  'otherwise resolve_tenant_by_host and the lookups above return no rows';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION memberships_for_user(uuid), invitation_by_token(text), tenant_for_payment(text, text),
  release_all_expired_holds(), resolve_tenant_by_host(text), domain_allowed_for_tls(text) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Roles (create once per environment, then run the GRANTs)
-- ---------------------------------------------------------------------
-- app_definer : NOLOGIN BYPASSRLS        owns the SECURITY DEFINER functions
-- app_user    : LOGIN NOBYPASSRLS        the API; every request sets app.tenant_id
-- app_worker  : LOGIN BYPASSRLS          queue workers, outbox relay, billing and cleanup jobs
--
-- CREATE ROLE app_definer NOLOGIN BYPASSRLS;
-- CREATE ROLE app_user   LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;
-- CREATE ROLE app_worker LOGIN PASSWORD '...' NOSUPERUSER BYPASSRLS;
-- ALTER FUNCTION memberships_for_user(uuid) OWNER TO app_definer;   -- same for the other definer functions
-- GRANT USAGE ON SCHEMA public TO app_user, app_worker;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user, app_worker;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_user, app_worker;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_worker;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO app_user, app_worker;
-- GRANT EXECUTE ON FUNCTION memberships_for_user(uuid), invitation_by_token(text), tenant_for_payment(text, text),
--   resolve_tenant_by_host(text), domain_allowed_for_tls(text) TO app_user;
-- GRANT EXECUTE ON FUNCTION release_all_expired_holds() TO app_worker;
-- Append-only and platform-controlled data:
-- REVOKE UPDATE, DELETE ON audit_log, platform_audit_log, tooth_records FROM app_user;
-- REVOKE INSERT, UPDATE, DELETE ON subscriptions, usage_counters, platform_invoices FROM app_user;  -- billing jobs only
-- REVOKE UPDATE ON tenants FROM app_user;            -- a table-level grant would override column revokes, so:
-- GRANT UPDATE (name_en, name_ar, onboarding_step, default_locale, timezone, logo_file_id, primary_phone, whatsapp,
--   email, social_links, specialties, about_en, about_ar, updated_at) ON tenants TO app_user;  -- status: worker/admin only

-- migrate:down
DO $$ BEGIN RAISE EXCEPTION 'The initial schema cannot be rolled back. Use: pnpm db:reset'; END $$;
