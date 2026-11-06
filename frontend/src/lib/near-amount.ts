const MAX_U128 = (1n << 128n) - 1n;

export function decimalToBaseUnits(amount: string, decimals: number, assetLabel = "token"): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Token decimals must be between 0 and 36.");
  const parts = amount.trim().split(".");
  const [whole, fraction = ""] = parts;
  if (parts.length > 2 || !/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) {
    throw new Error(`Enter a valid ${assetLabel} amount with up to ${decimals} decimal places.`);
  }
  const scale = 10n ** BigInt(decimals);
  const value = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (value > MAX_U128) throw new Error(`${assetLabel} amount exceeds the contract's u128 limit.`);
  return value.toString();
}

export function nearToYocto(amount: string): string {
  return decimalToBaseUnits(amount, 24, "NEAR");
}
