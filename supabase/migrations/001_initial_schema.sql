-- =====================================================
-- Job Search App — Initial Schema
-- =====================================================

-- ─────────────────────────────────────────
-- user_profiles
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id                   UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  desired_job_titles        TEXT[],
  industries                TEXT[],
  seniority_level           TEXT,
  skills                    TEXT[],
  certifications_licenses   TEXT[],
  work_authorization        TEXT,
  years_experience          INTEGER,
  location_preferences      JSONB,
  salary_min                INTEGER,
  salary_max                INTEGER,
  schedule_preferences      TEXT,
  company_size_preference   TEXT,
  culture_preferences       TEXT,
  deal_breakers             TEXT,
  work_history_summary      TEXT,
  raw_onboarding_transcript TEXT,
  onboarding_complete       BOOLEAN     NOT NULL DEFAULT FALSE,
  last_updated              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-level security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────
-- job_matches
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_matches (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_title               TEXT        NOT NULL,
  company                 TEXT        NOT NULL,
  location                TEXT,
  salary_range            TEXT,
  job_description         TEXT,
  apply_url               TEXT,
  match_reason            TEXT,
  match_score             INTEGER     CHECK (match_score BETWEEN 1 AND 10),
  source                  TEXT,
  user_feedback           TEXT        CHECK (user_feedback IN ('liked', 'disliked', NULL)),
  user_feedback_comment   TEXT,
  resume_generated        BOOLEAN     NOT NULL DEFAULT FALSE,
  cover_letter_generated  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-level security
ALTER TABLE public.job_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own job matches"
  ON public.job_matches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert job matches"
  ON public.job_matches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own job matches"
  ON public.job_matches FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for common query patterns
CREATE INDEX idx_job_matches_user_id        ON public.job_matches(user_id);
CREATE INDEX idx_job_matches_created_at     ON public.job_matches(created_at DESC);
CREATE INDEX idx_job_matches_match_score    ON public.job_matches(match_score DESC);
CREATE INDEX idx_job_matches_user_feedback  ON public.job_matches(user_feedback);

-- ─────────────────────────────────────────
-- onboarding_messages  (persists chat state)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row-level security
ALTER TABLE public.onboarding_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own onboarding messages"
  ON public.onboarding_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own onboarding messages"
  ON public.onboarding_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_onboarding_messages_user_id   ON public.onboarding_messages(user_id);
CREATE INDEX idx_onboarding_messages_created   ON public.onboarding_messages(created_at ASC);

-- ─────────────────────────────────────────
-- Trigger: auto-create an empty profile row when a user signs up
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
