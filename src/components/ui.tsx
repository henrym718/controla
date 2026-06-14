import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

type Variant = "primary" | "accent" | "soft" | "outline" | "danger";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.98] disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white",
  accent: "bg-coral text-white",
  soft: "bg-lav text-ink",
  outline: "border border-ink/15 text-ink bg-white",
  danger: "bg-coral/10 text-coral",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`${base} ${variants[variant]} h-12 px-5 text-base ${className}`}
      {...props}
    />
  );
}

export function LinkButton({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${base} ${variants[variant]} h-12 px-5 text-base ${className}`}
    >
      {children}
    </Link>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-3xl border border-ink/10 bg-white p-5 ${className}`}>
      {children}
    </div>
  );
}

const tones: Record<string, string> = {
  lav: "bg-lav",
  mint: "bg-mint",
  peach: "bg-peach",
  sand: "bg-sand",
  ink: "bg-ink text-white",
};

export function Stat({
  label,
  value,
  tone = "lav",
  hint,
  accent,
}: {
  label: string;
  value: string;
  tone?: keyof typeof tones;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className={`rounded-3xl p-4 ${tones[tone]}`}>
      <p className="text-xs font-medium opacity-60">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ?? ""}`}>{value}</p>
      {hint && <p className="text-xs opacity-60">{hint}</p>}
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm opacity-60">{subtitle}</p>}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

export function Input({
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40 ${className}`}
      {...props}
    />
  );
}

export function Tag({
  children,
  tone = "lav",
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Hoja inferior (bottom-sheet) mobile-first. Cierra al tocar el fondo. */
export function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="float-in max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-paper p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
