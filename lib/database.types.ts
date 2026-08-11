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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_item_cache: {
        Row: {
          category: string
          created_at: string
          normalized_name: string
          source: string
        }
        Insert: {
          category: string
          created_at?: string
          normalized_name: string
          source?: string
        }
        Update: {
          category?: string
          created_at?: string
          normalized_name?: string
          source?: string
        }
        Relationships: []
      }
      email_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string | null
          email: string
          group_id: string
          group_invite_id: string
          id: string
          invited_by: string
          mailersend_message_id: string | null
          mailersend_status: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email: string
          group_id: string
          group_invite_id: string
          id?: string
          invited_by: string
          mailersend_message_id?: string | null
          mailersend_status?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string | null
          email?: string
          group_id?: string
          group_invite_id?: string
          id?: string
          invited_by?: string
          mailersend_message_id?: string | null
          mailersend_status?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_invites_group_invite_id_fkey"
            columns: ["group_invite_id"]
            isOneToOne: false
            referencedRelation: "group_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      group_deletion_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          group_id: string
          id: string
          requested_by: string
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          group_id: string
          id?: string
          requested_by: string
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          group_id?: string
          id?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_deletion_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_deletion_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_deletion_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invites: {
        Row: {
          created_at: string | null
          current_uses: number | null
          expires_at: string
          group_id: string
          id: string
          invite_token: string
          invited_by: string
          is_active: boolean | null
          max_uses: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_uses?: number | null
          expires_at?: string
          group_id: string
          id?: string
          invite_token: string
          invited_by: string
          is_active?: boolean | null
          max_uses?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_uses?: number | null
          expires_at?: string
          group_id?: string
          id?: string
          invite_token?: string
          invited_by?: string
          is_active?: boolean | null
          max_uses?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          person_id: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          person_id: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          person_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string | null
          created_by: string | null
          currency: string
          enable_cute_icons: boolean
          group_type: string
          id: string
          is_archived: boolean | null
          name: string
          trip_end_date: string | null
          trip_start_date: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          currency?: string
          enable_cute_icons?: boolean
          group_type: string
          id?: string
          is_archived?: boolean | null
          name: string
          trip_end_date?: string | null
          trip_start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          currency?: string
          enable_cute_icons?: boolean
          group_type?: string
          id?: string
          is_archived?: boolean | null
          name?: string
          trip_end_date?: string | null
          trip_start_date?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_sources: {
        Row: {
          created_at: string | null
          created_by: string | null
          details: Json | null
          id: string
          is_active: boolean | null
          name: string
          type: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          type: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          type?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["clerk_user_id"]
          },
        ]
      }
      people: {
        Row: {
          auth_user_id: string | null
          avatar_url: string
          clerk_user_id: string | null
          created_at: string | null
          email: string | null
          id: string
          is_claimed: boolean
          name: string
          source: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          auth_user_id?: string | null
          avatar_url: string
          clerk_user_id?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_claimed?: boolean
          name: string
          source?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          auth_user_id?: string | null
          avatar_url?: string
          clerk_user_id?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_claimed?: boolean
          name?: string
          source?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          comment: string | null
          created_at: string | null
          date: string
          description: string
          group_id: string
          id: string
          paid_by_id: string
          payers: Json | null
          payment_source_id: string | null
          split_mode: string
          split_participants: Json
          tag: string
          type: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          comment?: string | null
          created_at?: string | null
          date: string
          description: string
          group_id: string
          id?: string
          paid_by_id: string
          payers?: Json | null
          payment_source_id?: string | null
          split_mode: string
          split_participants: Json
          tag: string
          type?: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          comment?: string | null
          created_at?: string | null
          date?: string
          description?: string
          group_id?: string
          id?: string
          paid_by_id?: string
          payers?: Json | null
          payment_source_id?: string | null
          split_mode?: string
          split_participants?: Json
          tag?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_paid_by_id_fkey"
            columns: ["paid_by_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_payment_source_id_fkey"
            columns: ["payment_source_id"]
            isOneToOne: false
            referencedRelation: "payment_sources"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_person_by_email: {
        Args: { p_clerk_id: string; p_email: string; p_name: string }
        Returns: {
          auth_user_id: string | null
          avatar_url: string
          clerk_user_id: string | null
          created_at: string | null
          email: string | null
          id: string
          is_claimed: boolean
          name: string
          source: string
          updated_at: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "people"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      find_person_by_email: {
        Args: { p_email: string }
        Returns: {
          auth_user_id: string | null
          avatar_url: string
          clerk_user_id: string | null
          created_at: string | null
          email: string | null
          id: string
          is_claimed: boolean
          name: string
          source: string
          updated_at: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "people"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_expired_invites: { Args: never; Returns: number }
      debug_auth_check: { Args: never; Returns: Json }
      generate_invite_token: { Args: never; Returns: string }
      get_current_user_person_id: { Args: never; Returns: string }
      /** Exact-token invite preview (anon + authenticated). Phase B. */
      get_invite_preview: { Args: { p_token: string }; Returns: Json }
      /** JWT-bound invite accept. Phase B. */
      accept_group_invite: { Args: { p_token: string }; Returns: Json }
      i_am_member_of: { Args: { p_group_id: string }; Returns: boolean }
      i_can_see_person: { Args: { p_person_id: string }; Returns: boolean }
      i_created_group: { Args: { p_group_id: string }; Returns: boolean }
      requesting_user_id: { Args: never; Returns: string }
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
