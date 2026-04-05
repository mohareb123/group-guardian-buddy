
-- Add security columns to telegram_groups
ALTER TABLE public.telegram_groups 
ADD COLUMN IF NOT EXISTS blacklist_words text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS restrict_new_accounts boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS new_account_days integer DEFAULT 7,
ADD COLUMN IF NOT EXISTS anti_flood boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS flood_max_messages integer DEFAULT 5,
ADD COLUMN IF NOT EXISTS flood_interval_seconds integer DEFAULT 3,
ADD COLUMN IF NOT EXISTS anti_forward_spam boolean DEFAULT true;

-- Table to track joins for raid detection (persists across function invocations)
CREATE TABLE IF NOT EXISTS public.telegram_raid_joins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raid_joins_chat_time ON public.telegram_raid_joins (chat_id, joined_at);

ALTER TABLE public.telegram_raid_joins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read telegram_raid_joins" ON public.telegram_raid_joins FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_raid_joins" ON public.telegram_raid_joins FOR ALL TO public USING (true) WITH CHECK (true);

-- Table to track captcha pending (for timeout auto-kick)
CREATE TABLE IF NOT EXISTS public.telegram_captcha_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(chat_id, user_id)
);

ALTER TABLE public.telegram_captcha_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read telegram_captcha_pending" ON public.telegram_captcha_pending FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_captcha_pending" ON public.telegram_captcha_pending FOR ALL TO public USING (true) WITH CHECK (true);

-- Clean up old raid joins (auto-cleanup function)
CREATE OR REPLACE FUNCTION public.cleanup_old_raid_joins()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.telegram_raid_joins WHERE joined_at < now() - interval '5 minutes';
END;
$$;
