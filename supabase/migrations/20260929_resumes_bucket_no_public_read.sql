-- Migration: Remove public read access from the resumes storage bucket.
--
-- CVs must only be accessible via time-limited signed URLs generated
-- server-side or by the authenticated owner. Removing the public policy
-- ensures that knowing a file path is not sufficient to download a CV.

-- Drop the permissive "Anyone can view resumes" policy if it exists.
DROP POLICY IF EXISTS "Anyone can view resumes" ON storage.objects;

-- Also drop any other SELECT policies on the resumes bucket that allow
-- unauthenticated (anon) access (belt-and-suspenders).
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND cmd        = 'SELECT'
      AND qual::text ILIKE '%resumes%'
      AND (roles IS NULL OR 'anon' = ANY(roles))
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Ensure authenticated users can still read files in the resumes bucket
-- (needed for createSignedUrl which runs under the user's JWT).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'Authenticated users can read resumes'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Authenticated users can read resumes"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (bucket_id = 'resumes')
    $policy$;
  END IF;
END $$;