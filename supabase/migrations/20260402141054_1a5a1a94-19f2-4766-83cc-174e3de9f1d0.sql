INSERT INTO storage.buckets (id, name, public) VALUES ('broadcast-media', 'broadcast-media', true) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload broadcast media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'broadcast-media');

CREATE POLICY "Public can read broadcast media"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'broadcast-media');