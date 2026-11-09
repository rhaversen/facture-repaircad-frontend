"use client";

import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { PhotoIcon } from "./icons";

/** Joins class names, skipping the falsy ones. */
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/** A screen's heading: the title large, an optional line under it and actions beside it. */
export function Title({ children, subtitle, actions }: { children: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A surface for one thing on a page. */
export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-2xl border border-border/70 bg-surface p-5", className)}>
      {(title || actions) && (
        <div className="flex items-center gap-2">
          {title && <h2 className="text-sm font-medium text-muted">{title}</h2>}
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover",
  secondary: "bg-surface-2 text-foreground hover:bg-surface-3",
  ghost: "text-muted hover:text-foreground hover:bg-surface-2",
  danger: "bg-danger/10 text-danger hover:bg-danger/20",
};

const SIZES = { sm: "h-7 px-3 text-xs", md: "h-9 px-4 text-sm", lg: "h-11 px-6 text-sm" } as const;

/** A pill button's classes, for the odd element that must look like one (a file picker's label). */
export const buttonClass = (variant: Variant = "secondary", size: keyof typeof SIZES = "md") =>
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default",
    SIZES[size],
    VARIANTS[variant],
  );

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZES }) {
  return <button type="button" {...props} className={cn(buttonClass(variant, size), className)} />;
}

export function ErrorBox({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger", className)}>{children}</div>;
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted", className)}>{children}</p>;
}

/** Nothing here yet: a line, and the one thing to do about it. */
export function Empty({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
      {icon && <span className="text-subtle">{icon}</span>}
      <p className="text-sm text-muted">{children}</p>
      {action}
    </div>
  );
}

/** A spinner with a short line under it, centred in whatever holds it. */
export function Loading({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted", className)}>
      <div className="cad-spinner" />
      {children && <p>{children}</p>}
    </div>
  );
}

export const inputClass =
  "h-10 w-full rounded-xl bg-surface-2 px-3 text-sm text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent";

export const textareaClass =
  "min-h-30 w-full resize-y rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-accent";

/** A drop zone for photos: drop them or click to choose. */
export function PhotoDrop({
  onFiles,
  label = "Drop photos here",
  hint = "or click to choose",
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  label?: string;
  hint?: ReactNode;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const images = (files: FileList | null) => Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(images(e.dataTransfer.files));
      }}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed text-center text-muted transition-colors",
        compact ? "p-5" : "p-8",
        over ? "border-accent bg-accent/5" : "border-border hover:border-border-strong",
      )}
    >
      <PhotoIcon size={compact ? 22 : 28} />
      <span className="text-sm font-medium text-foreground">{label}</span>
      {hint && <span className="text-xs">{hint}</span>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </button>
  );
}
