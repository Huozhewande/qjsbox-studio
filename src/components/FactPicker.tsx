import { useEffect, useMemo, useRef, useState } from "react";
import { tryT, useT } from "../i18n";
import { factOperators, type Fact } from "../model";

export interface FactPickerProps {
  facts: Fact[];
  onSelect: (fact: Fact) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Searchable table of facts and factors. Unavailable rows stay visible with their reason. */
export function FactPicker({ facts, onSelect, disabled = false, autoFocus = false }: FactPickerProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState("");
  const [source, setSource] = useState("");
  const [expanded, setExpanded] = useState("");
  const search = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (autoFocus) search.current?.focus(); }, [autoFocus]);
  const categoryOf = (fact: Fact) => fact.category || t("fp.uncategorized");
  const categories = useMemo(() => [...new Set(facts.map(categoryOf))].sort((a, b) => a.localeCompare(b)), [facts, t]);
  const kinds = useMemo(() => [...new Set(facts.map((fact) => fact.kind))], [facts]);
  const sources = useMemo(() => [...new Set(facts.map((fact) => fact.source).filter((item): item is string => Boolean(item)))], [facts]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = facts
    .filter((fact) => (!category || categoryOf(fact) === category) && (!kind || fact.kind === kind) && (!source || fact.source === source)
      && (!needle || `${fact.label} ${fact.key} ${fact.description ?? ""}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => Number(Boolean(a.disabled)) - Number(Boolean(b.disabled)));
  const sourceName = (value?: string) => value ? tryT(t, `source.${value}`, value) : "—";
  return <section className="qs-fact-picker" aria-label={t("fp.title")}>
    <div className="qs-toolbar">
      <label className="qs-field is-grow">{t("fp.search")}<input ref={search} type="search" placeholder={t("fp.searchPlaceholder")} value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} /></label>
      <label className="qs-field">{t("fp.category")}<select value={category} disabled={disabled} onChange={(event) => setCategory(event.target.value)}><option value="">{t("fp.allCategories")}</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="qs-field">{t("fp.type")}<select value={kind} disabled={disabled} onChange={(event) => setKind(event.target.value)}><option value="">{t("fp.allTypes")}</option>{kinds.map((item) => <option key={item} value={item}>{t(`kind.${item}`)}</option>)}</select></label>
      {sources.length > 0 && <label className="qs-field">{t("fp.source")}<select value={source} disabled={disabled} onChange={(event) => setSource(event.target.value)}><option value="">{t("fp.allSources")}</option>{sources.map((item) => <option key={item} value={item}>{sourceName(item)}</option>)}</select></label>}
    </div>
    <div className="qs-table-wrap">
      <table className="qs-table">
        <thead><tr><th>{t("fp.colName")}</th><th>{t("fp.colKey")}</th><th>{t("fp.category")}</th><th>{t("fp.type")}</th><th>{t("fp.source")}</th><th>{t("fp.colDescription")}</th><th>{t("fp.colActions")}</th></tr></thead>
        <tbody>
          {visible.length ? visible.map((fact) => {
            const open = expanded === fact.key;
            return [
              <tr key={fact.key} className={fact.disabled ? "is-unavailable" : undefined}>
                <td><strong>{fact.label}</strong></td>
                <td><code>{fact.key}</code></td>
                <td>{categoryOf(fact)}</td>
                <td>{t(`kind.${fact.kind}`)}</td>
                <td>{sourceName(fact.source)}</td>
                <td className="qs-description">{fact.description || "—"}{fact.disabled && fact.disabledReason && <small className="qs-reason">{fact.disabledReason}</small>}</td>
                <td className="qs-actions">
                  <button type="button" className="qs-button is-small is-primary" disabled={disabled || fact.disabled} aria-label={`${t("fp.select")} ${fact.label}`} onClick={() => onSelect(fact)}>{t("fp.select")}</button>
                  <button type="button" className="qs-link-button" aria-expanded={open} onClick={() => setExpanded(open ? "" : fact.key)}>{t(open ? "fp.hideDetails" : "fp.details")}</button>
                </td>
              </tr>,
              open && <tr key={`${fact.key}-details`} className="qs-details-row"><td colSpan={7}>
                <p>{t("fp.operators", { list: factOperators(fact).map((operator) => t(`op.${operator}`)).join(", ") })}</p>
                {fact.options?.length ? <p>{t("fp.options", { list: fact.options.map((option) => option.label ?? option.value).join(", ") })}</p> : null}
                {fact.description && <p>{fact.description}</p>}
              </td></tr>,
            ];
          }) : <tr><td colSpan={7} className="qs-empty">{t("fp.empty")}</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

export interface FactPickerDialogProps extends FactPickerProps {
  title?: string;
  description?: string;
  onCancel: () => void;
}

/** Modal around {@link FactPicker}. Escape, the backdrop and Cancel all keep the original condition. */
export function FactPickerDialog({ title, description, onCancel, ...picker }: FactPickerDialogProps) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onCancel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return <div className="qs-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="qs-dialog" role="dialog" aria-modal="true" aria-label={title ?? t("fp.title")}>
      <header className="qs-dialog-head">
        <div><h3>{title ?? t("fp.title")}</h3>{description && <p className="qs-muted">{description}</p>}</div>
        <button type="button" className="qs-button is-small" onClick={onCancel}>{t("fp.cancel")}</button>
      </header>
      <FactPicker {...picker} autoFocus />
    </div>
  </div>;
}
