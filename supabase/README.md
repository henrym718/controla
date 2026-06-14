# Controla · Base de datos (Supabase)

- `0001_fundacion` — multi-tenant, auth por PIN, turnos, cierre de turno (caja),
  ventas, gastos y costos recurrentes.
- `0002_costeo` — insumos contable/granel, recetas, tandas, inventario, descartables,
  y el **cierre diario** (prorrateo del pool de granel + merma + conteo físico).

## Aplicar

**Opción A — Supabase CLI**
```bash
supabase db reset          # aplica migrations/ + seed.sql en local
# o contra el proyecto remoto:
supabase db push
```

**Opción B — SQL Editor**
Pega `migrations/20260613000001_fundacion.sql` y luego `seed.sql` en el editor del dashboard.

## Auth por PIN (sin email/password)

El login ocurre en el **servidor** (Next.js, con la *service role key*, que ignora RLS):

1. La usuaria elige **restaurante** (por la URL `/[slug]`) y **turno**, e ingresa su **PIN**.
2. El servidor busca el usuario y valida: `SELECT ... WHERE pin_hash = crypt($pin, pin_hash)`.
3. Se emite un **JWT propio** (firmado con el JWT secret de Supabase) con claims:
   ```json
   { "restaurant_id": "...", "user_id": "...", "role": "admin|empleado" }
   ```
   Esos claims alimentan las RLS (`app.restaurant_id()`, `app.user_id()`, `app.user_role()`).

> La **ventana horaria** del turno (`shifts.start_time/end_time`) la valida la app al
> abrir turno, para que no usen la IA desde la casa. Si `end_time < start_time`, el turno
> cruza la medianoche (turno noche).

## Ciclo de un turno

```
abrir turno  → crea shift_sessions (status=open, opening_cash, encargada)
             → se agregan miembros (shift_session_members)
durante      → sales / cash_movements / expenses referencian el shift_session_id
en vivo      → app.v_caja_turno.caja_esperada responde "¿cuánto debería haber?"
cerrar turno → app.cerrar_turno(session, contado, por_quien)
             → calcula esperado vs contado, guarda descuadre, status=closed
             → la app saca a TODAS las miembros (re-login para otro turno)
```

- **Cierre de turno** = cuadre de **caja** (lo de aquí).
- **Cierre diario** = los **costos** (pool/prorrateo + fijos) → migración de costeo.

## Pendiente (siguiente)

- App Next.js (App Router, PWA, mobile-first) + `/api/agent` (Whisper→Gemini) y `/api/commit`.
- Login por PIN + selección de turno (emite el JWT propio con los claims).
- Tools de Gemini: `abrir_turno`, `registrar_venta`, `ingresar_caja`, `registrar_gasto`,
  `registrar_produccion`, `registrar_retiro`, `cerrar_turno`, `cerrar_dia`.
