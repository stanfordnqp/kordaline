"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fitTranslation, formatNumber } = require("../app.js");
const { displayDecimalPlaces } = require("../app.js");
const { nicePlotBounds, transformPoints } = require("../app.js");

test("nice ticks have rounded 1/2/5 steps, equal scales, and contain all points", () => {
  for (const points of [
    [{ x: 1.01, y: 1.02 }, { x: 1.34, y: 1.36 }],
    [{ x: -1.125, y: -1.299 }, { x: 0.991, y: 1.299 }],
    [{ x: 0, y: 0 }],
    [{ x: 1e-6, y: 2e-6 }, { x: 3e-6, y: 5e-6 }],
  ]) {
    const b = nicePlotBounds(points);
    const mantissa = b.step / 10 ** Math.floor(Math.log10(b.step));
    assert.ok([1, 2, 5].some((n) => Math.abs(n - mantissa) < 1e-10));
    assert.ok(points.every((p) => p.x >= b.xMin && p.x <= b.xMin + b.span && p.y >= b.yMin && p.y <= b.yMin + b.span));
    assert.equal(b.xTicks.length, b.yTicks.length);
    assert.ok(b.xTicks.every((v) => Math.abs(v / b.step - Math.round(v / b.step)) < 1e-10));
  }
  const centered = nicePlotBounds([{ x: -3, y: 1 }, { x: 2, y: -1 }], true);
  assert.deepEqual(centered.xTicks, [-4, -2, 0, 2, 4]);
  assert.deepEqual(centered.yTicks, centered.xTicks);
});

test("target transformation retains full precision and handles rows independently", () => {
  const points = transformPoints([
    { id: 1, values: ["1.234", "-2.5"] },
    { id: 2, values: ["bad", "1"] },
    { id: 3, values: ["", ""] },
  ], { x: 10.12345, y: 20 });
  assert.equal(points[0].frame2.x, 11.35745);
  assert.equal(points[0].frame2.y, 17.5);
  assert.ok(points[1].error);
  assert.equal(points[2].empty, true);
  assert.equal(transformPoints([{ id: 1, values: ["1", "2"] }], null)[0].frame2, null);
  assert.throws(() => parsePastedBlock("1\t2\t3", 0, 2), /beyond two/);
});

test("display precision respects typed decimal places, trailing zeros and exponents", () => {
  assert.equal(displayDecimalPlaces(["1", "58.160", "0.01"]), 3);
  assert.equal(displayDecimalPlaces(["1.20e-2"]), 4);
  assert.equal(displayDecimalPlaces(["1.20e2"]), 0);
  assert.equal(formatNumber(54.46, 3), "54.460");
  assert.equal(formatNumber(-0.00001, 3), "0.000");
  assert.equal(formatNumber(null, 3), "—");
});
const { parsePastedBlock, analyzeRows, displacementPoints } = require("../app.js");

test("paste parser preserves blank tab cells and validates rectangle and bounds", () => {
  assert.deepEqual(parsePastedBlock("1\t\t3\t4\r\n5\t6\t7\t8\r\n"), [["1", "", "3", "4"], ["5", "6", "7", "8"]]);
  assert.deepEqual(parsePastedBlock("−1.2 2e-3\n3 4", 2), [["-1.2", "2e-3"], ["3", "4"]]);
  assert.throws(() => parsePastedBlock("1\t2\n3"), /different number/);
  assert.throws(() => parsePastedBlock("1\t2", 3), /beyond four/);
  assert.throws(() => parsePastedBlock("1\tInfinity"), /finite/);
});

test("row filtering preserves IDs and residuals use only selected rows' mean", () => {
  const analysis = analyzeRows([
    { id: 1, enabled: true, values: [0, 0, 9, 19] },
    { id: 2, enabled: false, values: [0, 0, 100, 200] },
    { id: 3, enabled: true, values: [0, 0, 11, 21] },
  ], { x: 0, y: 0 });
  assert.deepEqual(analysis.used.map((r) => r.id), [1, 3]);
  assert.deepEqual(analysis.result.translation, { x: 10, y: 20 });
  assert.deepEqual(displacementPoints(analysis).map((p) => [p.id, p.x, p.y]), [[1, -1000, -1000], [2, 90000, 180000], [3, 1000, 1000]]);
  assert.deepEqual(displacementPoints(analysis, "raw").map((p) => [p.id, p.x, p.y]), [[1, 9, 19], [2, 100, 200], [3, 11, 21]]);
});

test("fits an exact translation and locates the GDS center", () => {
  const film = [{ x: 0, y: 0 }, { x: 10, y: 2 }, { x: -3, y: 7 }, { x: 4, y: -5 }];
  const scope = film.map((point) => ({ x: point.x + 101.5, y: point.y - 40.25 }));
  const result = fitTranslation(film, scope, { x: 25, y: 30 });
  assert.deepEqual(result.translation, { x: 101.5, y: -40.25 });
  assert.deepEqual(result.center, { x: 126.5, y: -10.25 });
  assert.equal(result.rmsResidual, 0);
  assert.deepEqual(result.meanStandardError, { x: 0, y: 0 });
  assert.equal(result.meanRmsUncertainty, 0);
});

test("fits the mean difference for noisy points", () => {
  const result = fitTranslation(
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 2 }],
    [{ x: 10.1, y: 20 }, { x: 11.9, y: 20.1 }, { x: 10, y: 21.8 }, { x: 12, y: 22.1 }],
    { x: 5, y: 6 },
  );
  assert.ok(Math.abs(result.translation.x - 10) < 1e-12);
  assert.ok(Math.abs(result.translation.y - 20) < 1e-12);
  assert.equal(formatNumber(result.center.x), "15");
  assert.equal(formatNumber(result.center.y), "26");
  assert.ok(Math.abs(result.meanRmsUncertainty - result.rmsResidual / Math.sqrt(3)) < 1e-12);
});

test("one point has no estimable uncertainty", () => {
  const result = fitTranslation([{ x: 0, y: 0 }], [{ x: 5, y: 10 }], { x: 0, y: 0 });
  assert.equal(result.meanStandardError, null);
  assert.equal(result.meanRmsUncertainty, null);
  assert.equal(formatNumber(result.meanRmsUncertainty), "—");
});

test("standard error uses sample variance and decreases at fixed scatter", () => {
  const small = fitTranslation(
    [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    [{ x: 4, y: 8 }, { x: 16, y: 12 }], { x: 25, y: 30 },
  );
  assert.deepEqual(small.meanStandardError, { x: 1, y: 2 });
  assert.ok(Math.abs(small.meanRmsUncertainty - Math.sqrt(5)) < 1e-12);
  const a = Math.sqrt(7) / 2;
  const large = fitTranslation(
    Array.from({ length: 8 }, () => ({ x: 0, y: 0 })),
    Array.from({ length: 8 }, (_, i) => ({ x: i % 2 ? a : -a, y: i % 2 ? 2*a : -2*a })),
    { x: 0, y: 0 },
  );
  assert.ok(Math.abs(large.meanStandardError.x - 0.5) < 1e-12);
  assert.ok(Math.abs(large.meanStandardError.y - 1) < 1e-12);
  assert.ok(Math.abs(large.meanRmsUncertainty - small.meanRmsUncertainty / 2) < 1e-12);
});
