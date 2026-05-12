CREATE TABLE IF NOT EXISTS public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL DEFAULT 'info',
  source text NOT NULL DEFAULT 'bot',
  event text NOT NULL,
  message text,
  context jsonb DEFAULT '{}'::jsonb,
  chat_id bigint,
  user_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_created ON public.system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON public.system_logs(level);

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read system_logs" ON public.system_logs FOR SELECT USING (true);
CREATE POLICY "Service role full access system_logs" ON public.system_logs FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.system_logs;
ALTER TABLE public.system_logs REPLICA IDENTITY FULL;

-- Auto-cleanup function: keep last 5000 logs
CREATE OR REPLACE FUNCTION public.cleanup_old_system_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.system_logs
  WHERE id IN (
    SELECT id FROM public.system_logs
    ORDER BY created_at DESC
    OFFSET 5000
  );
END;
$$;