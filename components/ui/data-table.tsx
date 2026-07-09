"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Circle,
  CircleCheck,
  Copy,
  EyeOff,
  Filter,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isNumericColumn, stringify, type Cell, type DataRow } from "@/lib/dataset";

type SortDir = "asc" | "desc";

export type { Cell, DataRow };

interface DataTableProps {
  columns: string[];
  rows: DataRow[];
  numericColumns?: Set<string>;
  /** Columns that show a per-row copy button beside their value. */
  copyableColumns?: Set<string>;
  /** Extra controls on the right of the toolbar. */
  rightToolbar?: React.ReactNode;
  /** If provided, search/filters/sort are persisted to localStorage under this key. */
  storageKey?: string;
  /** Adds a leading checkbox column for selecting rows. */
  selection?: {
    isSelected: (id: string) => boolean;
    onToggle: (id: string) => void;
    onToggleMany: (ids: string[], checked: boolean) => void;
  };
  /** Adds a per-row "complete" toggle; completed rows are highlighted yellow. */
  completion?: {
    isCompleted: (id: string) => boolean;
    onToggle: (id: string) => void;
  };
  /** Adds a trailing "ignore" toggle; ignored rows are dimmed / struck through. */
  ignorable?: {
    isIgnored: (id: string) => boolean;
    onToggle: (id: string) => void;
  };
  /** When provided, any cell becomes click-to-edit. */
  onEditCell?: (id: string, col: string, value: string) => void;
}

type SavedState = {
  search?: string;
  filters?: Record<string, string[]>;
  sort?: { col: string; dir: SortDir } | null;
};

function loadTableState(key: string): SavedState | null {
  try {
    const raw = localStorage.getItem(`dt:${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTableState(key: string, state: SavedState) {
  try {
    localStorage.setItem(`dt:${key}`, JSON.stringify(state));
  } catch {}
}

export function DataTable({
  columns,
  rows,
  numericColumns,
  copyableColumns,
  rightToolbar,
  storageKey,
  selection,
  completion,
  ignorable,
  onEditCell,
}: DataTableProps) {
  const saved = React.useMemo(
    () => (storageKey ? loadTableState(storageKey) : null),
    [storageKey],
  );

  const [search, setSearch] = React.useState(saved?.search ?? "");
  const [filters, setFilters] = React.useState<Record<string, Set<string>>>(
    () => {
      if (!saved?.filters) return {};
      const out: Record<string, Set<string>> = {};
      for (const [col, vals] of Object.entries(saved.filters)) {
        out[col] = new Set(vals);
      }
      return out;
    },
  );
  const [sort, setSort] = React.useState<{ col: string; dir: SortDir } | null>(
    saved?.sort ?? null,
  );

  React.useEffect(() => {
    if (!storageKey) return;
    const serializable: Record<string, string[]> = {};
    for (const [col, set] of Object.entries(filters)) {
      serializable[col] = [...set];
    }
    saveTableState(storageKey, { search, filters: serializable, sort });
  }, [storageKey, search, filters, sort]);
  const [menu, setMenu] = React.useState<{
    col: string;
    x: number;
    y: number;
  } | null>(null);
  const [valSearch, setValSearch] = React.useState("");

  // The single cell currently being edited inline (when onEditCell is set).
  const [editing, setEditing] = React.useState<{ id: string; col: string } | null>(
    null,
  );
  // Set by Escape so the input's blur discards instead of committing.
  const skipCommit = React.useRef(false);

  // The most recently copied cell, so we can flash a check on its button.
  const [copied, setCopied] = React.useState<string | null>(null);
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyCell = (id: string, col: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(`${id}:${col}`);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 1200);
    });
  };
  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const commitEdit = (id: string, col: string, value: string) => {
    setEditing(null);
    onEditCell?.(id, col, value);
  };

  const numericCols = React.useMemo(() => {
    if (numericColumns) return numericColumns;
    const set = new Set<string>();
    for (const c of columns) if (isNumericColumn(rows, c)) set.add(c);
    return set;
  }, [rows, columns, numericColumns]);

  const domains = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      const set = new Set<string>();
      for (const row of rows) set.add(stringify(row[col]));
      const numeric = numericCols.has(col);
      map[col] = [...set].sort((a, b) => {
        if (a === "" || b === "") return a === "" ? 1 : -1; // blanks last
        return numeric
          ? Number(a) - Number(b)
          : a.localeCompare(b, undefined, { numeric: true });
      });
    }
    return map;
  }, [rows, columns, numericCols]);

  const setColumnFilter = (
    col: string,
    mutate: (allowed: Set<string>) => void,
  ) => {
    setFilters((prev) => {
      const allowed = prev[col] ? new Set(prev[col]) : new Set(domains[col]);
      mutate(allowed);
      const next = { ...prev };
      if (allowed.size === domains[col].length) delete next[col];
      else next[col] = allowed;
      return next;
    });
  };

  const toggleValue = (col: string, value: string) =>
    setColumnFilter(col, (allowed) => {
      if (allowed.has(value)) allowed.delete(value);
      else allowed.add(value);
    });

  const setAllValues = (col: string, values: string[], checked: boolean) =>
    setColumnFilter(col, (allowed) => {
      for (const v of values) {
        if (checked) allowed.add(v);
        else allowed.delete(v);
      }
    });

  const clearColumn = (col: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    setMenu(null);
  };

  const clearAll = () => {
    setSearch("");
    setFilters({});
  };

  const toggleSort = (col: string) =>
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });

  React.useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-col-filter]"))
        setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onResize = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);

  const visibleRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = Object.entries(filters);

    let out = rows.filter((row) => {
      if (
        q &&
        !columns.some((c) => stringify(row[c]).toLowerCase().includes(q))
      )
        return false;
      for (const [col, allowed] of active) {
        if (!allowed.has(stringify(row[col]))) return false;
      }
      return true;
    });

    if (sort) {
      const { col, dir } = sort;
      const numeric = numericCols.has(col);
      out = [...out].sort((a, b) => {
        const as = stringify(a[col]);
        const bs = stringify(b[col]);
        if (as === "" || bs === "") return as === bs ? 0 : as === "" ? 1 : -1;
        const cmp = numeric
          ? Number(as) - Number(bs)
          : as.localeCompare(bs, undefined, {
              numeric: true,
              sensitivity: "base",
            });
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, columns, search, filters, sort, numericCols]);

  const visibleIds = React.useMemo(
    () => visibleRows.map((r) => r.__id),
    [visibleRows],
  );

  const allVisibleSelected =
    !!selection &&
    visibleIds.length > 0 &&
    visibleIds.every((id) => selection.isSelected(id));
  const someVisibleSelected =
    !!selection && visibleIds.some((id) => selection.isSelected(id));

  const activeFilterCount =
    Object.keys(filters).length + (search.trim() ? 1 : 0);

  const fmt = (v: string) => (v === "" ? "(Blanks)" : v);

  const menuValues = React.useMemo(() => {
    if (!menu) return [];
    const q = valSearch.trim().toLowerCase();
    if (!q) return domains[menu.col];
    return domains[menu.col].filter((v) => fmt(v).toLowerCase().includes(q));
  }, [menu, valSearch, domains]); // eslint-disable-line react-hooks/exhaustive-deps

  const menuAllChecked =
    menu &&
    menuValues.every((v) => !filters[menu.col] || filters[menu.col].has(v));

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search all columns…"
            className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {visibleRows.length.toLocaleString("en-US")} of{" "}
          {rows.length.toLocaleString("en-US")} rows
        </p>
        {activeFilterCount > 0 && (
          <Button variant="outline" size="sm" onClick={clearAll}>
            <X /> Clear all ({activeFilterCount})
          </Button>
        )}
        {rightToolbar}
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              {selection && (
                <th className="border-b border-border px-2 py-1.5">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    className="size-4 accent-primary align-middle"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          !allVisibleSelected && someVisibleSelected;
                    }}
                    onChange={(e) =>
                      selection.onToggleMany(visibleIds, e.target.checked)
                    }
                  />
                </th>
              )}
              {completion && (
                <th className="border-b border-border px-3 py-1.5 text-center font-semibold">
                  Done
                </th>
              )}
              {columns.map((col) => {
                const sorted = sort?.col === col;
                const filtered = !!filters[col];
                return (
                  <th
                    key={col}
                    className="border-b border-border text-center font-semibold"
                  >
                    <div
                      data-col-filter
                      className="flex items-center justify-between gap-1 px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1 py-1 hover:bg-muted/60"
                        title={`Sort by ${col}`}
                      >
                        <span className="truncate" title={col}>
                          {col}
                        </span>
                        {sorted ? (
                          sort!.dir === "asc" ? (
                            <ArrowUp className="size-3.5 shrink-0" />
                          ) : (
                            <ArrowDown className="size-3.5 shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3.5 shrink-0 text-muted-foreground/40" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Filter ${col}`}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setValSearch("");
                          setMenu((m) =>
                            m?.col === col
                              ? null
                              : {
                                  col,
                                  x: Math.min(r.left, window.innerWidth - 272),
                                  y: r.bottom,
                                },
                          );
                        }}
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded hover:bg-muted",
                          filtered && "text-primary",
                        )}
                      >
                        <Filter
                          className={cn(
                            "size-3.5",
                            filtered && "fill-primary/20",
                          )}
                        />
                      </button>
                    </div>
                  </th>
                );
              })}
              {ignorable && (
                <th className="border-b border-border px-3 py-1.5 text-center font-semibold">
                  Ignore
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const completed = completion?.isCompleted(row.__id) ?? false;
              const ignored = ignorable?.isIgnored(row.__id) ?? false;
              const selected = selection?.isSelected(row.__id) ?? false;
              return (
                <tr
                  key={row.__id}
                  className={cn(
                    "border-b border-border last:border-0",
                    selected && "bg-primary/5",
                    completed &&
                      "bg-yellow-300/40 hover:bg-yellow-300/50 dark:bg-yellow-400/15 dark:hover:bg-yellow-400/20",
                    ignored && "bg-destructive/5 opacity-60",
                    !completed && !ignored && !selected && "hover:bg-muted/40",
                  )}
                >
                  {selection && (
                    <td className="px-2 py-2 text-center align-top">
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        className="size-4 accent-primary align-middle"
                        checked={selected}
                        onChange={() => selection.onToggle(row.__id)}
                      />
                    </td>
                  )}
                  {completion && (
                    <td className="px-3 py-2 text-center align-top">
                      <button
                        type="button"
                        onClick={() => completion.onToggle(row.__id)}
                        className={cn(
                          "inline-grid place-items-center rounded transition-colors",
                          completed
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-muted-foreground/50 hover:text-foreground",
                        )}
                        title={completed ? "Mark as not done" : "Mark complete"}
                        aria-label={completed ? "Mark as not done" : "Mark complete"}
                        aria-pressed={completed}
                      >
                        {completed ? (
                          <CircleCheck className="size-5" />
                        ) : (
                          <Circle className="size-5" />
                        )}
                      </button>
                    </td>
                  )}
                  {columns.map((col) => {
                    const numeric = numericCols.has(col);
                    const empty = stringify(row[col]) === "";
                    const isEditing =
                      editing?.id === row.__id && editing?.col === col;
                    const copyable = !!copyableColumns?.has(col) && !empty;
                    const justCopied = copied === `${row.__id}:${col}`;
                    const value = empty ? (
                      <span className="text-muted-foreground/40">—</span>
                    ) : (
                      String(row[col])
                    );
                    return (
                      <td
                        key={col}
                        className={cn(
                          "px-3 py-2 align-top",
                          numeric && "tabular-nums",
                          ignored && "line-through",
                        )}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            type={numeric ? "number" : "text"}
                            defaultValue={stringify(row[col])}
                            onBlur={(e) => {
                              if (skipCommit.current) {
                                skipCommit.current = false;
                                setEditing(null);
                                return;
                              }
                              commitEdit(row.__id, col, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                skipCommit.current = true;
                                e.currentTarget.blur();
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                e.currentTarget.blur();
                              }
                            }}
                            className="h-8 w-full min-w-24 rounded-md border border-ring bg-background px-2 text-center text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          />
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {onEditCell ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditing({ id: row.__id, col })
                                }
                                className="-mx-1 min-w-0 rounded px-1 py-0.5 text-center transition-colors hover:bg-muted/60"
                                title="Click to edit"
                              >
                                {value}
                              </button>
                            ) : (
                              value
                            )}
                            {copyable && (
                              <button
                                type="button"
                                onClick={() =>
                                  copyCell(row.__id, col, String(row[col]))
                                }
                                className={cn(
                                  "shrink-0 rounded p-1 no-underline transition-colors",
                                  justCopied
                                    ? "text-emerald-600 dark:text-emerald-500"
                                    : "text-muted-foreground/50 hover:bg-muted hover:text-foreground",
                                )}
                                title={justCopied ? "Copied" : "Copy"}
                                aria-label={`Copy ${col}`}
                              >
                                {justCopied ? (
                                  <Check className="size-3.5" />
                                ) : (
                                  <Copy className="size-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {ignorable && (
                    <td className="px-2 py-2 text-center align-top">
                      <button
                        type="button"
                        onClick={() => ignorable.onToggle(row.__id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                          ignored
                            ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                            : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                        )}
                      >
                        <EyeOff className="size-3" />
                        {ignored ? "Ignored" : "Ignore"}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td
                  colSpan={
                    columns.length +
                    (selection ? 1 : 0) +
                    (completion ? 1 : 0) +
                    (ignorable ? 1 : 0)
                  }
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  No rows match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Excel-style filter dropdown */}
      {menu && (
        <div
          data-col-filter
          style={{ position: "fixed", top: menu.y + 4, left: menu.x }}
          className="z-50 flex w-68 flex-col rounded-lg border border-border bg-card p-2 text-sm shadow-xl"
        >
          <div className="flex gap-1 pb-2">
            <button
              type="button"
              onClick={() => {
                setSort({ col: menu.col, dir: "asc" });
                setMenu(null);
              }}
              className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <ArrowUp className="size-3.5" /> Sort ascending
            </button>
            <button
              type="button"
              onClick={() => {
                setSort({ col: menu.col, dir: "desc" });
                setMenu(null);
              }}
              className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <ArrowDown className="size-3.5" /> Sort descending
            </button>
          </div>

          <div className="-mx-2 border-t border-border" />

          <div className="relative pt-2">
            <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={valSearch}
              onChange={(e) => setValSearch(e.target.value)}
              placeholder="Search values…"
              className="h-8 w-full rounded-md border border-border bg-background ps-7 pe-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>

          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-medium hover:bg-muted">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={!!menuAllChecked}
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    !menuAllChecked &&
                    menuValues.some(
                      (v) => !filters[menu.col] || filters[menu.col].has(v),
                    );
              }}
              onChange={(e) =>
                setAllValues(menu.col, menuValues, e.target.checked)
              }
            />
            <span>(Select all{valSearch ? " in search" : ""})</span>
          </label>

          <div className="max-h-56 overflow-auto py-1">
            {menuValues.length === 0 && (
              <p className="px-2 py-3 text-center text-muted-foreground">
                No matching values.
              </p>
            )}
            {menuValues.map((v) => {
              const checked = !filters[menu.col] || filters[menu.col].has(v);
              return (
                <label
                  key={v}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={checked}
                    onChange={() => toggleValue(menu.col, v)}
                  />
                  <span
                    className={cn(
                      "truncate",
                      v === "" && "text-muted-foreground italic",
                    )}
                    title={fmt(v)}
                  >
                    {fmt(v)}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="-mx-2 border-t border-border" />

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearColumn(menu.col)}
              disabled={!filters[menu.col]}
            >
              Clear filter
            </Button>
            <Button size="sm" onClick={() => setMenu(null)}>
              <Check /> Done
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
