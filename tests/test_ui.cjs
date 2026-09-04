"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "app.js"), "utf8");

async function app(t) {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  await new Promise((resolve) => dom.window.document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  dom.window.eval(script);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  const { document } = dom.window;
  const $ = (id) => document.getElementById(id);
  const inputs = () => [...document.querySelectorAll(".coordinate")];
  const rows = () => [...$("point-rows").children];
  function paste(text, index = 0) {
    const event = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    inputs()[index].dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  return { dom, document, $, inputs, rows, paste };
}

test("clear all rows resets alignment and outputs while preserving target inputs", async (t) => {
  const a = await app(t);
  a.paste("0\t0\t10\t20\n1\t1\t11\t21");
  const target = a.document.querySelector(".target-input");
  target.value = "3";
  assert.equal(a.$("add-point").nextElementSibling, a.$("clear-rows"));
  a.$("clear-rows").click();
  assert.equal(a.rows().length, 1);
  assert.ok(a.inputs().every((input) => input.value === ""));
  assert.equal(a.$("translation-x").textContent, "—");
  assert.equal(a.$("copy-targets").disabled, true);
  assert.equal(a.$("frame-plot").querySelectorAll("circle").length, 0);
  assert.equal(target.value, "3");
  assert.equal(a.document.activeElement, a.inputs()[0]);
  a.paste("0\t0\t5\t6");
  assert.equal(a.$("translation-x").textContent, "5");
});

test("spreadsheet paste expands rows and updates result and both labeled plots", async (t) => {
  const a = await app(t);
  a.paste(Array.from({ length: 6 }, (_, i) => `${i}\t${i}\t${i + 10}\t${i + 20}`).join("\r\n") + "\r\n");
  assert.equal(a.rows().length, 6);
  assert.equal(a.$("translation-x").textContent, "10");
  assert.equal(a.$("translation-y").textContent, "20");
  assert.equal(a.$("result-status").textContent, "6 of 6 alignment rows used.");
  for (const id of ["frame-plot", "displacement-plot"]) {
    assert.equal(a.$(id).querySelectorAll("circle[data-row]").length, 6);
    assert.deepEqual([...a.$(id).querySelectorAll(".point-label")].map((el) => el.textContent), ["1", "2", "3", "4", "5", "6"]);
    assert.ok(!a.$(id).innerHTML.includes("NaN"));
  }
  assert.equal(a.$("displacement-plot").querySelector('circle[data-row="1"]').getAttribute("cx"), "251");
  assert.equal(a.$("displacement-plot").querySelector('circle[data-row="1"]').getAttribute("cy"), "203");
  assert.ok(!/Filmetrics|microscope|GDS|Paste spreadsheet cells|Paste a whole table/i.test(a.document.body.textContent));
  assert.ok(![...a.document.querySelectorAll("button")].some((b) => b.textContent === "Calculate"));
  assert.equal(a.$("measurements-title").textContent, "Alignment points");
});

test("unchecking an outlier refits but keeps its original row label visible", async (t) => {
  const a = await app(t);
  a.paste("0\t0\t10\t20\n1\t1\t101\t201\n2\t2\t12\t22");
  assert.equal(a.$("translation-x").textContent, "40");
  a.document.querySelector('[aria-label="Use row 2"]').click();
  assert.equal(a.$("translation-x").textContent, "10");
  assert.equal(a.$("translation-y").textContent, "20");
  assert.equal(a.$("mean-se-x").textContent, "0");
  assert.equal(a.$("result-status").textContent, "2 of 3 alignment rows used.");
  const excluded = a.$("displacement-plot").querySelector('circle[data-row="2"]');
  assert.equal(excluded.getAttribute("data-used"), "false");
  assert.equal(excluded.getAttribute("fill"), "white");
  assert.deepEqual([...a.$("displacement-plot").querySelectorAll(".point-label")].map((e) => e.textContent), ["1", "2", "3"]);
  a.document.querySelector('[aria-label="Use row 2"]').click();
  assert.equal(a.$("translation-x").textContent, "40");
});

test("two-column paste into Frame 2 preserves Frame 1 and row selection", async (t) => {
  const a = await app(t);
  a.paste("1\t2\t10\t20\n3\t4\t30\t40");
  a.document.querySelector('[aria-label="Use row 2"]').click();
  a.paste("11\t22\n13\t24", 2);
  assert.deepEqual(a.inputs().slice(0, 8).map((i) => i.value), ["1", "2", "11", "22", "3", "4", "13", "24"]);
  assert.equal(a.document.querySelector('[aria-label="Use row 2"]').checked, false);
  assert.equal(a.$("translation-x").textContent, "10");
  assert.equal(a.$("mean-rms-uncertainty").textContent, "—");
});

test("overflow and invalid pasted cells leave the entire table unchanged", async (t) => {
  const a = await app(t);
  a.paste("0\t0\t10\t20");
  const before = a.inputs().map((i) => i.value);
  a.paste("1\t2\t3\t4", 2);
  assert.match(a.$("error-message").textContent, /beyond four/);
  assert.deepEqual(a.inputs().map((i) => i.value), before);
  a.paste("1\t2\t3\t4\n5\t6\tbad\t8");
  assert.match(a.$("error-message").textContent, /finite number/);
  assert.deepEqual(a.inputs().map((i) => i.value), before);
});

test("cell paste handles screenshot values and Unicode minus", async (t) => {
  const a = await app(t);
  a.paste("−1.125,1.299,58.160,55.758\n0.991,1.291,60.274,55.752\n−1.137,−1.295,58.151,53.164\n−0.231,−1.299,59.057,53.162");
  assert.equal(a.$("translation-x").textContent, "59.286");
  assert.equal(a.$("translation-y").textContent, "54.460");
  assert.deepEqual(["translation-x", "translation-y", "rms-residual", "max-residual", "mean-se-x", "mean-se-y", "mean-rms-uncertainty"].map((id) => a.$(id).textContent),
    ["59.286", "54.460", "0.002", "0.003", "0.001", "0.001", "0.001"]);
  assert.equal(a.$("error-message").textContent, "");
});

test("target outputs preserve precision and copy as displayed", async (t) => {
  const a = await app(t);
  a.paste("0.00\t0.00\t10.00\t20.00\n1.0000\t1.0000\t11.0000\t21.0000");
  assert.equal(a.$("translation-x").textContent, "10.0000");
  a.document.querySelector('[aria-label="Use row 2"]').click();
  assert.equal(a.$("translation-x").textContent, "10.00");
  const inputs = a.document.querySelectorAll(".target-input");
  inputs[0].value = "0.001";
  inputs[1].value = "0";
  inputs[1].dispatchEvent(new a.dom.window.Event("input", { bubbles: true }));
  assert.equal(a.document.querySelector(".target-x").textContent, "10.001");
  assert.equal(a.document.querySelector(".target-y").textContent, "20.000");
  assert.equal(a.$("translation-x").textContent, "10.00");
  let copied;
  a.document.execCommand = () => { copied = a.document.querySelector('textarea[style]').value; return true; };
  a.$("copy-targets").click();
  await Promise.resolve();
  assert.equal(copied, "10.001\t20.000");
});

test("all excluded clears outputs; rechecking restores them; raw view has correct units", async (t) => {
  const a = await app(t);
  a.paste("0\t0\t10\t20");
  a.document.querySelector('[aria-label="Use row 1"]').click();
  assert.equal(a.$("translation-x").textContent, "—");
  assert.equal(a.$("copy-targets").disabled, true);
  assert.match(a.$("error-message").textContent, /Check at least one/);
  a.document.querySelector('[aria-label="Use row 1"]').click();
  a.$("displacement-mode").value = "raw";
  a.$("displacement-mode").dispatchEvent(new a.dom.window.Event("change"));
  assert.equal(a.$("displacement-title").textContent, "Raw displacement");
  assert.match(a.$("displacement-note").textContent, /in mm/);
  assert.match(a.$("displacement-plot").textContent, /Mean translation/);
});

test("copy rows includes unchecked rows as TSV without selection columns", async (t) => {
  const a = await app(t);
  a.paste("1\t2\t3\t4\n5\t6\t7\t8");
  a.document.querySelector('[aria-label="Use row 2"]').click();
  let copied;
  a.document.execCommand = (command) => {
    assert.equal(command, "copy");
    copied = a.document.querySelector('textarea[style]').value;
    return true;
  };
  a.$("copy-rows").click();
  await Promise.resolve();
  assert.equal(copied, "1\t2\t3\t4\n5\t6\t7\t8");
});

test("invalid edits clear stale fit and disabled incomplete rows do not block fitting", async (t) => {
  const a = await app(t);
  a.paste("1\t2\t11\t22\n3\t4\t13\t24");
  a.inputs()[4].value = "";
  a.$("alignment-form").dispatchEvent(new a.dom.window.Event("submit", { cancelable: true }));
  assert.equal(a.$("translation-x").textContent, "—");
  assert.match(a.$("error-message").textContent, /Row 2 is incomplete/);
  a.document.querySelector('[aria-label="Use row 2"]').click();
  assert.equal(a.$("translation-x").textContent, "10");
});

test("multiple targets paste and plot, follow refits, and never affect statistics", async (t) => {
  const a = await app(t);
  a.paste("0\t0\t9\t19\n1\t1\t12\t22");
  const stats = a.document.querySelector(".statistics").textContent;
  const event = new a.dom.window.Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => "2\t3\n4\t5\n6\t7" } });
  a.document.querySelector(".target-input").dispatchEvent(event);
  assert.equal(a.$("target-rows").children.length, 3);
  assert.deepEqual([...a.document.querySelectorAll(".target-x")].map((e) => e.textContent), ["12", "14", "16"]);
  assert.deepEqual([...a.document.querySelectorAll(".target-y")].map((e) => e.textContent), ["23", "25", "27"]);
  assert.equal(a.document.querySelector(".statistics").textContent, stats);
  assert.equal(a.$("frame-plot").querySelectorAll("[data-target]").length, 3);
  assert.match(a.$("frame-plot").textContent, /P1/);
  a.document.querySelector('[aria-label="Use row 2"]').click();
  assert.deepEqual([...a.document.querySelectorAll(".target-x")].map((e) => e.textContent), ["11", "13", "15"]);
  a.document.querySelector('[aria-label="Remove point P2"]').click();
  assert.equal(a.$("frame-plot").querySelectorAll("[data-target]").length, 2);
  assert.equal(a.$("target-rows").children.length, 2);
});

test("invalid targets do not poison alignment and lose their stale results", async (t) => {
  const a = await app(t);
  a.paste("0\t0\t10\t20");
  const input = a.document.querySelector(".target-input");
  input.value = "bad";
  input.dispatchEvent(new a.dom.window.Event("input", { bubbles: true }));
  assert.equal(a.$("translation-x").textContent, "10");
  assert.equal(a.document.querySelector(".target-x").textContent, "—");
  assert.equal(a.$("copy-targets").disabled, true);
  assert.match(a.$("target-error").textContent, /finite number/);
  assert.equal(a.$("frame-plot").querySelectorAll("[data-target]").length, 0);
});

test("copy confirmation is only Copied and expires after five seconds", async (t) => {
  const a = await app(t);
  a.paste("0\t0\t10\t20");
  let expiry;
  a.dom.window.setTimeout = (fn, ms) => { assert.equal(ms, 5000); expiry = fn; return 100; };
  a.document.execCommand = () => true;
  a.$("copy-rows").click();
  await Promise.resolve();
  assert.equal(a.$("paste-status").textContent, "Copied");
  expiry();
  assert.equal(a.$("paste-status").textContent, "");
});
