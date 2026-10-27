"use client";

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X, ArrowUpRight, LoaderCircle } from "lucide-react";
import { clsx } from "clsx";
import { initials } from "@/lib/format";

export function Button({ children, className, variant = "primary", busy = false, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet"; busy?: boolean }) {
  return <button type="button" className={clsx("button", `button-${variant}`, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>{busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}{children}</button>;
}
export function Avatar({ name, size = "normal", tone = 0 }: { name: string; size?: "normal" | "large" | "small"; tone?: number }) {
  return <span className={clsx("avatar", `avatar-${size}`, `avatar-tone-${tone % 4}`)} aria-hidden="true">{initials(name)}</span>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" aria-hidden="true" />{children}</span>;
}
export function Drawer({ open, title, description, children, onClose, dismissDisabled = false }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; dismissDisabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  return <dialog ref={dialog} className="drawer" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!dismissDisabled) onClose(); }} onClose={onClose} onClick={event => { if (!dismissDisabled && event.target === event.currentTarget) onClose(); }}>
    <div className="drawer-body">
      <div className="drawer-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Закрыть панель" disabled={dismissDisabled} onClick={onClose}><X size={20} /></button></div>
      {description && <p className="secondary-text drawer-description">{description}</p>}{children}
    </div>
  </dialog>;
}
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon" aria-hidden="true">{icon}</span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="text-link" onClick={onClick}>{children}<ArrowUpRight size={15} aria-hidden="true" /></button>;
}
