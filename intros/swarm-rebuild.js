import { fitCanvas, prefersStill } from "./shared/common.js";

const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => value * value * (3 - 2 * value);

// Each builder travels from its last selection to the next one, then drags
// a selection open over the live page. The canvas only paints the mask.
export function playSwarmRebuild({ stage, surface, tracks, colors, instruction, interactive = "a, button", onFinish }) {
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
  const builders = colors.map((color, index) => ({
    color, tasks: [], end: index * 95,
    x: width / 2 + (index - 1) * 14, y: height * 0.46,
  }));

  function assign(builder, box, text = false) {
    const start = builder.end;
    builder.end += 280 + (text ? 360 : 620);
    builder.tasks.push({ ...box, text, start, end: builder.end });
  }

  // Elements get a typing reveal. Rectangles get a dragged selection box.
  tracks.forEach((targets, index) => {
    for (const target of targets) {
      if (!target) continue;
      const text = target instanceof Element;
      if (text && getComputedStyle(target).visibility === "hidden") continue;
      const rect = text ? target.getBoundingClientRect() : target;
      if (!rect.width || !rect.height) continue;
      const pad = text ? 2 : 0;
      assign(builders[index], {
        x: rect.left - bounds.left - pad, y: rect.top - bounds.top - pad,
        w: rect.width + 2 * pad, h: rect.height + 2 * pad,
      }, text);
    }
  });

  const duration = Math.max(...builders.map((builder) => builder.end));
  const background = getComputedStyle(document.body).backgroundColor;
  const listeners = new AbortController();
  const options = { signal: listeners.signal, capture: true, passive: true };
  let frame;
  let heldPointer = null;
  let spaceHeld = false;
  let aim = null;
  let pull = 0;
  let elapsed = 0;
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
    canvas.style.opacity = String(1 - fade);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    const cursors = [];
    for (const builder of builders) {
      let { x, y } = builder;
      for (const task of builder.tasks) {
        if (elapsed < task.start) break;
        if (elapsed >= task.end) {
          ctx.clearRect(task.x, task.y, task.w, task.h);
          x = task.x + task.w;
          y = task.y + task.h;
          continue;
        }
        const travel = ease(clamp((elapsed - task.start) / 280));
        x += (task.x - x) * travel;
        y += (task.y - y) * travel;
        if (travel === 1) {
          const progress = ease(clamp((elapsed - task.start - 280) / (task.end - task.start - 280)));
          const w = task.w * progress;
          const h = task.text ? task.h : task.h * progress;
          ctx.clearRect(task.x, task.y, w, h);
          ctx.strokeStyle = builder.color;
          if (task.text) {
            ctx.fillStyle = builder.color;
            ctx.fillRect(task.x + w, task.y, 1.5, h);
          } else {
            ctx.strokeRect(task.x, task.y, w, h);
            ctx.fillStyle = builder.color;
            ctx.fillRect(task.x - 2, task.y - 2, 4, 4);
            ctx.fillRect(task.x + w - 2, task.y + h - 2, 4, 4);
          }
          x += w;
          y += h;
        }
        break;
      }
      cursors.push({ x, y, color: builder.color });
    }
    if (aim) {
      // Reveal the real code beneath the pointer, even in unfinished regions.
      const radius = 55 + 40 * pull;
      const glow = ctx.createRadialGradient(aim.x, aim.y, 0, aim.x, aim.y, radius);
      glow.addColorStop(0, "#000");
      glow.addColorStop(1, "transparent");
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = glow;
      ctx.fillRect(aim.x - radius, aim.y - radius, radius * 2, radius * 2);
      ctx.restore();
    }
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
    frame = requestAnimationFrame(draw);
  }
  draw(previous);
}
