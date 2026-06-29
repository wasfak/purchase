"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  CircleCheck,
  Clock,
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
  deleteDataset,
  listDatasets,
  loadDataset,
  saveDataset,
  type SavedDatasetMeta,
  type SavedRow,
} from "@/lib/local-store";

type Row = Record<string, Cell>;

// Keep columns that have at least one non-empty cell and aren't xlsx's
// auto-generated placeholders for unlabeled columns (__EMPTY, __EMPTY_1, …).
function detectColumns(rows: Row[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) keys.add(k);
  return [...keys].filter((key) => {
    if (/^__EMPTY/.test(key)) return false;
    return rows.some((row) => stringify(row[key]) !== "");
  });
}

export function ReviewClient() {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [columns, setColumns] = React.useState<string[]>([]);
  const [completed, setCompleted] = React.useState<Set<string>>(new Set());
  const [ignored, setIgnored] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // The id of the saved dataset currently open, so re-saving updates it in
  // place instead of creating a duplicate. Null for a fresh, unsaved upload.
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<SavedDatasetMeta[]>([]);

  const inputRef = React.useRef<HTMLInputElement>(null);

  const dataRows = React.useMemo<DataRow[]>(
    () => rows.map((r, i) => ({ ...r, __id: String(i) })),
    [rows],
  );

  const numericCols = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of columns) if (isNumericColumn(dataRows, c)) set.add(c);
    return set;
  }, [dataRows, columns]);

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
      } else {
        setRows(data);
        setColumns(detectColumns(data));
      }
      setFileName(file.name);
      setName(file.name.replace(/\.[^.]+$/, ""));
      setCompleted(new Set());
      setIgnored(new Set());
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

  const toggleIn =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) =>
    (id: string) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

  const toggleComplete = toggleIn(setCompleted);
  const toggleIgnore = toggleIn(setIgnored);
  const toggleSelect = toggleIn(setSelected);

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
  const applyToSelected = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    add: boolean,
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      for (const id of selected) {
        if (add) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setSelected(new Set());
  };

  const save = async () => {
    setSaving(true);
    try {
      const savedRows: SavedRow[] = rows.map((r, i) => ({
        values: columns.map((c) => r[c] ?? null),
        completed: completed.has(String(i)),
        ignored: ignored.has(String(i)),
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
      setColumns(ds.columns);
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
      setSelected(new Set());
      setFileName(ds.fileName);
      setName(ds.name);
      setCurrentId(ds.id);
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
    setSelected(new Set());
    setName("");
    setError(null);
    setCurrentId(null);
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
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {currentId ? "Update saved" : "Save to PC"}
            </Button>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 p-2 text-sm">
              <span className="px-1 font-medium">{selected.size} selected</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyToSelected(setCompleted, true)}
              >
                <CircleCheck /> Mark done
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyToSelected(setIgnored, true)}
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
            columns={columns}
            rows={dataRows}
            numericColumns={numericCols}
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
