// Renders the Gridspin title sequence to a 1080p60 MP4, frame by frame.
//
// NOT a screen recording. A screen recording of a rAF animation drops frames the moment the machine
// is busy, and every dropped frame is a stutter baked into the file. This drives the film's own clock
// instead: it sets `t` to an exact time, waits for the browser to lay out that frame, screenshots it,
// and moves on. The film never runs in real time at all, so the output is exactly 60 distinct frames
// a second however long each one took to draw.
//
// The frames are piped straight into ffmpeg's stdin rather than written to disk - 1800 PNGs of a
// dot-matrix field is the better part of a gigabyte, and none of it is wanted afterwards.
//
//   node tools/film/render.mjs [--out FILE] [--fps 60] [--width 1920] [--height 1080] [--seconds 30]
//
// Needs: puppeteer-core (already a devDependency), Chrome, and ffmpeg on PATH or at FFMPEG_PATH.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const WIDTH = Number(arg("width", 1920));
const HEIGHT = Number(arg("height", 1080));
const FPS = Number(arg("fps", 60));
const SECONDS = Number(arg("seconds", 30));
const FRAMES = Math.round(FPS * SECONDS);
const OUT = resolve(arg("out", "build/film/gridspin-30s-1080p60.mp4"));
const FILM = resolve(arg("film", "tools/film/spin-an-era.html"));

// The same list the UI harness uses, plus the winget install path - winget adds its shim to PATH but
// only for shells started afterwards, so a session that predates the install can't see it.
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error("No Chrome found - set CHROME_PATH");
  return found;
}

function findFfmpeg() {
  const home = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.FFMPEG_PATH,
    `${home}/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe`,
    `${home}/Microsoft/WinGet/Links/ffmpeg.exe`,
    "/usr/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
  ];
  const found = candidates.find((p) => p && existsSync(p));
  return found || "ffmpeg"; // fall through to PATH
}

const pad = (n, w = 6) => String(n).padStart(w, " ");

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const chrome = findChrome();
  const ffmpeg = findFfmpeg();
  console.log(`film    ${FILM}`);
  console.log(`chrome  ${chrome}`);
  console.log(`ffmpeg  ${ffmpeg}`);
  console.log(`out     ${OUT}`);
  console.log(`${WIDTH}x${HEIGHT} @ ${FPS}fps, ${SECONDS}s = ${FRAMES} frames\n`);

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "shell",
    args: [
      `--window-size=${WIDTH},${HEIGHT}`,
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--disable-lcd-text",            // greyscale AA: subpixel fringing survives h264 as colour noise
      "--font-render-hinting=none",    // the same glyph shapes a designer sees, not hinted-to-pixel ones
      "--disable-gpu-vsync",
      "--no-sandbox",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    // ?render=1 strips the transport and sizes the stage to the viewport exactly. The film is ONE
    // file - a separate "render build" is a second thing to keep in step, and it would drift.
    await page.goto(`${pathToFileURL(FILM).href}?render=1`, { waitUntil: "networkidle0" });

    // Anton and Inter come off Google Fonts. Frame 0 must not be the fallback stack: a web font that
    // lands at frame 40 re-lays out every line of type and the cut jumps.
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));

    const ready = await page.evaluate(() => typeof window.__seek === "function");
    if (!ready) throw new Error("the film exposes no window.__seek(t) - it cannot be driven frame by frame");

    const stills = arg("stills", null);
    if (stills) {
      const times = stills.split(",").map(Number).filter((n) => !Number.isNaN(n));
      mkdirSync(resolve("build/film/stills"), { recursive: true });
      for (const time of times) {
        await page.evaluate((x) => {
          window.__seek(x);
          return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }, time);
        const file = resolve(`build/film/stills/t${time.toFixed(2).replace(".", "_")}.png`);
        await page.screenshot({ path: file, type: "png" });
        console.log(`still  t=${time.toFixed(2)}s  ${file}`);
      }
      return;
    }

    const args = [
      "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-i", "-",
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "16",              // visually lossless for flat colour and type
      "-profile:v", "high",
      "-level", "4.2",
      "-pix_fmt", "yuv420p",     // the one chroma format every player and phone will open
      "-r", String(FPS),
      "-movflags", "+faststart", // moov atom first, so it starts playing before it has downloaded
      OUT,
    ];
    const enc = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    enc.stderr.on("data", (d) => { ffErr += d.toString(); if (ffErr.length > 8000) ffErr = ffErr.slice(-8000); });
    const encDone = new Promise((res, rej) => {
      enc.on("error", rej);
      enc.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}\n${ffErr}`))));
    });

    // Backpressure. Both listeners have to come off again once one of them fires, or 1800 frames adds
    // 1800 error handlers to the same socket and node starts warning about a leak it is right about.
    const write = (buf) => new Promise((res, rej) => {
      if (enc.stdin.write(buf)) return res();
      const onDrain = () => { enc.stdin.off("error", onErr); res(); };
      const onErr = (e) => { enc.stdin.off("drain", onDrain); rej(e); };
      enc.stdin.once("drain", onDrain);
      enc.stdin.once("error", onErr);
    });

    const started = process.hrtime.bigint();
    for (let i = 0; i < FRAMES; i++) {
      const t = i / FPS;
      // Seek, then let the browser produce the frame for that time before grabbing it. Two rAFs:
      // the first returns inside the frame the write happened in, the second after it has been drawn.
      await page.evaluate((time) => {
        window.__seek(time);
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, t);
      await write(await page.screenshot({ type: "png", optimizeForSpeed: true }));

      if (i % 60 === 0 || i === FRAMES - 1) {
        const secs = Number(process.hrtime.bigint() - started) / 1e9;
        const rate = (i + 1) / secs;
        const left = (FRAMES - i - 1) / (rate || 1);
        process.stdout.write(
          `\rframe ${pad(i + 1)}/${FRAMES}  t=${t.toFixed(2).padStart(5)}s  ` +
          `${rate.toFixed(1)} fps  ~${Math.max(0, left).toFixed(0)}s left   `,
        );
      }
    }
    enc.stdin.end();
    process.stdout.write("\n\nencoding...\n");
    await encDone;
    console.log(`done  ${OUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("\n" + (e && e.stack || e)); process.exit(1); });
