
-- Create extension for pg_cron and pg_net
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Telegram groups settings
CREATE TABLE public.telegram_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id BIGINT NOT NULL UNIQUE,
  title TEXT,
  welcome_message TEXT DEFAULT 'مرحباً بك في المجموعة! 👋',
  lock_links BOOLEAN DEFAULT false,
  lock_media BOOLEAN DEFAULT false,
  lock_stickers BOOLEAN DEFAULT false,
  lock_files BOOLEAN DEFAULT false,
  anti_spam BOOLEAN DEFAULT true,
  entertainment_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Telegram users (members)
CREATE TABLE public.telegram_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  points INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  warnings INTEGER DEFAULT 0,
  is_muted BOOLEAN DEFAULT false,
  is_banned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, chat_id)
);

-- Admin logs
CREATE TABLE public.telegram_admin_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  admin_user_id BIGINT,
  admin_username TEXT,
  target_user_id BIGINT,
  target_username TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Whispers
CREATE TABLE public.telegram_whispers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  from_user_id BIGINT NOT NULL,
  from_username TEXT,
  to_user_id BIGINT NOT NULL,
  to_username TEXT,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bot state for polling
CREATE TABLE public.telegram_bot_state (
  id INT PRIMARY KEY CHECK (id = 1),
  update_offset BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0);

-- Messages table
CREATE TABLE public.telegram_messages (
  update_id BIGINT PRIMARY KEY,
  chat_id BIGINT NOT NULL,
  user_id BIGINT,
  username TEXT,
  text TEXT,
  raw_update JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_messages_chat_id ON public.telegram_messages (chat_id);
CREATE INDEX idx_telegram_admin_logs_chat_id ON public.telegram_admin_logs (chat_id);
CREATE INDEX idx_telegram_users_chat_id ON public.telegram_users (chat_id);

-- Enable RLS on all tables
ALTER TABLE public.telegram_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_admin_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_whispers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_messages ENABLE ROW LEVEL SECURITY;

-- Public read policies (dashboard is public for now, no auth)
CREATE POLICY "Allow public read telegram_groups" ON public.telegram_groups FOR SELECT USING (true);
CREATE POLICY "Allow public read telegram_users" ON public.telegram_users FOR SELECT USING (true);
CREATE POLICY "Allow public read telegram_admin_logs" ON public.telegram_admin_logs FOR SELECT USING (true);
CREATE POLICY "Allow public read telegram_whispers" ON public.telegram_whispers FOR SELECT USING (true);
CREATE POLICY "Allow public read telegram_bot_state" ON public.telegram_bot_state FOR SELECT USING (true);
CREATE POLICY "Allow public read telegram_messages" ON public.telegram_messages FOR SELECT USING (true);

-- Service role insert/update (edge functions use service role)
CREATE POLICY "Service role full access telegram_groups" ON public.telegram_groups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access telegram_users" ON public.telegram_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access telegram_admin_logs" ON public.telegram_admin_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access telegram_whispers" ON public.telegram_whispers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access telegram_bot_state" ON public.telegram_bot_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access telegram_messages" ON public.telegram_messages FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for messages and logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.telegram_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.telegram_admin_logs;

-- Update timestamp function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_telegram_groups_updated_at BEFORE UPDATE ON public.telegram_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_telegram_users_updated_at BEFORE UPDATE ON public.telegram_users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
