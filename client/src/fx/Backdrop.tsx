import { useEffect, useRef } from "react";
import type { Mode } from "../scale";
import { useReducedMotion } from "./motion";

/**
 * The page's ambient layer, fixed behind everything and inert to the pointer.
 *
 *   aurora   four blurred colour fields drifting on long, out-of-phase loops
 *   grid     a dot lattice, faint everywhere and lit up around the cursor
 *   motes    a canvas of slow "energy" particles with depth: they parallax on
 *            scroll at different rates and part around the cursor
 *   grain    a film-grain overlay, the thing that stops flat gradients from
 *            looking like a default
 *
 * None of it carries information, so all of it stays out of the way: no blue
 * or red (those are the data's), and it goes still under reduced motion.
 */
export function Backdrop({ mode }: { mode: Mode }) {
  const still = useReducedMotion();

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="aurora">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
      </div>
      <div className="lattice" />
      <div className="lattice lit" />
      {!still && <Motes mode={mode} />}
      <div className="grain" />
      <div className="vignette" />
    </div>
  );
}

type Mote = {
  x: number;
  y: number;
  /** 0.15 (far) to 1 (near): scales size, speed, parallax and brightness. */
  depth: number;
  vx: number;
  vy: number;
  sprite: number;
  phase: number;
  /** Displacement from the cursor, eased back to zero. */
  ox: number;
  oy: number;
};

const PALETTE: Record<Mode, string[]> = {
  dark: ["167, 139, 250", "232, 121, 249", "251, 191, 36", "240, 240, 255"],
  light: ["124, 58, 237", "192, 38, 211", "217, 119, 6", "99, 82, 160"],
};

/** A soft radial glow per palette colour, drawn once and stamped per frame. */
function makeSprites(mode: Mode): HTMLCanvasElement[] {
  return PALETTE[mode].map((rgb) => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, `rgba(${rgb}, 1)`);
    g.addColorStop(0.18, `rgba(${rgb}, 0.85)`);
    g.addColorStop(0.45, `rgba(${rgb}, 0.18)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  });
}

function Motes({ mode }: { mode: Mode }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const sprites = makeSprites(mode);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let motes: Mote[] = [];
    const pointer = { x: -9999, y: -9999 };

    const seed = (): Mote => {
      const depth = 0.15 + Math.random() ** 1.6 * 0.85;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        depth,
        vx: (Math.random() - 0.5) * 0.12 * depth,
        vy: -(0.05 + Math.random() * 0.18) * depth,
        sprite: Math.random() < 0.12 ? 2 : Math.random() < 0.2 ? 3 : Math.random() < 0.55 ? 0 : 1,
        phase: Math.random() * Math.PI * 2,
        ox: 0,
        oy: 0,
      };
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.min(110, Math.round((width * height) / 15000));
      while (motes.length < target) motes.push(seed());
      motes.length = target;
    };

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onLeave = () => {
      pointer.x = pointer.y = -9999;
    };

    let frame = 0;
    let last = performance.now();

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (document.hidden) return;
      const dt = Math.min((now - last) / 16.67, 3);
      last = now;
      const scroll = window.scrollY;

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = mode === "dark" ? "lighter" : "source-over";

      for (const m of motes) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.y < -20) m.y += height + 40;
        if (m.x < -20) m.x += width + 40;
        if (m.x > width + 20) m.x -= width + 40;

        // Nearer motes scroll past faster - the parallax is what sells depth.
        let y = (m.y - scroll * 0.25 * m.depth) % (height + 40);
        if (y < -20) y += height + 40;

        // Part around the cursor, then drift home.
        const dx = m.x + m.ox - pointer.x;
        const dy = y + m.oy - pointer.y;
        const dist2 = dx * dx + dy * dy;
        const reach = 150;
        if (dist2 < reach * reach && dist2 > 0.01) {
          const dist = Math.sqrt(dist2);
          const push = ((reach - dist) / reach) ** 2 * 3.2 * m.depth;
          m.ox += (dx / dist) * push * dt;
          m.oy += (dy / dist) * push * dt;
        }
        m.ox *= 0.94;
        m.oy *= 0.94;

        const twinkle = 0.55 + 0.45 * Math.sin(now * 0.0016 + m.phase);
        const size = (3 + m.depth * 11) * (0.85 + twinkle * 0.3);
        ctx.globalAlpha = (mode === "dark" ? 0.75 : 0.42) * m.depth * twinkle;
        ctx.drawImage(sprites[m.sprite], m.x + m.ox - size / 2, y + m.oy - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [mode]);

  return <canvas ref={ref} className="motes" />;
}
