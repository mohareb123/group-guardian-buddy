
CREATE TABLE IF NOT EXISTS public.hosted_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id bigint NOT NULL,
  owner_username text,
  chat_id bigint,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'python',
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  stdin text DEFAULT '',
  status text NOT NULL DEFAULT 'idle',
  run_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_output text,
  last_exit_code integer,
  last_duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_hosted_projects_owner ON public.hosted_projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_hosted_projects_updated ON public.hosted_projects(updated_at DESC);

ALTER TABLE public.hosted_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read hosted_projects" ON public.hosted_projects FOR SELECT USING (true);
CREATE POLICY "Service role full access hosted_projects" ON public.hosted_projects FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER trg_hosted_projects_updated_at
BEFORE UPDATE ON public.hosted_projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.hosting_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.hosted_projects(id) ON DELETE CASCADE,
  owner_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'success',
  exit_code integer,
  duration_ms integer,
  stdout text,
  stderr text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hosting_runs_project ON public.hosting_runs(project_id, created_at DESC);

ALTER TABLE public.hosting_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read hosting_runs" ON public.hosting_runs FOR SELECT USING (true);
CREATE POLICY "Service role full access hosting_runs" ON public.hosting_runs FOR ALL USING (true) WITH CHECK (true);
