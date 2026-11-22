import { useEffect, useRef, useState } from "react";

/**
 * Full right-side chat area reactive emoji effect overlay.
 * Renders 60fps physics particles & subtle ambient glow tailored to every emoji sent or received.
 */
export default function EmojiScreenEffects({ effect, darkMode = false }) {
  const canvasRef = useRef(null);
  const [ambientStyle, setAmbientStyle] = useState(null);
  const [ambientVisible, setAmbientVisible] = useState(false);

  useEffect(() => {
    if (!effect || !effect.emojis?.length) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = parent.clientWidth || 640;
    const height = parent.clientHeight || 480;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Subtle ambient wash across the chat area
    setAmbientStyle(darkMode ? effect.ambientDark : effect.ambientLight);
    setAmbientVisible(true);

    const originX = effect.origin === "incoming" ? width * 0.22 : width * 0.78;
    const originY = height * 0.86;
    const particles = [];
    const total = effect.count || 24;
    const emojis = effect.emojis;
    const sparks = effect.sparks || ["#38bdf8", "#60a5fa"];

    const rand = (min, max) => min + Math.random() * (max - min);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // Create primary emoji particles based on smart motion style
    for (let i = 0; i < total; i++) {
      const emoji = pick(emojis);
      const size = rand(20, 38);
      const delay = rand(0, 420);
      const life = rand(effect.durationMs * 0.65, effect.durationMs);

      let x = rand(width * 0.08, width * 0.92);
      let y = height + rand(10, 60);
      let vx = rand(-0.6, 0.6);
      let vy = rand(-3.4, -1.8);
      let gravity = -0.01;
      let swayAmp = rand(0.4, 1.4);
      let swayFreq = rand(0.002, 0.005);
      let rotation = rand(-0.25, 0.25);
      let vr = rand(-0.02, 0.02);
      let bounce = false;

      switch (effect.motion) {
        case "floatUp":
          x = rand(width * 0.08, width * 0.92);
          y = height + rand(0, 70);
          vy = rand(-2.8, -1.4);
          vx = rand(-0.4, 0.4);
          gravity = -0.015;
          swayAmp = rand(0.8, 1.8);
          break;

        case "confettiBurst":
          x = i % 2 === 0 ? width * 0.15 : width * 0.85;
          y = height * 0.92;
          vx = (i % 2 === 0 ? 1 : -1) * rand(2.2, 6.8) + rand(-1.5, 1.5);
          vy = rand(-11.5, -6.2);
          gravity = 0.2;
          vr = rand(-0.08, 0.08);
          swayAmp = 0.3;
          break;

        case "bouncyPop":
          x = originX + rand(-width * 0.32, width * 0.32);
          x = Math.max(36, Math.min(width - 36, x));
          y = height - rand(10, 40);
          vx = rand(-2.8, 2.8);
          vy = rand(-9.5, -5.2);
          gravity = 0.24;
          bounce = true;
          vr = rand(-0.06, 0.06);
          break;

        case "rocketRise":
          x = originX + rand(-width * 0.35, width * 0.35);
          x = Math.max(30, Math.min(width - 30, x));
          y = height + rand(0, 40);
          vx = rand(-1.2, 1.2);
          vy = rand(-7.2, -3.6);
          gravity = -0.06;
          swayAmp = rand(0.2, 0.6);
          break;

        case "rainFall":
          x = rand(width * 0.04, width * 0.96);
          y = -rand(20, 140);
          vx = rand(-0.4, 0.4);
          vy = rand(3.2, 6.2);
          gravity = 0.05;
          swayAmp = 0.15;
          rotation = 0;
          vr = 0;
          break;

        case "snowDrift":
          x = rand(width * 0.02, width * 0.98);
          y = -rand(20, 120);
          vx = rand(-0.6, 0.8);
          vy = rand(1.1, 2.5);
          gravity = 0.005;
          swayAmp = rand(0.9, 2.0);
          vr = rand(-0.02, 0.02);
          break;

        case "radialShock": {
          const angle = (Math.PI * 2 * i) / total + rand(-0.2, 0.2);
          const speed = rand(3.2, 7.6);
          x = originX;
          y = height * 0.62;
          vx = Math.cos(angle) * speed;
          vy = Math.sin(angle) * speed - 1.2;
          gravity = 0.08;
          vr = rand(-0.09, 0.09);
          break;
        }

        case "starOrbit": {
          const angle = rand(-Math.PI * 0.92, -Math.PI * 0.08);
          const speed = rand(3.2, 7.4);
          x = originX + rand(-40, 40);
          y = originY;
          vx = Math.cos(angle) * speed;
          vy = Math.sin(angle) * speed;
          gravity = 0.06;
          swayAmp = 0.5;
          break;
        }

        case "dreamyDrift":
          x = rand(width * 0.1, width * 0.9);
          y = height * rand(0.55, 1.02);
          vx = rand(-0.4, 0.4);
          vy = rand(-1.3, -0.6);
          gravity = -0.005;
          swayAmp = rand(0.6, 1.4);
          break;

        case "waveDance":
          x = rand(width * 0.08, width * 0.92);
          y = height + rand(0, 60);
          vx = rand(-0.5, 0.5);
          vy = rand(-3.0, -1.6);
          gravity = 0;
          swayAmp = rand(1.6, 2.8);
          swayFreq = rand(0.005, 0.009);
          break;

        case "petalGlide":
          x = rand(width * 0.05, width * 0.95);
          y = -rand(10, 90);
          vx = rand(-1.1, 1.4);
          vy = rand(1.4, 2.9);
          gravity = 0.01;
          swayAmp = rand(1.2, 2.4);
          vr = rand(-0.035, 0.035);
          break;

        default: {
          // Universal Smart Cascade — bursts cleanly from sender side across the chat canvas
          const spreadAngle =
            effect.origin === "incoming"
              ? rand(-Math.PI * 0.48, -Math.PI * 0.08)
              : rand(-Math.PI * 0.92, -Math.PI * 0.52);
          const speed = rand(4.0, 9.2);
          x = originX + rand(-24, 24);
          y = originY;
          vx = Math.cos(spreadAngle) * speed;
          vy = Math.sin(spreadAngle) * speed;
          gravity = 0.14;
          vr = rand(-0.04, 0.04);
          break;
        }
      }

      particles.push({
        kind: "emoji",
        emoji,
        x,
        y,
        vx,
        vy,
        gravity,
        size,
        rotation,
        vr,
        swayAmp,
        swayFreq,
        phase: rand(0, Math.PI * 2),
        delay,
        life,
        bounce,
      });
    }

    // Add crisp ambient micro-sparks / confetti ribbons / raindrops for extra richness
    const sparkCount = effect.motion === "confettiBurst" ? 42 : effect.motion === "rainFall" ? 32 : 20;
    for (let i = 0; i < sparkCount; i++) {
      const isRain = effect.motion === "rainFall";
      const isConfetti = effect.motion === "confettiBurst";
      particles.push({
        kind: isRain ? "raindrop" : isConfetti ? "ribbon" : "spark",
        color: pick(sparks),
        x: isRain
          ? rand(0, width)
          : isConfetti
          ? i % 2 === 0
            ? width * 0.15
            : width * 0.85
          : originX + rand(-width * 0.35, width * 0.35),
        y: isRain ? -rand(0, 120) : isConfetti ? height * 0.92 : height * rand(0.35, 0.95),
        vx: isRain
          ? rand(-0.3, 0.3)
          : isConfetti
          ? (i % 2 === 0 ? 1 : -1) * rand(2, 8)
          : rand(-2.2, 2.2),
        vy: isRain ? rand(7, 12) : isConfetti ? rand(-12, -5.5) : rand(-4.5, -1.2),
        gravity: isRain ? 0.08 : isConfetti ? 0.22 : 0.05,
        size: isConfetti ? rand(6, 11) : rand(2.5, 5.5),
        rotation: rand(0, Math.PI * 2),
        vr: rand(-0.15, 0.15),
        delay: rand(0, 350),
        life: rand(effect.durationMs * 0.55, effect.durationMs * 0.95),
      });
    }

    const startTime = performance.now();
    let rafId = null;

    const render = (now) => {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, width, height);

      let anyAlive = false;

      for (const p of particles) {
        const localT = elapsed - p.delay;
        if (localT < 0) {
          anyAlive = true;
          continue;
        }
        const progress = localT / p.life;
        if (progress >= 1) continue;
        anyAlive = true;

        p.vy += p.gravity;
        p.x += p.vx + (p.swayAmp ? Math.sin(localT * p.swayFreq + p.phase) * p.swayAmp : 0);
        p.y += p.vy;
        p.rotation += p.vr || 0;

        if (p.bounce && p.y > height - 24 && p.vy > 0) {
          p.y = height - 24;
          p.vy = -p.vy * 0.55;
          p.vx *= 0.86;
        }

        // Smooth pop-in and fade-out curve
        const fadeIn = Math.min(1, progress / 0.14);
        const fadeOut = progress > 0.68 ? Math.max(0, 1 - (progress - 0.68) / 0.32) : 1;
        const alpha = fadeIn * fadeOut;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        if (p.kind === "emoji") {
          const scale = 0.65 + 0.35 * Math.sin(Math.min(1, progress / 0.22) * (Math.PI / 2));
          ctx.scale(scale, scale);
          ctx.font = `${p.size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(p.emoji, 0, 0);
        } else if (p.kind === "raindrop") {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(0, -8);
          ctx.lineTo(0, 8);
          ctx.stroke();
        } else if (p.kind === "ribbon") {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size * 0.45);
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }

      if (anyAlive && elapsed < effect.durationMs + 500) {
        rafId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };

    rafId = requestAnimationFrame(render);

    const ambientFadeTimer = setTimeout(() => {
      setAmbientVisible(false);
    }, Math.max(900, effect.durationMs * 0.6));

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(ambientFadeTimer);
      ctx.clearRect(0, 0, width, height);
    };
  }, [effect, darkMode]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
      <div
        style={{ background: ambientStyle || "none" }}
        className={`absolute inset-0 transition-opacity duration-700 ${
          ambientVisible ? "opacity-100" : "opacity-0"
        }`}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
