// The crash net. Until v2.19.0 there was none: entry.jsx was `root.render(<PerfectSeason />)` with nothing
// around it, and React 18 unmounts the whole tree on an uncaught render error - so the player was left on a
// blank cream page with no text, no retry and no hint that reloading might help. That is not hypothetical
// here. versus.jsx says so in its own words, about a duel board that read a turn which no longer existed:
// "with no error boundary anywhere, that took the whole app down, and it landed on whoever didn't make the
// last pick." That one site was fixed; the net never got built.
//
// **This file imports nothing but React, and it never will.** It is the thing that has to work when something
// else did not, so it cannot share a dependency with whatever broke - not theme.mjs, not game-logic.mjs, not
// storage.js. Every colour here is a literal and every style is inline, because the stylesheet is injected by
// perfect-season.jsx as it renders and a crash during that render means there may be no stylesheet at all. A
// crash screen that needs the crashed app's CSS is not a crash screen.
//
// There is no third party in here either. The privacy policy promises "no adverts, no analytics and no
// trackers" (site-pages.mjs), and crash reporting that posts to somebody else's servers is the kind of thing
// a player would reasonably call a tracker. So this reports the only way that needs no vendor, no account and
// no policy change: it shows the player what broke and gives them a button that copies it, which turns a blank
// page into a message the owner can actually act on. A first-party sink can come later; the copy button is
// what makes the next bug reportable at all.
import React from "react";

// Newest last, bounded, and never allowed to grow: this is a diagnostic, not a log. 20 is enough to show what
// led up to a crash and small enough that a copied report stays pasteable.
const RING = 20;
const recent = [];

export const VERSION = typeof APP_VERSION !== "undefined" ? APP_VERSION : "dev";

// Errors arrive in three shapes - a thrown Error, a rejected promise with any value at all, and window.onerror's
// positional arguments - so everything is normalised here rather than at each call site.
export function describeError(err) {
  if (err instanceof Error) return { message: String(err.message || err), stack: String(err.stack || "") };
  if (err && typeof err === "object") {
    try { return { message: JSON.stringify(err).slice(0, 500), stack: "" }; } catch (e) { /* circular */ }
  }
  return { message: String(err), stack: "" };
}

export function recordError(kind, err, extra) {
  const { message, stack } = describeError(err);
  recent.push({
    kind,
    message,
    // The first few frames only. A full stack from a minified bundle is pages of noise and makes the copied
    // report too long to paste anywhere.
    stack: stack.split("\n").slice(0, 6).join("\n"),
    extra: extra || "",
    at: new Date().toISOString(),
  });
  while (recent.length > RING) recent.shift();
  return recent[recent.length - 1];
}

export const errorLog = () => recent.slice();
export const clearErrorLog = () => { recent.length = 0; };

// The crash sink (docs/superpowers/specs/2026-10-05-client-error-sink-design.md). Fire-and-forget: a crash
// report is worth less than anything else happening on this screen, so it may never delay, throw or retry.
//
// IT IMPORTS NOTHING, and that is the point of this whole file. SUPABASE_URL and SUPABASE_ANON_KEY are
// esbuild DEFINES - bare identifiers replaced at build time, exactly as APP_VERSION is above - so the crash
// net can send a report over the network while still depending on nothing but React. Importing storage.js
// here would make the reporter depend on the app it is reporting on.
const SINK = typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : "";
const SINK_KEY = typeof SUPABASE_ANON_KEY !== "undefined" ? SUPABASE_ANON_KEY : "";

export function sendReport(err, info) {
  // The tests and tools/ui-harness build with no Supabase environment, so both defines are "". Without this
  // guard the whole suite POSTs at a relative URL on every caught render error.
  if (!SINK || !SINK_KEY) return;
  try {
    const { message, stack } = describeError(err);
    const firstLines = (text, n) => (text ? String(text).split("\n").slice(0, n).join("\n") : "");
    fetch(SINK + "/functions/v1/report-error", {
      method: "POST",
      // A crash is frequently followed by the tab closing. Without keepalive the request dies with the page,
      // and the reports lost are the ones from the most annoyed strangers - who are the whole point of this.
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: SINK_KEY },
      body: JSON.stringify({
        version: VERSION,
        message,
        stack: firstLines(stack, 6),
        component: firstLines(info && info.componentStack, 6),
        // The ring, which is usually where the answer is: a crash is normally the SECOND failure, and the
        // first one is what explains it.
        before: recent.slice(-5).map((r) => ({ kind: r.kind, message: r.message, extra: r.extra })),
        // Sent raw and scrubbed SERVER-side. /u/<name> is a username, and the code that just crashed is the
        // last code that should be trusted to remove it - see report-error/index.ts's own header.
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        path: typeof location !== "undefined" ? location.pathname : "",
      }),
    }).catch(() => {});
  } catch (e) {
    // The one thing worse than losing a report is the crash net crashing.
  }
}

// The async half. An error boundary catches nothing that happens outside rendering - a failed storage write, a
// rejected fetch in an effect, a handler that throws - and those are exactly the silent failures this repo
// keeps shipping. They do not blank the page, so there is nothing to show at the time; they are kept so that
// the NEXT crash report carries what led up to it, and so a player who is asked "what did you see" has
// something to send.
export function installGlobalErrorHandlers(target) {
  const w = target || (typeof window !== "undefined" ? window : null);
  if (!w || w.__ps_error_handlers__) return () => {};
  w.__ps_error_handlers__ = true;
  const onError = (event) => {
    // ErrorEvent in a browser; some environments pass the error positionally.
    const err = (event && event.error) || (event && event.message) || event;
    recordError("error", err, event && event.filename ? `${event.filename}:${event.lineno || 0}` : "");
  };
  const onRejection = (event) => {
    recordError("unhandledrejection", (event && event.reason !== undefined) ? event.reason : event, "");
  };
  w.addEventListener("error", onError);
  w.addEventListener("unhandledrejection", onRejection);
  return () => {
    w.removeEventListener("error", onError);
    w.removeEventListener("unhandledrejection", onRejection);
    w.__ps_error_handlers__ = false;
  };
}

// What the Copy button puts on the clipboard. Deliberately plain text and deliberately boring: it is going to
// be pasted into an email by somebody who is already annoyed. No personal data goes in it - no username, no
// email, no account id - because the owner does not need any of that to find a crash, and a report that
// carries it is a report the player should have been asked about first.
export function crashReport(err, info) {
  const { message, stack } = describeError(err);
  const lines = [
    `Gridspin ${VERSION}`,
    `When: ${new Date().toISOString()}`,
    typeof navigator !== "undefined" && navigator.userAgent ? `Browser: ${navigator.userAgent}` : "",
    typeof location !== "undefined" && location.pathname ? `Page: ${location.pathname}` : "",
    "",
    `Error: ${message}`,
    // V8 begins a stack with "Error: <message>", so printing the message and then the stack says the one line
    // the reader cares about twice. Found by looking at a real crash screen rather than at this function.
    stack ? stack.split("\n").filter((l) => l.trim() && !l.includes(message)).slice(0, 6).join("\n") : "",
    info && info.componentStack ? `\nWhere:${info.componentStack.split("\n").slice(0, 6).join("\n")}` : "",
  ];
  const before = recent.filter((r) => r.message !== message);
  if (before.length) {
    lines.push("", `Before this (${before.length}):`);
    for (const r of before.slice(-5)) lines.push(`  [${r.kind}] ${r.message}${r.extra ? ` (${r.extra})` : ""}`);
  }
  return lines.filter((l) => l !== "").join("\n");
}

const S = {
  wrap: {
    minHeight: "100vh", margin: 0, padding: "24px 16px", boxSizing: "border-box",
    background: "#FDF6E9", color: "#14110F",
    font: "16px/1.5 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  card: { width: "100%", maxWidth: "34rem" },
  // These colours are literals, not theme.mjs tokens, because this file imports nothing - so nothing else
  // holds them to AA and tests/test-error-boundary.mjs computes them instead. Measured: ink #14110F on the
  // cream is 17.49:1, muted #5B5651 on it 6.75:1, ink on the lime button 15.96:1, and the report block
  // 16.28:1. Lime is a FILL and never text, which is the rule in CLAUDE.md's design notes.
  h: { font: "700 1.6rem/1.15 Anton, Inter, system-ui, sans-serif", letterSpacing: ".01em", margin: "0 0 .5rem" },
  p: { margin: "0 0 1rem", color: "#5B5651" },
  row: { display: "flex", flexWrap: "wrap", gap: ".6rem", margin: "0 0 1rem" },
  btn: {
    font: "600 1rem/1 Inter, system-ui, sans-serif", padding: ".8rem 1.1rem", minHeight: "44px",
    border: "2px solid #14110F", borderRadius: ".6rem", background: "#C8FF3D", color: "#14110F",
    boxShadow: "3px 3px 0 #14110F", cursor: "pointer",
  },
  btn2: {
    font: "600 1rem/1 Inter, system-ui, sans-serif", padding: ".8rem 1.1rem", minHeight: "44px",
    border: "2px solid #14110F", borderRadius: ".6rem", background: "transparent", color: "#14110F",
    cursor: "pointer",
  },
  det: { margin: 0, color: "#5B5651", fontSize: ".85rem" },
  pre: {
    margin: ".6rem 0 0", padding: ".7rem", background: "#14110F", color: "#F4EEE3", borderRadius: ".5rem",
    fontSize: ".75rem", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "14rem", overflow: "auto",
  },
};

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null, copied: "" };
  }

  static getDerivedStateFromError(err) { return { err }; }

  componentDidCatch(err, info) {
    this.setState({ info });
    recordError("render", err, "");
    sendReport(err, info);
    // The console is the only sink there is, and it is what the owner reads when a player screen-shares.
    // Never swallowed: a crash nobody can see is the bug this whole file exists for.
    try { console.error("Gridspin crashed:", err, info && info.componentStack); } catch (e) { /* no console */ }
    try { if (this.props.onError) this.props.onError(err, info); } catch (e) { /* a reporter must not re-crash */ }
  }

  copy = async () => {
    const text = crashReport(this.state.err, this.state.info);
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: "Copied" });
    } catch (e) {
      // No clipboard permission, or an insecure context. Showing the text IS the fallback - the player can
      // select it by hand, which is what the details block below is for.
      this.setState({ copied: "Couldn't copy - select the text below" });
    }
  };

  reload = () => { try { location.reload(); } catch (e) { /* not a browser */ } };

  render() {
    if (!this.state.err) return this.props.children;
    const { message } = describeError(this.state.err);
    return (
      <div style={S.wrap} className="ps-crash" role="alert">
        <div style={S.card}>
          <h1 style={S.h}>Something went wrong</h1>
          <p style={S.p}>
            The game hit a problem it couldn&apos;t recover from. Reloading usually fixes it, and nothing you
            had saved is lost - your seasons live on the server, not in this page.
          </p>
          <div style={S.row}>
            <button type="button" style={S.btn} onClick={this.reload}>Reload the game</button>
            <button type="button" style={S.btn2} onClick={this.copy}>Copy error details</button>
          </div>
          <p style={S.det}>
            {this.state.copied
              ? this.state.copied
              : <>If it keeps happening, copy the details and send them to the owner - that is what makes it
                fixable.</>}
          </p>
          <details>
            <summary style={{ ...S.det, cursor: "pointer", marginTop: ".8rem" }}>
              Gridspin {VERSION} - what broke
            </summary>
            <pre style={S.pre}>{crashReport(this.state.err, this.state.info)}</pre>
          </details>
          <p style={{ ...S.det, marginTop: ".8rem" }} aria-hidden="true">{message}</p>
        </div>
      </div>
    );
  }
}
