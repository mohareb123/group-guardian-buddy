
-- Add new columns to telegram_groups for feature flags
ALTER TABLE public.telegram_groups
  ADD COLUMN IF NOT EXISTS night_mode_start integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS night_mode_end integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS captcha_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_faq_enabled boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS toxicity_filter boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS raid_protection boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS slow_mode_seconds integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_warnings integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS auto_trust_enabled boolean DEFAULT true;

-- Add reputation to telegram_users
ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS reputation integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trust_level integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS join_date timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS coins integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_streak integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_daily timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS captcha_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_warns integer DEFAULT 0;

-- Shop items table
CREATE TABLE IF NOT EXISTS public.telegram_shop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  name text NOT NULL,
  description text,
  price integer NOT NULL DEFAULT 100,
  item_type text NOT NULL DEFAULT 'role',
  value text,
  stock integer DEFAULT -1,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_shop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_shop_items" ON public.telegram_shop_items FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_shop_items" ON public.telegram_shop_items FOR ALL TO public USING (true) WITH CHECK (true);

-- Purchase history
CREATE TABLE IF NOT EXISTS public.telegram_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  item_id uuid REFERENCES public.telegram_shop_items(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  price integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_purchases" ON public.telegram_purchases FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_purchases" ON public.telegram_purchases FOR ALL TO public USING (true) WITH CHECK (true);

-- Scheduled messages
CREATE TABLE IF NOT EXISTS public.telegram_scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  message text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  sent boolean DEFAULT false,
  created_by bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_scheduled_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_scheduled_messages" ON public.telegram_scheduled_messages FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_scheduled_messages" ON public.telegram_scheduled_messages FOR ALL TO public USING (true) WITH CHECK (true);

-- Support tickets
CREATE TABLE IF NOT EXISTS public.telegram_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  username text,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  priority text DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by bigint
);
ALTER TABLE public.telegram_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_tickets" ON public.telegram_tickets FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_tickets" ON public.telegram_tickets FOR ALL TO public USING (true) WITH CHECK (true);

-- Daily challenges
CREATE TABLE IF NOT EXISTS public.telegram_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  title text NOT NULL,
  description text,
  reward_coins integer DEFAULT 50,
  reward_points integer DEFAULT 20,
  challenge_type text DEFAULT 'message_count',
  target_value integer DEFAULT 10,
  active_date date DEFAULT CURRENT_DATE,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_challenges" ON public.telegram_challenges FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_challenges" ON public.telegram_challenges FOR ALL TO public USING (true) WITH CHECK (true);

-- Challenge completions
CREATE TABLE IF NOT EXISTS public.telegram_challenge_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid REFERENCES public.telegram_challenges(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  user_id bigint NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_challenge_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_challenge_completions" ON public.telegram_challenge_completions FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_challenge_completions" ON public.telegram_challenge_completions FOR ALL TO public USING (true) WITH CHECK (true);

-- FAQ entries
CREATE TABLE IF NOT EXISTS public.telegram_faq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  keywords text[],
  usage_count integer DEFAULT 0,
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_faq ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_faq" ON public.telegram_faq FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_faq" ON public.telegram_faq FOR ALL TO public USING (true) WITH CHECK (true);

-- Saved/archived messages
CREATE TABLE IF NOT EXISTS public.telegram_saved_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  message_id bigint NOT NULL,
  saved_by bigint NOT NULL,
  text text,
  tag text DEFAULT 'general',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_saved_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_saved_messages" ON public.telegram_saved_messages FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_saved_messages" ON public.telegram_saved_messages FOR ALL TO public USING (true) WITH CHECK (true);

-- Court/appeal system
CREATE TABLE IF NOT EXISTS public.telegram_court_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id bigint NOT NULL,
  accused_user_id bigint NOT NULL,
  accused_username text,
  accuser_user_id bigint NOT NULL,
  accuser_username text,
  reason text NOT NULL,
  status text DEFAULT 'voting',
  verdict text,
  votes_for integer DEFAULT 0,
  votes_against integer DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_court_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_court_cases" ON public.telegram_court_cases FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_court_cases" ON public.telegram_court_cases FOR ALL TO public USING (true) WITH CHECK (true);

-- Court votes
CREATE TABLE IF NOT EXISTS public.telegram_court_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.telegram_court_cases(id) ON DELETE CASCADE,
  user_id bigint NOT NULL,
  vote boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id, user_id)
);
ALTER TABLE public.telegram_court_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read telegram_court_votes" ON public.telegram_court_votes FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_court_votes" ON public.telegram_court_votes FOR ALL TO public USING (true) WITH CHECK (true);

-- Increment coins function
CREATE OR REPLACE FUNCTION public.increment_coins(p_user_id bigint, p_chat_id bigint, p_amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.telegram_users SET coins = COALESCE(coins, 0) + p_amount
  WHERE user_id = p_user_id AND chat_id = p_chat_id;
END;
$$;

-- Update reputation function
CREATE OR REPLACE FUNCTION public.update_reputation(p_user_id bigint, p_chat_id bigint, p_amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.telegram_users SET reputation = COALESCE(reputation, 0) + p_amount
  WHERE user_id = p_user_id AND chat_id = p_chat_id;
END;
$$;

-- Increment message count
CREATE OR REPLACE FUNCTION public.increment_message_count(p_user_id bigint, p_chat_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.telegram_users 
  SET message_count = COALESCE(message_count, 0) + 1,
      last_message_at = now()
  WHERE user_id = p_user_id AND chat_id = p_chat_id;
END;
$$;

-- Auto trust level update
CREATE OR REPLACE FUNCTION public.update_trust_level(p_user_id bigint, p_chat_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_msg_count integer;
  v_reputation integer;
  v_days integer;
  v_new_trust integer;
BEGIN
  SELECT message_count, reputation, EXTRACT(DAY FROM now() - join_date)::integer
  INTO v_msg_count, v_reputation, v_days
  FROM public.telegram_users
  WHERE user_id = p_user_id AND chat_id = p_chat_id;

  v_msg_count := COALESCE(v_msg_count, 0);
  v_reputation := COALESCE(v_reputation, 0);
  v_days := COALESCE(v_days, 0);

  v_new_trust := 0;
  IF v_msg_count >= 10 AND v_days >= 1 THEN v_new_trust := 1; END IF;
  IF v_msg_count >= 50 AND v_days >= 7 AND v_reputation >= 5 THEN v_new_trust := 2; END IF;
  IF v_msg_count >= 200 AND v_days >= 30 AND v_reputation >= 20 THEN v_new_trust := 3; END IF;
  IF v_msg_count >= 500 AND v_days >= 60 AND v_reputation >= 50 THEN v_new_trust := 4; END IF;
  IF v_msg_count >= 1000 AND v_days >= 90 AND v_reputation >= 100 THEN v_new_trust := 5; END IF;

  UPDATE public.telegram_users SET trust_level = v_new_trust
  WHERE user_id = p_user_id AND chat_id = p_chat_id AND COALESCE(trust_level, 0) < v_new_trust;
END;
$$;
