// ~150ms matches the PGlite latency measured for milestones/worst_point
// with simulation (SPEC.md §4), so the "e se eu gastar ___" field can
// recompute on every keystroke without the query lagging behind typing.
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
