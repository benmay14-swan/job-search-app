export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          user_id: string;
          desired_job_titles: string[] | null;
          industries: string[] | null;
          seniority_level: string | null;
          skills: string[] | null;
          certifications_licenses: string[] | null;
          work_authorization: string | null;
          years_experience: number | null;
          location_preferences: Json | null;
          salary_min: number | null;
          salary_max: number | null;
          schedule_preferences: string | null;
          company_size_preference: string | null;
          culture_preferences: string | null;
          deal_breakers: string | null;
          work_history_summary: string | null;
          raw_onboarding_transcript: string | null;
          onboarding_complete: boolean;
          last_updated: string;
        };
        Insert: {
          user_id: string;
          desired_job_titles?: string[] | null;
          industries?: string[] | null;
          seniority_level?: string | null;
          skills?: string[] | null;
          certifications_licenses?: string[] | null;
          work_authorization?: string | null;
          years_experience?: number | null;
          location_preferences?: Json | null;
          salary_min?: number | null;
          salary_max?: number | null;
          schedule_preferences?: string | null;
          company_size_preference?: string | null;
          culture_preferences?: string | null;
          deal_breakers?: string | null;
          work_history_summary?: string | null;
          raw_onboarding_transcript?: string | null;
          onboarding_complete?: boolean;
          last_updated?: string;
        };
        Update: {
          user_id?: string;
          desired_job_titles?: string[] | null;
          industries?: string[] | null;
          seniority_level?: string | null;
          skills?: string[] | null;
          certifications_licenses?: string[] | null;
          work_authorization?: string | null;
          years_experience?: number | null;
          location_preferences?: Json | null;
          salary_min?: number | null;
          salary_max?: number | null;
          schedule_preferences?: string | null;
          company_size_preference?: string | null;
          culture_preferences?: string | null;
          deal_breakers?: string | null;
          work_history_summary?: string | null;
          raw_onboarding_transcript?: string | null;
          onboarding_complete?: boolean;
          last_updated?: string;
        };
      };
      job_matches: {
        Row: {
          id: string;
          user_id: string;
          job_title: string;
          company: string;
          location: string | null;
          salary_range: string | null;
          job_description: string | null;
          apply_url: string | null;
          match_reason: string | null;
          match_score: number | null;
          source: string | null;
          user_feedback: string | null;
          user_feedback_comment: string | null;
          resume_generated: boolean;
          cover_letter_generated: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          job_title: string;
          company: string;
          location?: string | null;
          salary_range?: string | null;
          job_description?: string | null;
          apply_url?: string | null;
          match_reason?: string | null;
          match_score?: number | null;
          source?: string | null;
          user_feedback?: string | null;
          user_feedback_comment?: string | null;
          resume_generated?: boolean;
          cover_letter_generated?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          job_title?: string;
          company?: string;
          location?: string | null;
          salary_range?: string | null;
          job_description?: string | null;
          apply_url?: string | null;
          match_reason?: string | null;
          match_score?: number | null;
          source?: string | null;
          user_feedback?: string | null;
          user_feedback_comment?: string | null;
          resume_generated?: boolean;
          cover_letter_generated?: boolean;
          created_at?: string;
        };
      };
      onboarding_messages: {
        Row: {
          id: string;
          user_id: string;
          role: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          role?: string;
          content?: string;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}
