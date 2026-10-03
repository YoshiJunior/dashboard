import { ReactNode, useRef } from "react";

export const assets = `${import.meta.env.BASE_URL}assets`;

export function Field({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <input
      className={`field ${className}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  );
}

export function FilePicker({
  label,
  accept,
  selected,
  onSelect,
}: {
  label: string;
  accept?: string;
  selected?: string;
  onSelect: (file: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="file-picker" type="button" onClick={() => ref.current?.click()}>
        {selected || label}
      </button>
      <input
        ref={ref}
        hidden
        type="file"
        accept={accept}
        onChange={(event) => onSelect(event.target.files?.[0] || null)}
      />
    </>
  );
}

export function ActionButton({
  children,
  tone = "green",
  onClick,
}: {
  children: ReactNode;
  tone?: "green" | "yellow" | "red";
  onClick: () => void;
}) {
  return (
    <button className={`action-button ${tone}`} onClick={onClick}>
      {children}
    </button>
  );
}

export function Toggle({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return <button className={`toggle ${enabled ? "on" : ""}`} onClick={onClick}><span /></button>;
}

