// Belt-and-suspenders manual backup: download a JSON snapshot of your data so
// you always have an offline copy on disk, independent of the browser and the
// server. Re-importing isn't automated, but the file holds everything needed to
// restore by hand if it ever came to that.

/** Trigger a browser download of `data` as a pretty-printed .json file. */
export function downloadJson(fileNameStem: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${fileNameStem}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a tick to start before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
