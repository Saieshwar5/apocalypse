/**
 * The Defence Authority's bonus, in credits, for finishing a field. It is in
 * proportion to how much of the field the pilot destroyed, so surviving a
 * field without fighting earns nothing; a field with no impacts doubles it.
 */
export function waveClearBonus(wave: number, destroyed: number, impacts: number): number {
  const total = destroyed + impacts;
  if (destroyed <= 0 || total <= 0) {
    return 0;
  }
  const base = Math.round((100 * wave * destroyed) / total);
  return impacts === 0 ? base * 2 : base;
}
