// frontend/src/layout/columns.test.ts
import { describe, expect, it } from "vitest";
import {
  CENTER_MIN,
  RIGHTBAR_DEFAULT_RATIO,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DEFAULT,
  clampWidth,
  computeColumns,
} from "./columns";

describe("clampWidth", () => {
  it("clamps into range and rounds", () => {
    expect(clampWidth(10, 264, 420)).toBe(264);
    expect(clampWidth(999, 264, 420)).toBe(420);
    expect(clampWidth(300.6, 264, 420)).toBe(301);
  });
});

describe("computeColumns", () => {
  it("gives defaults an unconstrained frame", () => {
    const cols = computeColumns(1600, SIDEBAR_DEFAULT, 1600 * RIGHTBAR_DEFAULT_RATIO);
    expect(cols.sidebar).toBe(280);
    expect(cols.rightbar).toBe(720);
    expect(cols.center).toBe(600);
  });

  it("shrinks the rightbar to the available space before losing its track", () => {
    // available = 1024 - 280 - 400 = 344 ≥ RIGHTBAR_MIN → 轨道保住，右栏被压到 344
    const cols = computeColumns(1024, 280, 2000);
    expect(cols.rightbar).toBe(344);
    expect(cols.center).toBe(CENTER_MIN);
  });

  it("drops the rightbar track when the center minimum cannot be met", () => {
    // available = 700 - 280 - 400 = 20 < 300 → 轨道归零，中央拿走剩余
    const cols = computeColumns(700, 280, 2000);
    expect(cols.rightbar).toBe(0);
    expect(cols.center).toBe(420);
  });

  it("caps the rightbar at 70% of the viewport", () => {
    const cols = computeColumns(2000, 280, 2000);
    expect(cols.rightbar).toBe(1320); // available=1320 < 1400(上限)
    const wide = computeColumns(3000, 280, 3000);
    expect(wide.rightbar).toBe(Math.min(3000 - 280 - 400, 3000 * 0.7));
  });

  it("collapses the sidebar to the icon rail at 0", () => {
    const cols = computeColumns(1200, 0, 0);
    expect(cols.sidebar).toBe(SIDEBAR_COLLAPSED);
    expect(cols.center).toBe(1200 - SIDEBAR_COLLAPSED);
  });

  it("clamps sidebar preference into 264..420", () => {
    expect(computeColumns(1600, 100, 0).sidebar).toBe(264);
    expect(computeColumns(1600, 1000, 0).sidebar).toBe(420);
  });
});
