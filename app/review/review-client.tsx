"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  CircleCheck,
  Clock,
  Download,
  EyeOff,
  FileSpreadsheet,
  Loader2,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/ui/data-table";
import {
  isNumericColumn,
  stringify,
  type Cell,
  type DataRow,
} from "@/lib/dataset";
import {
  clearSession,
  deleteDataset,
  getCodeStatuses,
  listDatasets,
  loadDataset,
  loadSession,
  mergeCodeStatuses,
  saveDataset,
  saveSession,
  type CodeMeta,
  type SavedDatasetMeta,
  type SavedRow,
} from "@/lib/local-store";

type Row = Record<string, Cell>;

// App-managed columns appended after the sheet's own columns in the table.
const MARKED_COL = "Status date"; // when the row was marked done/ignored
const CATEGORY_COL = "Category"; // pharma / sena / sherktha
const CATEGORY_OPTIONS = ["pharma", "sena", "sherktha"] as const;

// Local date as YYYY-MM-DD — human-readable and sorts/filters correctly as text.
const formatDate = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Only these columns are shown in the review table, in this order. Everything
// else in the sheet is ignored.
const VISIBLE_COLUMNS = [
  "code",
  "اسم الصنف",
  "Order",
  "الموردين",
  "الرئيسي",
  "بيع 55يوم",
];

// Normalize a header for matching: strip whitespace and any invisible
// bidirectional/formatting marks that spreadsheets sometimes embed.
const normalizeHeader = (key: string) =>
  key.replace(/[‎‏‪-‮⁦-⁩]/g, "").trim();

// Given the actual header keys present in a sheet, return the ones we want to
// show — mapped back to their real key and ordered per VISIBLE_COLUMNS.
function pickVisibleColumns(allKeys: string[]): string[] {
  const out: string[] = [];
  for (const want of VISIBLE_COLUMNS) {
    const match = allKeys.find(
      (k) => normalizeHeader(k) === normalizeHeader(want),
    );
    if (match) out.push(match);
  }
  return out;
}

function detectColumns(rows: Row[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) keys.add(k);
  return pickVisibleColumns([...keys]);
}

// Canonical form of a code cell for matching across sheets: strip invisible
// marks/whitespace, and compare purely-numeric codes as numbers so "143354",
// " 143354 " and "143354.0" all resolve to the same key.
const normCode = (raw: Cell): string => {
  const s = normalizeHeader(stringify(raw));
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};

export function ReviewClient() {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [columns, setColumns] = React.useState<string[]>([]);
  const [completed, setCompleted] = React.useState<Set<string>>(new Set());
  const [ignored, setIgnored] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  // Per-row-id epoch ms of when it was marked done/ignored, and its category.
  const [statusAt, setStatusAt] = React.useState<Map<string, number>>(
    () => new Map(),
  );
  const [category, setCategory] = React.useState<Map<string, string>>(
    () => new Map(),
  );
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [hideIgnored, setHideIgnored] = React.useState(false);
  const [hideDone, setHideDone] = React.useState(false);

  // The id of the saved dataset currently open, so re-saving updates it in
  // place instead of creating a duplicate. Null for a fresh, unsaved upload.
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<SavedDatasetMeta[]>([]);

  // Bulk "mark done by pasting codes" panel.
  const [markOpen, setMarkOpen] = React.useState(false);
  const [codesText, setCodesText] = React.useState("");
  const [markResult, setMarkResult] = React.useState<string | null>(null);

  // How many rows the last upload pulled in from the cross-sheet code history.
  const [carried, setCarried] = React.useState<{
    done: number;
    ignored: number;
  } | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);

  const dataRows = React.useMemo<DataRow[]>(
    () => rows.map((r, i) => ({ ...r, __id: String(i) })),
    [rows],
  );

  // Rows shown in the table: optionally drop ignored and/or done rows entirely.
  const visibleDataRows = React.useMemo(
    () =>
      dataRows.filter(
        (r) =>
          (!hideIgnored || !ignored.has(r.__id)) &&
          (!hideDone || !completed.has(r.__id)),
      ),
    [dataRows, hideIgnored, hideDone, ignored, completed],
  );

  // Columns actually rendered by the table: the sheet's columns plus our two
  // app-managed ones (mark date + category). Kept separate from `columns` so
  // export / save / code-history logic still only see the sheet's own columns.
  const tableColumns = React.useMemo(
    () => [...columns, MARKED_COL, CATEGORY_COL],
    [columns],
  );

  // Inject the mark date (formatted YYYY-MM-DD so it sorts correctly) and the
  // category into each row so the table can filter/sort/search on them.
  const tableRows = React.useMemo(
    () =>
      visibleDataRows.map((r) => {
        const at = statusAt.get(r.__id);
        return {
          ...r,
          [MARKED_COL]: at ? formatDate(at) : "",
          [CATEGORY_COL]: category.get(r.__id) ?? "",
        };
      }),
    [visibleDataRows, statusAt, category],
  );

  const numericCols = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of columns) if (isNumericColumn(dataRows, c)) set.add(c);
    return set;
  }, [dataRows, columns]);

  // Columns that get a per-row copy button next to their value.
  const copyableCols = React.useMemo(() => {
    const want = ["code", "اسم الصنف"].map(normalizeHeader);
    return new Set(columns.filter((c) => want.includes(normalizeHeader(c))));
  }, [columns]);

  // The actual header key for the code column, if present.
  const codeCol = React.useMemo(
    () => columns.find((c) => normalizeHeader(c) === "code"),
    [columns],
  );

  const refreshSaved = React.useCallback(async () => {
    try {
      setSaved(await listDatasets());
    } catch {
      // Local storage unavailable — saving just won't be offered.
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listDatasets();
        if (active) setSaved(list);
      } catch {
        // Local storage unavailable — saving just won't be offered.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Restore the last working sheet on mount, then keep it persisted so a reload
  // never loses the current session. `hydrated` gates the save effect so we
  // don't clobber the stored session before we've read it.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const session = await loadSession();
        if (active && session && session.columns.length > 0) {
          setFileName(session.fileName);
          setName(session.name);
          setColumns(session.columns);
          setRows(session.rows);
          setCompleted(new Set(session.completed));
          setIgnored(new Set(session.ignored));
          setStatusAt(new Map(session.statusAt ?? []));
          setCategory(new Map(session.category ?? []));
          setCurrentId(session.currentId);
        }
      } catch {
        // Ignore — a missing/unreadable session just starts empty.
      } finally {
        if (active) setHydrated(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    const handle = setTimeout(() => {
      if (columns.length === 0) {
        void clearSession().catch(() => {});
        return;
      }
      void saveSession({
        fileName,
        name,
        columns,
        rows,
        completed: [...completed],
        ignored: [...ignored],
        statusAt: [...statusAt],
        category: [...category],
        currentId,
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [
    hydrated,
    fileName,
    name,
    columns,
    rows,
    completed,
    ignored,
    statusAt,
    category,
    currentId,
  ]);


  // Keep the cross-sheet code history in sync with the current sheet: the sheet
  // is authoritative for the codes it contains — their status, the date it was
  // set, and the category all carry forward to the next sheet by code.
  React.useEffect(() => {
    if (!hydrated || !codeCol || rows.length === 0) return;
    const handle = setTimeout(() => {
      const updates: Record<string, CodeMeta | null> = {};
      rows.forEach((r, i) => {
        const code = normCode(r[codeCol]);
        if (!code) return;
        const id = String(i);
        const status = completed.has(id)
          ? "done"
          : ignored.has(id)
            ? "ignored"
            : undefined;
        const cat = category.get(id) || undefined;
        updates[code] =
          !status && !cat
            ? null
            : { status, at: status ? statusAt.get(id) : undefined, category: cat };
      });
      void mergeCodeStatuses(updates).catch(() => {});
    }, 500);
    return () => clearTimeout(handle);
  }, [hydrated, codeCol, rows, completed, ignored, statusAt, category]);

  const parseFile = React.useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Row>(ws, { defval: null });

      if (data.length === 0) {
        setError("The sheet appears to be empty.");
        setRows([]);
        setColumns([]);
        setCompleted(new Set());
        setIgnored(new Set());
        setStatusAt(new Map());
        setCategory(new Map());
      } else {
        const cols = detectColumns(data);

        // Carry over done/ignored status, the date it was set, and the category
        // from earlier sheets by code, so we don't re-order something already
        // handled and can see when it was decided.
        const codeKey = cols.find((c) => normalizeHeader(c) === "code");
        const carriedDone = new Set<string>();
        const carriedIgnored = new Set<string>();
        const carriedAt = new Map<string, number>();
        const carriedCat = new Map<string, string>();
        if (codeKey) {
          const history = await getCodeStatuses();
          data.forEach((r, i) => {
            const meta = history[normCode(r[codeKey])];
            if (!meta) return;
            const id = String(i);
            if (meta.status === "done") carriedDone.add(id);
            else if (meta.status === "ignored") carriedIgnored.add(id);
            if (meta.status && meta.at) carriedAt.set(id, meta.at);
            if (meta.category) carriedCat.set(id, meta.category);
          });
        }

        setRows(data);
        setColumns(cols);
        setCompleted(carriedDone);
        setIgnored(carriedIgnored);
        setStatusAt(carriedAt);
        setCategory(carriedCat);
        setCarried({ done: carriedDone.size, ignored: carriedIgnored.size });

        if (carriedDone.size + carriedIgnored.size > 0) {
          toast.info(
            `${carriedDone.size} already done and ${carriedIgnored.size} ignored were carried over from previous sheets.`,
          );
        }
      }
      setFileName(file.name);
      setName(file.name.replace(/\.[^.]+$/, ""));
      setSelected(new Set());
      setCurrentId(null); // a freshly uploaded sheet is unsaved
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not read this file as a spreadsheet.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  // Inline cell edit: coerce numeric columns back to numbers, blanks to null.
  const editCell = (id: string, col: string, value: string) => {
    const i = Number(id);
    setRows((prev) =>
      prev.map((r, idx) => {
        if (idx !== i) return r;
        const trimmed = value.trim();
        let next: Cell;
        if (trimmed === "") next = null;
        else if (numericCols.has(col) && Number.isFinite(Number(trimmed)))
          next = Number(trimmed);
        else next = value;
        return { ...r, [col]: next };
      }),
    );
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Stamp "now" on rows that just became done/ignored, and drop the stamp of any
  // row no longer marked — so statusAt holds exactly the marked rows, each with
  // the date it was marked (not the upload date). Rows carried over from an
  // earlier sheet already have a stamp, so they keep their original date.
  const reconcileStatusAt = (
    nextCompleted: Set<string>,
    nextIgnored: Set<string>,
  ) =>
    setStatusAt((prev) => {
      const next = new Map(prev);
      const now = Date.now();
      for (const id of nextCompleted) if (!next.has(id)) next.set(id, now);
      for (const id of nextIgnored) if (!next.has(id)) next.set(id, now);
      for (const id of [...next.keys()])
        if (!nextCompleted.has(id) && !nextIgnored.has(id)) next.delete(id);
      return next;
    });

  const toggleComplete = (id: string) => {
    const next = new Set(completed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCompleted(next);
    reconcileStatusAt(next, ignored);
  };

  const toggleIgnore = (id: string) => {
    const next = new Set(ignored);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIgnored(next);
    reconcileStatusAt(completed, next);
  };

  const setCategoryFor = (id: string, value: string) =>
    setCategory((prev) => {
      const next = new Map(prev);
      if (value) next.set(id, value);
      else next.delete(id);
      return next;
    });

  const toggleSelectMany = (ids: string[], checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // Apply a bulk action to the currently checked rows, then clear the checks.
  const applyToSelected = (which: "completed" | "ignored", add: boolean) => {
    if (which === "completed") {
      const next = new Set(completed);
      for (const id of selected) {
        if (add) next.add(id);
        else next.delete(id);
      }
      setCompleted(next);
      reconcileStatusAt(next, ignored);
    } else {
      const next = new Set(ignored);
      for (const id of selected) {
        if (add) next.add(id);
        else next.delete(id);
      }
      setIgnored(next);
      reconcileStatusAt(completed, next);
    }
    setSelected(new Set());
  };

  const save = async () => {
    setSaving(true);
    try {
      const savedRows: SavedRow[] = rows.map((r, i) => ({
        values: columns.map((c) => r[c] ?? null),
        completed: completed.has(String(i)),
        ignored: ignored.has(String(i)),
        statusAt: statusAt.get(String(i)),
        category: category.get(String(i)),
      }));
      const id = await saveDataset({
        id: currentId ?? undefined,
        name,
        fileName: fileName ?? "sheet",
        columns,
        numericColumns: [...numericCols],
        rows: savedRows,
      });
      setCurrentId(id);
      await refreshSaved();
      toast.success("Saved to this PC");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  // Export the current sheet to .xlsx — with all edits applied, ignored rows
  // dropped, and the الرئيسي / بيع 55يوم columns left out.
  const exportExcel = () => {
    const exclude = ["الرئيسي", "بيع 55يوم"].map(normalizeHeader);
    const exportCols = columns.filter(
      (c) => !exclude.includes(normalizeHeader(c)),
    );
    const header = [...exportCols, CATEGORY_COL];
    const data = rows
      .map((r, i) => ({ r, i }))
      .filter(({ i }) => !ignored.has(String(i)))
      .map(({ r, i }) => {
        const obj: Record<string, Cell> = {};
        for (const c of exportCols) obj[c] = r[c] ?? null;
        obj[CATEGORY_COL] = category.get(String(i)) ?? null;
        return obj;
      });

    if (data.length === 0) {
      toast.error("No rows to export.");
      return;
    }

    const ws = XLSX.utils.json_to_sheet(data, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const base =
      (name.trim() || fileName || "export").replace(/\.[^.]+$/, "") || "export";
    XLSX.writeFile(wb, `${base}.xlsx`);
    toast.success(`Exported ${data.length} rows`);
  };

  // Mark every row whose code appears in the pasted list as done. Codes may be
  // separated by newlines, spaces, commas, semicolons, or tabs. Matching is
  // lenient: invisible marks are stripped and purely-numeric codes are compared
  // as numbers, so "143354", " 143354 " and "143354.0" all match.
  const markDoneByCodes = () => {
    if (!codeCol) {
      toast.error("This sheet has no code column.");
      return;
    }

    const wantedList = codesText
      .split(/[\s,;]+/)
      .map((s) => normCode(s))
      .filter(Boolean);
    const wanted = new Set(wantedList);
    if (wanted.size === 0) {
      toast.error("Paste some codes first.");
      return;
    }

    const ids: string[] = [];
    const matchedCodes = new Set<string>();
    rows.forEach((r, i) => {
      const code = normCode(r[codeCol]);
      if (code && wanted.has(code)) {
        ids.push(String(i));
        matchedCodes.add(code);
      }
    });

    if (ids.length === 0) {
      // Show a few real codes from the sheet so a mismatch is obvious.
      const sample = rows
        .map((r) => normCode(r[codeCol]))
        .filter(Boolean)
        .slice(0, 5);
      setMarkResult(
        `No rows matched. You pasted e.g. [${[...wanted]
          .slice(0, 5)
          .join(", ")}], but the sheet's codes look like [${sample.join(
          ", ",
        )}].`,
      );
      toast.error("No rows matched those codes.");
      return;
    }

    const nextCompleted = new Set(completed);
    for (const id of ids) nextCompleted.add(id);
    setCompleted(nextCompleted);
    reconcileStatusAt(nextCompleted, ignored);

    const missing = [...wanted].filter((c) => !matchedCodes.has(c));
    const msg =
      missing.length > 0
        ? `Marked ${ids.length} rows done. ${missing.length} not found: ${missing
            .slice(0, 10)
            .join(", ")}${missing.length > 10 ? "…" : ""}`
        : `Marked ${ids.length} rows done.`;
    setMarkResult(msg);
    toast.success(msg);
    setCodesText("");
  };

  const openSaved = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const ds = await loadDataset(id);
      if (!ds) {
        toast.error("That sheet is no longer saved");
        await refreshSaved();
        return;
      }
      setColumns(pickVisibleColumns(ds.columns));
      setRows(
        ds.rows.map((sr) =>
          Object.fromEntries(ds.columns.map((c, ci) => [c, sr.values[ci] ?? null])),
        ),
      );
      setCompleted(
        new Set(ds.rows.map((sr, i) => (sr.completed ? String(i) : "")).filter(Boolean)),
      );
      setIgnored(
        new Set(ds.rows.map((sr, i) => (sr.ignored ? String(i) : "")).filter(Boolean)),
      );
      setStatusAt(
        new Map(
          ds.rows.flatMap((sr, i) =>
            sr.statusAt != null ? [[String(i), sr.statusAt] as [string, number]] : [],
          ),
        ),
      );
      setCategory(
        new Map(
          ds.rows.flatMap((sr, i) =>
            sr.category ? [[String(i), sr.category] as [string, string]] : [],
          ),
        ),
      );
      setSelected(new Set());
      setFileName(ds.fileName);
      setName(ds.name);
      setCurrentId(ds.id);
      setCarried(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open that sheet");
    } finally {
      setLoading(false);
    }
  };

  const removeSaved = async (id: string) => {
    try {
      await deleteDataset(id);
      if (currentId === id) setCurrentId(null);
      await refreshSaved();
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    }
  };

  const clear = () => {
    setFileName(null);
    setRows([]);
    setColumns([]);
    setCompleted(new Set());
    setIgnored(new Set());
    setStatusAt(new Map());
    setCategory(new Map());
    setSelected(new Set());
    setName("");
    setError(null);
    setCurrentId(null);
    setCarried(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const hasData = columns.length > 0;
  const completedCount = completed.size;

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={onFileChange}
        />
        <div className="rounded-full bg-muted p-3">
          {fileName ? (
            <FileSpreadsheet className="size-6 text-primary" />
          ) : (
            <Upload className="size-6 text-muted-foreground" />
          )}
        </div>
        {fileName ? (
          <div>
            <p className="font-medium">{fileName}</p>
            <p className="text-sm text-muted-foreground">
              {rows.length.toLocaleString()} rows · {columns.length} columns ·
              click to replace
            </p>
          </div>
        ) : (
          <div>
            <p className="font-medium">
              {loading
                ? "Reading file..."
                : "Click to choose or drag a file here"}
            </p>
            <p className="text-sm text-muted-foreground">
              Supports .xlsx, .xls and .csv
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {saved.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-muted-foreground" />
            Saved sheets ({saved.length})
          </div>
          <ul className="divide-y divide-border/60">
            {saved.map((d) => (
              <li
                key={d.id}
                className={cn(
                  "flex items-center gap-3 py-2",
                  d.id === currentId && "rounded-lg bg-primary/5 px-2",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(d.savedAt).toLocaleString()} ·{" "}
                    {d.rowCount.toLocaleString()} rows · {d.completedCount} done
                    {d.ignoredCount > 0 && ` · ${d.ignoredCount} ignored`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openSaved(d.id)}
                >
                  Open
                </Button>
                <button
                  type="button"
                  onClick={() => removeSaved(d.id)}
                  className="text-muted-foreground/60 transition-colors hover:text-destructive"
                  title="Delete saved sheet"
                  aria-label="Delete saved sheet"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasData && (
        <>
          {carried && carried.done + carried.ignored > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm">
              <span className="font-medium">
                🔗 Linked to your history
              </span>
              <span className="text-muted-foreground">
                {carried.done} already ordered · {carried.ignored} ignored —
                carried over from previous sheets.
              </span>
              <button
                type="button"
                onClick={() => {
                  setHideIgnored(true);
                  setHideDone(true);
                }}
                className="ml-auto rounded-md px-2 py-1 font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400"
              >
                Show only new items
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this sheet"
              className="h-9 min-w-48 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <span className="px-1 text-sm text-muted-foreground">
              {completedCount} done · {ignored.size} ignored · {rows.length} rows
            </span>
            {ignored.size > 0 && (
              <Button
                variant={hideIgnored ? "default" : "outline"}
                onClick={() => setHideIgnored((v) => !v)}
              >
                <EyeOff />
                {hideIgnored ? "Show ignored" : "Hide ignored"}
              </Button>
            )}
            {completedCount > 0 && (
              <Button
                variant={hideDone ? "default" : "outline"}
                onClick={() => setHideDone((v) => !v)}
              >
                <EyeOff />
                {hideDone ? "Show done" : "Hide done"}
              </Button>
            )}
            {codeCol && (
              <Button
                variant={markOpen ? "default" : "outline"}
                onClick={() => setMarkOpen((v) => !v)}
              >
                <CircleCheck /> Mark done by codes
              </Button>
            )}
            <Button variant="outline" onClick={exportExcel}>
              <Download /> Export Excel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {currentId ? "Update saved" : "Save to PC"}
            </Button>
          </div>

          {markOpen && codeCol && (
            <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
              <label className="font-medium">
                Paste codes to mark done
                <span className="ml-2 font-normal text-muted-foreground">
                  (separated by spaces, commas, or new lines)
                </span>
              </label>
              <textarea
                value={codesText}
                onChange={(e) => setCodesText(e.target.value)}
                placeholder={"143354\n143445\n135247"}
                rows={4}
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={markDoneByCodes}>
                  <CircleCheck /> Mark done
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCodesText("");
                    setMarkResult(null);
                    setMarkOpen(false);
                  }}
                >
                  <X /> Close
                </Button>
              </div>
              {markResult && (
                <p className="rounded-lg bg-background px-3 py-2 text-sm text-muted-foreground">
                  {markResult}
                </p>
              )}
            </div>
          )}

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-2 text-sm">
              <span className="px-1 font-medium">{selected.size} selected</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyToSelected("completed", true)}
              >
                <CircleCheck /> Mark done
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyToSelected("ignored", true)}
              >
                <EyeOff /> Ignore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                <X /> Clear selection
              </Button>
            </div>
          )}

          <DataTable
            // Remount when the column set changes so filters/sort from a
            // previous sheet can't carry over and hide rows.
            key={columns.join("|")}
            columns={tableColumns}
            rows={tableRows}
            numericColumns={numericCols}
            copyableColumns={copyableCols}
            renderCell={(row, col) => {
              if (col === CATEGORY_COL) {
                return (
                  <select
                    value={category.get(row.__id) ?? ""}
                    onChange={(e) => setCategoryFor(row.__id, e.target.value)}
                    className="h-8 w-full min-w-28 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                  >
                    <option value="">—</option>
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                );
              }
              if (col === MARKED_COL) {
                const v = stringify(row[MARKED_COL]);
                return v ? (
                  <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {v}
                  </span>
                ) : (
                  <span className="text-muted-foreground/40">—</span>
                );
              }
              return undefined;
            }}
            selection={{
              isSelected: (id) => selected.has(id),
              onToggle: toggleSelect,
              onToggleMany: toggleSelectMany,
            }}
            completion={{
              isCompleted: (id) => completed.has(id),
              onToggle: toggleComplete,
            }}
            ignorable={{
              isIgnored: (id) => ignored.has(id),
              onToggle: toggleIgnore,
            }}
            onEditCell={editCell}
            rightToolbar={
              <Button variant="outline" size="sm" onClick={clear}>
                <X /> Clear file
              </Button>
            }
          />
        </>
      )}
    </div>
  );
}
