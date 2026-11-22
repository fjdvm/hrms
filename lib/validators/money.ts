/**
 * A peso amount typed by Staff, read the one way everywhere: whole pesos or pesos and centavos ("1500", "1500.5", "1,500.50" is not accepted),
 * more than 0 and at most `max`. Returns the amount to the centavo, or null when it is not an amount. Refused, not rounded: "1.234" is null.
 */
export function parsePesos(input: unknown, max: number): number | null {
  const value = typeof input === "number" ? input : typeof input === "string" && /^\d{1,9}(\.\d{1,2})?$/.test(input.trim()) ? Number(input.trim()) : Number.NaN;
  const centavos = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || value > max || Math.abs(value * 100 - centavos) > 1e-6) return null;
  return centavos / 100;
}
