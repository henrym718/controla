"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const INK = "#0a0a0a";
const TEAL = "#00a887";
const CORAL = "#ff4d3d";
const YELLOW = "#ffb81f";

export function BreakEvenChart({ data }: { data: { dia: number; acumulado: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -6, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#00000010" />
        <XAxis dataKey="dia" tickLine={false} axisLine={false} fontSize={10} />
        <YAxis tickLine={false} axisLine={false} fontSize={10} width={46} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          formatter={(value) => [`$${Number(value).toFixed(2)}`, "Acumulado"]}
          labelFormatter={(l) => `Día ${l}`}
          contentStyle={{ borderRadius: 12, border: "1px solid #00000015", fontSize: 12 }}
        />
        <ReferenceLine y={0} stroke={INK} strokeDasharray="4 4" />
        <Line type="monotone" dataKey="acumulado" stroke={TEAL} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MermaLineChart({ data }: { data: { date: string; merma: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={170}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#00000010" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
        <Tooltip
          formatter={(value) => [`$${Number(value).toFixed(2)}`, "Merma"]}
          contentStyle={{ borderRadius: 12, border: "1px solid #00000015", fontSize: 12 }}
        />
        <Line type="monotone" dataKey="merma" stroke={YELLOW} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DesfaseBarChart({ data }: { data: { date: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#00000010" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
        <Tooltip
          cursor={{ fill: "#00000008" }}
          formatter={(value) => [`$${Number(value).toFixed(2)}`, "Desfase"]}
          contentStyle={{ borderRadius: 12, border: "1px solid #00000015", fontSize: 12 }}
        />
        <Bar dataKey="total" radius={[6, 6, 0, 0]} fill={CORAL} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VentasDiaChart({ data }: { data: { label: string; ventas: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#00000010" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
        <Tooltip
          cursor={{ fill: "#00000008" }}
          formatter={(value) => [`$${Number(value).toFixed(2)}`, "Ventas"]}
          contentStyle={{ borderRadius: 12, border: "1px solid #00000015", fontSize: 12 }}
        />
        <Bar dataKey="ventas" radius={[8, 8, 0, 0]} fill={INK} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VentasCostosChart({
  data,
}: {
  data: { date: string; ventas: number; costos: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#00000010" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          fontSize={10}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
        <Tooltip
          formatter={(value, name) => [
            `$${Number(value).toFixed(2)}`,
            name === "ventas" ? "Ventas" : "Costos",
          ]}
          contentStyle={{ borderRadius: 12, border: "1px solid #00000015", fontSize: 12 }}
        />
        <Legend
          iconType="circle"
          formatter={(v) => (v === "ventas" ? "Ventas" : "Costos")}
          wrapperStyle={{ fontSize: 11 }}
        />
        <Bar dataKey="ventas" radius={[6, 6, 0, 0]} fill={TEAL} barSize={18} />
        <Line type="monotone" dataKey="costos" stroke={CORAL} strokeWidth={2.5} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CostoPrecioChart({
  data,
}: {
  data: { date: string; costo: number; precio: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#00000010" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          fontSize={10}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={40} />
        <Tooltip
          formatter={(value, name) => [
            `$${Number(value).toFixed(2)}`,
            name === "precio" ? "Precio" : "Costo",
          ]}
          contentStyle={{ borderRadius: 12, border: "1px solid #00000015", fontSize: 12 }}
        />
        <Line type="monotone" dataKey="precio" stroke={TEAL} strokeWidth={2.5} dot={false} />
        <Line type="monotone" dataKey="costo" stroke={CORAL} strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
