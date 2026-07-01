CREATE TABLE public.vps_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host text NOT NULL DEFAULT '',
  port integer NOT NULL DEFAULT 22,
  username text NOT NULL DEFAULT '',
  private_key text NOT NULL DEFAULT '',
  simulator_mode boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vps_config TO authenticated;
GRANT ALL ON public.vps_config TO service_role;

ALTER TABLE public.vps_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own vps config"
ON public.vps_config FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_vps_config_updated_at
BEFORE UPDATE ON public.vps_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();