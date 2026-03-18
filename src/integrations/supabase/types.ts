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
      telegram_groups: {
        Row: {
          anti_spam: boolean | null
          chat_id: number
          created_at: string
          entertainment_enabled: boolean | null
          id: string
          lock_files: boolean | null
          lock_links: boolean | null
          lock_media: boolean | null
          lock_stickers: boolean | null
          title: string | null
          updated_at: string
          welcome_message: string | null
        }
        Insert: {
          anti_spam?: boolean | null
          chat_id: number
          created_at?: string
          entertainment_enabled?: boolean | null
          id?: string
          lock_files?: boolean | null
          lock_links?: boolean | null
          lock_media?: boolean | null
          lock_stickers?: boolean | null
          title?: string | null
          updated_at?: string
          welcome_message?: string | null
        }
        Update: {
          anti_spam?: boolean | null
          chat_id?: number
          created_at?: string
          entertainment_enabled?: boolean | null
          id?: string
          lock_files?: boolean | null
          lock_links?: boolean | null
          lock_media?: boolean | null
          lock_stickers?: boolean | null
          title?: string | null
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
      telegram_users: {
        Row: {
          chat_id: number
          created_at: string
          first_name: string | null
          id: string
          is_banned: boolean | null
          is_muted: boolean | null
          last_name: string | null
          level: number | null
          points: number | null
          updated_at: string
          user_id: number
          username: string | null
          warnings: number | null
        }
        Insert: {
          chat_id: number
          created_at?: string
          first_name?: string | null
          id?: string
          is_banned?: boolean | null
          is_muted?: boolean | null
          last_name?: string | null
          level?: number | null
          points?: number | null
          updated_at?: string
          user_id: number
          username?: string | null
          warnings?: number | null
        }
        Update: {
          chat_id?: number
          created_at?: string
          first_name?: string | null
          id?: string
          is_banned?: boolean | null
          is_muted?: boolean | null
          last_name?: string | null
          level?: number | null
          points?: number | null
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
      increment_points: {
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
