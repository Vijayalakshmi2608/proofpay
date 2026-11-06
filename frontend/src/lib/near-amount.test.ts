import { describe, expect, it } from "vitest";
import { decimalToBaseUnits, nearToYocto } from "./near-amount";

describe("nearToYocto", () => {
  it("preserves all 24 decimal places without number rounding", () => {
    expect(nearToYocto("1.000000000000000001000001")).toBe("1000000000000000001000001");
  });

  it("pads fractional values exactly", () => {
    expect(nearToYocto("0.1")).toBe("100000000000000000000000");
  });

  it("rejects invalid precision, exponent notation, and amounts over u128", () => {
    expect(() => nearToYocto("1.0000000000000000000000001")).toThrow("24 decimal places");
    expect(() => nearToYocto("1e3")).toThrow("valid NEAR amount");
    expect(() => nearToYocto("1.2.3")).toThrow("valid NEAR amount");
    expect(() => nearToYocto("999999999999999999999999999999999999999999")).toThrow("u128");
  });
});

describe("decimalToBaseUnits", () => {
  it("converts six-decimal USDC without floating-point rounding", () => {
    expect(decimalToBaseUnits("12.345678", 6, "USDC")).toBe("12345678");
  });

  it("rejects excess precision and amounts outside U128", () => {
    expect(() => decimalToBaseUnits("1.0000001", 6, "USDC")).toThrow("6 decimal places");
    expect(() => decimalToBaseUnits("999999999999999999999999999999999999999999", 6, "USDC")).toThrow("u128");
  });
});
