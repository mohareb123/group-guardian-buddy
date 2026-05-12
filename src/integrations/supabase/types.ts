export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      system_logs: {
        Row: {
          chat_id: number | null
          context: Json | null
          created_at: string
          event: string
          id: string
          level: string
          message: string | null
          source: string
          user_id: number | null
        }
        Insert: {
          chat_id?: number | null
          context?: Json | null
          created_at?: string
          event: string
          id?: string
          level?: string
          message?: string | null
          source?: string
          user_id?: number | null
        }
        Update: {
          chat_id?: number | null
          context?: Json | null
          created_at?: string
          event?: string
          id?: string
          level?: string
          message?: string | null
          source?: string
          user_id?: number | null
        }
        Relationships: []
      }
      telegram_admin_logs: {
        Row: {
          action: string
          admin_user_id: number | null
          admin_username: string | null
          chat_id: number
          created_at: string
          details: string | null
          id: string
          target_user_id: number | null
          target_username: string | null
        }
        Insert: {
          action: string
          admin_user_id?: number | null
          admin_username?: string | null
          chat_id: number
          created_at?: string
          details?: string | null
          id?: string
          target_user_id?: number | null
          target_username?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: number | null
          admin_username?: string | null
          chat_id?: number
          created_at?: string
          details?: string | null
          id?: string
          target_user_id?: number | null
          target_username?: string | null
        }
        Relationships: []
      }
      telegram_bot_state: {
        Row: {
          id: number
          update_offset: number
          updated_at: string
        }
        Insert: {
          id: number
          update_offset?: number
          updated_at?: string
        }
        Update: {
          id?: number
          update_offset?: number
          updated_at?: string
        }
        Relationships: []
      }
      telegram_captcha_pending: {
        Row: {
          chat_id: number
          created_at: string
          id: string
          user_id: number
        }
        Insert: {
          chat_id: number
          created_at?: string
          id?: string
          user_id: number
        }
        Update: {
          chat_id?: number
          created_at?: string
          id?: string
          user_id?: number
        }
        Relationships: []
      }
      telegram_challenge_completions: {
        Row: {
          challenge_id: string | null
          chat_id: number
          completed_at: string
          id: string
          user_id: number
        }
        Insert: {
          challenge_id?: string | null
          chat_id: number
          completed_at?: string
          id?: string
          user_id: number
        }
        Update: {
          challenge_id?: string | null
          chat_id?: number
          completed_at?: string
          id?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_challenge_completions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "telegram_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_challenges: {
        Row: {
          active_date: string | null
          challenge_type: string | null
          chat_id: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          reward_coins: number | null
          reward_points: number | null
          target_value: number | null
          title: string
        }
        Insert: {
          active_date?: string | null
          challenge_type?: string | null
          chat_id: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          reward_coins?: number | null
          reward_points?: number | null
          target_value?: number | null
          title: string
        }
        Update: {
          active_date?: string | null
          challenge_type?: string | null
          chat_id?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          reward_coins?: number | null
          reward_points?: number | null
          target_value?: number | null
          title?: string
        }
        Relationships: []
      }
      telegram_court_cases: {
        Row: {
          accused_user_id: number
          accused_username: string | null
          accuser_user_id: number
          accuser_username: string | null
          chat_id: number
          created_at: string
          expires_at: string
          id: string
          reason: string
          status: string | null
          verdict: string | null
          votes_against: number | null
          votes_for: number | null
        }
        Insert: {
          accused_user_id: number
          accused_username?: string | null
          accuser_user_id: number
          accuser_username?: string | null
          chat_id: number
          created_at?: string
          expires_at: string
          id?: string
          reason: string
          status?: string | null
          verdict?: string | null
          votes_against?: number | null
          votes_for?: number | null
        }
        Update: {
          accused_user_id?: number
          accused_username?: string | null
          accuser_user_id?: number
          accuser_username?: string | null
          chat_id?: number
          created_at?: string
          expires_at?: string
          id?: string
          reason?: string
          status?: string | null
          verdict?: string | null
          votes_against?: number | null
          votes_for?: number | null
        }
        Relationships: []
      }
      telegram_court_votes: {
        Row: {
          case_id: string | null
          created_at: string
          id: string
          user_id: number
          vote: boolean
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          id?: string
          user_id: number
          vote: boolean
        }
        Update: {
          case_id?: string | null
          created_at?: string
          id?: string
          user_id?: number
          vote?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "telegram_court_votes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "telegram_court_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_faq: {
        Row: {
          answer: string
          chat_id: number
          created_at: string
          created_by: number | null
          id: string
          keywords: string[] | null
          question: string
          usage_count: number | null
        }
        Insert: {
          answer: string
          chat_id: number
          created_at?: string
          created_by?: number | null
          id?: string
          keywords?: string[] | null
          question: string
          usage_count?: number | null
        }
        Update: {
          answer?: string
          chat_id?: number
          created_at?: string
          created_by?: number | null
          id?: string
          keywords?: string[] | null
          question?: string
          usage_count?: number | null
        }
        Relationships: []
      }
      telegram_groups: {
        Row: {
          anti_flood: boolean | null
          anti_forward_spam: boolean | null
          anti_spam: boolean | null
          auto_faq_enabled: boolean | null
          auto_trust_enabled: boolean | null
          blacklist_words: string[] | null
          captcha_enabled: boolean | null
          chat_id: number
          created_at: string
          daily_digest_enabled: boolean | null
          entertainment_enabled: boolean | null
          flood_interval_seconds: number | null
          flood_max_messages: number | null
          id: string
          lock_files: boolean | null
          lock_links: boolean | null
          lock_media: boolean | null
          lock_stickers: boolean | null
          max_warnings: number | null
          new_account_days: number | null
          night_mode_end: number | null
          night_mode_start: number | null
          raid_protection: boolean | null
          restrict_new_accounts: boolean | null
          slow_mode_seconds: number | null
          title: string | null
          toxicity_filter: boolean | null
          updated_at: string
          welcome_message: string | null
        }
        Insert: {
          anti_flood?: boolean | null
          anti_forward_spam?: boolean | null
          anti_spam?: boolean | null
          auto_faq_enabled?: boolean | null
          auto_trust_enabled?: boolean | null
          blacklist_words?: string[] | null
          captcha_enabled?: boolean | null
          chat_id: number
          created_at?: string
          daily_digest_enabled?: boolean | null
          entertainment_enabled?: boolean | null
          flood_interval_seconds?: number | null
          flood_max_messages?: number | null
          id?: string
          lock_files?: boolean | null
          lock_links?: boolean | null
          lock_media?: boolean | null
          lock_stickers?: boolean | null
          max_warnings?: number | null
          new_account_days?: number | null
          night_mode_end?: number | null
          night_mode_start?: number | null
          raid_protection?: boolean | null
          restrict_new_accounts?: boolean | null
          slow_mode_seconds?: number | null
          title?: string | null
          toxicity_filter?: boolean | null
          updated_at?: string
          welcome_message?: string | null
        }
        Update: {
          anti_flood?: boolean | null
          anti_forward_spam?: boolean | null
          anti_spam?: boolean | null
          auto_faq_enabled?: boolean | null
          auto_trust_enabled?: boolean | null
          blacklist_words?: string[] | null
          captcha_enabled?: boolean | null
          chat_id?: number
          created_at?: string
          daily_digest_enabled?: boolean | null
          entertainment_enabled?: boolean | null
          flood_interval_seconds?: number | null
          flood_max_messages?: number | null
          id?: string
          lock_files?: boolean | null
          lock_links?: boolean | null
          lock_media?: boolean | null
          lock_stickers?: boolean | null
          max_warnings?: number | null
          new_account_days?: number | null
          night_mode_end?: number | null
          night_mode_start?: number | null
          raid_protection?: boolean | null
          restrict_new_accounts?: boolean | null
          slow_mode_seconds?: number | null
          title?: string | null
          toxicity_filter?: boolean | null
          updated_at?: string
          welcome_message?: string | null
        }
        Relationships: []
      }
      telegram_messages: {
        Row: {
          chat_id: number
          created_at: string
          raw_update: Json
          text: string | null
          update_id: number
          user_id: number | null
          username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          raw_update: Json
          text?: string | null
          update_id: number
          user_id?: number | null
          username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          raw_update?: Json
          text?: string | null
          update_id?: number
          user_id?: number | null
          username?: string | null
        }
        Relationships: []
      }
      telegram_pending_whispers: {
        Row: {
          chat_id: number
          created_at: string
          from_user_id: number
          from_username: string | null
          id: string
          to_user_id: number
          to_username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          from_user_id: number
          from_username?: string | null
          id?: string
          to_user_id: number
          to_username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          from_user_id?: number
          from_username?: string | null
          id?: string
          to_user_id?: number
          to_username?: string | null
        }
        Relationships: []
      }
      telegram_purchases: {
        Row: {
          chat_id: number
          created_at: string
          id: string
          item_id: string | null
          item_name: string
          price: number
          user_id: number
        }
        Insert: {
          chat_id: number
          created_at?: string
          id?: string
          item_id?: string | null
          item_name: string
          price: number
          user_id: number
        }
        Update: {
          chat_id?: number
          created_at?: string
          id?: string
          item_id?: string | null
          item_name?: string
          price?: number
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_purchases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "telegram_shop_items"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_raid_joins: {
        Row: {
          chat_id: number
          id: string
          joined_at: string
          user_id: number
        }
        Insert: {
          chat_id: number
          id?: string
          joined_at?: string
          user_id: number
        }
        Update: {
          chat_id?: number
          id?: string
          joined_at?: string
          user_id?: number
        }
        Relationships: []
      }
      telegram_saved_messages: {
        Row: {
          chat_id: number
          created_at: string
          id: string
          message_id: number
          saved_by: number
          tag: string | null
          text: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          id?: string
          message_id: number
          saved_by: number
          tag?: string | null
          text?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          id?: string
          message_id?: number
          saved_by?: number
          tag?: string | null
          text?: string | null
        }
        Relationships: []
      }
      telegram_scheduled_messages: {
        Row: {
          chat_id: number
          created_at: string
          created_by: number
          id: string
          message: string
          scheduled_at: string
          sent: boolean | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          created_by: number
          id?: string
          message: string
          scheduled_at: string
          sent?: boolean | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          created_by?: number
          id?: string
          message?: string
          scheduled_at?: string
          sent?: boolean | null
        }
        Relationships: []
      }
      telegram_shop_items: {
        Row: {
          chat_id: number
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          item_type: string
          name: string
          price: number
          stock: number | null
          value: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          item_type?: string
          name: string
          price?: number
          stock?: number | null
          value?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          item_type?: string
          name?: string
          price?: number
          stock?: number | null
          value?: string | null
        }
        Relationships: []
      }
      telegram_tickets: {
        Row: {
          chat_id: number
          created_at: string
          id: string
          priority: string | null
          resolved_at: string | null
          resolved_by: number | null
          status: string
          subject: string
          user_id: number
          username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          id?: string
          priority?: string | null
          resolved_at?: string | null
          resolved_by?: number | null
          status?: string
          subject: string
          user_id: number
          username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          id?: string
          priority?: string | null
          resolved_at?: string | null
          resolved_by?: number | null
          status?: string
          subject?: string
          user_id?: number
          username?: string | null
        }
        Relationships: []
      }
      telegram_users: {
        Row: {
          captcha_verified: boolean | null
          chat_id: number
          coins: number | null
          created_at: string
          daily_streak: number | null
          first_name: string | null
          id: string
          is_banned: boolean | null
          is_muted: boolean | null
          join_date: string | null
          last_daily: string | null
          last_message_at: string | null
          last_name: string | null
          level: number | null
          message_count: number | null
          points: number | null
          reputation: number | null
          total_warns: number | null
          trust_level: number | null
          updated_at: string
          user_id: number
          username: string | null
          warnings: number | null
        }
        Insert: {
          captcha_verified?: boolean | null
          chat_id: number
          coins?: number | null
          created_at?: string
          daily_streak?: number | null
          first_name?: string | null
          id?: string
          is_banned?: boolean | null
          is_muted?: boolean | null
          join_date?: string | null
          last_daily?: string | null
          last_message_at?: string | null
          last_name?: string | null
          level?: number | null
          message_count?: number | null
          points?: number | null
          reputation?: number | null
          total_warns?: number | null
          trust_level?: number | null
          updated_at?: string
          user_id: number
          username?: string | null
          warnings?: number | null
        }
        Update: {
          captcha_verified?: boolean | null
          chat_id?: number
          coins?: number | null
          created_at?: string
          daily_streak?: number | null
          first_name?: string | null
          id?: string
          is_banned?: boolean | null
          is_muted?: boolean | null
          join_date?: string | null
          last_daily?: string | null
          last_message_at?: string | null
          last_name?: string | null
          level?: number | null
          message_count?: number | null
          points?: number | null
          reputation?: number | null
          total_warns?: number | null
          trust_level?: number | null
          updated_at?: string
          user_id?: number
          username?: string | null
          warnings?: number | null
        }
        Relationships: []
      }
      telegram_whispers: {
        Row: {
          chat_id: number
          created_at: string
          from_user_id: number
          from_username: string | null
          id: string
          is_read: boolean | null
          message: string
          to_user_id: number
          to_username: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          from_user_id: number
          from_username?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          to_user_id: number
          to_username?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          from_user_id?: number
          from_username?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          to_user_id?: number
          to_username?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_raid_joins: { Args: never; Returns: undefined }
      cleanup_old_system_logs: { Args: never; Returns: undefined }
      increment_coins: {
        Args: { p_amount: number; p_chat_id: number; p_user_id: number }
        Returns: undefined
      }
      increment_message_count: {
        Args: { p_chat_id: number; p_user_id: number }
        Returns: undefined
      }
      increment_points: {
        Args: { p_chat_id: number; p_user_id: number }
        Returns: undefined
      }
      update_reputation: {
        Args: { p_amount: number; p_chat_id: number; p_user_id: number }
        Returns: undefined
      }
      update_trust_level: {
        Args: { p_chat_id: number; p_user_id: number }
        Returns: undefined
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
