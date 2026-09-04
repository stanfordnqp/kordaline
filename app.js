"use strict";

function fitTranslation(frame1, frame2, offset = { x: 0, y: 0 }) {
  if (!Array.isArray(frame1) || frame1.length === 0) {
    throw new Error("Enter at least one complete corresponding point.");
  }
  if (!Array.isArray(frame2) || frame1.length !== frame2.length) {
    throw new Error("The two point sets must contain the same number of points.");
  }
  if ([...frame1, ...frame2, offset].some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error("Every coordinate must be a finite number.");
  }
  const count = frame1.length;
  const translation = frame1.reduce((sum, p, i) => ({
    x: sum.x + (frame2[i].x - p.x), y: sum.y + (frame2[i].y - p.y),
  }), { x: 0, y: 0 });
  translation.x /= count;
  translation.y /= count;
  const predicted = frame1.map((p) => ({ x: p.x + translation.x, y: p.y + translation.y }));
  const residuals = frame2.map((p, i) => ({ x: p.x - predicted[i].x, y: p.y - predicted[i].y }));
  const residualNorms = residuals.map((p) => Math.hypot(p.x, p.y));
  const meanStandardError = count > 1 ? {
    x: Math.sqrt(residuals.reduce((sum, p) => sum + p.x * p.x, 0) / (count * (count - 1))),
    y: Math.sqrt(residuals.reduce((sum, p) => sum + p.y * p.y, 0) / (count * (count - 1))),
  } : null;
  return {
    translation,
    center: { x: offset.x + translation.x, y: offset.y + translation.y },
    predicted, residuals,
    rmsResidual: Math.sqrt(residualNorms.reduce((sum, value) => sum + value * value, 0) / count),
    maxResidual: Math.max(...residualNorms),
    meanStandardError,
    meanRmsUncertainty: meanStandardError === null ? null : Math.hypot(meanStandardError.x, meanStandardError.y),
  };
}

function formatNumber(value, decimalPlaces) {
  if (!Number.isFinite(value)) return "—";
  if (decimalPlaces !== undefined) {
    const rounded = value.toFixed(decimalPlaces);
    return Number(rounded) === 0 ? (0).toFixed(decimalPlaces) : rounded;
  }
  if (value === 0) return "0";
  if (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-4) return value.toExponential(6);
  return Number(value.toPrecision(9)).toString();
}

function displayDecimalPlaces(values) {
  return Math.min(100, Math.max(0, ...values.map((value) => {
    const [mantissa, exponent = "0"] = normalizeNumber(value).toLowerCase().split("e");
    return (mantissa.split(".")[1]?.length || 0) - Number(exponent);
  })));
}

function normalizeNumber(value) {
  return String(value).trim().replace(/\u2212/g, "-");
}

function parseNumber(value, label) {
  const text = normalizeNumber(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
    throw new Error(`${label} must be a finite number.`);
  }
  return Number(text);
}

// Validate the entire rectangular paste before changing any cells.
function parsePastedBlock(text, startColumn = 0, columnCount = 4) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (!lines.length) throw new Error("Paste one or more rows of numbers.");
  const block = lines.map((line) => {
    const cells = line.includes("\t") ? line.split("\t")
      : line.includes(",") ? line.split(",") : line.trim().split(/\s+/);
    return cells.map(normalizeNumber);
  });
  const width = block[0].length;
  if (startColumn < 0 || startColumn + width > columnCount) {
    throw new Error(`The pasted block extends beyond ${columnCount === 4 ? "four" : "two"} coordinate columns. Start farther left or paste fewer columns.`);
  }
  block.forEach((row, i) => {
    if (row.length !== width) throw new Error(`Pasted row ${i + 1} has a different number of columns.`);
    row.forEach((cell, j) => { if (cell !== "") parseNumber(cell, `Pasted row ${i + 1}, column ${j + 1}`); });
  });
  return block;
}

function analyzeRows(rows, offset = { x: 0, y: 0 }) {
  const complete = [];
  for (const row of rows) {
    const values = row.values.map(normalizeNumber);
    if (values.every((v) => v === "")) continue;
    if (values.some((v) => v === "")) {
      if (row.enabled) throw new Error(`Row ${row.id} is incomplete. Fill all four coordinates or uncheck it.`);
      continue;
    }
    let coordinates;
    try {
      coordinates = values.map((v) => parseNumber(v, `Row ${row.id}`));
    } catch (error) {
      if (row.enabled) throw error;
      continue;
    }
    complete.push({ id: row.id, enabled: row.enabled,
      frame1: { x: coordinates[0], y: coordinates[1] },
      frame2: { x: coordinates[2], y: coordinates[3] } });
  }
  const used = complete.filter((row) => row.enabled);
  if (!used.length) throw new Error("Check at least one complete row to fit the alignment.");
  const result = fitTranslation(used.map((r) => r.frame1), used.map((r) => r.frame2), offset);
  return { complete, used, result };
}

function displacementPoints(analysis, mode = "residual") {
  const { translation } = analysis.result;
  return analysis.complete.map((row) => ({
    id: row.id, enabled: row.enabled,
    x: (row.frame2.x - row.frame1.x - (mode === "residual" ? translation.x : 0)) * (mode === "residual" ? 1000 : 1),
    y: (row.frame2.y - row.frame1.y - (mode === "residual" ? translation.y : 0)) * (mode === "residual" ? 1000 : 1),
  }));
}

function svgElement(name, attributes = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  element.textContent = text;
  return element;
}

// Common rounded step and equal spans keep both axes at the same physical scale.
function nicePlotBounds(points, centered = false) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = centered
    ? Math.max(...xs.map(Math.abs), ...ys.map(Math.abs), 0.001) * 2
    : Math.max(maxX - minX, maxY - minY, 0.001);
  const requested = span * 1.16 / 5;
  const power = 10 ** Math.floor(Math.log10(requested));
  const multiple = [1, 2, 5, 10].find((n) => n * power >= requested);
  const step = multiple * power;
  const clean = (v) => Number(v.toPrecision(14));
  let xLow, yLow, count;
  if (centered) {
    const half = Math.ceil(span * 0.58 / step);
    xLow = yLow = -half;
    count = 2 * half;
  } else {
    xLow = Math.floor((minX - span * 0.08) / step);
    yLow = Math.floor((minY - span * 0.08) / step);
    const xCount = Math.ceil((maxX + span * 0.08) / step) - xLow;
    const yCount = Math.ceil((maxY + span * 0.08) / step) - yLow;
    count = Math.max(xCount, yCount);
    xLow -= Math.floor((count - xCount) / 2);
    yLow -= Math.floor((count - yCount) / 2);
  }
  return {
    step, span: clean(count * step),
    xMin: clean(xLow * step), yMin: clean(yLow * step),
    xTicks: Array.from({ length: count + 1 }, (_, i) => clean((xLow + i) * step)),
    yTicks: Array.from({ length: count + 1 }, (_, i) => clean((yLow + i) * step)),
  };
}

function drawAxes(svg, points, units, centered = false, displacement = false) {
  const plot = { x: 76, y: 28, size: 350 };
  const bounds = nicePlotBounds(points, centered);
  const { xMin, yMin, span } = bounds;
  const map = (p) => ({ x: plot.x + (p.x - xMin) / span * plot.size,
    y: plot.y + plot.size - (p.y - yMin) / span * plot.size });
  bounds.xTicks.forEach((value) => {
    const x = map({ x: value, y: 0 }).x;
    svg.append(svgElement("line", { x1: x, x2: x, y1: plot.y, y2: plot.y + plot.size, class: "grid-line" }));
    svg.append(svgElement("text", { x, y: plot.y + plot.size + 21, "text-anchor": "middle", class: "x-tick" }, String(value)));
  });
  bounds.yTicks.forEach((value) => {
    const y = map({ x: 0, y: value }).y;
    svg.append(svgElement("line", { x1: plot.x, x2: plot.x + plot.size, y1: y, y2: y, class: "grid-line" }));
    svg.append(svgElement("text", { x: plot.x - 9, y: y + 4, "text-anchor": "end", class: "y-tick" }, String(value)));
  });
  const zero = map({ x: 0, y: 0 });
  if (xMin <= 0 && xMin + span >= 0) svg.append(svgElement("line", { x1: zero.x, x2: zero.x, y1: plot.y, y2: plot.y + plot.size, class: "zero-line" }));
  if (yMin <= 0 && yMin + span >= 0) svg.append(svgElement("line", { x1: plot.x, x2: plot.x + plot.size, y1: zero.y, y2: zero.y, class: "zero-line" }));
  svg.append(svgElement("rect", { x: plot.x, y: plot.y, width: plot.size, height: plot.size, class: "plot-border" }));
  svg.append(svgElement("text", { x: plot.x + plot.size / 2, y: 426, "text-anchor": "middle" }, `${displacement ? "ΔX" : "X"} (${units})`));
  svg.append(svgElement("text", { x: plot.x, y: 16 }, `${displacement ? "ΔY" : "Y"} (${units})`));
  return map;
}

function addLabel(svg, position, text, excluded, labels) {
  const offsets = [[9, -9], [9, 18], [-24, -9], [-24, 18], [9, -26], [9, 35], [-38, 35]];
  let target;
  for (let i = 0; ; i += 1) {
    const [dx, dy] = offsets[i] || [9, 35 + 17 * (i - offsets.length + 1)];
    target = { x: position.x + dx, y: position.y + dy };
    if (labels.every((p) => Math.abs(p.x - target.x) > 22 || Math.abs(p.y - target.y) > 14)) break;
  }
  labels.push(target);
  svg.append(svgElement("text", { ...target, class: excluded ? "point-label excluded-label" : "point-label" }, String(text)));
}

function drawPoint(svg, position, row, labels) {
  const circle = svgElement("circle", { cx: position.x, cy: position.y, r: 4.5,
    fill: row.enabled ? "#365d73" : "white", stroke: row.enabled ? "#365d73" : "#999999",
    "stroke-width": 1.4, "data-row": row.id, "data-used": row.enabled });
  circle.append(svgElement("title", {}, `Row ${row.id}${row.enabled ? "" : " (excluded)"}`));
  svg.append(circle);
  addLabel(svg, position, row.id, !row.enabled, labels);
}

function drawCenter(svg, p, label) {
  svg.append(svgElement("path", { d: `M${p.x - 7},${p.y} h14 M${p.x},${p.y - 7} v14`, stroke: "#222", "stroke-width": 1.5, fill: "none" }));
  svg.append(svgElement("text", { x: p.x + 10, y: p.y + 18 }, label));
}

function drawPlaceholder(svg, message) {
  svg.replaceChildren(svgElement("text", { x: 260, y: 220, "text-anchor": "middle" }, message));
}

function renderPlots(frameSvg, displacementSvg, analysis, targets, mode) {
  frameSvg.replaceChildren();
  const frameMap = drawAxes(frameSvg, [...analysis.complete.map((r) => r.frame1), ...targets.map((p) => p.frame1)], "mm");
  const labels = [];
  analysis.complete.forEach((row) => drawPoint(frameSvg, frameMap(row.frame1), row, labels));
  targets.forEach((point) => {
    const p = frameMap(point.frame1);
    frameSvg.append(svgElement("path", { d: `M${p.x - 7},${p.y} h14 M${p.x},${p.y - 7} v14`, stroke: "#222", "stroke-width": 1.5, fill: "none", "data-target": point.id }));
    addLabel(frameSvg, p, `P${point.id}`, false, labels);
  });

  displacementSvg.replaceChildren();
  const points = displacementPoints(analysis, mode);
  const residual = mode === "residual";
  const map = drawAxes(displacementSvg, [...points, { x: 0, y: 0 }], residual ? "µm" : "mm", residual, true);
  const zero = map({ x: 0, y: 0 });
  const displacementLabels = [];
  points.forEach((row) => {
    const p = map(row);
    displacementSvg.append(svgElement("line", { x1: zero.x, y1: zero.y, x2: p.x, y2: p.y,
      class: row.enabled ? "vector" : "vector excluded", "data-vector-row": row.id }));
    drawPoint(displacementSvg, p, row, displacementLabels);
  });
  if (!residual) drawCenter(displacementSvg, map(analysis.result.translation), "Mean translation");
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(value); return; } catch (_) { /* Try local-file fallback. */ }
  }
  const temporary = document.createElement("textarea");
  temporary.value = value;
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  document.body.append(temporary);
  temporary.select();
  let success;
  try { success = document.execCommand("copy"); } finally { temporary.remove(); }
  if (!success) throw new Error("Clipboard access was blocked. Select and copy the values manually.");
}

function transformPoints(rows, translation) {
  return rows.map((row) => {
    const values = row.values.map(normalizeNumber);
    if (values.every((value) => value === "")) return { id: row.id, empty: true };
    try {
      const frame1 = { x: parseNumber(values[0], `Point P${row.id} X`), y: parseNumber(values[1], `Point P${row.id} Y`) };
      return { id: row.id, frame1, places: displayDecimalPlaces(values),
        frame2: translation ? { x: frame1.x + translation.x, y: frame1.y + translation.y } : null };
    } catch (error) { return { id: row.id, error: error.message }; }
  });
}

function setupApp() {
  const $ = (id) => document.getElementById(id);
  const rows = $("point-rows"), targetRows = $("target-rows"), form = $("alignment-form");
  const frameSvg = $("frame-plot"), displacementSvg = $("displacement-plot");
  let last = null, timer, transformed = [];
  const copyTimers = new Map();
  const resultIds = ["translation-x", "translation-y", "rms-residual", "max-residual", "mean-se-x", "mean-se-y", "mean-rms-uncertainty"];

  function showCopied(id) {
    window.clearTimeout(copyTimers.get(id));
    $(id).textContent = "Copied";
    copyTimers.set(id, window.setTimeout(() => { $(id).textContent = ""; }, 5000));
  }

  function clearResult(message) {
    last = null;
    resultIds.forEach((id) => { $(id).textContent = "—"; });
    targetRows.querySelectorAll("output").forEach((output) => { output.textContent = "—"; });
    $("copy-targets").disabled = true;
    $("result-status").textContent = message;
    $("uncertainty-status").textContent = "Uncertainty requires at least two independent point pairs.";
    drawPlaceholder(frameSvg, "Enter checked, complete alignment points.");
    drawPlaceholder(displacementSvg, "Displacements will appear here.");
  }

  function updatePlots() {
    const mode = $("displacement-mode").value;
    $("displacement-title").textContent = mode === "residual" ? "Residual displacement" : "Raw displacement";
    $("displacement-note").textContent = mode === "residual"
      ? "Frame 2 − Frame 1 − fitted translation, in µm. Every reference point is at the origin."
      : "Frame 2 − Frame 1, in mm. The cross marks the mean translation.";
    if (last) renderPlots(frameSvg, displacementSvg, last.analysis, transformed.filter((p) => p.frame1), mode);
  }

  function readRows() {
    return [...rows.children].map((row, i) => ({ id: i + 1,
      enabled: row.querySelector(".use-row").checked,
      values: [...row.querySelectorAll(".coordinate")].map((input) => input.value) }));
  }

  function updateTargets() {
    const raw = [...targetRows.children].map((row, i) => ({ id: i + 1,
      values: [...row.querySelectorAll(".target-input")].map((input) => input.value) }));
    transformed = transformPoints(raw, last?.analysis.result.translation);
    transformed.forEach((point, index) => {
      const row = targetRows.children[index];
      row.classList.toggle("invalid", Boolean(point.error));
      row.querySelectorAll(".target-input").forEach((input) => input.setAttribute("aria-invalid", String(Boolean(point.error))));
      const places = Math.max(last?.places || 0, point.places || 0);
      row.querySelector(".target-x").textContent = formatNumber(point.frame2?.x, places);
      row.querySelector(".target-y").textContent = formatNumber(point.frame2?.y, places);
    });
    $("target-error").textContent = transformed.find((point) => point.error)?.error || "";
    $("copy-targets").disabled = !last || !transformed.some((point) => point.frame2) || transformed.some((point) => point.error);
    updatePlots();
  }

  function calculate() {
    window.clearTimeout(timer);
    try {
      const rawRows = readRows();
      const analysis = analyzeRows(rawRows);
      const { result, used, complete } = analysis;
      const usedIds = new Set(used.map((row) => row.id));
      const places = displayDecimalPlaces(rawRows.filter((row) => usedIds.has(row.id)).flatMap((row) => row.values));
      last = { analysis, places };
      const values = [result.translation.x, result.translation.y, result.rmsResidual, result.maxResidual,
        result.meanStandardError?.x, result.meanStandardError?.y, result.meanRmsUncertainty];
      resultIds.forEach((id, i) => { $(id).textContent = formatNumber(values[i], places); });
      $("result-status").textContent = `${used.length} of ${complete.length} alignment rows used.`;
      $("uncertainty-status").textContent = used.length < 2
        ? "One point determines a translation, but cannot estimate its uncertainty."
        : "The same alignment uncertainty applies to every transformed point, assuming exact Frame 1 coordinates. Random measurement error only.";
      $("error-message").textContent = "";
      updateTargets();
    } catch (error) {
      clearResult("No current fit.");
      $("error-message").textContent = error.message;
    }
  }

  function renumber() {
    [...rows.children].forEach((row, i) => {
      row.querySelector(".row-index").textContent = String(i + 1);
      row.querySelector(".use-row").setAttribute("aria-label", `Use row ${i + 1}`);
      row.querySelector(".remove-point").setAttribute("aria-label", `Remove row ${i + 1}`);
      row.querySelectorAll(".coordinate").forEach((input, j) => {
        input.setAttribute("aria-label", `Row ${i + 1} Frame ${j < 2 ? 1 : 2} ${j % 2 ? "Y" : "X"}`);
      });
    });
    [...targetRows.children].forEach((row, i) => {
      row.querySelector(".row-index").textContent = `P${i + 1}`;
      row.querySelector(".remove-target").setAttribute("aria-label", `Remove point P${i + 1}`);
      row.querySelectorAll(".target-input").forEach((input, j) => {
        input.setAttribute("aria-label", `Point P${i + 1} Frame 1 ${j ? "Y" : "X"}`);
      });
      row.querySelectorAll("output").forEach((output, j) => {
        output.setAttribute("aria-label", `Point P${i + 1} Frame 2 ${j ? "Y" : "X"}`);
      });
    });
  }

  function applyPaste(text, startRow, startColumn, target = false) {
    const block = parsePastedBlock(text, startColumn, target ? 2 : 4);
    const body = target ? targetRows : rows;
    while (body.children.length < startRow + block.length) (target ? addTarget : addRow)();
    block.forEach((cells, i) => {
      const inputs = body.children[startRow + i].querySelectorAll(target ? ".target-input" : ".coordinate");
      cells.forEach((value, j) => { inputs[startColumn + j].value = value; });
    });
    if (target) updateTargets(); else calculate();
  }

  function bindPaste(row, target) {
    row.querySelectorAll(target ? ".target-input" : ".coordinate").forEach((input, column) => {
      input.addEventListener("paste", (event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return;
        event.preventDefault();
        const body = target ? targetRows : rows;
        try { applyPaste(text, [...body.children].indexOf(row), column, target); }
        catch (error) { $(target ? "target-error" : "error-message").textContent = error.message; }
      });
    });
  }

  function addRow() {
    const row = document.createElement("tr");
    row.innerHTML = `<td><input class="use-row" type="checkbox" checked></td><td class="row-index"></td>
      ${Array.from({ length: 4 }, () => '<td><input class="coordinate" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"></td>').join("")}
      <td><button type="button" class="remove-point">×</button></td>`;
    row.querySelector(".use-row").addEventListener("change", (event) => {
      row.classList.toggle("excluded", !event.target.checked);
      calculate();
    });
    row.querySelector(".remove-point").addEventListener("click", () => {
      row.remove();
      if (!rows.children.length) addRow();
      renumber();
      calculate();
    });
    bindPaste(row, false);
    rows.append(row);
    renumber();
  }

  function addTarget() {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="row-index"></td>
      <td><input class="target-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"></td>
      <td><input class="target-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"></td>
      <td><output class="target-x">—</output></td><td><output class="target-y">—</output></td>
      <td><button type="button" class="remove-target">×</button></td>`;
    row.querySelector(".remove-target").addEventListener("click", () => {
      row.remove();
      if (!targetRows.children.length) addTarget();
      renumber();
      updateTargets();
    });
    bindPaste(row, true);
    targetRows.append(row);
    renumber();
  }

  form.addEventListener("submit", (event) => { event.preventDefault(); calculate(); });
  form.addEventListener("input", (event) => {
    if (event.target.matches(".coordinate")) {
      clearResult("Updating…");
      window.clearTimeout(timer);
      timer = window.setTimeout(calculate, 150);
    } else if (event.target.matches(".target-input")) updateTargets();
  });
  $("add-point").addEventListener("click", addRow);
  $("add-target").addEventListener("click", addTarget);
  $("displacement-mode").addEventListener("change", updatePlots);
  $("copy-rows").addEventListener("click", async () => {
    try {
      const data = readRows();
      while (data.length && data[data.length - 1].values.every((v) => v.trim() === "")) data.pop();
      await copyText(data.map((r) => r.values.join("\t")).join("\n"));
      showCopied("paste-status");
    } catch (error) { $("error-message").textContent = error.message; }
  });
  $("copy-targets").addEventListener("click", async () => {
    if ($("copy-targets").disabled) return;
    try {
      const lines = [...targetRows.children].filter((row) => row.querySelector(".target-x").textContent !== "—")
        .map((row) => [row.querySelector(".target-x").textContent, row.querySelector(".target-y").textContent].join("\t"));
      await copyText(lines.join("\n"));
      showCopied("target-copy-status");
    } catch (error) { $("target-error").textContent = error.message; }
  });
  for (let i = 0; i < 4; i += 1) addRow();
  addTarget();
  clearResult("Enter at least one complete alignment point pair.");
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", setupApp);
if (typeof module !== "undefined") module.exports = {
  fitTranslation, formatNumber, displayDecimalPlaces, parsePastedBlock, analyzeRows, displacementPoints,
  nicePlotBounds, transformPoints,
};
