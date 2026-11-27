// Keep the assembled page from flashing while modules load. If loading fails,
// the static links become visible again.
if (!location.hash && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !new URLSearchParams(location.search).has("still")) {
  document.documentElement.classList.add("swarm-boot");
  setTimeout(() => document.documentElement.classList.remove("swarm-boot"), 2500);
}
