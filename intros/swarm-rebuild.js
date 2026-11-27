import { fitCanvas, prefersStill } from "./shared/common.js";

const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => value * value * (3 - 2 * value);

// DOM pieces travel with their builder. Canvas-drawn lines stay in their
// native layer and are uncovered one line at a time at the builder's tip.
export function playSwarmRebuild({ stage, surface, groups, liveParts, colors, instruction, interactive = "a, button", onFinish }) {
  document.documentElement.classList.remove("swarm-boot");
  if (prefersStill() || document.hidden) {
    onFinish();
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.className = "swarm-rebuild";
  canvas.setAttribute("aria-hidden", "true");
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "swarm-skip";
  skip.textContent = "Skip intro";
  const controls = document.createElement("div");
  controls.className = "swarm-controls";
  const hint = document.createElement("span");
  const hintText = matchMedia("(pointer: coarse)").matches ? "Touch and hold to gather" : instruction;
  hint.textContent = hintText;
  controls.append(hint, skip);
  stage.append(canvas, controls);
  stage.classList.add("is-rebuilding");

  const { context: ctx, width, height } = fitCanvas(canvas);
  const bounds = canvas.getBoundingClientRect();
  const count = Math.min(7, Math.max(3, Math.ceil(groups.reduce((total, group) => total + group.length, 0) / 8)));
  const builders = Array.from({ length: count }, (_, i) => ({
    color: colors[i % colors.length], tasks: [], end: i * 45,
    x: width * (0.15 + 0.7 * i / (count - 1)), y: height * 0.46,
  }));
  const scheduled = new WeakSet();
  const background = getComputedStyle(document.body).backgroundColor;
  let elapsed = 0;
  let duration = 0;

  function schedule(part) {
    if (!part || scheduled.has(part)) return;
    const node = part instanceof Element ? part : null;
    const style = node && getComputedStyle(node);
    if (style && (style.visibility !== "visible" || Number(style.opacity) === 0)) return;
    const rect = node ? node.getBoundingClientRect() : part.rect || part;
    const viewport = node?.closest(".buffer, .wheel-list")?.getBoundingClientRect() || bounds;
    const left = Math.max(rect.left, bounds.left, viewport.left);
    const top = Math.max(rect.top, bounds.top, viewport.top);
    const right = Math.min(rect.right, bounds.right, viewport.right, window.innerWidth);
    const bottom = Math.min(rect.bottom, bounds.bottom, viewport.bottom, window.innerHeight);
    if (right <= left || bottom <= top) return;
    scheduled.add(part);
    const x = left - bounds.left;
    const y = top - bounds.top;
    const w = right - left;
    const h = bottom - top;
    // Place the grab point near the leading edge of the piece.
    const gripX = node ? x + Math.min(w / 2, 12) : x;
    const gripY = y + h / 2;
    let arrival = Infinity;
    let builder, start;
    for (const candidate of builders) {
      const last = candidate.tasks.at(-1);
      const distance = Math.hypot(gripX - (last?.endX ?? candidate.x), gripY - (last?.endY ?? candidate.y));
      const depart = Math.max(candidate.end, elapsed);
      const reach = depart + Math.min(310, 100 + distance * 0.32);
      if (reach < arrival) {
        builder = candidate;
        start = depart;
        arrival = reach;
      }
    }
    const dx = gripX < width / 2 ? -28 : 28;
    const dy = -14;
    const end = arrival + Math.min(460, 220 + w * 0.28);
    // Non-replaced inline boxes (such as a text link) ignore translate.
    const inline = style?.display === "inline" && node instanceof HTMLAnchorElement;
    const pickup = inline ? { position: "relative", left: `${dx}px`, top: `${dy}px` } : { translate: `${dx}px ${dy}px` };
    const landed = inline ? { position: "relative", left: "0px", top: "0px" } : { translate: "0px 0px" };
    const animation = node?.animate([
      { opacity: 0, ...pickup },
      { opacity: Number(style.opacity), offset: 0.35 },
      { opacity: Number(style.opacity), ...landed },
    ], { duration: 1000, fill: "both" });
    if (animation) {
      animation.pause();
      animation.currentTime = 0;
    }
    part.reveal?.(0);
    builder.tasks.push({ x, y, w, h, start, arrival, end, animation, reveal: part.reveal, dx, dy,
      startX: gripX + (node ? dx : 0), startY: gripY + (node ? dy : 0),
      endX: node ? gripX : x + w, endY: gripY });
    builder.end = end;
    duration = Math.max(duration, end);
  }
  // Start work in every region immediately, including the footer and desk.
  for (let i = 0; groups.some(group => i < group.length); i++) {
    for (const group of groups) schedule(group[i]);
  }
  const observer = liveParts && new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE))) {
      liveParts.collect().forEach(schedule);
    }
  });
  observer?.observe(liveParts.root, { childList: true, subtree: true });
  const listeners = new AbortController();
  const options = { signal: listeners.signal, capture: true, passive: true };
  let frame;
  let heldPointer = null;
  let spaceHeld = false;
  let aim = null;
  let pull = 0;
  let previous = performance.now();

  function updateAim(event) {
    aim = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function releasePointer() {
    const id = heldPointer;
    heldPointer = null;
    if (id !== null && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
    if (!spaceHeld) hint.textContent = hintText;
  }
  function finish() {
    listeners.abort();
    observer?.disconnect();
    for (const builder of builders) {
      for (const task of builder.tasks) {
        task.animation?.cancel();
        task.reveal?.(1);
      }
    }
    cancelAnimationFrame(frame);
    releasePointer();
    stage.classList.remove("is-rebuilding");
    canvas.remove();
    controls.remove();
    onFinish();
  }
  surface.addEventListener("pointermove", (event) => {
    if (event.isPrimary) updateAim(event);
  }, options);
  surface.addEventListener("pointerleave", () => {
    if (heldPointer === null && !spaceHeld) aim = null;
  }, options);
  window.addEventListener("pointerdown", (event) => {
    if (event.target.closest(interactive)) {
      if (event.target !== skip) finish();
      return;
    }
    if (surface.contains(event.target) && event.isPrimary && event.button === 0) {
      updateAim(event);
      heldPointer = event.pointerId;
      surface.setPointerCapture(heldPointer);
      hint.textContent = "Drag to guide · Release to build";
    }
  }, options);
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    surface.addEventListener(event, (event) => {
      if (event.pointerId === heldPointer) releasePointer();
    }, options);
  }
  const keyboardOptions = { signal: listeners.signal, capture: true };
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && event.target === document.body && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      spaceHeld = true;
      aim ??= { x: width / 2, y: height * 0.46 };
      hint.textContent = "Release Space to build";
      return;
    }
    if (event.target === skip && (event.key === "Enter" || event.key === " ")) return;
    finish();
  }, keyboardOptions);
  window.addEventListener("keyup", (event) => {
    if (event.code !== "Space" || !spaceHeld) return;
    spaceHeld = false;
    if (heldPointer === null) hint.textContent = hintText;
  }, options);
  for (const event of ["wheel", "resize", "blur", "pagehide"]) {
    window.addEventListener(event, finish, options);
  }
  document.addEventListener("visibilitychange", finish, options);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", finish, options);
  skip.addEventListener("click", finish, options);

  const pointer = new Path2D("M0 0 L3 17 L7.5 12 L13.5 11 Z");
  function draw(now) {
    const dt = now - previous;
    previous = now;
    const gathering = heldPointer !== null || spaceHeld;
    if (!gathering) elapsed += dt;
    pull += ((gathering ? 1 : 0) - pull) * (1 - Math.exp(-dt / 95));
    const fade = clamp((elapsed - duration) / 280);
    if (fade === 1) return finish();
    ctx.clearRect(0, 0, width, height);
    const cursors = [];
    for (const builder of builders) {
      let { x, y } = builder;
      for (const task of builder.tasks) {
        if (elapsed >= task.end) {
          if (!task.done) {
            task.animation?.cancel();
            task.reveal?.(1);
            task.done = true;
          }
          x = task.endX;
          y = task.endY;
          continue;
        }
        const progress = ease(clamp((elapsed - task.arrival) / (task.end - task.arrival)));
        if (!task.animation && !task.reveal) {
          const revealed = Math.floor(task.w * progress);
          ctx.fillStyle = background;
          ctx.fillRect(task.x + revealed, task.y, task.w - revealed, task.h);
        }
        if (elapsed < task.start) continue;
        const travel = ease(clamp((elapsed - task.start) / (task.arrival - task.start)));
        x += (task.startX - x) * travel;
        y += (task.startY - y) * travel;
        if (elapsed < task.arrival) continue;
        x = task.startX + (task.endX - task.startX) * progress;
        y = task.startY + (task.endY - task.startY) * progress;
        task.reveal?.(progress);
        ctx.strokeStyle = builder.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (task.animation) {
          task.animation.currentTime = 1000 * progress;
          const left = task.x + task.dx * (1 - progress);
          const top = task.y + task.dy * (1 - progress);
          const right = left + task.w;
          const bottom = top + task.h;
          const tick = Math.min(6, task.w / 2, task.h / 2);
          ctx.moveTo(left, top + tick);
          ctx.lineTo(left, top);
          ctx.lineTo(left + tick, top);
          ctx.moveTo(right - tick, bottom);
          ctx.lineTo(right, bottom);
          ctx.lineTo(right, bottom - tick);
        } else {
          ctx.moveTo(x, task.y);
          ctx.lineTo(x, task.y + task.h);
        }
        ctx.stroke();
      }
      cursors.push({ x, y, color: builder.color });
    }
    ctx.globalAlpha = 1 - fade;
    for (const [index, cursor] of cursors.entries()) {
      if (aim && pull > 0.001) {
        const angle = now / 550 + index * 2 * Math.PI / cursors.length;
        cursor.x += (aim.x + 30 * Math.cos(angle) - cursor.x) * pull;
        cursor.y += (aim.y + 24 * Math.sin(angle) - cursor.y) * pull;
      }
      ctx.save();
      ctx.translate(cursor.x, cursor.y);
      ctx.fillStyle = cursor.color;
      ctx.strokeStyle = background;
      ctx.lineWidth = 1.5;
      ctx.fill(pointer);
      ctx.stroke(pointer);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    frame = requestAnimationFrame(draw);
  }
  draw(previous);
}
