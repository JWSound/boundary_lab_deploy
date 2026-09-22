/** Small immutable snapshots; runtime assets are shared, never deep-copied. */
export class EditorHistory<T> {
  private past: Array<{ before: T; after: T; label: string }> = [];
  private future: Array<{ before: T; after: T; label: string }> = [];
  private pending: { before: T; label: string } | null = null;
  private grouping = false;
  private listeners = new Set<() => void>();
  private snapshot: { present: T; undoLabel: string | null; redoLabel: string | null };
  private transaction = 0;
  get transactionId() { return this.transaction; }
  session = crypto.randomUUID();
  constructor(initial: T, private equal: (a: T, b: T) => boolean, private limit = 100) {
    this.snapshot = { present: initial, undoLabel: null, redoLabel: null };
  }
  get present() { return this.snapshot.present; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(present = this.present) {
    this.snapshot = { present, undoLabel: this.past.at(-1)?.label ?? null, redoLabel: this.future.at(-1)?.label ?? null };
    this.listeners.forEach(listener => listener());
  }
  update(next: T, label = "Edit scene", record = true) {
    if (next === this.present) return;
    if (record && !this.pending) {
      this.transaction++;
      this.pending = { before: this.present, label };
      queueMicrotask(() => { if (!this.grouping) this.commit(); });
    }
    this.publish(next);
  }
  set<K extends keyof T>(key: K, value: T[K] | ((current: T[K]) => T[K]), record = true, label = "Edit scene") {
    const next = typeof value === "function" ? (value as (current: T[K]) => T[K])(this.present[key]) : value;
    if (Object.is(next, this.present[key])) return;
    this.update({ ...this.present, [key]: next }, label, record);
  }
  begin(label: string) {
    this.end();
    this.transaction++;
    this.grouping = true;
    this.pending = { before: this.present, label };
  }
  end() { this.grouping = false; this.commit(); }
  private commit() {
    const pending = this.pending;
    this.pending = null;
    if (!pending || this.equal(pending.before, this.present)) return;
    this.past.push({ ...pending, after: this.present });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.publish();
  }
  run(label: string, edit: () => void) { this.begin(label); try { edit(); } finally { this.end(); } }
  undo() {
    this.end(); const entry = this.past.pop(); if (!entry) return;
    this.future.push(entry); this.publish(entry.before);
  }
  redo() {
    this.end(); const entry = this.future.pop(); if (!entry) return;
    this.past.push(entry); this.publish(entry.after);
  }
  clear() {
    this.transaction++;
    this.pending = null; this.grouping = false; this.past = []; this.future = [];
    this.session = crypto.randomUUID(); this.publish();
  }
}
