/* The shared driver for a Gridspin film. Loaded as a classic <script src>, before the film's own inline
   script, so everything below is on `window` by the time the film runs. No modules: a film opens from a
   file:// URL and `import` is CORS-blocked there, while a plain script tag is not.

   A film using this kit supplies only what makes it that film:

     FILM.start({
       duration: 15,
       beats: [{ id:"s1", start:0, end:11.25 }, ...],   // ids are element ids of .scene divs
       render: function (t) { ... }                      // called with an exact time, must be PURE in t
     });

   PURE IN T is the whole contract. render.mjs does not play the film; it sets t to an exact value, waits
   for layout, screenshots, and moves on - 900 times for a 15-second cut. So a frame seeked to cold must be
   identical to the same frame played through. Nothing here or in a film may read a wall clock, call
   Math.random, start a CSS animation or transition, or accumulate state between calls. */
(function (global) {
  "use strict";

  var RENDER = /(^|[?&])render=1(&|$)/.test(location.search);
  var GUIDES = /(^|[?&])guides=1(&|$)/.test(location.search);

  function $(id) { return document.getElementById(id); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  /* Progress through a `d`-long window opening at `s`. Clamped at both ends, so a film can call it for a
     beat that has not started (0) or finished long ago (1) without branching. */
  function at(t, s, d) { return clamp01((t - s) / d); }
  function outCubic(p) { return 1 - Math.pow(1 - p, 3); }

  /* The p <= 0 arm is arithmetic, not defence: 1 - 2.70158 + 1.70158 does not cancel in binary, so the
     formula returns 2.220446049250313e-16 at p = 0 instead of 0. Invisible on screen - and it left
     `transform:scale(calc(... var(--x) ...))` permanently off the identity matrix, which made overlap.mjs
     skip those elements at EVERY frame rather than only while they moved. Math.max(0, ...) does not fix
     it; the epsilon is positive. */
  function outBack(p) {
    if (p <= 0) return 0;
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  }

  /* A scene's visibility at time t: 0 before, 1 while it holds, with an `xf`-long crossfade at each edge.
     The first scene does not fade IN - a film that opens on a fade opens on nothing, and the first frame
     is what a thumbnail and a scrolling viewer both get. */
  function hold(t, s, e, xf) {
    xf = xf || 0.08;
    if (t < s) return 0;
    if (s > 0 && t < s + xf) return (t - s) / xf;
    if (t <= e) return 1;
    if (t < e + xf) return 1 - (t - e) / xf;
    return 0;
  }

  /* Verbatim from static/icon.svg. ONE copy for every film built on this kit, where there were previously
     one per film. CLAUDE.md's census of hand copies counts the three already-posted films and the two older
     ones; this is not a sixth, it is what stops the number growing. */
  var MARK =
    '<rect x="2" y="2" width="60" height="60" rx="15" fill="#B8F500" stroke="#101114" stroke-width="3"/>' +
    '<path d="M43.57 18.21A18 18 0 1 1 20.43 18.21" fill="none" stroke="#101114" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M25.9 12.6 16.2 13.9 22.4 22.2Z" fill="#101114"/>' +
    '<ellipse cx="32" cy="33.5" rx="9.5" ry="6.2" transform="rotate(-35 32 33.5)" fill="#101114"/>' +
    '<path d="M29 35.8 35 31.2" stroke="#B8F500" stroke-width="1.8" stroke-linecap="round"/>';

  /* DATA_CREDIT from site-pages.mjs, flattened - the links cannot be clicked in a video. DATA.md calls this
     a licence term rather than a judgement call, and tests/test-film.mjs holds this string to the constant.
     It renders IN FRAME: see the note on .credit in kit.css for why that matters. */
  var CREDIT =
    "Player and team statistics from nflverse, used under CC BY 4.0 and modified: the ratings, boards " +
    "and eras are this game's own. Not affiliated with the NFL.";

  function start(opts) {
    var DUR = opts.duration;
    var BEATS = opts.beats;
    var draw = opts.render;

    if (RENDER) document.body.classList.add("render");
    if (GUIDES) document.body.classList.add("guides");

    var mark = document.querySelector(".mark");
    if (mark) mark.innerHTML = MARK;
    var credit = document.querySelector(".credit");
    if (credit) credit.textContent = CREDIT;

    var scenes = {};
    BEATS.forEach(function (b) { scenes[b.id] = $(b.id); });

    function render(t) {
      BEATS.forEach(function (b) { scenes[b.id].style.setProperty("--vis", hold(t, b.start, b.end)); });
      draw(t);
      if (!RENDER) {
        var fill = $("fill"), clock = $("clock");
        if (fill) fill.style.setProperty("--pct", (t / DUR * 100) + "%");
        if (clock) clock.textContent = t.toFixed(1) + " / " + DUR.toFixed(1) + "s";
      }
    }

    /* The contract render.mjs drives. __duration sits outside any render-mode branch on purpose: two older
       films hid it inside `if (RENDER)`, so a tool asking how long the film was before putting it into
       render mode saw nothing and fell back to 30s - 1800 frames for a 15-second cut, half of them copies
       of the frozen last frame. */
    global.__seek = function (x) { var t = Math.max(0, Math.min(DUR, x)); render(t); };
    global.__duration = DUR;

    if (RENDER) { render(0); return; }

    // Preview only: a real clock, which is exactly what the renderer refuses to use.
    var t = 0, playing = true, last = 0;
    function frame(now) {
      if (playing) {
        if (last) t = Math.min(DUR, t + (now - last) / 1000);
        last = now;
        if (t >= DUR) { t = DUR; playing = false; var p = $("play"); if (p) p.textContent = "play"; }
      } else { last = now; }
      render(t);
      requestAnimationFrame(frame);
    }
    var play = $("play"), restart = $("restart"), bar = $("bar");
    if (play) play.addEventListener("click", function () {
      if (t >= DUR) t = 0;
      playing = !playing; play.textContent = playing ? "pause" : "play";
    });
    if (restart) restart.addEventListener("click", function () {
      t = 0; playing = true; if (play) play.textContent = "pause";
    });
    if (bar) bar.addEventListener("click", function (e) {
      var r = bar.getBoundingClientRect();
      t = Math.max(0, Math.min(DUR, (e.clientX - r.left) / r.width * DUR));
      render(t);
    });
    render(0);
    requestAnimationFrame(frame);
  }

  global.FILM = {
    start: start,
    $: $, clamp01: clamp01, at: at, outCubic: outCubic, outBack: outBack, hold: hold,
    MARK: MARK, CREDIT: CREDIT, RENDER: RENDER,
  };
})(window);
