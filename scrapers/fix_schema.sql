-- Fix / create public.user_applications for My Jobs tracking
-- Run in the Supabase SQL Editor, then retry /my-jobs

create extension if not exists "pgcrypto";

CREATE TABLE IF NOT EXISTS public.user_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Compatibility with app queries that use applied_at + uniqueness
ALTER TABLE public.user_applications
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.user_applications
SET applied_at = COALESCE(applied_at, created_at, NOW())
WHERE applied_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_applications_user_id_job_id_key'
  ) THEN
    ALTER TABLE public.user_applications
      ADD CONSTRAINT user_applications_user_id_job_id_key UNIQUE (user_id, job_id);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN unique_violation THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS user_applications_user_id_idx
  ON public.user_applications (user_id, applied_at DESC);

ALTER TABLE public.user_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own applications" ON public.user_applications;
CREATE POLICY "Users read own applications"
  ON public.user_applications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own applications" ON public.user_applications;
CREATE POLICY "Users insert own applications"
  ON public.user_applications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own applications" ON public.user_applications;
CREATE POLICY "Users delete own applications"
  ON public.user_applications FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
