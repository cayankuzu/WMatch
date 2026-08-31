export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_deletion_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          last_error: string | null
          photo_paths: Json
          stage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          last_error?: string | null
          photo_paths?: Json
          stage?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          last_error?: string | null
          photo_paths?: Json
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_pair_summaries: {
        Row: {
          last_message: string
          last_message_id: string | null
          last_message_time: string | null
          unread_user1: number
          unread_user2: number
          updated_at: string
          user1_id: string
          user2_id: string
        }
        Insert: {
          last_message?: string
          last_message_id?: string | null
          last_message_time?: string | null
          unread_user1?: number
          unread_user2?: number
          updated_at?: string
          user1_id: string
          user2_id: string
        }
        Update: {
          last_message?: string
          last_message_id?: string | null
          last_message_time?: string | null
          unread_user1?: number
          unread_user2?: number
          updated_at?: string
          user1_id?: string
          user2_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_pair_summaries_user1_id_fkey"
            columns: ["user1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_pair_summaries_user2_id_fkey"
            columns: ["user2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_repair_audit: {
        Row: {
          created_at: string
          first_message_at: string | null
          id: string
          last_message_at: string | null
          message_count: number
          reason: string
          resolved_at: string | null
          status: string
          updated_at: string
          user1_id: string
          user2_id: string
        }
        Insert: {
          created_at?: string
          first_message_at?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          reason: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
          user1_id: string
          user2_id: string
        }
        Update: {
          created_at?: string
          first_message_at?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number
          reason?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
          user1_id?: string
          user2_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_repair_audit_user1_id_fkey"
            columns: ["user1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_repair_audit_user2_id_fkey"
            columns: ["user2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_settings: {
        Row: {
          created_at: string
          notifications_enabled: boolean
          online_status_enabled: boolean
          other_user_id: string
          owner_user_id: string
          read_receipts_enabled: boolean
          typing_indicator_enabled: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          notifications_enabled?: boolean
          online_status_enabled?: boolean
          other_user_id: string
          owner_user_id: string
          read_receipts_enabled?: boolean
          typing_indicator_enabled?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          notifications_enabled?: boolean
          online_status_enabled?: boolean
          other_user_id?: string
          owner_user_id?: string
          read_receipts_enabled?: boolean
          typing_indicator_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_settings_other_user_id_fkey"
            columns: ["other_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_settings_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      currently_watching: {
        Row: {
          expires_at: string
          media_type: string
          movie_id: number
          paused_at: string | null
          remaining_ms: number
          started_at: string
          state: string
          updated_at: string | null
          user_id: string
          version: number
        }
        Insert: {
          expires_at?: string
          media_type?: string
          movie_id: number
          paused_at?: string | null
          remaining_ms?: number
          started_at?: string
          state?: string
          updated_at?: string | null
          user_id: string
          version?: number
        }
        Update: {
          expires_at?: string
          media_type?: string
          movie_id?: number
          paused_at?: string | null
          remaining_ms?: number
          started_at?: string
          state?: string
          updated_at?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "currently_watching_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_push_tokens: {
        Row: {
          created_at: string
          last_seen_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          last_seen_at?: string
          platform?: string
          token: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          last_seen_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_delivery_receipts: {
        Row: {
          attempt_count: number
          checked_at: string | null
          created_at: string
          event_id: string
          last_error: string | null
          locked_at: string | null
          next_attempt_at: string | null
          status: string
          ticket_id: string
          token: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          checked_at?: string | null
          created_at?: string
          event_id: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string | null
          status?: string
          ticket_id: string
          token: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          checked_at?: string | null
          created_at?: string
          event_id?: string
          last_error?: string | null
          locked_at?: string | null
          next_attempt_at?: string | null
          status?: string
          ticket_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_delivery_receipts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_preferences: {
        Row: {
          age_max: number
          age_min: number
          compatibility_max: number
          compatibility_min: number
          created_at: string
          distance_max_km: number
          distance_min_km: number
          gender_preference: string
          updated_at: string
          user_id: string
        }
        Insert: {
          age_max?: number
          age_min?: number
          compatibility_max?: number
          compatibility_min?: number
          created_at?: string
          distance_max_km?: number
          distance_min_km?: number
          gender_preference?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          age_max?: number
          age_min?: number
          compatibility_max?: number
          compatibility_min?: number
          created_at?: string
          distance_max_km?: number
          distance_min_km?: number
          gender_preference?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hidden_chats: {
        Row: {
          created_at: string
          other_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          other_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          other_user_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hidden_chats_other_user_id_fkey"
            columns: ["other_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hidden_chats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kv_store_d962235e: {
        Row: {
          key: string
          value: Json
        }
        Insert: {
          key: string
          value: Json
        }
        Update: {
          key?: string
          value?: Json
        }
        Relationships: []
      }
      edge_origin_hmac_nonces: {
        Row: {
          claimed_at: string
          expires_at: string
          key_id: string
          nonce: string
          signed_at: string
        }
        Insert: {
          claimed_at?: string
          expires_at: string
          key_id: string
          nonce: string
          signed_at: string
        }
        Update: {
          claimed_at?: string
          expires_at?: string
          key_id?: string
          nonce?: string
          signed_at?: string
        }
        Relationships: []
      }
      likes: {
        Row: {
          created_at: string | null
          hidden_by_liked_user: boolean
          liked_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          hidden_by_liked_user?: boolean
          liked_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          hidden_by_liked_user?: boolean
          liked_user_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "likes_liked_user_id_fkey"
            columns: ["liked_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          accepted_by_user_id: string | null
          common_favorite_movie_ids: number[]
          common_watched_movie_ids: number[]
          created_at: string | null
          ended_at: string | null
          ended_by_user_id: string | null
          first_like_by_user_id: string | null
          match_source_movie_id: number | null
          match_source_score: number | null
          match_source_type: string
          status: string | null
          updated_at: string | null
          user1_chat_cleared_at: string | null
          user1_chat_deleted_at: string | null
          user1_id: string
          user2_chat_cleared_at: string | null
          user2_chat_deleted_at: string | null
          user2_id: string
        }
        Insert: {
          accepted_by_user_id?: string | null
          common_favorite_movie_ids?: number[]
          common_watched_movie_ids?: number[]
          created_at?: string | null
          ended_at?: string | null
          ended_by_user_id?: string | null
          first_like_by_user_id?: string | null
          match_source_movie_id?: number | null
          match_source_score?: number | null
          match_source_type?: string
          status?: string | null
          updated_at?: string | null
          user1_chat_cleared_at?: string | null
          user1_chat_deleted_at?: string | null
          user1_id: string
          user2_chat_cleared_at?: string | null
          user2_chat_deleted_at?: string | null
          user2_id: string
        }
        Update: {
          accepted_by_user_id?: string | null
          common_favorite_movie_ids?: number[]
          common_watched_movie_ids?: number[]
          created_at?: string | null
          ended_at?: string | null
          ended_by_user_id?: string | null
          first_like_by_user_id?: string | null
          match_source_movie_id?: number | null
          match_source_score?: number | null
          match_source_type?: string
          status?: string | null
          updated_at?: string | null
          user1_chat_cleared_at?: string | null
          user1_chat_deleted_at?: string | null
          user1_id?: string
          user2_chat_cleared_at?: string | null
          user2_chat_deleted_at?: string | null
          user2_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_accepted_by_user_id_fkey"
            columns: ["accepted_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_ended_by_user_id_fkey"
            columns: ["ended_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_first_like_by_user_id_fkey"
            columns: ["first_like_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_user1_id_fkey"
            columns: ["user1_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_user2_id_fkey"
            columns: ["user2_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      media_identity_repair_history: {
        Row: {
          action: string
          collection_type: string | null
          created_at: string
          id: string
          movie_id: number
          next_media_type: string
          previous_media_type: string
          repair_id: string
          source_table: string
          user_id: string
        }
        Insert: {
          action: string
          collection_type?: string | null
          created_at?: string
          id?: string
          movie_id: number
          next_media_type: string
          previous_media_type: string
          repair_id: string
          source_table: string
          user_id: string
        }
        Update: {
          action?: string
          collection_type?: string | null
          created_at?: string
          id?: string
          movie_id?: number
          next_media_type?: string
          previous_media_type?: string
          repair_id?: string
          source_table?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_identity_repair_history_repair_id_fkey"
            columns: ["repair_id"]
            isOneToOne: false
            referencedRelation: "media_identity_repair_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      media_identity_repair_queue: {
        Row: {
          assumed_media_type: string | null
          collection_type: string | null
          created_at: string
          id: string
          movie_id: number
          reason: string
          resolved_at: string | null
          source_table: string
          status: string
          user_id: string
        }
        Insert: {
          assumed_media_type?: string | null
          collection_type?: string | null
          created_at?: string
          id?: string
          movie_id: number
          reason: string
          resolved_at?: string | null
          source_table: string
          status?: string
          user_id: string
        }
        Update: {
          assumed_media_type?: string | null
          collection_type?: string | null
          created_at?: string
          id?: string
          movie_id?: number
          reason?: string
          resolved_at?: string | null
          source_table?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_identity_repair_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          client_message_id: string | null
          client_payload_hash: string | null
          client_request_id: string | null
          created_at: string | null
          id: string
          read: boolean | null
          receiver_id: string | null
          sender_id: string | null
          text: string
        }
        Insert: {
          client_message_id?: string | null
          client_payload_hash?: string | null
          client_request_id?: string | null
          created_at?: string | null
          id?: string
          read?: boolean | null
          receiver_id?: string | null
          sender_id?: string | null
          text: string
        }
        Update: {
          client_message_id?: string | null
          client_payload_hash?: string | null
          client_request_id?: string | null
          created_at?: string | null
          id?: string
          read?: boolean | null
          receiver_id?: string | null
          sender_id?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_reports: {
        Row: {
          context_snapshot: Json
          created_at: string
          details: string
          id: string
          idempotency_key: string | null
          last_transition_at: string
          payload_hash: string | null
          reason_code: string
          reporter_snapshot: Json
          reporter_user_id: string
          reviewed_at: string | null
          reviewer_notes: string | null
          sla_due_at: string
          status: string
          target_record_id: string | null
          target_snapshot: Json
          target_type: string
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          context_snapshot?: Json
          created_at?: string
          details: string
          id?: string
          idempotency_key?: string | null
          last_transition_at?: string
          payload_hash?: string | null
          reason_code: string
          reporter_snapshot?: Json
          reporter_user_id: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          sla_due_at?: string
          status?: string
          target_record_id?: string | null
          target_snapshot?: Json
          target_type: string
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          context_snapshot?: Json
          created_at?: string
          details?: string
          id?: string
          idempotency_key?: string | null
          last_transition_at?: string
          payload_hash?: string | null
          reason_code?: string
          reporter_snapshot?: Json
          reporter_user_id?: string
          reviewed_at?: string | null
          reviewer_notes?: string | null
          sla_due_at?: string
          status?: string
          target_record_id?: string | null
          target_snapshot?: Json
          target_type?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_reports_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_report_audit_events: {
        Row: {
          action: string
          actor_kind: string
          actor_label: string | null
          created_at: string
          from_status: string | null
          id: string
          metadata: Json
          report_id: string
          to_status: string | null
        }
        Insert: {
          action: string
          actor_kind?: string
          actor_label?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          report_id: string
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_kind?: string
          actor_label?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          metadata?: Json
          report_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_report_audit_events_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "moderation_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      mutation_idempotency_records: {
        Row: {
          created_at: string
          expires_at: string
          idempotency_key: string
          mutation_route: string
          payload_hash: string
          response_payload: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          idempotency_key: string
          mutation_route: string
          payload_hash: string
          response_payload: Json
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          idempotency_key?: string
          mutation_route?: string
          payload_hash?: string
          response_payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      notification_events: {
        Row: {
          actor_user_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          payload: Json
          push_attempt_count: number
          push_last_error: string | null
          push_locked_at: string | null
          push_next_attempt_at: string | null
          push_status: string
          push_submitted_at: string | null
          read_at: string | null
          route_kind: string
          route_user_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          push_attempt_count?: number
          push_last_error?: string | null
          push_locked_at?: string | null
          push_next_attempt_at?: string | null
          push_status?: string
          push_submitted_at?: string | null
          read_at?: string | null
          route_kind: string
          route_user_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          push_attempt_count?: number
          push_last_error?: string | null
          push_locked_at?: string | null
          push_next_attempt_at?: string | null
          push_status?: string
          push_submitted_at?: string | null
          read_at?: string | null
          route_kind?: string
          route_user_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_route_user_id_fkey"
            columns: ["route_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age: number
          bio: string | null
          created_at: string | null
          email_confirmed: boolean
          gender: string
          id: string
          latitude: number | null
          letterboxd: string | null
          location_updated_at: string | null
          longitude: number | null
          name: string
          photos: string[]
          show_age_on_profile: boolean
          show_gender_on_profile: boolean
          updated_at: string | null
          username: string
        }
        Insert: {
          age: number
          bio?: string | null
          created_at?: string | null
          email_confirmed?: boolean
          gender?: string
          id: string
          latitude?: number | null
          letterboxd?: string | null
          location_updated_at?: string | null
          longitude?: number | null
          name: string
          photos?: string[]
          show_age_on_profile?: boolean
          show_gender_on_profile?: boolean
          updated_at?: string | null
          username: string
        }
        Update: {
          age?: number
          bio?: string | null
          created_at?: string | null
          email_confirmed?: boolean
          gender?: string
          id?: string
          latitude?: number | null
          letterboxd?: string | null
          location_updated_at?: string | null
          longitude?: number | null
          name?: string
          photos?: string[]
          show_age_on_profile?: boolean
          show_gender_on_profile?: boolean
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      profiles_private: {
        Row: {
          latitude: number | null
          location_updated_at: string | null
          longitude: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          latitude?: number | null
          location_updated_at?: string | null
          longitude?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          latitude?: number | null
          location_updated_at?: string | null
          longitude?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_private_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      request_rate_limits: {
        Row: {
          action: string
          created_at: string
          expires_at: string
          hashed_key: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          action: string
          created_at?: string
          expires_at: string
          hashed_key: string
          request_count?: number
          updated_at?: string
          window_start: string
        }
        Update: {
          action?: string
          created_at?: string
          expires_at?: string
          hashed_key?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      schema_contracts: {
        Row: {
          compatible_min_version: string
          current_version: string
          name: string
          required_version: string
          updated_at: string
        }
        Insert: {
          compatible_min_version: string
          current_version: string
          name: string
          required_version: string
          updated_at?: string
        }
        Update: {
          compatible_min_version?: string
          current_version?: string
          name?: string
          required_version?: string
          updated_at?: string
        }
        Relationships: []
      }
      swipe_quotas: {
        Row: {
          updated_at: string
          used_dislike_swipes: number
          used_like_swipes: number
          used_undos: number
          user_id: string
          window_started_at: string
        }
        Insert: {
          updated_at?: string
          used_dislike_swipes?: number
          used_like_swipes?: number
          used_undos?: number
          user_id: string
          window_started_at?: string
        }
        Update: {
          updated_at?: string
          used_dislike_swipes?: number
          used_like_swipes?: number
          used_undos?: number
          user_id?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "swipe_quotas_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_entitlements: {
        Row: {
          feature_key: string
          provider_reference: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          feature_key: string
          provider_reference?: string | null
          source?: string
          status: string
          updated_at?: string
          user_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          feature_key?: string
          provider_reference?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_movies: {
        Row: {
          created_at: string | null
          media_type: string
          movie_id: number
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          media_type?: string
          movie_id: number
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          media_type?: string
          movie_id?: number
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_movies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_chat_repair_audit: {
        Args: { p_audit_id: string }
        Returns: boolean
      }
      apply_watch_session_transition: {
        Args: {
          p_action: string
          p_duration_ms?: number
          p_expected_version?: number
          p_media_type?: string
          p_movie_id?: number
          p_user_id: string
        }
        Returns: {
          expires_at: string
          media_type: string
          movie_id: number
          paused_at: string
          remaining_ms: number
          started_at: string
          state: string
          updated_at: string
          version: number
        }[]
      }
      calculate_discovery_compatibility_score: {
        Args: {
          p_candidate_favorite_count: number
          p_candidate_watched_count: number
          p_common_favorite_count: number
          p_common_watched_count: number
          p_current_favorite_count: number
          p_current_watched_count: number
        }
        Returns: number
      }
      check_email_availability: {
        Args: { p_email: string }
        Returns: {
          email_available: boolean
          email_message: string
        }[]
      }
      claim_edge_origin_hmac_nonce: {
        Args: {
          p_key_id: string
          p_max_skew_seconds?: number
          p_nonce: string
          p_timestamp: number
        }
        Returns: boolean
      }
      claim_push_receipt_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          event_id: string
          ticket_id: string
          token: string
        }[]
      }
      complete_push_receipt_job: {
        Args: {
          p_error?: string
          p_retry_after_seconds?: number
          p_status: string
          p_ticket_id: string
        }
        Returns: boolean
      }
      claim_push_delivery_jobs: {
        Args: { p_event_ids?: string[]; p_limit?: number }
        Returns: {
          actor_user_id: string
          attempt_count: number
          body: string
          id: string
          kind: string
          payload: Json
          route_kind: string
          route_user_id: string
          title: string
          user_id: string
        }[]
      }
      complete_push_delivery_job: {
        Args: {
          p_error?: string
          p_event_id: string
          p_retry_after_seconds?: number
          p_status: string
        }
        Returns: boolean
      }
      get_push_delivery_health: {
        Args: Record<PropertyKey, never>
        Returns: {
          dead_count: number
          oldest_due_age_seconds: number
          oldest_due_at: string | null
          pending_count: number
          processing_count: number
          receipt_failed_count: number
          receipt_pending_count: number
          receipt_processing_count: number
          receipt_retry_count: number
          receipt_stalled_count: number
          retry_count: number
          stalled_count: number
        }[]
      }
      consume_rate_limit: {
        Args: {
          p_action: string
          p_key: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          current_count: number
          reset_at: string
          retry_after_seconds: number
        }[]
      }
      consume_swipe_quota_atomic: {
        Args: {
          p_dislike_limit: number
          p_kind: string
          p_like_limit: number
          p_undo_limit: number
          p_user_id: string
          p_window_hours: number
        }
        Returns: {
          consumed: boolean
          used_dislike_swipes: number
          used_like_swipes: number
          used_undos: number
          user_id: string
          window_started_at: string
        }[]
      }
      delete_chat_for_user_atomic: {
        Args: {
          p_actor_user_id: string
          p_mode: string
          p_target_user_id: string
        }
        Returns: {
          deleted_for_everyone: boolean
          deleted_for_self: boolean
          outcome: string
        }[]
      }
      get_chat_directory_page: {
        Args: {
          p_current_user_id: string
          p_cursor_time?: string
          p_cursor_user_id?: string
          p_limit?: number
        }
        Returns: {
          activity_at: string
          other_user_id: string
        }[]
      }
      get_chat_list_stats: {
        Args: {
          p_current_user_id: string
          p_other_user_ids: string[]
          p_visible_since: Json
        }
        Returns: {
          last_message: string
          last_message_time: string
          other_user_id: string
          unread_count: number
        }[]
      }
      get_chat_message_peers: {
        Args: { p_current_user_id: string; p_limit?: number }
        Returns: {
          last_message: string
          last_message_time: string
          other_user_id: string
          unread_count: number
        }[]
      }
      get_chat_message_stats: {
        Args: { p_current_user_id: string; p_other_user_ids?: string[] }
        Returns: {
          last_message: string
          last_message_time: string
          other_user_id: string
          unread_count: number
        }[]
      }
      get_chat_messages_page: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_current_user_id: string
          p_limit?: number
          p_other_user_id: string
        }
        Returns: {
          client_request_id: string
          created_at: string
          id: string
          read: boolean
          receiver_id: string
          sender_id: string
          text: string
        }[]
      }
      get_compatibility_candidate_page: {
        Args: {
          p_current_user_id: string
          p_cursor_score?: number
          p_cursor_user_id?: string
          p_limit?: number
        }
        Returns: {
          compatibility_score: number
          user_id: string
        }[]
      }
      get_live_now_users: {
        Args: {
          p_current_user_id: string
          p_cursor_updated_at?: string
          p_cursor_user_id?: string
          p_limit?: number
        }
        Returns: {
          media_type: string
          movie_id: number
          updated_at: string
          user_id: string
        }[]
      }
      get_watch_discovery_candidate_page: {
        Args: {
          p_current_user_id: string
          p_cursor_updated_at?: string
          p_cursor_user_id?: string
          p_limit?: number
          p_media_type: string
          p_movie_id: number
        }
        Returns: {
          compatibility_score: number
          updated_at: string
          user_id: string
        }[]
      }
      process_like_action_atomic: {
        Args: {
          p_actor_user_id: string
          p_like_limit: number
          p_source_type: string
          p_target_user_id: string
          p_window_hours: number
        }
        Returns: {
          match_became_active: boolean
          matched: boolean
          outcome: string
          reward_granted: boolean
          used_dislike_swipes: number
          used_like_swipes: number
          used_undos: number
          window_started_at: string
        }[]
      }
      process_like_action_idempotent: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_like_limit: number
          p_payload_hash: string
          p_source_type: string
          p_target_user_id: string
          p_window_hours: number
        }
        Returns: {
          idempotency_replayed: boolean
          match_became_active: boolean
          matched: boolean
          outcome: string
          reward_granted: boolean
          used_dislike_swipes: number
          used_like_swipes: number
          used_undos: number
          window_started_at: string
        }[]
      }
      refresh_chat_repair_audit: { Args: { p_limit?: number }; Returns: number }
      replace_user_media_collections: {
        Args: { p_favorites?: Json; p_user_id: string; p_watched?: Json }
        Returns: undefined
      }
      replace_user_movie_collections: {
        Args: {
          p_favorite_movie_ids?: number[]
          p_user_id: string
          p_watched_movie_ids?: number[]
        }
        Returns: undefined
      }
      resolve_media_identity_repair: {
        Args: { p_media_type: string; p_repair_id: string; p_status?: string }
        Returns: undefined
      }
      reward_swipe_quota_atomic: {
        Args: { p_kind: string; p_user_id: string; p_window_hours: number }
        Returns: {
          used_dislike_swipes: number
          used_like_swipes: number
          used_undos: number
          user_id: string
          window_started_at: string
        }[]
      }
      transition_moderation_report_ops: {
        Args: {
          p_actor_label?: string
          p_next_status: string
          p_report_id: string
          p_reviewer_notes?: string
        }
        Returns: Database["public"]["Tables"]["moderation_reports"]["Row"]
      }
      undo_like_action_atomic: {
        Args: {
          p_actor_user_id: string
          p_target_user_id: string
          p_undo_limit: number
          p_window_hours: number
        }
        Returns: {
          outcome: string
          used_dislike_swipes: number
          used_like_swipes: number
          used_undos: number
          window_started_at: string
        }[]
      }
      update_pair_relationship_atomic: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_target_user_id: string
        }
        Returns: {
          match_status: string
          outcome: string
          user1_id: string
          user2_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
