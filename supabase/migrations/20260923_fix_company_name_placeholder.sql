-- Fix jobs that have the placeholder "Company" as company_name.
-- Update them to use the recruiter's profile company_name where available.

UPDATE jobs j
SET company_name = rp.company_name
FROM recruiter_profiles rp
WHERE j.company_name = 'Company'
  AND rp.company_name IS NOT NULL
  AND rp.company_name <> ''
  AND rp.company_name <> 'Company'
  AND (
    rp.user_id = j.owner_id
    OR rp.user_id = j.employer_id
    OR rp.id = j.recruiter_id
  );