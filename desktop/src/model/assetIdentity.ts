/** Updating an asset preserves its instance references, so its ID may outlive its hash. */
export function assetIdentity(prefix: string, fingerprint: string, assets: { id: string; fingerprint?: string }[]): string {
  const existing = assets.find(asset => asset.fingerprint === fingerprint);
  if (existing) return existing.id;
  const base = `${prefix}-${fingerprint}`;
  const occupied = new Set(assets.map(asset => asset.id));
  let id = base, suffix = 2;
  while (occupied.has(id)) id = `${base}-${suffix++}`;
  return id;
}
