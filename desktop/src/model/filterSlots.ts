import type { EqualizerConfiguration, EqualizerFilter } from "./types";

const frequencies = [30, 63, 125, 250, 500, 1000, 4000, 16000];
const compatible = (filter: EqualizerFilter, slot: number) => slot === 0 ? filter.type === "highpass"
  : slot === 7 ? filter.type === "lowpass" : filter.type !== "lowpass" && filter.type !== "highpass";

/** Project banks may contain more than eight filters. Never discard hidden entries. */
export function filterSlots(bank: EqualizerConfiguration) {
  const used = new Set<number>();
  const indices = Array<number>(8).fill(-1);
  // Reserved IDs keep a newly edited empty slot in its chosen column after reopening.
  bank.filters.forEach((filter, index) => {
    const match = /^deploy-eq-slot-([0-7])(?:-\d+)?$/.exec(filter.id);
    if (match) {
      const slot = Number(match[1]);
      if (indices[slot] === -1 && compatible(filter, slot)) { indices[slot] = index; used.add(index); }
    }
  });
  for (let slot = 0; slot < 8; slot++) {
    if (indices[slot] !== -1) continue;
    const index = bank.filters.findIndex((f, i) => !used.has(i) && compatible(f, slot));
    if (index !== -1) { indices[slot] = index; used.add(index); }
  }
  const ids = new Set(bank.filters.map(f => f.id));
  const slots = indices.map((index, slot): EqualizerFilter => {
    if (index !== -1) return bank.filters[index];
    let id = `deploy-eq-slot-${slot}`, suffix = 1;
    while (ids.has(id)) id = `deploy-eq-slot-${slot}-${suffix++}`;
    return { id, type: slot === 0 ? "highpass" : slot === 7 ? "lowpass" : "peq", enabled: false,
      frequencyHz: frequencies[slot], gainDb: 0, q: Math.SQRT1_2,
      ...(slot === 0 || slot === 7 ? { family: "butterworth" as const, order: 2 } : {}) };
  });
  return { slots, indices, extraCount: bank.filters.length - used.size };
}

export function updateFilterSlot(bank: EqualizerConfiguration, slot: number, patch: Partial<EqualizerFilter>): EqualizerConfiguration {
  const { slots, indices } = filterSlots(bank);
  if (!Number.isInteger(slot) || slot < 0 || slot > 7) throw new Error("Invalid filter slot");
  const next = { ...slots[slot], ...patch, id: slots[slot].id };
  if (!compatible(next, slot)) throw new Error("Filter type is not available in this slot");
  if (indices[slot] === -1) {
    if (bank.filters.length >= 64) throw new Error("This bank already contains 64 filters");
    return { ...bank, filters: [...bank.filters, next] };
  }
  return { ...bank, filters: bank.filters.map((f, i) => i === indices[slot] ? next : f) };
}
