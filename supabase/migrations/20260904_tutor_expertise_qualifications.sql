-- Migration: Ensure tutor_profiles has user_id column, then create tutor_expertise and tutor_qualifications
-- Safe to re-run (uses IF NOT EXISTS / IF column does not exist guards).
-- Run this in the Supabase SQL Editor.

-- ============================================================================
-- 1. Ensure tutor_profiles exists with the correct schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS tutor_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    bio TEXT,
    headline VARCHAR(255),
    rating DECIMAL(3,2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    total_students INTEGER DEFAULT 0,
    total_courses INTEGER DEFAULT 0,
    teaching_experience_years INTEGER,
    preferred_teaching_mode VARCHAR(50) CHECK (preferred_teaching_mode IN ('online', 'offline', 'hybrid')),
    hourly_rate DECIMAL(10,2),
    bank_account_name VARCHAR(255),
    bank_account_number VARCHAR(255),
    upi_id VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_document_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- If tutor_profiles already existed without user_id, add the column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tutor_profiles' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE tutor_profiles
            ADD COLUMN user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Add other potentially missing columns safely
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'bio') THEN
        ALTER TABLE tutor_profiles ADD COLUMN bio TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'headline') THEN
        ALTER TABLE tutor_profiles ADD COLUMN headline VARCHAR(255);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'rating') THEN
        ALTER TABLE tutor_profiles ADD COLUMN rating DECIMAL(3,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'total_reviews') THEN
        ALTER TABLE tutor_profiles ADD COLUMN total_reviews INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'total_students') THEN
        ALTER TABLE tutor_profiles ADD COLUMN total_students INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'total_courses') THEN
        ALTER TABLE tutor_profiles ADD COLUMN total_courses INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'updated_at') THEN
        ALTER TABLE tutor_profiles ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tutor_profiles' AND column_name = 'created_at') THEN
        ALTER TABLE tutor_profiles ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tutor_profiles_user_id ON tutor_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_tutor_profiles_rating ON tutor_profiles(rating);

-- ============================================================================
-- 2. Create tutor_expertise
-- ============================================================================

CREATE TABLE IF NOT EXISTS tutor_expertise (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tutor_id UUID NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
    skill_name VARCHAR(255) NOT NULL,
    experience_level VARCHAR(20),
    description TEXT,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tutor_expertise_tutor_id ON tutor_expertise(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_expertise_skill_name ON tutor_expertise(skill_name);

-- ============================================================================
-- 3. Create tutor_qualifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS tutor_qualifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tutor_id UUID NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE,
    qualification_name VARCHAR(255) NOT NULL,
    issuing_organization VARCHAR(255),
    verification_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tutor_qualifications_tutor_id ON tutor_qualifications(tutor_id);