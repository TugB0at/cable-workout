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
function seed() {
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
  return { state: { units: "lb", notes: { "chest-press": "position 31 of 32 on both towers, check!" }, rest: 90, planVersion: 3 }, logs };
}

// Everything on screen that sticks out past the right edge of the phone (or of the
// open exercise view). Strips that are meant to scroll sideways are allowed.
const findOverflow = () => {
  const dlg = document.querySelector("dialog[open]");
  const root = dlg || document.body;
  const limit = dlg ? dlg.getBoundingClientRect().right : document.documentElement.clientWidth;
  const scrollsSideways = el => {
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
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
  // Number boxes too narrow to show their value (e.g. a weight of 137.5).
  for (const el of root.querySelectorAll('input[type="number"]')) {
    if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`number cut off: #${el.id || el.getAttribute("aria-label")} "${el.value}"`);
  }
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
    const data = seed();
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
    const shot = async name => { if (width === SHOT_WIDTH) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: !(await page.$("dialog[open]")) }); };

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
    const taps = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#logForm button')].map(b => b.getBoundingClientRect().height)));
    if (taps < 44) fail(`log buttons are only ${Math.round(taps)}px tall (want 44+)`);
    clean = (await checkScreen(page, "exercise view with a set logged")) && clean;
    await page.evaluate(() => document.querySelector(".logger").scrollIntoView());
    await shot("exercise-logging");
    await page.evaluate(() => document.getElementById("sheet").scrollTop = 0);
    await shot("exercise-top");

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
    await tap(page, 'dialog[open] [data-act="close"]', "close"); await page.waitForTimeout(300);

    await tap(page, '[data-act="finish"]', "Finish workout");
    const sum = await page.evaluate(() => ({
      open: !!document.querySelector("dialog[open] .sum-stats"),
      records: [...document.querySelectorAll("dialog[open] .record")].map(r => r.textContent.replace(/\s+/g, " ").trim()),
      sets: document.querySelectorAll("dialog[open] .sum-stats .stat .v")[1]?.textContent,
    }));
    const rec = sum.records.find(r => r.includes("Standing cable chest press") && r.includes("Heaviest set: 100 lb, up from 81"));
    sum.open && rec && sum.sets === "3" ? pass(`summary: 3 sets, "${rec}"`) : fail(`summary: ${JSON.stringify(sum)}`);
    // Calories: asks for body weight once, then estimates (3 back-filled sets: ~7 min estimated).
    const ask = await page.evaluate(() => !!document.querySelector("dialog[open] #bwIn"));
    await page.fill("#bwIn", "200"); await tap(page, '[data-act="savebw"]', "Save body weight");
    const est = await page.evaluate(() => document.querySelector("dialog[open] .cal-card")?.textContent.replace(/\s+/g, " ") || "");
    ask && est.includes("≈ 37 calories") && est.includes("7 min (estimated") ? pass(`calories, estimated time: "${est.trim().slice(0, 60)}…"`) : fail(`calories (estimated): asked=${ask} "${est}"`);
    await back();
    (await page.evaluate(() => !document.querySelector("dialog[open]"))) ? pass("back closes the summary") : fail("summary still open after back");
    // Measured time: two sets 40 minutes apart today, 200 lb body weight -> 3.5 x 90.7 kg x 41/60 h = 217.
    const measured = await page.evaluate(() => {
      const t0 = Date.now() - 40 * 60000, k = todayKey();
      Store.logs[k] = { date: k, sets: { row: [{ w: 100, r: 10, t: t0 }, { w: 100, r: 10, t: t0 + 40 * 60000 }] } };
      setLogDate(null); openSummary();
      const r = { cal: document.querySelector("dialog[open] .cal-card")?.textContent.replace(/\s+/g, " ") || "", time: document.querySelector("dialog[open] .sum-stats .stat .v")?.textContent };
      delete Store.logs[k]; document.getElementById("sheet").close();
      return r;
    });
    await page.waitForTimeout(300);
    measured.cal.includes("≈ 217 calories") && measured.time === "41 min" ? pass("calories, measured time: ≈ 217 for 41 min at 200 lb") : fail(`calories (measured): ${JSON.stringify(measured)}`);

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
  if (!process.argv.includes("--layout-only")) await updateTests(browser);
} finally {
  server.close();
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} problem(s) found.` : "\nAll checks passed.");
process.exit(failures.length ? 1 : 0);
