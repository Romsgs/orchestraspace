import { describe, expect, it } from "vitest";

describe("event validation contract", () => {
  it("documents the expected API event shape", () => {
    const sample = {
      type: "REHEARSAL",
      title: "Ensaio de cordas",
      startAt: "2026-11-10T14:00:00.000Z",
      endAt: "2026-11-10T17:00:00.000Z",
      timezone: "Europe/Sofia"
    };
    expect(new Date(sample.endAt).getTime()).toBeGreaterThan(new Date(sample.startAt).getTime());
  });
});
