-- Migration: Ensure recruiter_profiles has all required columns
-- Safe to re-run (uses IF NOT EXISTS / DO $$ guards).
-- Run this in the Supabase SQL Editor.

-- 1. Create table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS recruiter_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    company_name VARCHAR(255),
    company_size VARCHAR(50),
    industry VARCHAR(255),
    location VARCHAR(255),
    country VARCHAR(100),
    website VARCHAR(500),
    company_description TEXT,
    company_logo_url TEXT,
    phone VARCHAR(20),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_document_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Add missing columns if the table already existed with a different schema
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'recruiter_profiles' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE recruiter_profiles
            ADD COLUMN user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recruiter_profiles' AND column_name = 'company_name') THEN
        ALTER TABLE recruiter_profiles ADD COLUMN company_name VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recruiter_profiles' AND column_name = 'company_description') THEN
        ALTER TABLE recruiter_profiles ADD COLUMN company_description TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recruiter_profiles' AND column_name = 'website') THEN
        ALTER TABLE recruiter_profiles ADD COLUMN website VARCHAR(500);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recruiter_profiles' AND column_name = 'industry') THEN
        ALTER TABLE recruiter_profiles ADD COLUMN industry VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recruiter_profiles' AND column_name = 'location') THEN
        ALTER TABLE recruiter_profiles ADD COLUMN location VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recruiter_profiles' AND column_name = 'updated_at') THEN
        ALTER TABLE recruiter_profiles ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'recruiter_profiles' AND column_name = 'created_at') THEN
        ALTER TABLE recruiter_profiles ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_recruiter_profiles_user_id ON recruiter_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_recruiter_profiles_company_name ON recruiter_profiles(company_name);
CREATE INDEX IF NOT EXISTS idx_recruiter_profiles_industry ON recruiter_profiles(industry);