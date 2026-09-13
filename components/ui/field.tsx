// Labelled form row: a label, an optional muted hint on the same line, and the
// control beneath. Shared by the character and persona editors, which had
// byte-identical local copies.

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-[var(--foreground)]">
        {label}
        {hint && <span className="ml-1.5 font-normal text-[var(--muted-fg)]">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
