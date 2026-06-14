# Manual de Controla 🍗

Guía simple para usar la app del restaurante. Está pensada para que **cualquiera**
(la cocina, la encargada o la dueña) la entienda. Casi todo se hace **hablando**: tocas
el botón **Hablar**, dices lo que pasó, y la app lo registra. **Siempre te pide confirmar
antes de guardar.**

> Regla de oro: si no estás segura, di lo que pasó con tus palabras. La app pregunta lo
> que le falte. **Nada se guarda sin que confirmes.**

---

## 1. Entrar a la app

1. Abre la página del restaurante.
2. Elige tu **turno** (Mañana, Tarde, Noche…).
3. Escribe tu **PIN**.
4. Si eres la primera del turno, escribe la **caja inicial** (la plata con la que arrancas;
   puede ser 0).

Listo, ya puedes trabajar. Todas las que entran al mismo turno comparten la misma caja y
las mismas ventas del día.

---

## 2. Hablar con la app (lo del día a día)

Toca **Hablar** y dilo natural. Estos son los casos y **cómo decirlos**:

### 🛒 Vender
| Qué pasó | Cómo decirlo |
|---|---|
| Vender un plato | “vendí un arroz con pollo” |
| Varios | “tres almuerzos” |
| Para llevar | “dos arroz con pollo para llevar” (descuenta la bandeja/lonchera) |
| Pagaron por transferencia | “un seco de pollo, pagó por transferencia” |
| Vender una bebida | “una coca cola” |

> La app usa el **precio del menú de hoy**. Si el plato no está, te pregunta el precio.

### 💵 Caja
| Qué pasó | Cómo decirlo |
|---|---|
| Entró plata a la caja | “ingresé $10 a la caja” |
| Sacar plata (con motivo) | “saqué $5 para el gas” *(el motivo es obligatorio)* |

### 🧾 Gasto vs Compra (¡es distinto!)
- **GASTO** = algo que se gasta y ya (jabón, escoba, servilletas, propinas).
  - “gasté $2 en jabón” — la app pregunta si salió **de la caja** o lo puso **la jefa**.
- **COMPRA** = algo que **entra al inventario** (arroz, aceite, colas, pollo).
  - “compré 4 pollos por $40” — sube al inventario; aún no es costo hasta que se use.

### 🍗 Procesar (pollo → presas, verde → tortillas)
Cuando un crudo se convierte en lo que se vende, y **no sabes de antemano cuánto rinde**:
| Qué pasó | Cómo decirlo |
|---|---|
| Cortaste pollo | “de 2 pollos salieron 28 presas” |
| Carne | “de 3 libras de carne salieron 24 tajadas” |
| Verde | “de 20 dedos de verde salieron 20 tortillas” |

La app **saca el crudo del inventario y le pasa el costo** a lo que salió. **No preguntes
el costo**, ella lo calcula. Si no puedes contar cuánto salió (sopa, espagueti), no digas
las unidades: va “a granel” (ver abajo).

### 🍚 Cocinar a granel (lo que no se cuenta)
- “cociné arroz por $8”, “hice sopa por $6” → entra al **pool del día**. Al cerrar el día
  se reparte entre los platos vendidos.

### 📋 Menú del día
| Qué pasó | Cómo decirlo |
|---|---|
| Poner el menú | “el menú de hoy es arroz con pollo a $3 y seco a $3.50” |
| Se acabó un plato | “se acabó el seco de pollo” |

### ❓ Preguntar
- “¿cuánto hemos vendido hoy?”
- “¿cuánta plata hay en caja?”
- “¿cuánto queda de cola?”
- “¿cuánto vendimos de arroz con pollo?”

---

## 3. Los cierres (lo más importante para el control)

### 🔒 Cerrar turno = cuadrar la CAJA (lo hace la encargada)
En la pantalla **Cierre**:
1. Cuenta la plata física y escribe cuánto contaste.
2. Toca **“Cerrar turno y cuadrar caja”** → sale un resumen de todo (ventas, costos, caja).
3. Escribe **cuánta caja dejas** para el próximo turno (por defecto, la caja inicial; puedes
   dejar más o menos).
4. La app calcula el **efectivo a entregar a la jefa** (lo contado menos la base que dejas).
5. Confirma. **Se cierra para todas** y hay que volver a entrar para otro turno.

> Si lo contado no coincide con lo que el sistema esperaba, eso es un **descuadre** (falta o
> sobra plata) y queda registrado.

### 📦 Conteo de cierre = contar el INVENTARIO (caza el robo de producto)
En la pantalla **Conteo de cierre** (admin):
1. La app muestra cuánto **debería** haber de cada producto contable (presas, colas, etc.).
2. Escribe cuánto hay **realmente**.
3. Guarda. Si falta producto, aparece en rojo el **faltante en $** (posible venta no
   registrada o robo). Lo que dejes en blanco se toma como “cuadra”.

> Ejemplo: salieron 28 presas, se vendieron 12 platos y al contar quedan 6 → **faltan 10
> presas**. Eso es lo que la dueña debe revisar.

### 🌙 Cerrar el día = los COSTOS (admin)
En **Cerrar el día** se reparte el costo del granel (arroz, sopa…) entre los platos
vendidos y se declara el **% de merma** (lo que se botó). Con eso queda el costo real por
plato y la utilidad del día.

---

## 4. Las pantallas

| Pantalla | Para qué sirve | Quién |
|---|---|---|
| **Hoy** | Resumen rápido del turno y accesos | Todas |
| **Hablar** | Registrar todo por voz | Todas |
| **Cierre** | Cerrar turno / cuadrar caja | Encargada |
| **Menú** | Definir el menú del día por turno | Todas |
| **Resumen diario** | ¿Cuánto se ganó hoy? | Admin |
| **Cuadres de caja** | Historial de cierres de caja por turno/día | Admin |
| **Conteo de cierre** | Contar inventario y ver faltantes | Admin |
| **Analítica y control** | Tendencias y anti-robo | Admin |
| **Inventario** | Ver stock, agregar y **Procesar** | Admin |
| **Costos fijos** | Sueldos, arriendo, P&L | Admin |
| **Histórico de platos** | Costo vs precio en el tiempo | Admin |
| **Catálogo / Turnos / Usuarios** | Configurar el negocio | Admin |

---

## 5. Qué mira la DUEÑA (y qué hacer con cada dato)

| Métrica | Dónde | Qué te dice / qué hacer |
|---|---|---|
| **Utilidad del día** | Resumen diario | ¿Gané o perdí hoy? Si es roja, revisa costos y ventas. |
| **Ventas vs costos por día** | Analítica | El espacio entre la barra y la línea es tu ganancia. Si la línea se pega a la barra, ese día trabajaste casi gratis → mira compras/merma/personal. |
| **% vs periodo anterior** | Analítica (tarjeta Ventas) | ¿Voy mejor o peor que antes? |
| **Rentabilidad de platos** | Analítica | Qué plato deja más por día servido → ofrécelo más seguido. |
| **Merma** | Resumen / Analítica | Plata botada. Si sube, estás cocinando de más. |
| **Descuadre de caja** | Cuadres de caja | Falta o sobra efectivo al cerrar. Quién cerró ese turno. |
| **Faltante de inventario** | Conteo de cierre | Producto que falta = posible robo / venta sin registrar. |
| **Efectivo entregado** | Cuadres de caja | Cuánta plata real te dejó cada turno. |
| **Mapa de calor (días y turnos)** | Analítica | Qué turno vende poco vs lo que cuesta el personal. |

---

## 6. Reglas de oro

1. **Confirma siempre** lo que la app va a guardar (lo verás en pantalla grande).
2. **Gasto** (se gasta) **≠ Compra** (entra al inventario). En la duda, di qué se hizo con
   la cosa.
3. **Procesar** el pollo/carne al abrirlos (di cuántas presas/tajadas salieron): así el
   costo es exacto y se sabe cuántas debían venderse.
4. Los **retiros** siempre con **motivo**.
5. **Cierra el turno contando la caja**, y haz el **conteo de inventario** al final del día.
   Esos dos números son los que cazan el robo.
6. Lo que **sobra se queda en el inventario** para el día siguiente (presas, dedos, colas):
   no hay que volver a comprarlo, solo contarlo bien.
