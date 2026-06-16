export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  app: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      jwt: { Args: never; Returns: Json }
      restaurant_id: { Args: never; Returns: string }
      user_id: { Args: never; Returns: string }
      user_role: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          category: string
          code: string
          label: string
          sort_order: number
        }
        Insert: {
          category: string
          code: string
          label: string
          sort_order?: number
        }
        Update: {
          category?: string
          code?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          actor_name: string | null
          created_at: string
          description: string
          event_code: string
          id: string
          metadata: Json | null
          op_id: string | null
          restaurant_id: string
          shift_session_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          actor_name?: string | null
          created_at?: string
          description: string
          event_code: string
          id?: string
          metadata?: Json | null
          op_id?: string | null
          restaurant_id: string
          shift_session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Update: {
          actor_name?: string | null
          created_at?: string
          description?: string
          event_code?: string
          id?: string
          metadata?: Json | null
          op_id?: string | null
          restaurant_id?: string
          shift_session_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_event_code_fkey"
            columns: ["event_code"]
            isOneToOne: false
            referencedRelation: "activity_events"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "activity_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          payload: Json | null
          reason: string | null
          restaurant_id: string
          shift_session_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          payload?: Json | null
          reason?: string | null
          restaurant_id: string
          shift_session_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          payload?: Json | null
          reason?: string | null
          restaurant_id?: string
          shift_session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_throttle: {
        Row: {
          blocked_until: string | null
          fails: number
          id: string
          updated_at: string
        }
        Insert: {
          blocked_until?: string | null
          fails?: number
          id: string
          updated_at?: string
        }
        Update: {
          blocked_until?: string | null
          fails?: number
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          amount: number
          categoria: string | null
          cliente_id: string | null
          created_at: string
          id: string
          op_id: string | null
          reason: string | null
          restaurant_id: string
          shift_session_id: string
          type: string
          user_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          categoria?: string | null
          cliente_id?: string | null
          created_at?: string
          id?: string
          op_id?: string | null
          reason?: string | null
          restaurant_id: string
          shift_session_id: string
          type: string
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          categoria?: string | null
          cliente_id?: string | null
          created_at?: string
          id?: string
          op_id?: string | null
          reason?: string | null
          restaurant_id?: string
          shift_session_id?: string
          type?: string
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_saldos_credito"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "cash_movements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "cash_movements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          restaurant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name: string
          restaurant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_parts: {
        Row: {
          combo_dish_id: string
          part_dish_id: string
          restaurant_id: string
          role: string
        }
        Insert: {
          combo_dish_id: string
          part_dish_id: string
          restaurant_id: string
          role?: string
        }
        Update: {
          combo_dish_id?: string
          part_dish_id?: string
          restaurant_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_parts_combo_dish_id_fkey"
            columns: ["combo_dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_parts_part_dish_id_fkey"
            columns: ["part_dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_parts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_close: {
        Row: {
          business_date: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          notes: string | null
          restaurant_id: string
          status: string
        }
        Insert: {
          business_date: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          restaurant_id: string
          status?: string
        }
        Update: {
          business_date?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          restaurant_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_close_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_close_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_menu: {
        Row: {
          available: boolean
          business_date: string
          created_at: string
          created_by: string | null
          dish_id: string
          id: string
          price: number
          restaurant_id: string
          shift_id: string
          sort_order: number
        }
        Insert: {
          available?: boolean
          business_date: string
          created_at?: string
          created_by?: string | null
          dish_id: string
          id?: string
          price?: number
          restaurant_id: string
          shift_id: string
          sort_order?: number
        }
        Update: {
          available?: boolean
          business_date?: string
          created_at?: string
          created_by?: string | null
          dish_id?: string
          id?: string
          price?: number
          restaurant_id?: string
          shift_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_menu_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_menu_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_menu_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_menu_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_components: {
        Row: {
          created_at: string
          dish_id: string
          id: string
          ingredient_id: string
          qty: number
          restaurant_id: string
        }
        Insert: {
          created_at?: string
          dish_id: string
          id?: string
          ingredient_id: string
          qty?: number
          restaurant_id: string
        }
        Update: {
          created_at?: string
          dish_id?: string
          id?: string
          ingredient_id?: string
          qty?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_components_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_components_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_components_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "dish_components_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "dish_components_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_daily_cost: {
        Row: {
          business_date: string
          created_at: string
          dish_id: string
          id: string
          price: number
          qty: number
          restaurant_id: string
          unit_cost: number
        }
        Insert: {
          business_date: string
          created_at?: string
          dish_id: string
          id?: string
          price?: number
          qty?: number
          restaurant_id: string
          unit_cost?: number
        }
        Update: {
          business_date?: string
          created_at?: string
          dish_id?: string
          id?: string
          price?: number
          qty?: number
          restaurant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "dish_daily_cost_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_daily_cost_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      dishes: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          is_combo: boolean
          is_extra: boolean
          name: string
          price: number
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          is_combo?: boolean
          is_extra?: boolean
          name: string
          price?: number
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          is_combo?: boolean
          is_extra?: boolean
          name?: string
          price?: number
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dishes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          business_date: string
          category: string
          created_at: string
          id: string
          note: string | null
          op_id: string | null
          paid_from_cash: boolean
          recurring_cost_id: string | null
          restaurant_id: string
          shift_session_id: string | null
          source: string
          user_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          business_date?: string
          category?: string
          created_at?: string
          id?: string
          note?: string | null
          op_id?: string | null
          paid_from_cash?: boolean
          recurring_cost_id?: string | null
          restaurant_id: string
          shift_session_id?: string | null
          source?: string
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          business_date?: string
          category?: string
          created_at?: string
          id?: string
          note?: string | null
          op_id?: string | null
          paid_from_cash?: boolean
          recurring_cost_id?: string | null
          restaurant_id?: string
          shift_session_id?: string | null
          source?: string
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "expenses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      granel_close: {
        Row: {
          business_date: string
          cost_per_plate: number | null
          created_at: string
          distributable_cost: number | null
          id: string
          ingredient_id: string
          merma_cost: number | null
          merma_pct: number
          plates_count: number
          pool_cost: number
          restaurant_id: string
        }
        Insert: {
          business_date: string
          cost_per_plate?: number | null
          created_at?: string
          distributable_cost?: number | null
          id?: string
          ingredient_id: string
          merma_cost?: number | null
          merma_pct?: number
          plates_count?: number
          pool_cost?: number
          restaurant_id: string
        }
        Update: {
          business_date?: string
          cost_per_plate?: number | null
          created_at?: string
          distributable_cost?: number | null
          id?: string
          ingredient_id?: string
          merma_cost?: number | null
          merma_pct?: number
          plates_count?: number
          pool_cost?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "granel_close_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "granel_close_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "granel_close_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "granel_close_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          active: boolean
          consumo_visible: boolean
          consumption_unit: string | null
          conversion_factor: number | null
          costing_method: string
          created_at: string
          id: string
          is_disposable: boolean
          is_sellable: boolean
          kind: string
          last_unit_cost: number | null
          name: string
          purchase_unit: string | null
          restaurant_id: string
          sale_price: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          consumo_visible?: boolean
          consumption_unit?: string | null
          conversion_factor?: number | null
          costing_method: string
          created_at?: string
          id?: string
          is_disposable?: boolean
          is_sellable?: boolean
          kind: string
          last_unit_cost?: number | null
          name: string
          purchase_unit?: string | null
          restaurant_id: string
          sale_price?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          consumo_visible?: boolean
          consumption_unit?: string | null
          conversion_factor?: number | null
          costing_method?: string
          created_at?: string
          id?: string
          is_disposable?: boolean
          is_sellable?: boolean
          kind?: string
          last_unit_cost?: number | null
          name?: string
          purchase_unit?: string | null
          restaurant_id?: string
          sale_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          business_date: string
          counted_qty: number
          created_at: string
          diff: number | null
          expected_qty: number
          id: string
          ingredient_id: string
          restaurant_id: string
          tag: string | null
        }
        Insert: {
          business_date: string
          counted_qty?: number
          created_at?: string
          diff?: number | null
          expected_qty?: number
          id?: string
          ingredient_id: string
          restaurant_id: string
          tag?: string | null
        }
        Update: {
          business_date?: string
          counted_qty?: number
          created_at?: string
          diff?: number | null
          expected_qty?: number
          id?: string
          ingredient_id?: string
          restaurant_id?: string
          tag?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "inventory_counts_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "inventory_counts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          business_date: string
          created_at: string
          id: string
          ingredient_id: string
          op_id: string | null
          qty: number
          reason: string | null
          ref_id: string | null
          ref_table: string | null
          restaurant_id: string
          shift_session_id: string | null
          total_cost: number | null
          type: string
          unit_cost: number
          user_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          business_date?: string
          created_at?: string
          id?: string
          ingredient_id: string
          op_id?: string | null
          qty: number
          reason?: string | null
          ref_id?: string | null
          ref_table?: string | null
          restaurant_id: string
          shift_session_id?: string | null
          total_cost?: number | null
          type: string
          unit_cost?: number
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          business_date?: string
          created_at?: string
          id?: string
          ingredient_id?: string
          op_id?: string | null
          qty?: number
          reason?: string | null
          ref_id?: string | null
          ref_table?: string | null
          restaurant_id?: string
          shift_session_id?: string | null
          total_cost?: number | null
          type?: string
          unit_cost?: number
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "inventory_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "inventory_movements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "inventory_movements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_config: {
        Row: {
          id: number
          super_pin_hash: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          super_pin_hash?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          super_pin_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      production_batches: {
        Row: {
          business_date: string
          created_at: string
          id: string
          ingredient_id: string
          note: string | null
          restaurant_id: string
          shift_session_id: string | null
          total_cost: number
          unit_cost: number | null
          units_produced: number | null
          user_id: string | null
        }
        Insert: {
          business_date?: string
          created_at?: string
          id?: string
          ingredient_id: string
          note?: string | null
          restaurant_id: string
          shift_session_id?: string | null
          total_cost?: number
          unit_cost?: number | null
          units_produced?: number | null
          user_id?: string | null
        }
        Update: {
          business_date?: string
          created_at?: string
          id?: string
          ingredient_id?: string
          note?: string | null
          restaurant_id?: string
          shift_session_id?: string | null
          total_cost?: number
          unit_cost?: number | null
          units_produced?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "production_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "production_batches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "production_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_costs: {
        Row: {
          active: boolean
          amount: number
          category: string
          created_at: string
          day_of_month: number | null
          effective_from: string
          id: string
          name: string
          next_run: string | null
          restaurant_id: string
          schedule_type: string
          shift_id: string | null
          updated_at: string
          weekdays: number[] | null
        }
        Insert: {
          active?: boolean
          amount: number
          category?: string
          created_at?: string
          day_of_month?: number | null
          effective_from?: string
          id?: string
          name: string
          next_run?: string | null
          restaurant_id: string
          schedule_type?: string
          shift_id?: string | null
          updated_at?: string
          weekdays?: number[] | null
        }
        Update: {
          active?: boolean
          amount?: number
          category?: string
          created_at?: string
          day_of_month?: number | null
          effective_from?: string
          id?: string
          name?: string
          next_run?: string | null
          restaurant_id?: string
          schedule_type?: string
          shift_id?: string | null
          updated_at?: string
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_costs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_costs_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      sales: {
        Row: {
          business_date: string
          cliente_id: string | null
          consumo_interno: boolean
          created_at: string
          dish_id: string | null
          dish_name: string | null
          id: string
          ingredient_id: string | null
          item_kind: string
          op_id: string | null
          payment_method: string
          qty: number
          restaurant_id: string
          service_type: string
          shift_session_id: string
          total: number
          unit_price: number
          user_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          business_date?: string
          cliente_id?: string | null
          consumo_interno?: boolean
          created_at?: string
          dish_id?: string | null
          dish_name?: string | null
          id?: string
          ingredient_id?: string | null
          item_kind?: string
          op_id?: string | null
          payment_method?: string
          qty?: number
          restaurant_id: string
          service_type?: string
          shift_session_id: string
          total?: number
          unit_price?: number
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          business_date?: string
          cliente_id?: string | null
          consumo_interno?: boolean
          created_at?: string
          dish_id?: string | null
          dish_name?: string | null
          id?: string
          ingredient_id?: string | null
          item_kind?: string
          op_id?: string | null
          payment_method?: string
          qty?: number
          restaurant_id?: string
          service_type?: string
          shift_session_id?: string
          total?: number
          unit_price?: number
          user_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "v_saldos_credito"
            referencedColumns: ["cliente_id"]
          },
          {
            foreignKeyName: "sales_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "sales_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "sales_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "sales_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_session_members: {
        Row: {
          joined_at: string
          shift_session_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          shift_session_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          shift_session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_session_members_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_session_members_shift_session_id_fkey"
            columns: ["shift_session_id"]
            isOneToOne: false
            referencedRelation: "v_caja_turno"
            referencedColumns: ["shift_session_id"]
          },
          {
            foreignKeyName: "shift_session_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_sessions: {
        Row: {
          business_date: string
          cash_discrepancy: number | null
          closed_at: string | null
          closed_by: string | null
          closing_float: number | null
          counted_cash: number | null
          deposit_amount: number | null
          expected_cash: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_cash: number
          responsible_user_id: string | null
          restaurant_id: string
          shift_id: string
          status: string
        }
        Insert: {
          business_date?: string
          cash_discrepancy?: number | null
          closed_at?: string | null
          closed_by?: string | null
          closing_float?: number | null
          counted_cash?: number | null
          deposit_amount?: number | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_cash?: number
          responsible_user_id?: string | null
          restaurant_id: string
          shift_id: string
          status?: string
        }
        Update: {
          business_date?: string
          cash_discrepancy?: number | null
          closed_at?: string | null
          closed_by?: string | null
          closing_float?: number | null
          counted_cash?: number | null
          deposit_amount?: number | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_cash?: number
          responsible_user_id?: string | null
          restaurant_id?: string
          shift_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_sessions_responsible_user_id_fkey"
            columns: ["responsible_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          active: boolean
          created_at: string
          end_time: string
          id: string
          name: string
          restaurant_id: string
          sort_order: number
          start_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          end_time: string
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
          start_time: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          end_time?: string
          id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      takeout_packaging: {
        Row: {
          ingredient_id: string
          qty_per_order: number
          restaurant_id: string
        }
        Insert: {
          ingredient_id: string
          qty_per_order?: number
          restaurant_id: string
        }
        Update: {
          ingredient_id?: string
          qty_per_order?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "takeout_packaging_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "takeout_packaging_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "takeout_packaging_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "takeout_packaging_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active: boolean
          created_at: string
          default_shift_id: string | null
          id: string
          name: string
          pin_hash: string
          restaurant_id: string
          role: string
          schedule_end: string | null
          schedule_start: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_shift_id?: string | null
          id?: string
          name: string
          pin_hash: string
          restaurant_id: string
          role?: string
          schedule_end?: string | null
          schedule_start?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          default_shift_id?: string | null
          id?: string
          name?: string
          pin_hash?: string
          restaurant_id?: string
          role?: string
          schedule_end?: string | null
          schedule_start?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_default_shift_id_fkey"
            columns: ["default_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_caja_turno: {
        Row: {
          caja_esperada: number | null
          opening_cash: number | null
          restaurant_id: string | null
          shift_session_id: string | null
        }
        Insert: {
          caja_esperada?: never
          opening_cash?: number | null
          restaurant_id?: string | null
          shift_session_id?: string | null
        }
        Update: {
          caja_esperada?: never
          opening_cash?: number | null
          restaurant_id?: string | null
          shift_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_pool_granel: {
        Row: {
          business_date: string | null
          ingredient_id: string | null
          name: string | null
          pool_cost: number | null
          restaurant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_contable"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "production_batches_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "v_stock_total"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "production_batches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_saldos_credito: {
        Row: {
          cliente_id: string | null
          kind: string | null
          name: string | null
          restaurant_id: string | null
          saldo: number | null
        }
        Insert: {
          cliente_id?: string | null
          kind?: string | null
          name?: string | null
          restaurant_id?: string | null
          saldo?: never
        }
        Update: {
          cliente_id?: string | null
          kind?: string | null
          name?: string | null
          restaurant_id?: string | null
          saldo?: never
        }
        Relationships: [
          {
            foreignKeyName: "clientes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_contable: {
        Row: {
          ingredient_id: string | null
          name: string | null
          restaurant_id: string | null
          stock: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_total: {
        Row: {
          ingredient_id: string | null
          kind: string | null
          name: string | null
          restaurant_id: string | null
          stock: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_create_user: {
        Args: {
          p_end?: string
          p_name: string
          p_pin: string
          p_restaurant: string
          p_role: string
          p_shift_id?: string
          p_start?: string
        }
        Returns: string
      }
      admin_set_pin: {
        Args: { p_pin: string; p_user: string }
        Returns: undefined
      }
      anular_operacion: {
        Args: {
          p_by: string
          p_op_id: string
          p_reason: string
          p_restaurant: string
        }
        Returns: Json
      }
      armar_combo: {
        Args: {
          p_name?: string
          p_parts: Json
          p_price?: number
          p_restaurant: string
          p_user?: string
        }
        Returns: Json
      }
      auth_estado: { Args: { p_key: string }; Returns: string }
      auth_intento: {
        Args: {
          p_block_min?: number
          p_key: string
          p_max?: number
          p_ok: boolean
        }
        Returns: string
      }
      bitacora_listar: {
        Args: {
          p_category?: string
          p_event?: string
          p_from: string
          p_restaurant: string
          p_to: string
        }
        Returns: Json
      }
      cerrar_dia: {
        Args: {
          p_closed_by?: string
          p_date: string
          p_merma?: Json
          p_restaurant: string
        }
        Returns: Json
      }
      cerrar_turno: {
        Args: {
          p_closed_by: string
          p_closing_float: number
          p_counted_cash: number
          p_notes?: string
          p_session_id: string
        }
        Returns: {
          business_date: string
          cash_discrepancy: number | null
          closed_at: string | null
          closed_by: string | null
          closing_float: number | null
          counted_cash: number | null
          deposit_amount: number | null
          expected_cash: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_cash: number
          responsible_user_id: string | null
          restaurant_id: string
          shift_id: string
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "shift_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consumir_insumo: {
        Args: {
          p_date: string
          p_ingredient_id: string
          p_qty: number
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      conteo_estado: {
        Args: { p_date: string; p_restaurant: string }
        Returns: Json
      }
      crear_combo: {
        Args: {
          p_name?: string
          p_price?: number
          p_restaurant: string
          p_segundo: string
          p_sopa: string
          p_user?: string
        }
        Returns: Json
      }
      crear_restaurante: {
        Args: {
          p_admin_name: string
          p_admin_pin: string
          p_name: string
          p_slug: string
        }
        Returns: Json
      }
      cuadres_dia: {
        Args: { p_date: string; p_restaurant: string }
        Returns: Json
      }
      editar_producto: {
        Args: {
          p_adjust_kind?: string
          p_date: string
          p_ingredient_id: string
          p_name: string
          p_new_qty?: number
          p_reason?: string
          p_restaurant: string
          p_sale_price?: number
          p_session: string
          p_unit_cost: number
          p_user: string
        }
        Returns: Json
      }
      eliminar_producto: {
        Args: { p_ingredient_id: string; p_restaurant: string }
        Returns: Json
      }
      fijar_menu: {
        Args: {
          p_date: string
          p_items: Json
          p_restaurant: string
          p_shift: string
          p_user: string
        }
        Returns: Json
      }
      login_pin: {
        Args: { p_pin: string; p_restaurant: string }
        Returns: {
          id: string
          name: string
          role: string
        }[]
      }
      operaciones_reversibles: {
        Args: { p_from: string; p_restaurant: string; p_to: string }
        Returns: Json
      }
      procesar_insumo: {
        Args: {
          p_date: string
          p_input_id: string
          p_input_qty: number
          p_output_id: string
          p_output_units?: number
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      purgar_bitacora: { Args: { p_days?: number }; Returns: number }
      registrar_cobro_credito: {
        Args: {
          p_amount: number
          p_cliente_id: string
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      registrar_compra: {
        Args: {
          p_date: string
          p_fuente?: string
          p_ingredient_id: string
          p_name: string
          p_quantity?: number
          p_restaurant: string
          p_sale_price?: number
          p_session: string
          p_total_cost: number
          p_user: string
        }
        Returns: Json
      }
      registrar_consumo: {
        Args: {
          p_date: string
          p_items: Json
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      registrar_consumo_interno: {
        Args: {
          p_date: string
          p_dish_id: string
          p_name: string
          p_qty?: number
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      registrar_conteo: {
        Args: {
          p_counts: Json
          p_date: string
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      registrar_gasto: {
        Args: {
          p_amount: number
          p_category: string
          p_date: string
          p_fuente: string
          p_note: string
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      registrar_merma_insumos: {
        Args: {
          p_date: string
          p_items: Json
          p_restaurant: string
          p_session: string
          p_user: string
        }
        Returns: Json
      }
      registrar_venta: {
        Args: {
          p_date: string
          p_dish_id: string
          p_ingredient_id: string
          p_item_kind: string
          p_name: string
          p_packaging_id?: string
          p_payment_method: string
          p_qty: number
          p_restaurant: string
          p_service_type: string
          p_session: string
          p_unit_price: number
          p_user: string
        }
        Returns: Json
      }
      registrar_venta_credito: {
        Args: {
          p_cliente_id: string
          p_date: string
          p_dish_id: string
          p_ingredient_id: string
          p_item_kind: string
          p_name: string
          p_packaging_id?: string
          p_qty: number
          p_restaurant: string
          p_service_type?: string
          p_session: string
          p_unit_price: number
          p_user: string
        }
        Returns: Json
      }
      resumen_turno: { Args: { p_session_id: string }; Returns: Json }
      set_super_pin: { Args: { p_pin: string }; Returns: undefined }
      ventas_por_dia_semana: {
        Args: { p_restaurant: string }
        Returns: {
          dias: number
          total: number
          weekday: number
        }[]
      }
      verify_super_pin: { Args: { p_pin: string }; Returns: boolean }
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
  app: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

