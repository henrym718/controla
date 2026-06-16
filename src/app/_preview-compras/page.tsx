// TEMP: ruta de verificación visual del arreglo de truncado en compras. Borrar tras la captura.
const productos = [
  { name: "Sal", stock: 4, unit: "kg" },
  { name: "Aceite vegetal de girasol marca premium en bidón de 5 litros", stock: 12, unit: "L" },
  { name: "Detergente líquido concentrado multiusos para cocina industrial", stock: 3, unit: "L" },
  { name: "Pechuga de pollo deshuesada congelada paquete familiar", stock: 8, unit: "kg" },
];

function Fila({ name, stock, unit, truncar }: { name: string; stock: number; unit: string; truncar: boolean }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-left">
      <div className="min-w-0 flex-1">
        {truncar ? (
          <p className="truncate font-semibold">{name}</p>
        ) : (
          <p className="font-semibold leading-tight break-words">{name}</p>
        )}
        <p className="mt-0.5 text-xs opacity-50">
          quedan {stock} {unit}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white">Comprar</span>
    </button>
  );
}

export default function PreviewCompras() {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-md px-5 py-8">
        <p className="mb-2 text-sm font-bold uppercase tracking-wide opacity-40">Antes (con truncate)</p>
        <div className="mb-8 flex flex-col gap-2">
          {productos.map((p, i) => (
            <Fila key={i} {...p} truncar />
          ))}
        </div>

        <p className="mb-2 text-sm font-bold uppercase tracking-wide text-coral">Después (arreglado)</p>
        <div className="flex flex-col gap-2">
          {productos.map((p, i) => (
            <Fila key={i} {...p} truncar={false} />
          ))}
        </div>
      </div>
    </div>
  );
}
