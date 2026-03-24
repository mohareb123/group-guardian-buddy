CREATE TABLE public.telegram_pending_whispers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id bigint NOT NULL,
  from_username text,
  to_user_id bigint NOT NULL,
  to_username text,
  chat_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_pending_whispers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read telegram_pending_whispers" ON public.telegram_pending_whispers FOR SELECT TO public USING (true);
CREATE POLICY "Service role full access telegram_pending_whispers" ON public.telegram_pending_whispers FOR ALL TO public USING (true) WITH CHECK (true);