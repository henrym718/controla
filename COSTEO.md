# Controla · Modelo de inventario y costeo (la guía definitiva)

Esta nota fija **cómo se registra, se consume y se costea todo**, para que no se vuelva
a olvidar. Cubre los casos reales del restaurante: pollo (rinde variable), carne,
verde→tortilla, arroz/espagueti (granel), bebidas, descartables y gastos.

---

## 1. La regla que decide TODO (una sola pregunta)

> **Después de prepararlo, ¿puedo contar las unidades que voy a vender?**

- **SÍ → CONTABLE.** Stock que se cuenta, **costo exacto**, se **acarrea solo** al día
  siguiente, y el robo se caza por **conteo**. (presa, tajada, dedo de verde, bolsita,
  cola, bandeja, tortilla si la cuentas).
- **NO → GRANEL / POOL.** No hay stock por porciones; el costo del día va a un **pool**
  y se reparte al **cierre** entre los platos **vendidos**, restando la merma. (arroz,
  sopa, menestra, **espagueti**, salsa).

Todo vive en **una sola tabla** (`ingredients`) con dos campos: `kind`
(`contable` | `granel`) y `costing_method` (`tanda` | `conversion` | `pool`). **No se
separan en tablas distintas**; se comportan distinto por estos flags.

Aparte del inventario está el cajón de **GASTOS** (`expenses`): jabón, escoba,
servilletas, propinas. Eso **no es inventario** — es costo del día y se registra con
`registrar_gasto`, no con `registrar_compra`.

> **La línea de oro:** `registrar_compra` = algo que **entra al inventario** (todavía no
> es costo; lo será al consumirse). `registrar_gasto` = consumible que **se gasta y ya**.

---

## 2. Pollo y carne (rinde variable) → DOS NIVELES: crudo → procesado

Es el caso difícil ("no sé cuántas presas saldrán, y a veces sobran pollos para mañana").
Se resuelve con dos niveles, ambos **contables**:

**Nivel 1 — crudo** (`pollo entero`, `libra de carne`):
- Voz: **"registra compra de 4 pollos por $40"** → stock **+4 pollos @ $10**. Sale la
  plata de la caja. Lo que no se usa hoy **queda en stock para mañana** (se acarrea solo).

**Nivel 2 — procesado** (`presa`, `tajada`): se declara el **rendimiento al abrirlo**,
no al comprarlo.
- Voz: **"corté 2 pollos y salieron 28 presas"** → consume **−2 pollos (−$20)** y produce
  **+28 presas @ $0.71** (costo exacto = $20 ÷ 28). Quedan 2 pollos crudos en stock.
- Venta de "arroz con pollo" (receta = 1 presa) → **−1 presa** al costo exacto.

Así el costo por presa es **exacto** (no se infla por prorrateo), el sobrante se acarrea
solo, y el **rinde** (28 presas ÷ 2 pollos = 14 por pollo) queda registrado para vigilarlo.

> La carne es igual: "compré 3 libras a $15" (crudo) → "de 2 libras salieron 18 tajadas"
> (procesado). Si un día no cuentas tajadas, esa carne va como **granel** (ver §4).

---

## 3. Verde → tortilla (consumir un contable para producir otro)

- Compra: **"compré una racima de verde, 40 dedos, $5"** → contable, **+40 dedos @ $0.125**.
- Procesar: **"usé 20 dedos y salieron 20 tortillas"** → consume **−20 dedos ($2.50)** y
  produce **+20 tortillas** (si las cuentas → contable exacto; si no → el $2.50 va al pool
  de "tortilla").
- **Quedan 20 dedos en stock para otro día.** Se acarrean solos.

Es el mismo patrón "**procesar**" del pollo: consumir stock contable y producir unidades
(con rinde) o aporte a un pool.

---

## 4. Arroz / espagueti (granel) → pool, y el "no sé cuántas porciones"

- Voz: **"cociné arroz por $8"** → va al **pool del día** (no entra stock por porciones).
- Durante el día las ventas **no descuentan** arroz (a propósito).
- Al **cerrar el día**: el sistema cuenta los platos **vendidos** que llevan arroz
  (sumando las ventas registradas, **no** algo que declares) y calcula
  `costo por plato = pool × (1 − merma) ÷ platos vendidos`.

Por eso el espagueti funciona: **nunca declaras cuántas porciones hiciste**, solo cuántas
**vendiste** (cada venta queda registrada), y lo que sobró/se botó entra como **% de merma**.

---

## 5. Bebidas y descartables

- **Bebidas (Coca-Cola, agua):** contable con `is_sellable` + precio. Compra sube stock,
  venta baja stock, costo = costo unitario. Anti-robo por conteo.
- **Descartables (bandeja, vaso, cuchara):** contable `is_disposable`. Se descuentan solos
  al vender "para llevar" (tabla `takeout_packaging`).

---

## 6. El acarreo entre días es AUTOMÁTICO

El stock es la **suma de todos los movimientos** — **no se reinicia cada día**. Las presas,
dedos o pollos que sobran quedan con su costo para mañana, sin hacer nada especial. La única
disciplina: **contar físicamente de vez en cuando** (cierre) para cazar el desvío.

---

## 7. EL DATO QUE FALTA: rendimiento y "¿dónde están las presas?" (anti-robo)

Este es el control que la jefa necesita y que **todavía no está cableado**. Para contables:

```
stock al abrir
+ producido hoy        (rinde: presas que salieron de las tandas)
− vendido hoy          (consumo por ventas registradas)
− merma / retiros
= stock esperado
vs  stock contado      (conteo físico al cierre)
= DESCUADRE            (faltante = posible venta NO registrada / robo)
```

Ejemplo que dio el dueño: de 2 pollos salieron 28 presas, pero solo se vendieron 12 platos
y al contar quedan 6 presas → **faltan 10 presas** sin explicar → bandera roja (las pudieron
vender sin registrar). Hoy, si el pollo fuera **granel**, esto solo se vería como un
"costo por plato altísimo" sin saber por qué; con pollo **contable** se ve como **unidades
que faltan**, que es mucho más claro y acusatorio.

Y un KPI de **rinde**: presas por pollo de cada tanda vs la banda histórica (≈13–14). Rinde
bajo = mal corte **o** presas que caminaron antes de contarlas.

**"Platos que salieron para la venta" (disponibles, no vendidos):** se puede calcular **solo**
para platos cuyo insumo límite es **contable** (28 presas, 1 presa/plato → 28 platos
disponibles; vendidos 12 → 16 sin vender, deben cuadrar con el sobrante). Para platos puramente
de **granel** (espagueti) **no se puede** y **no hay que inventarlo** — ahí el control es la
merma % y el costo/plato vs la banda histórica.

---

## 8. Qué YA funciona vs qué FALTA construir

**Ya funciona:**
- Inventario contable con stock que se acarrea y **costo exacto** (`last_unit_cost`).
- **Tanda con rinde** (`production_batches.units_produced`) → costo por unidad exacto.
- **Granel + prorrateo** al cierre (`cerrar_dia`, `granel_close.cost_per_plate`) + merma %.
- Compra, retiro (con motivo), merma de insumo, y **ajuste físico manual con PIN** (sale en
  Analítica como "desfase de inventario").

**Falta (próximo código, en este orden de valor):**
1. **"Procesar"** que **consuma stock crudo** y produzca el procesado, **valorando el costo
   desde lo consumido** (hoy `registrar_produccion` pide el costo a mano y no descuenta el
   crudo; para el pollo toca hacer retiro + producción por separado). Esto resuelve pollo,
   carne y verde→tortilla con **un solo flujo** y menos errores.
2. **Conteo de cierre estructurado:** la tabla `inventory_counts` ya **existe pero está sin
   usar**. Cablearla = esperado vs contado por insumo contable → el **descuadre de unidades**
   del §7.
3. **Reporte de rinde + "platos disponibles vs vendidos"** para platos de insumo contable.

---

## 9. Resumen para la persona que registra (frases de voz)

| Situación | Qué decir | Qué hace el sistema |
|---|---|---|
| Compra de crudo | "compra 4 pollos por $40" | +4 pollos al stock, sale plata de caja |
| Abrir/procesar (rinde) | "de 2 pollos salieron 28 presas" | −2 pollos, +28 presas a costo exacto |
| Granel | "cociné arroz por $8" | +$8 al pool del día (sin stock) |
| Verde | "compra racima, 40 dedos, $5" | +40 dedos al stock |
| Procesar verde | "usé 20 dedos, salieron 20 tortillas" | −20 dedos, +20 tortillas |
| Bebida | "compré 24 colas por $18, se venden a $0.75" | +24 colas vendibles |
| Gasto (no inventario) | "gasté $2 en jabón de caja" | costo del día (no es inventario) |
| Venta | "vendí un arroz con pollo a $3" | −1 presa (exacto); arroz va por pool |
| Cierre del día | "cierra el día, 10% de merma del arroz" | prorratea el granel entre platos vendidos |

**Principio rector:** lo más simple posible. La mayoría de cosas son solo "contable" o
"granel". El doble nivel (crudo→procesado) se usa **solo** para los caros y robables de
rinde variable: **pollo y carne**. No forzar "platos disponibles" en el granel.
