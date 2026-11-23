// Arcade-wide daily game limit, shared by every game on this site.
//
// You pick a number once a day (or "No limit"). It locks until the next day.
// A game counts the moment it starts, so leaving halfway still uses it up.
// Games call `Arcade.tryStart()` before starting; it returns false (and shows
// a "done for today" card) once the limit is reached.
//
// The day rolls over at 04:00 local time, so a late game counts for the
// evening it belongs to.
(function () {
  const KEY = "arcade-limit-v1";
  const ROLLOVER_HOUR = 4;
  const MAX = 5;
  const LABELS = { 1: "just 1 game bro 🥺" };

  const today = () => {
    const d = new Date(Date.now() - ROLLOVER_HOUR * 3600e3);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  let memory = null; // fallback if localStorage is blocked
  function read() {
    let s = memory;
    try { s = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { /* use memory */ }
    if (!s || s.day !== today()) return { day: today(), chosen: false, goal: null, played: 0 };
    return s;
  }
  function write(s) {
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* memory only */ }
    dispatchEvent(new CustomEvent("arcade-limit-change", { detail: s }));
    renderStatus();
  }
  const left = (s) => (s.goal == null ? Infinity : Math.max(0, s.goal - s.played));

  /* ---------- overlay UI ---------- */
  const css = `
  .arc-ov{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;
    background:rgba(8,11,20,.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    font:17px/1.5 Inter,system-ui,-apple-system,sans-serif;color:#e9ecf5;-webkit-font-smoothing:antialiased}
  .arc-card{position:relative;width:100%;max-width:360px;background:#161d30;border:1px solid rgba(160,190,230,.14);
    border-radius:22px;padding:28px 22px 22px;text-align:center;box-shadow:0 30px 60px -25px rgba(0,0,0,.7)}
  .arc-card h2{margin:0;font-size:24px;font-weight:600;line-height:1.25}
  .arc-card p{margin:8px 0 0;color:#9aa6c2;font-size:16px}
  .arc-emoji{font-size:40px;margin-bottom:8px}
  .arc-list{display:flex;flex-direction:column;gap:10px;margin-top:22px}
  .arc-btn{display:block;width:100%;border:0;border-radius:14px;padding:15px;font:inherit;font-size:18px;font-weight:500;
    background:#212a42;color:#e9ecf5;cursor:pointer;text-decoration:none;transition:background .15s}
  .arc-btn:hover{background:#2a3554}
  .arc-btn.arc-none{background:transparent;border:1px solid rgba(160,190,230,.2);color:#9aa6c2;font-size:16px;padding:12px}
  .arc-btn.arc-main{background:#7fb8d8;color:#0d1220;margin-top:22px}
  .arc-x{position:absolute;top:10px;right:12px;width:36px;height:36px;border:0;background:none;color:#9aa6c2;font-size:24px;cursor:pointer}
  `;
  function overlay(html, opts = {}) {
    if (!document.getElementById("arc-style")) {
      const st = document.createElement("style"); st.id = "arc-style"; st.textContent = css; document.head.appendChild(st);
    }
    close();
    const ov = document.createElement("div");
    ov.className = "arc-ov"; ov.id = "arc-ov";
    ov.innerHTML = `<div class="arc-card" role="dialog" aria-modal="true">${opts.closable ? '<button class="arc-x" aria-label="Close">×</button>' : ""}${html}</div>`;
    // Keep taps on the card from reaching the game underneath.
    ["pointerdown", "touchstart", "mousedown", "keydown"].forEach((t) => ov.addEventListener(t, (e) => e.stopPropagation()));
    if (opts.closable) ov.querySelector(".arc-x").onclick = close;
    document.body.appendChild(ov);
    return ov;
  }
  function close() { const o = document.getElementById("arc-ov"); if (o) o.remove(); }

  function showPicker() {
    const opts = Array.from({ length: MAX }, (_, i) => i + 1)
      .map((n) => `<button class="arc-btn" data-n="${n}">${LABELS[n] || n + " games"}</button>`).join("");
    const ov = overlay(`<h2>How many games today?</h2><p>Across all games. Locks until tomorrow.</p>
      <div class="arc-list">${opts}<button class="arc-btn arc-none" data-n="none">No limit</button></div>`);
    ov.querySelectorAll("[data-n]").forEach((b) => b.onclick = () => {
      const n = b.dataset.n;
      write({ day: today(), chosen: true, goal: n === "none" ? null : Number(n), played: read().played });
      close();
    });
  }
  function showDone() {
    const s = read();
    overlay(`<div class="arc-emoji">🌤️</div><h2>${s.goal === 1 ? "Just 1 — done" : s.goal + " games — done"}</h2>
      <p>You said ${s.goal}, and you stuck to it. Back tomorrow.</p>
      <a class="arc-btn arc-main" href="./">Back to the arcade</a>`, { closable: true });
  }

  /* ---------- menu-page status line (element #arcade-status) ---------- */
  function renderStatus() {
    const el = document.getElementById("arcade-status");
    if (!el) return;
    const s = read();
    document.body.classList.toggle("arcade-done", s.chosen && left(s) === 0);
    if (!s.chosen) { el.textContent = ""; return; }
    if (s.goal == null) { el.textContent = "No limit today"; return; }
    const l = left(s);
    el.textContent = l === 0 ? "Done for today" : `${l} of ${s.goal} game${s.goal === 1 ? "" : "s"} left today`;
  }

  /* ---------- public API ---------- */
  window.Arcade = {
    state: read,
    /** Call right before a new game starts. True = go ahead (and it's counted). */
    tryStart() {
      const s = read();
      if (!s.chosen) { showPicker(); return false; }
      if (left(s) === 0) { showDone(); return false; }
      write({ ...s, played: s.played + 1 });
      return true;
    },
  };

  function init() {
    renderStatus();
    if (!read().chosen) showPicker();
  }
  document.readyState === "loading" ? addEventListener("DOMContentLoaded", init) : init();
  // Another tab may have played a game; keep the status in sync.
  addEventListener("storage", (e) => { if (e.key === KEY) renderStatus(); });
  // The day can roll over while a page stays open.
  addEventListener("visibilitychange", () => { if (!document.hidden) init(); });
})();
