# Controla

Control de finanzas para restaurantes pequeños, **sin fricción**: la captura es por
**voz** (un botón → Whisper → Gemini) y la app hace el resto — costos por plato,
merma, cuadre de caja por turno y detección de descuadres (robo).

> Pensado mobile-first. Cada restaurante vive en su ruta: `/[restaurante]`.

## Stack

- **Next.js** (App Router, TypeScript, Tailwind v4) — mobile-first / PWA
- **Supabase** (Postgres + RLS multi-tenant + Auth por PIN)
- **Voz:** MediaRecorder (nativo) → **Whisper** (STT) → **Gemini** (function calling)

## Puesta en marcha (local, con la CLI)

```bash
pnpm install

# levanta Postgres + servicios locales (la 1ª vez descarga imágenes de Docker)
supabase start

# aplica migrations/ + seed.sql
supabase db reset

# copia las llaves que imprime `supabase start` a tu .env.local
cp .env.local.example .env.local

pnpm dev
```

PINs de prueba (del seed, **cambiar**): admin `1234`, María `1111`, Ana `2222`.

> El login, la caja y el cierre de turno funcionan sin llaves de IA. Para que el
> **chat por voz/texto** funcione, completa `GEMINI_API_KEY` y `WHISPER_API_KEY` en
> `.env.local`. En desarrollo, `DISABLE_SHIFT_WINDOW=1` evita el bloqueo por horario.

## Modelo de costeo (resumen)

- **Costo del DÍA = exacto** (todo lo consumido). **Costo por PLATO = asignación.**
- Insumos **contables** (presa, dedo, bolsita) → costo unitario + conteo físico.
- Insumos **a granel** (arroz, sopa) → **pool** de costo que se **prorratea** entre
  los platos vendidos al **cierre diario** (restando la merma declarada).
- **Robo:** contables → conteo físico; granel → ratio histórico de rendimiento.

## Dos cierres

- **Cierre de turno** = cuadre de **caja** de la chica encargada (cada turno).
- **Cierre diario** = los **costos** (prorrateo del granel + fijos).

## Estructura

```
src/app/            # Next.js (App Router)
src/lib/supabase/   # clientes (admin = service role)
supabase/
  migrations/       # 0001_fundacion, 0002_costeo
  seed.sql          # restaurante demo + PINs
  README.md         # detalle del esquema y el ciclo del turno
```
