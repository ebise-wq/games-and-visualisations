// Shared by every page: registers the service worker, and in the installed
// app (where there is no browser back button) adds a small button back to the menu.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
(function () {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const onMenu = /\/(index\.html)?$/.test(location.pathname);
  if (!standalone || onMenu) return;
  const a = document.createElement("a");
  a.href = "./";
  a.setAttribute("aria-label", "Back to the arcade");
  a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
  a.style.cssText = "position:fixed;z-index:2147483647;left:calc(10px + env(safe-area-inset-left));bottom:calc(10px + env(safe-area-inset-bottom));" +
    "width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:#e9ecf5;" +
    "background:rgba(22,29,48,.72);border:1px solid rgba(160,190,230,.18);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:.75";
  const add = () => document.body.appendChild(a);
  document.body ? add() : addEventListener("DOMContentLoaded", add);
})();
