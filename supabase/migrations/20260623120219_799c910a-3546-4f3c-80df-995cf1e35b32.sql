CREATE TABLE IF NOT EXISTS public.telegram_config (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_config TO authenticated;
GRANT ALL ON public.telegram_config TO service_role;
ALTER TABLE public.telegram_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config readable by authenticated" ON public.telegram_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "service manages config" ON public.telegram_config FOR ALL TO service_role USING (true) WITH CHECK (true);