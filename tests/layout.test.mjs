// Phone layout and update checks for Tension.
//
//   npm install && npm test
//
// What it checks, in a mobile browser at every common Android width (280-430 px,
// which also covers phones with larger text/zoom settings):
//   - no screen is wider than the phone: Today, Plan, Exercises, Progress and the
//     exercise view for every exercise (with sets logged and the rest timer running)
//   - the bottom tabs fit without scrolling, and the main buttons are big enough to tap
//   - an installed copy picks up a new version even when the host caches pages for
//     10 minutes (like GitHub Pages), and keeps logged workouts across the update
//   - the app opens offline
// Screenshots of each screen at 360 px go to test-output/ for a visual check.

import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "test-output");
const WIDTHS = [280, 320, 360, 384, 412, 430];
const SHOT_WIDTH = 360;
const LS_KEY = "cable-workout-log-v1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png", ".json": "application/json" };

const failures = [];
const fail = (msg) => { failures.push(msg); console.log("  FAIL " + msg); };
const pass = (msg) => console.log("  ok   " + msg);

// Static server that caches like GitHub Pages (max-age=600).
function serve(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(dir, p);
    if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "max-age=600" });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

// Three weeks of example workouts plus a long machine note, so every screen has content.
// Local-date key n days from today (same format the app uses).
const dayKey = n => { const d = new Date(); d.setDate(d.getDate() + n); const z = v => String(v).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

function seed({ weight = false } = {}) {
  const logs = {}, day = new Date();
  for (let i = 1; i <= 21; i += 2) {
    const d = new Date(day); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    logs[k] = { date: k, sets: {
      "chest-press": [{ w: 60 + i, r: 12 }, { w: 60 + i, r: 11 }, { w: 60 + i, r: 10 }],
      "lat-pulldown": [{ w: 90, r: 10 }, { w: 90, r: 9 }],
      "rdl": [{ w: 100, r: 8 }],
    } };
  }
  const weighIns = weight ? [{ d: dayKey(-30), w: 207 }, { d: dayKey(-15), w: 205.5 }, { d: dayKey(-2), w: 203 }] : [];
  return { state: { units: "lb", notes: { "chest-press": "position 31 of 32 on both towers, check!" }, rest: 90, weighIns, planVersion: 3 }, logs };
}

// Everything on screen that sticks out past the right edge of the phone (or of the
// open exercise view). Strips that are meant to scroll sideways are allowed.
const findOverflow = () => {
  const dlg = document.querySelector("dialog[open]");
  const root = dlg || document.body;
  const limit = dlg ? dlg.getBoundingClientRect().right : document.documentElement.clientWidth;
  const scrollsSideways = el => {
    for (let p = el.parentElement; p && p !== root && p.id !== "view"; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  const bad = [];
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || scrollsSideways(el)) continue;
    if (r.right > limit + 1 || r.left < -1) {
      const name = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
      bad.push(`${name} (${Math.round(r.left)}–${Math.round(r.right)} of ${Math.round(limit)})`);
    }
  }
  // Text squeezed into a box too narrow for it: words spill out over neighbouring
  // controls (the Plan screen bug), or a column collapses to a sliver.
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg") || scrollsSideways(el)) continue;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.overflowX !== "visible" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "OPTION") continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const name = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
      bad.push(`text doesn't fit: ${name} "${el.textContent.trim().slice(0, 30)}" (${el.scrollWidth}px in ${el.clientWidth}px)`);
    }
  }
  // A set's label and its numbers must not sit on top of each other.
  for (const sl of root.querySelectorAll(".slot")) {
    const a = sl.querySelector(".lbl")?.getBoundingClientRect(), b = sl.querySelector(".val")?.getBoundingClientRect();
    if (a && b && a.width && b.width && a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1) bad.push(`set label and numbers overlap: "${sl.textContent.trim().slice(0, 30)}"`);
  }
  // Logged set numbers ("135 lb × 12") must stay on one line.
  for (const el of root.querySelectorAll(".slot .val")) {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    if (el.offsetHeight && el.getClientRects().length && el.offsetHeight > Math.max(44, lh * 1.8)) bad.push(`set numbers wrap: "${el.textContent.trim()}" is ${el.offsetHeight}px tall, ${el.offsetWidth}px wide`);
  }
  // Number boxes too narrow to show their value (e.g. a weight of 137.5).
  for (const el of root.querySelectorAll('input[type="number"]')) {
    if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`number cut off: #${el.id || el.getAttribute("aria-label")} "${el.value}"`);
  }
  const view = document.getElementById("view");
  if (!dlg && view.scrollWidth > view.clientWidth + 1) bad.push(`screen scrolls sideways by ${view.scrollWidth - view.clientWidth}px`);
  const page = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  const sheet = dlg ? dlg.scrollWidth - dlg.clientWidth : 0;
  if (page > 0) bad.unshift(`page scrolls sideways by ${page}px`);
  if (sheet > 0) bad.unshift(`exercise view scrolls sideways by ${sheet}px`);
  return bad;
};

// Tap like a finger would; a control covered by something else is a failure, not a crash.
async function tap(page, selector, label) {
  try { await page.click(selector, { timeout: 4000 }); return true; }
  catch (e) { fail(`can't tap ${label} (${selector}): ${e.message.split("\n").find(l => /intercepts|not visible|outside/.test(l))?.trim() || "timed out"}`); return false; }
}

async function checkScreen(page, label) {
  const bad = await page.evaluate(findOverflow);
  if (bad.length) fail(`${label}: wider than the screen → ${bad.slice(0, 4).join("; ")}${bad.length > 4 ? ` (+${bad.length - 4} more)` : ""}`);
  return !bad.length;
}

const RGB_HELPER = () => {
  window.rgb = c => {
    const n = c.match(/[\d.]+/g).map(Number);
    return c.startsWith("color(") ? n.slice(0, 3).map(v => v * 255) : n.slice(0, 3);
  };
};

async function layoutTests(browser, url) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const width of WIDTHS) {
    console.log(`\nPhone ${width} px wide`);
    const ctx = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: "dark", reducedMotion: "reduce" });
    const data = seed({ weight: true });
    await ctx.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [LS_KEY, JSON.stringify(data)]);
    await ctx.addInitScript(RGB_HELPER);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    if (width === WIDTHS[0]) {
      const fonts = await page.evaluate(() => ["Saira Condensed", "Public Sans", "IBM Plex Mono"].map(f => `${f}: ${document.fonts.check(`16px "${f}"`) ? "loaded" : "FALLBACK"}`));
      console.log("  fonts  " + fonts.join(", "));
    }
    const shot = async name => {
      if (width !== SHOT_WIDTH) return;
      const open = !!(await page.$("dialog[open]"));
      if (!open) await page.evaluate(() => document.documentElement.classList.add("test-unroll"));   // show the whole scrolling middle
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !open });
      if (!open) await page.evaluate(() => document.documentElement.classList.remove("test-unroll"));
    };
    await page.addStyleTag({ content: "html.test-unroll, html.test-unroll body, html.test-unroll .shell { height: auto !important; overflow: visible !important; } html.test-unroll main#view { overflow: visible !important; }" });

    let clean = true;
    for (const tab of ["today", "plan", "library", "progress"]) {
      if (!(await tap(page, `nav.tabs [data-tab="${tab}"]`, `the ${tab} tab`))) { clean = false; continue; }
      if (tab === "today") await tap(page, '[data-day="mon"]', "Monday");
      await page.waitForTimeout(150);
      clean = (await checkScreen(page, `${tab} tab`)) && clean;
      await shot(tab);
    }

    // Muscles: the day's list on Today, and each exercise's own list and body map.
    if (width === WIDTHS[0]) {
      await tap(page, 'nav.tabs [data-tab="today"]', "the today tab");
      await tap(page, '[data-day="mon"]', "Monday");
      const m = await page.evaluate(() => {
        const day = [...document.querySelectorAll(".musc .mchip.p")].map(c => c.textContent);
        openSheet("chest-press");
        const main = [...document.querySelectorAll("dialog[open] .musc .mchip.p")].map(c => c.textContent);
        const also = [...document.querySelectorAll("dialog[open] .musc .mchip.s")].map(c => c.textContent);
        const map = document.querySelectorAll("dialog[open] .musc .mm .p").length;
        openSheet("goblet-squat");
        const goblet = [...document.querySelectorAll("dialog[open] .gear-card .nm")].map(c => c.textContent);
        document.getElementById("sheet").close();
        return { day, main, also, map, goblet };
      });
      const okDay = ["Chest", "Front delts", "Side delts", "Triceps"].every(x => m.day.includes(x));
      const okEx = m.main.join() === "Chest" && m.also.join() === "Front delts,Triceps" && m.map > 0;
      okDay ? pass(`Monday lists its muscles: ${m.day.join(", ")}`) : fail(`Monday muscles: ${m.day.join(", ")}`);
      okEx ? pass("chest press: main Chest, also front delts and triceps, shaded on the body map") : fail(`chest press muscles: ${JSON.stringify(m)}`);
      m.goblet.join() === "D-handle" ? pass("goblet squat uses one D-handle") : fail(`goblet squat attachment: ${m.goblet.join(", ")}`);
    }

    const nav = await page.evaluate(() => {
      const n = document.querySelector("nav.tabs");
      return { scrolls: n.scrollWidth > n.clientWidth + 1, minH: Math.min(...[...n.querySelectorAll("button")].map(b => b.getBoundingClientRect().height)) };
    });
    if (nav.scrolls) fail("bottom tabs don't fit; they scroll sideways");
    await tap(page, 'nav.tabs [data-tab="progress"]', "the progress tab");
    const stay = await page.evaluate(async () => {
      const v = document.getElementById("view"), n = document.querySelector("nav.tabs"), frame = () => new Promise(r => requestAnimationFrame(r));
      v.scrollTop = v.scrollHeight; await frame(); v.scrollTop = 0; await frame();
      const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { pageScrolls: document.scrollingElement.scrollHeight > innerHeight + 1, contentScrolls: v.scrollHeight > v.clientHeight, bottom: Math.round(r.bottom), screen: innerHeight, onTop: n.contains(hit) };
    });
    if (stay.pageScrolls || !stay.contentScrolls || stay.bottom !== stay.screen || !stay.onTop) fail(`bottom tabs after scrolling: ${JSON.stringify(stay)}`);
    if (nav.minH < 44) fail(`bottom tabs are only ${Math.round(nav.minH)}px tall (want 44+)`);

    // Work through Monday from the Today tab: log a set so the rest timer and set list show.
    await tap(page, 'nav.tabs [data-tab="today"]', "the today tab");
    await tap(page, '[data-day="mon"]', "Monday");
    await tap(page, '[data-open="chest-press"]', "the first exercise");
    if (!(await page.$("dialog[open] #wIn"))) { fail("exercise view didn't open from Today"); await ctx.close(); continue; }
    for (const reps of ["12", "11", "10"]) {             // all 3 planned sets
      await page.fill("#wIn", "135"); await page.fill("#rIn", reps);
      await tap(page, '#logForm button[type="submit"]', "Log set");
      await page.waitForTimeout(120);
    }
    const green = await page.evaluate(() => {
      const isGreen = el => { const [r, g, b] = rgb(getComputedStyle(el).backgroundColor); return g > r + 10 && g > b; };
      const slots = [...document.querySelectorAll("dialog[open] .slot")];
      return { done: slots.filter(x => x.classList.contains("done") && isGreen(x)).length, total: slots.length, logger: document.querySelector("dialog[open] .logger").classList.contains("complete") };
    });
    if (green.done !== 3 || green.total !== 3 || !green.logger) fail(`after 3 sets: ${green.done} of ${green.total} set rows green, exercise marked done: ${green.logger}`);
    await page.fill("#wIn", "137.5");   // widest realistic weight
    const shown = await page.evaluate(() => {
      const t = document.getElementById("toast"); if (t.hidden) return "hidden";
      const r = t.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return t.contains(hit) ? "visible" : `covered by ${hit && hit.tagName.toLowerCase()}`;
    });
    if (shown !== "visible") fail(`"Set done" message while an exercise is open: ${shown}`);
    const taps = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#logForm button')].map(b => b.getBoundingClientRect().height)));
    if (taps < 44) fail(`log buttons are only ${Math.round(taps)}px tall (want 44+)`);
    clean = (await checkScreen(page, "exercise view with a set logged")) && clean;
    await page.evaluate(() => document.querySelector(".logger").scrollIntoView());
    await shot("exercise-logging");
    await page.evaluate(() => document.getElementById("sheet").scrollTop = 0);
    await shot("exercise-top");

    // Editing a logged set at this width.
    await page.evaluate(() => stopRest(false));
    if (await tap(page, '[data-editset="1"]', "set 2's numbers")) {
      await page.fill("#wIn", "137.5");
      clean = (await checkScreen(page, "editing a logged set")) && clean;
      if (width === SHOT_WIDTH) await shot("exercise-editing");
      await tap(page, '[data-act="cancel-edit"]', "Cancel");
    }
    await page.evaluate(() => openSummary());
    clean = (await checkScreen(page, "workout summary")) && clean;
    await shot("summary");
    await page.evaluate(() => { ui.sheetMode = "exercise"; });

    // Every exercise, with the rest timer still running.
    const ids = await page.evaluate(() => EX.map(e => e.id));
    const wide = [];
    for (const id of ids) {
      await page.evaluate(i => openSheet(i), id);
      const bad = await page.evaluate(findOverflow);
      if (bad.length) wide.push(`${id} → ${bad[0]}`);
    }
    if (wide.length) fail(`${wide.length} of ${ids.length} exercise views are wider than the screen: ${wide.slice(0, 3).join("; ")}`);
    await page.evaluate(() => document.getElementById("sheet").close());
    clean = clean && !wide.length;

    // Back on Today, the finished exercise is green and counted.
    await page.waitForTimeout(150);
    const row = await page.evaluate(() => {
      const r = document.querySelector('.ex-row[data-open="chest-press"]');
      const [cr, cg, cb] = rgb(getComputedStyle(r).borderTopColor);
      return { complete: r.classList.contains("complete"), green: cg > cr + 10 && cg > cb, progress: document.querySelector(".day-progress .txt")?.textContent.trim() };
    });
    if (!row.complete || !row.green || row.progress !== "1 of 5 exercises done") { fail(`Today after finishing an exercise: ${JSON.stringify(row)}`); clean = false; }
    clean = (await checkScreen(page, "today tab with a finished exercise")) && clean;
    await shot("today-done");
    await page.evaluate(() => { setLogDate(shiftKey(todayKey(), -2)); render(); });
    clean = (await checkScreen(page, "today tab logging a past day")) && clean;
    await shot("today-past");
    await page.evaluate(() => { setLogDate(null); render(); });

    if (errors.length) fail(`script errors: ${errors.join(" | ")}`);
    if (clean && !nav.scrolls && nav.minH >= 44 && taps >= 44 && !errors.length && green.done === 3) pass(`all screens and ${ids.length} exercise views fit; finished sets and exercises turn green`);
    await ctx.close();
  }
}

// Android's back button is a history step. It should close the exercise view (and return
// to Today from other tabs) instead of leaving the app.
async function backButtonTests(browser, url) {
  console.log("\nBack button");
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(300); };
  const state = () => page.evaluate(() => ({ open: !!document.querySelector("dialog[open]"), tab: ui.tab, title: document.querySelector("dialog[open] h2")?.textContent || "", len: history.length, url: location.href }));
  try {
    await page.goto(url);
    const start = await state();
    await tap(page, '[data-day="mon"]', "Monday");
    await tap(page, '[data-open="chest-press"]', "the first exercise");
    let s = await state();
    if (!s.open) throw new Error("exercise view didn't open");
    await back(); s = await state();
    !s.open && s.tab === "today" && s.url === start.url ? pass("back closes the exercise and stays in the app") : fail(`back from an exercise: open=${s.open}, tab=${s.tab}, url=${s.url}`);

    await tap(page, '[data-open="chest-press"]', "the first exercise");
    await tap(page, "[data-goto]", "Next exercise");
    s = await state();
    const nextTitle = s.title;
    await back(); s = await state();
    !s.open ? pass(`back after "Next" closes the exercise (was on ${nextTitle})`) : fail(`back after "Next" left the view open on ${s.title}`);

    for (const tab of ["plan", "library", "progress"]) {
      await tap(page, `nav.tabs [data-tab="${tab}"]`, `the ${tab} tab`);
      await back(); s = await state();
      s.tab === "today" && s.url === start.url ? pass(`back from ${tab} returns to Today`) : fail(`back from ${tab}: now on ${s.tab}, url ${s.url}`);
    }
    await tap(page, 'nav.tabs [data-tab="plan"]', "the plan tab");
    await tap(page, 'nav.tabs [data-tab="library"]', "the library tab");
    await back(); s = await state();
    s.tab === "today" ? pass("back from a second tab still returns to Today") : fail(`Plan then Exercises then back: on ${s.tab}`);

    const before = (await state()).len;
    await tap(page, '[data-open="chest-press"]', "the first exercise");
    await tap(page, 'dialog[open] [data-act="close"]', "the close button");
    await page.waitForTimeout(300);
    s = await state();
    const st = await page.evaluate(() => history.state);
    !s.open && !(st && st.sheet) ? pass("closing with ✕ leaves no extra back step") : fail(`after ✕: open=${s.open}, history state ${JSON.stringify(st)} (length ${before} → ${s.len})`);

    // Rest timer finishing: the visible and audible cue.
    await page.evaluate(() => { unlockAudio(); startRest(1); });
    await page.waitForTimeout(1500);
    const cue = await page.evaluate(() => ({ toast: document.getElementById("toast").textContent, flash: document.body.classList.contains("rest-done") }));
    cue.toast.includes("Rest's over") && cue.flash ? pass("rest timer ends with a flash and a message (and a beep)") : fail(`rest timer end: ${JSON.stringify(cue)}`);
  } catch (e) {
    fail("back button checks stopped: " + e.message.split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

// Logging a missed day, personal records and the workout summary.
async function pastDayTests(browser, url) {
  console.log("\nMissed days, records and summary");
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await ctx.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [LS_KEY, JSON.stringify(seed())]);
  const page = await ctx.newPage();
  const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(300); };
  try {
    await page.goto(url);
    const day = await page.evaluate(() => shiftKey(todayKey(), -2));
    await tap(page, '[data-shift="-1"]', "previous day"); await tap(page, '[data-shift="-1"]', "previous day");
    const note = await page.evaluate(() => document.querySelector(".past-note")?.textContent || "");
    note ? pass(`picking a past day shows: "${note.trim()}"`) : fail("no notice when logging a past day");
    await tap(page, '[data-day="mon"]', "Monday's plan");
    await tap(page, '[data-open="chest-press"]', "chest press");
    const toasts = [];
    for (const r of ["10", "9", "8"]) {
      await page.fill("#wIn", "100"); await page.fill("#rIn", r);
      await tap(page, '#logForm button[type="submit"]', "Log set");
      toasts.push(await page.evaluate(() => document.getElementById("toast").textContent));
    }
    const res = await page.evaluate(d => ({ n: setsOn(d, "chest-press").length, today: setsOn(todayKey(), "chest-press").length, pr: document.querySelectorAll("dialog[open] .slot .pr").length }), day);
    res.n === 3 && res.today === 0 ? pass("3 sets saved to the past day, none to today") : fail(`past-day sets: ${JSON.stringify(res)}`);
    toasts[0].startsWith("New record: 100 lb") && res.pr === 1 ? pass(`record noticed while logging: "${toasts[0]}"`) : fail(`record while logging: toast "${toasts[0]}", PR badges ${res.pr}`);
    // Fix a logged set: tap its numbers, change them, save.
    const tBefore = await page.evaluate(d => setsOn(d, "chest-press")[1].t, day);
    await page.evaluate(() => stopRest(false));
    await tap(page, '[data-editset="1"]', "set 2's numbers");
    const label = await page.evaluate(() => document.querySelector('#logForm button[type="submit"]').textContent);
    await page.fill("#wIn", "105"); await page.fill("#rIn", "9");
    await tap(page, '#logForm button[type="submit"]', "Save set 2");
    const edited = await page.evaluate(d => ({ sets: setsOn(d, "chest-press").map(x => `${x.w}x${x.r}`).join(" "), t: setsOn(d, "chest-press")[1].t, toast: document.getElementById("toast").textContent, resting: rest.end > 0, button: document.querySelector('#logForm button[type="submit"]').textContent }), day);
    label === "Save set 2" && edited.sets === "100x10 105x9 100x8" && edited.t === tBefore && !edited.resting && edited.button === "Log set" && edited.toast.startsWith("Set 2 updated")
      ? pass(`editing set 2 → ${edited.sets} (time kept, no rest timer)`) : fail(`edit set: label "${label}", ${JSON.stringify(edited)}`);
    await tap(page, '[data-editset="0"]', "set 1's numbers");
    await tap(page, '[data-act="cancel-edit"]', "Cancel");
    const after = await page.evaluate(d => ({ sets: setsOn(d, "chest-press").map(x => `${x.w}x${x.r}`).join(" "), button: document.querySelector('#logForm button[type="submit"]').textContent }), day);
    after.sets === "100x10 105x9 100x8" && after.button === "Log set" ? pass("Cancel leaves the set unchanged") : fail(`cancel edit: ${JSON.stringify(after)}`);
    await tap(page, 'dialog[open] [data-act="close"]', "close"); await page.waitForTimeout(300);

    await tap(page, '[data-act="finish"]', "Finish workout");
    const sum = await page.evaluate(() => ({
      open: !!document.querySelector("dialog[open] .sum-stats"),
      records: [...document.querySelectorAll("dialog[open] .record")].map(r => r.textContent.replace(/\s+/g, " ").trim()),
      sets: document.querySelectorAll("dialog[open] .sum-stats .stat .v")[1]?.textContent,
    }));
    const rec = sum.records.find(r => r.includes("Standing cable chest press") && r.includes("Heaviest set: 105 lb, up from 81"));
    sum.open && rec && sum.sets === "3" ? pass(`summary: 3 sets, "${rec}"`) : fail(`summary: ${JSON.stringify(sum)}`);
    // Calories: asks for body weight once, then estimates (3 back-filled sets: ~7 min estimated).
    const ask = await page.evaluate(() => !!document.querySelector("dialog[open] #bwIn"));
    await page.fill("#bwIn", "200"); await tap(page, '[data-act="savebw"]', "Save body weight");
    const est = await page.evaluate(() => document.querySelector("dialog[open] .cal-card")?.textContent.replace(/\s+/g, " ") || "");
    ask && est.includes("≈ 37 calories") && est.includes("7 min (estimated") ? pass(`calories, estimated time: "${est.trim().slice(0, 60)}…"`) : fail(`calories (estimated): asked=${ask} "${est}"`);
    await tap(page, '[data-act="editbw"]', "Change body weight");
    const pre = await page.evaluate(() => document.getElementById("bwIn").value);
    await page.fill("#bwIn", "180"); await tap(page, '[data-act="savebw"]', "Save body weight");
    const est2 = await page.evaluate(() => document.querySelector("dialog[open] .cal-card")?.textContent.replace(/\s+/g, " ") || "");
    pre === "200" && est2.includes("≈ 33 calories") && est2.includes("180 lb") ? pass("Change body weight on the summary: 200 → 180 lb, ≈ 33 calories") : fail(`change body weight: prefilled "${pre}", "${est2}"`);
    await page.evaluate(() => logWeighIn(todayKey(), 200));
    await back();
    (await page.evaluate(() => !document.querySelector("dialog[open]"))) ? pass("back closes the summary") : fail("summary still open after back");
    // Measured time: two sets 40 minutes apart today, 200 lb body weight -> 3.5 x 90.7 kg x 41/60 h = 217.
    const measured = await page.evaluate(() => {
      const t0 = Date.now() - 39 * 60000, k = todayKey();
      Store.logs[k] = { date: k, sets: { row: Array.from({ length: 14 }, (_, i) => ({ w: 100, r: 10, t: t0 + i * 3 * 60000 })) } };
      setLogDate(null); openSummary();
      const r = { cal: document.querySelector("dialog[open] .cal-card")?.textContent.replace(/\s+/g, " ") || "", time: document.querySelector("dialog[open] .sum-stats .stat .v")?.textContent };
      delete Store.logs[k]; document.getElementById("sheet").close();
      return r;
    });
    await page.waitForTimeout(300);
    measured.cal.includes("≈ 212 calories") && measured.time === "40 min" ? pass("calories, measured time: ≈ 212 for a 40 min workout at 200 lb") : fail(`calories (measured): ${JSON.stringify(measured)}`);

    await tap(page, '[data-act="today"]', "Back to today");
    const now = await page.evaluate(() => ({ note: !!document.querySelector(".past-note"), key: logKey() === todayKey() }));
    !now.note && now.key ? pass("Back to today logs to today again") : fail(`after Back to today: ${JSON.stringify(now)}`);

    await tap(page, 'nav.tabs [data-tab="progress"]', "the progress tab");
    const histRow = await page.evaluate(d => { const b = document.querySelector(`[data-edit="${d}"]`); return b ? b.closest(".hist-day").textContent.replace(/\s+/g, " ") : ""; }, day);
    histRow.includes("1 PR") ? pass("Progress marks that day with 1 PR") : fail(`history row: ${histRow}`);
    await tap(page, `[data-edit="${day}"]`, "Edit");
    await page.waitForTimeout(300);
    const edit = await page.evaluate(d => ({ tab: ui.tab, key: logKey() === d, note: !!document.querySelector(".past-note") }), day);
    edit.tab === "today" && edit.key && edit.note ? pass("Edit reopens that day on Today") : fail(`Edit: ${JSON.stringify(edit)}`);
  } catch (e) {
    fail("missed-day checks stopped: " + e.message.split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

// Weigh-ins: the old single body weight carries over, weigh-ins chart over time, and each
// workout's calories use the weigh-in from that day or the closest one before it.
async function bodyWeightTests(browser, url) {
  console.log("\nBody weight");
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const old = { state: { units: "lb", bodyWeight: 200, planVersion: 3 }, logs: {} };          // saved by the previous version
  await ctx.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [LS_KEY, JSON.stringify(old)]);
  const page = await ctx.newPage();
  try {
    await page.goto(url);
    await tap(page, 'nav.tabs [data-tab="progress"]', "the progress tab");
    const start = await page.evaluate(() => ({ list: Store.state.weighIns.map(x => `${x.d}:${x.w}`).join(" "), now: document.querySelector(".bw-now")?.textContent.replace(/\s+/g, " ").trim() }));
    start.list === `${dayKey(0)}:200` && start.now?.startsWith("200 lb") ? pass(`earlier body weight carried over: "${start.now}"`) : fail(`carry-over: ${JSON.stringify(start)}`);

    await page.fill("#bwNew", "210"); await page.fill("#bwDate", dayKey(-20));
    await tap(page, '#bwForm button[type="submit"]', "Log weigh-in");
    await page.fill("#bwNew", "198"); await page.fill("#bwDate", dayKey(0));
    await tap(page, '#bwForm button[type="submit"]', "Log weigh-in");
    const r = await page.evaluate(() => ({
      list: Store.state.weighIns.map(x => `${x.d}:${x.w}`).join(" "),
      chart: !!document.querySelector("#bwChart svg path.l1"),
      trend: document.querySelector('[aria-label="Body weight"] .row .muted')?.textContent || "",
      now: document.querySelector(".bw-now")?.textContent.replace(/\s+/g, " ").trim(),
    }));
    r.list === `${dayKey(-20)}:210 ${dayKey(0)}:198` && r.chart && r.trend.startsWith("−12 lb since") && r.now.startsWith("198 lb")
      ? pass(`weigh-ins: same day replaced, chart drawn, "${r.trend}"`) : fail(`weigh-ins: ${JSON.stringify(r)}`);
    const on = await page.evaluate(([a, b, c]) => [bodyWeightOn(a).w, bodyWeightOn(b).w, bodyWeightOn(c).w], [dayKey(-25), dayKey(-10), dayKey(0)]);
    on.join() === "210,210,198" ? pass("calories use that day's weigh-in or the one before it (210, 210, 198)") : fail(`weight used per day: ${on.join()}`);
    await tap(page, `[data-delw="${dayKey(-20)}"]`, "delete weigh-in");
    const del = await page.evaluate(() => ({ n: Store.state.weighIns.length, chart: !!document.querySelector("#bwChart") }));
    del.n === 1 && !del.chart ? pass("deleting a weigh-in removes it (chart hides with one left)") : fail(`delete weigh-in: ${JSON.stringify(del)}`);
  } catch (e) {
    fail("body weight checks stopped: " + e.message.split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

// Regressions from the code review.
async function reviewFixTests(browser, url) {
  console.log("\nReview fixes");
  const mobile = { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" };

  // Targets come from the day being done: lat pulldown is 4 sets on Tuesday, 3 on Thursday.
  {
    const ctx = await browser.newContext(mobile), page = await ctx.newPage();
    await page.goto(url);
    await tap(page, '[data-day="thu"]', "Thursday");
    await tap(page, '[data-open="lat-pulldown"]', "lat pulldown");
    const r = await page.evaluate(() => ({ slots: document.querySelectorAll("dialog[open] .slot").length, pill: document.querySelector("dialog[open] .logger .pill")?.textContent }));
    r.slots === 3 && r.pill === "0/3 sets · 10–12 reps" ? pass("Thursday's lat pulldown uses Thursday's 3 × 10–12") : fail(`Thursday lat pulldown: ${JSON.stringify(r)}`);
    await ctx.close();
  }

  // Midnight: a workout that runs past midnight stays on its day; the next morning shows the new day.
  {
    const ctx = await browser.newContext(mobile), page = await ctx.newPage();
    await page.clock.install({ time: new Date(2026, 9, 5, 23, 50) });          // Monday 11:50 pm
    await page.goto(url);
    await tap(page, '[data-open="chest-press"]', "chest press");
    await page.fill("#wIn", "100"); await page.fill("#rIn", "10"); await tap(page, '#logForm button[type="submit"]', "Log set");
    await page.clock.fastForward("20:00");                                     // 12:10 am Tuesday
    await page.fill("#wIn", "100"); await page.fill("#rIn", "9"); await tap(page, '#logForm button[type="submit"]', "Log set");
    const late = await page.evaluate(() => ({ mon: setsOn("2026-10-05", "chest-press").length, tue: setsOn("2026-10-06", "chest-press").length }));
    late.mon === 2 && late.tue === 0 ? pass("a set after midnight stays with the workout it belongs to") : fail(`after midnight: ${JSON.stringify(late)}`);
    await page.evaluate(() => document.getElementById("sheet").close());
    await page.clock.fastForward("04:00:00");                                  // 4:10 am, workout long over
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForTimeout(200);
    const morning = await page.evaluate(() => ({ day: ui.day, key: logKey(), title: document.querySelector("main h2")?.textContent }));
    morning.day === "tue" && morning.key === "2026-10-06" && morning.title === "Pull" ? pass("left open overnight, Today moves on to Tuesday's Pull") : fail(`next morning: ${JSON.stringify(morning)}`);
    await ctx.close();
  }

  // Workout time: a set added hours later doesn't count the whole gap.
  {
    const ctx = await browser.newContext(mobile), page = await ctx.newPage();
    await page.goto(url);
    const r = await page.evaluate(() => {
      const k = todayKey(), [y, m, d] = k.split("-").map(Number), at = (h, mi) => new Date(y, m - 1, d, h, mi).getTime();
      Store.logs[k] = { date: k, sets: { row: Array.from({ length: 11 }, (_, i) => ({ w: 90, r: 10, t: at(7, 3 * i) })).concat([{ w: 90, r: 10, t: at(19, 10) }]) } };
      return workoutTime(k);
    });
    r.mins === 41 && r.measured ? pass("a 30-minute workout plus a set added that evening counts as 41 min, not 731") : fail(`workout time: ${JSON.stringify(r)}`);
    await ctx.close();
  }

  // Plan editor keeps the keyboard on the next box.
  {
    const ctx = await browser.newContext(mobile), page = await ctx.newPage();
    await page.goto(url);
    await tap(page, 'nav.tabs [data-tab="plan"]', "the plan tab");
    await page.click("#p-mon-0-sets"); await page.fill("#p-mon-0-sets", "4");
    await page.click("#p-mon-0-min");
    const r = await page.evaluate(() => ({ focus: document.activeElement.id, sets: Store.state.plan.mon.items[0].sets }));
    r.focus === "p-mon-0-min" && r.sets === 4 ? pass("Plan: changing sets keeps focus on the next box") : fail(`plan editor focus: ${JSON.stringify(r)}`);
    await ctx.close();
  }

  // Back after Android reloads the app with an exercise open: the first back leaves Today as usual.
  {
    const ctx = await browser.newContext(mobile), page = await ctx.newPage();
    await page.goto("about:blank"); await page.goto(url);
    await tap(page, '[data-day="mon"]', "Monday");
    await tap(page, '[data-open="chest-press"]', "chest press");
    const opened = await page.evaluate(() => !!(history.state && history.state.sheet));
    if (!opened) fail("back-after-reload check: the exercise didn't open, so this check proves nothing");
    await page.reload(); await page.waitForTimeout(500);
    await page.evaluate(() => history.back()); await page.waitForTimeout(600);
    page.url() === "about:blank" ? pass("after a reload, back isn't swallowed by the closed exercise") : fail(`back after reload stayed on ${page.url()}`);
    await ctx.close();
  }

  // Installed app and a browser tab open at the same time don't overwrite each other.
  {
    const ctx = await browser.newContext(mobile);
    const a = await ctx.newPage(), b = await ctx.newPage();
    await a.goto(url); await b.goto(url);
    await a.click('[data-day="mon"]'); await a.click('[data-open="chest-press"]'); await a.fill("#wIn", "100"); await a.fill("#rIn", "10"); await a.click('#logForm button[type="submit"]');
    await b.waitForTimeout(300);
    await b.click('nav.tabs [data-tab="progress"]'); await b.click('[data-restdef="60"]');
    const saved = await b.evaluate(key => { const o = JSON.parse(localStorage.getItem(key)); return { sets: Object.values(o.logs).length, rest: o.state.rest }; }, LS_KEY);
    saved.sets === 1 && saved.rest === 60 ? pass("two open copies keep each other's changes") : fail(`two copies: ${JSON.stringify(saved)}`);
    await ctx.close();
  }

  // Cloud saving (the claude.ai version), against a stand-in store that follows the platform's
  // rules: stored data is frozen, the first save fails, and writes are timed for overlap.
  {
    const ctx = await browser.newContext(mobile);
    await ctx.addInitScript(() => {
      const freeze = o => { Object.values(o).forEach(v => v && typeof v === "object" && freeze(v)); return Object.freeze(o); };
      const docs = { state: freeze({ units: "lb", plan: { mon: { title: "Push", items: [{ id: "chest-press", sets: 3, min: 8, max: 12 }] } }, planVersion: 3 }) };
      let fail = 1, inflight = 0;
      window.__cloud = { docs, max: 0, writes: 0 };
      const db = {
        collection: () => ({ get: async () => ({ docs: Object.entries(docs).map(([id, body]) => ({ id, data: () => body })) }) }),
        doc: path => ({
          set: async body => {
            inflight++; window.__cloud.max = Math.max(window.__cloud.max, inflight);
            await new Promise(r => setTimeout(r, 15)); inflight--;
            if (fail > 0) { fail--; throw Object.assign(new Error("offline"), { code: "unavailable" }); }
            docs[path.split("/").pop()] = JSON.parse(JSON.stringify(body)); window.__cloud.writes++;
          },
          delete: async () => { delete docs[path.split("/").pop()]; },
        }),
      };
      window.claude = { use: async name => (name === "db" ? db : name === "user" ? { id: async () => "u_test" } : null) };
    });
    const page = await ctx.newPage();
    await page.goto(url); await page.waitForFunction(() => Store.mode !== "loading");
    const mode = await page.evaluate(() => ({ mode: Store.mode, title: Store.state.plan.mon.title }));
    mode.mode === "cloud" && mode.title === "Push" ? pass("cloud: loads saved (frozen) settings without falling back") : fail(`cloud load: ${JSON.stringify(mode)}`);
    await page.evaluate(() => { ui.day = "mon"; openSheet("chest-press"); });
    await page.fill("#wIn", "100"); await page.fill("#rIn", "10"); await page.click('#logForm button[type="submit"]');
    await page.waitForFunction(k => !!window.__cloud.docs["log-" + k], await page.evaluate(() => todayKey()), { timeout: 8000 }).catch(() => {});
    const saved = await page.evaluate(() => !!window.__cloud.docs["log-" + todayKey()]);
    saved ? pass("cloud: a save that fails is retried until it goes through") : fail("cloud: failed save was never retried");
    const imp = await page.evaluate(async () => {
      const logs = {}; for (let i = 1; i <= 30; i++) { const k = shiftKey(todayKey(), -i); logs[k] = { date: k, sets: { row: [{ w: 90, r: 10 }] } }; }
      window.__cloud.max = 0; ui.confirm = { import: { data: { state: {}, logs } } }; applyImport();
      for (let i = 0; i < 100 && (Store.dirty.size || Store.flushing); i++) await new Promise(r => setTimeout(r, 100));
      return { max: window.__cloud.max, stored: Object.keys(window.__cloud.docs).filter(k => k.startsWith("log-")).length };
    });
    imp.max === 1 && imp.stored === 30 ? pass("cloud: importing 30 days saves one at a time, all 30 stored") : fail(`cloud import: ${JSON.stringify(imp)}`);
    await ctx.close();
  }
}

// The cable shrug (traps) and the weekly sets-per-muscle card.
async function trapsAndWeeklyTests(browser, url) {
  console.log("\nTraps and weekly sets");
  const mobile = { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" };
  {
    const ctx = await browser.newContext(mobile), page = await ctx.newPage();
    await page.goto(url);
    const r = await page.evaluate(() => {
      openSheet("shrug");
      const main = [...document.querySelectorAll("dialog[open] .musc .mchip.p")].map(c => c.textContent).join();
      const shaded = document.querySelectorAll("dialog[open] .musc .mm .p").length;
      document.getElementById("sheet").close();
      return { main, shaded, tue: Store.state.plan.tue.items.map(x => x.id).includes("shrug"), count: EX.length };
    });
    r.main === "Traps" && r.shaded >= 3 && r.tue && r.count === 20 ? pass("cable shrug: works the traps (shaded front and back), on Tuesday's plan") : fail(`shrug: ${JSON.stringify(r)}`);
    // Log 3 sets of chest press this week: chest 3 (main), front delts and triceps 1½ each (also worked).
    await tap(page, '[data-day="mon"]', "Monday"); await tap(page, '[data-open="chest-press"]', "chest press");
    for (const reps of ["10", "10", "10"]) { await page.fill("#wIn", "100"); await page.fill("#rIn", reps); await tap(page, '#logForm button[type="submit"]', "Log set"); }
    await page.evaluate(() => document.getElementById("sheet").close()); await page.waitForTimeout(300);
    await tap(page, 'nav.tabs [data-tab="progress"]', "the progress tab");
    const rows = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ms-row")].map(r => [r.querySelector(".ms-name").textContent, r.querySelector(".ms-val").textContent])));
    rows.Chest === "3/10" && rows["Front delts"] === "1½/11" && rows.Triceps === "1½/10" && rows.Traps === "0/7½" && rows.Glutes === "0/19"
      ? pass("sets per muscle this week: Chest 3/10, Front delts 1½/11, Triceps 1½/10") : fail(`sets per muscle: ${JSON.stringify(rows)}`);
    await tap(page, '[data-week="-1"]', "Last week");
    const last = await page.evaluate(() => document.querySelector(".ms-row .ms-val").textContent);
    last === "0/10" ? pass("Last week shows last week's sets") : fail(`last week chest: ${last}`);
    await ctx.close();
  }
  // A plan saved before the shrug existed gets it on Tuesday.
  {
    const ctx = await browser.newContext(mobile);
    const old = { state: { units: "lb", planVersion: 3, plan: { tue: { title: "Pull", items: [{ id: "row", sets: 3, min: 8, max: 12 }] }, thu: { title: "Rest", items: [] } } }, logs: {} };
    await ctx.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value); }, [LS_KEY, JSON.stringify(old)]);
    const page = await ctx.newPage(); await page.goto(url);
    const tue = await page.evaluate(() => Store.state.plan.tue.items.map(x => x.id).join());
    tue === "row,shrug" ? pass("saved plans get the shrug added to Tuesday") : fail(`saved plan Tuesday: ${tue}`);
    await ctx.close();
  }
}

async function updateTests(browser) {
  console.log("\nInstalled app: updates and offline");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tension-site-"));
  for (const f of fs.readdirSync(ROOT)) if (/\.(html|js|webmanifest|png)$/.test(f)) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const { server, url } = await serve(dir);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    controlled ? pass("offline support installed") : fail("service worker isn't controlling the page");

    const version = await page.evaluate(() => document.querySelector('meta[name="app-version"]')?.content);
    const swCache = fs.readFileSync(path.join(dir, "sw.js"), "utf8").match(/const CACHE = "tension-([^"]+)"/)?.[1];
    version && version === swCache ? pass(`version ${version} matches the offline cache name`) : fail(`app version (${version}) and sw.js cache (${swCache}) must match`);

    await page.click('[data-open]');
    await page.fill("#wIn", "50"); await page.fill("#rIn", "10");
    await page.click('#logForm button[type="submit"]');
    await page.evaluate(() => document.getElementById("sheet").close());

    // Publish a "new version" while the old page is still cached by the host for 10 minutes.
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    fs.writeFileSync(path.join(dir, "index.html"), html.replace(/(<meta name="app-version" content=")[^"]+/, "$1test-next"));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const banner = await page.waitForSelector("#updateBar:not([hidden])", { timeout: 4000 }).then(() => true, () => false);
    banner ? pass("shows 'new version' when the app is reopened") : fail("no update notice after a new version was published");

    await page.reload();
    const after = await page.evaluate(() => document.querySelector('meta[name="app-version"]')?.content);
    after === "test-next" ? pass("reload gets the new version despite the host's 10-minute cache") : fail(`still on the old version after reload (${after})`);
    const kept = await page.evaluate(() => Object.keys(Store.logs).length);
    kept === 1 ? pass("logged workouts survive the update") : fail(`logged workouts after update: ${kept} (expected 1)`);

    // A new version of the offline cache must leave other sites' caches on this address alone.
    await page.evaluate(() => caches.open("another-site-cache").then(c => c.put("/x", new Response("x"))));
    fs.writeFileSync(path.join(dir, "sw.js"), fs.readFileSync(path.join(dir, "sw.js"), "utf8").replace(/const CACHE = "tension-[^"]+"/, 'const CACHE = "tension-test-next"'));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    for (let i = 0; i < 40; i++) {     // until the new version has fully taken over (up to 8 s)
      const done = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !r.installing && !r.waiting && r.active?.state === "activated" && (await caches.keys()).includes("tension-test-next"); });
      if (done) break;
      await page.waitForTimeout(200);
    }
    const keys = await page.evaluate(() => caches.keys());
    keys.includes("another-site-cache") && keys.includes("tension-test-next") && !keys.some(k => k.startsWith("tension-") && k !== "tension-test-next")
      ? pass("a new version clears only Tension's old offline copy") : fail(`caches after update: ${keys.join(", ")}`);

    await ctx.setOffline(true);
    await page.reload();
    const offline = await page.evaluate(() => !!document.querySelector("main#view").children.length);
    offline ? pass("opens offline") : fail("doesn't open offline");
  } finally {
    await ctx.close();
    server.close();
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const { server, url } = await serve(ROOT);
try {
  await layoutTests(browser, url);
  await backButtonTests(browser, url);
  await pastDayTests(browser, url);
  await bodyWeightTests(browser, url);
  await reviewFixTests(browser, url);
  await trapsAndWeeklyTests(browser, url);
  if (!process.argv.includes("--layout-only")) await updateTests(browser);
} finally {
  server.close();
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} problem(s) found.` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
