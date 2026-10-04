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
//   node tools/film/render.mjs [--out FILE] [--fps 60] [--width W] [--height H] [--seconds N]
//                              [--film FILE] [--audio FILE] [--stills 1.5,7,22]
//
// --width/--height/--seconds are ASKED OF THE FILM when you leave them off: the duration from its
// window.__duration and the shape from its .stage aspect-ratio. So the four 9:16 cuts render correctly
// with nothing but --film, and the 30s title sequence still comes out 1920x1080x30 as it always did.
// Anything you do pass is used exactly as given.
//
// Needs: puppeteer-core (already a devDependency), Chrome, and ffmpeg on PATH or at FFMPEG_PATH.
//
// --audio is what makes the DELIVERED film rather than a silent one. The cue is synthesized by
// tools/film/score.mjs, so the whole scored file comes out of this repo and nothing else:
//
//   node tools/film/score.mjs
//   node tools/film/render.mjs --audio build/film/score.wav \
//                              --out build/film/gridspin-spin-an-era-1080p60.mp4
//
// The flag lives here rather than in a separate mux script because this file is already the one
// place that knows how to talk to ffmpeg, and a second script would be a second copy of the encoder
// settings to keep in step. If a silent render is ALREADY in hand, though, don't re-render 1800
// frames just to attach sound - that is half an hour for something that takes two seconds. Copy the
// picture through untouched and encode only the audio. The h264 stream is byte for byte the one the
// silent render already produced, so this and the --audio flag above end at the same file:
//
//   ffmpeg -y -i build/film/silent.mp4 -i build/film/score.wav \
//          -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart \
//          build/film/gridspin-spin-an-era-1080p60.mp4
//
// -shortest is not decoration: without it the output runs as long as the LONGEST input, so a cue that
// overshoots the picture leaves an mp4 whose audio plays on over nothing.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

// Whether the CALLER said so, as opposed to a default being used. Every flag the caller passes is
// honoured exactly as before; only the ones they leave out get asked of the film. That split is what
// makes this safe to add to a tool whose existing commands are written down in several places.
const argGiven = (name) => process.argv.indexOf(`--${name}`) > -1;

// These were const 1920x1080x30 - the title sequence's shape, and the shape of exactly one of the five
// films. The four 9:16 cuts each had to be told their own dimensions on the command line, and leaving a
// flag off was silent: a 15s 1080x1920 film rendered as 1800 landscape frames, of which 900 were
// identical copies of the frozen close card, because __seek clamps at DUR. Every film already publishes
// window.__duration and already declares its aspect on .stage; nothing read either. Now they do.
let WIDTH = Number(arg("width", 1920));
let HEIGHT = Number(arg("height", 1080));
const FPS = Number(arg("fps", 60));
let SECONDS = Number(arg("seconds", 30));
let FRAMES = Math.round(FPS * SECONDS);
const OUT = resolve(arg("out", "build/film/gridspin-30s-1080p60.mp4"));
const FILM = resolve(arg("film", "tools/film/spin-an-era.html"));
const AUDIO = arg("audio", null) ? resolve(arg("audio", null)) : null;

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
  // Before Chrome, before a single frame. ffmpeg opens all its inputs at startup, so a missing cue
  // does fail on its own - but it fails as a broken pipe on the first frame written, which reads like
  // an encoder crash rather than a typo in a path. Half an hour of rendering is too expensive to risk
  // on a filename, so say it plainly while nothing has been spent yet.
  if (AUDIO && !existsSync(AUDIO)) {
    throw new Error(`no audio at ${AUDIO} - run \`node tools/film/score.mjs\` first, or drop --audio`);
  }
  const chrome = findChrome();
  const ffmpeg = findFfmpeg();
  console.log(`film    ${FILM}`);
  console.log(`chrome  ${chrome}`);
  console.log(`ffmpeg  ${ffmpeg}`);
  console.log(`audio   ${AUDIO || "(silent)"}`);
  console.log(`out     ${OUT}`);

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

    // Ask the film what it is, for anything the caller did not say. This is a PRE-FLIGHT load WITHOUT
    // ?render=1, which matters: `body.render .stage` overrides aspect-ratio to auto so the stage can
    // fill the viewport, so the film's own declared shape is only readable before render mode applies.
    if (!argGiven("seconds") || !argGiven("width") || !argGiven("height")) {
      // "load", not "domcontentloaded": spin-an-era.html sets window.__duration late enough that the
      // earlier event read it as absent, and the renderer then fell back to a default that happened to
      // be right for that one film. A default that is correct by luck is worse than one that is wrong.
      await page.goto(pathToFileURL(FILM).href, { waitUntil: "load" });
      const says = await page.evaluate(() => {
        const stage = document.querySelector(".stage");
        const ratio = stage ? getComputedStyle(stage).aspectRatio : "";
        const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio || "");
        return { aspect: m ? Number(m[1]) / Number(m[2]) : null };
      });
      // Height follows width, because width is the side a film's cqw units are measured against.
      if (!argGiven("width") && !argGiven("height") && says.aspect && Math.abs(says.aspect - WIDTH / HEIGHT) > 0.01) {
        HEIGHT = Math.round(WIDTH / says.aspect);
        if (says.aspect < 1) { HEIGHT = 1920; WIDTH = Math.round(HEIGHT * says.aspect); }
        console.log(`size    ${WIDTH}x${HEIGHT} from the film's own .stage aspect-ratio`);
      }
    }

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

    // The duration is read HERE rather than in the pre-flight, because this is the only page state in
    // which all five films publish it: spin-an-era.html and tiktok-ad.html set window.__duration inside
    // their `if (RENDER)` arm, so a page loaded without ?render=1 sees nothing. Both now set it
    // unconditionally too, but reading it from the render-mode page is what makes this correct for a
    // film that has not been updated - including any already delivered.
    if (!argGiven("seconds")) {
      const says = await page.evaluate(() => (typeof window.__duration === "number" ? window.__duration : null));
      if (says > 0 && says !== SECONDS) {
        SECONDS = says;
        FRAMES = Math.round(FPS * SECONDS);
        console.log(`length  ${SECONDS}s from the film's own window.__duration`);
      }
    }
    console.log(`${WIDTH}x${HEIGHT} @ ${FPS}fps, ${SECONDS}s = ${FRAMES} frames
`);

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

    // One stdin pipe for the picture and, optionally, the cue as a second input off disk. ffmpeg's
    // default stream selection takes the video from input 0 and the audio from input 1, so no -map is
    // needed; adding one would only be a thing to get wrong when a flag moves.
    const args = [
      "-y",
      "-f", "image2pipe",
      "-framerate", String(FPS),
      "-i", "-",
      ...(AUDIO ? ["-i", AUDIO] : []),
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "16",              // visually lossless for flat colour and type
      "-profile:v", "high",
      "-level", "4.2",
      "-pix_fmt", "yuv420p",     // the one chroma format every player and phone will open
      "-r", String(FPS),
      // AAC-LC at 256k, which is what the delivered film carries. The cue is synthesized rather than
      // recorded, so it is full of pure tones and sharp transients - the two things a mean encoder
      // smears - and the whole file is 30 seconds, so there is nothing to save by going lower.
      // -shortest bounds the output by the picture: without it a cue longer than the film leaves audio
      // playing over an mp4 that has run out of frames. It is exact at the length this is actually used
      // at - 30s of picture against the 30s cue comes out 30.000000s - but it cannot cut below what the
      // AAC encoder has already buffered, so a two-frame test render with --audio still lands near a
      // second. That is the test being shorter than the encoder's own latency, not a broken flag.
      ...(AUDIO ? ["-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest"] : []),
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
