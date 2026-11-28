/**
 * Paint schemes for the pilot's own ship, chosen on the menu. `tint` is
 * null for the factory finish; otherwise the hull paint is shifted towards it.
 */
export interface Livery {
  id: string;
  name: string;
  tint: readonly [number, number, number] | null;
}

export const LIVERIES: readonly Livery[] = [
  { id: 'factory', name: 'Factory grey', tint: null },
  { id: 'ember', name: 'Ember orange', tint: [1.0, 0.45, 0.18] },
  { id: 'glacier', name: 'Glacier white', tint: [0.92, 0.97, 1.0] },
  { id: 'graphite', name: 'Graphite', tint: [0.22, 0.24, 0.28] },
  { id: 'aurora', name: 'Aurora green', tint: [0.3, 0.95, 0.6] },
  { id: 'gold', name: 'Gold leaf', tint: [1.0, 0.78, 0.3] },
];

export function liveryById(id: string): Livery {
  return LIVERIES.find((livery) => livery.id === id) ?? LIVERIES[0];
}

/** Ship names are short, printable and upper case; empty means unnamed. */
export function sanitizeShipName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^A-Za-z0-9 '-]/g, '').trim().slice(0, 18).toUpperCase() : '';
}
