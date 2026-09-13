"use client";

/**
 * Viewport-entry primitives, after the reference's useHasEnteredViewport and
 * ScrambleText.
 *
 * `useInView` is an IntersectionObserver that fires once by default.
 * `Reveal` fades and lifts its children on entry, using the site's ease-66.
 * `Scramble` flips characters through random glyphs, tinted in the accent, then
 * settles left-to-right - one shared 40 ms ticker drives every instance so a
 * page full of headings costs one interval, not one per heading.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export function useInView<T extends HTMLElement>({
  once = true,
  threshold = 0.1,
  rootMargin,
}: { once?: boolean; threshold?: number; rootMargin?: string } = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || (once && inView)) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, inView, threshold, rootMargin]);

  return { ref, inView };
}

export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.12 });
  return (
    <Tag
      ref={ref as never}
      className={`reveal${inView ? " in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

// ---------- scramble ----------

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*+-=?/<>[]{}";
const rand = () => CHARSET[Math.floor(Math.random() * CHARSET.length)];

const listeners = new Set<(t: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(fn: (t: number) => void) {
  listeners.add(fn);
  timer ??= setInterval(() => {
    const t = performance.now();
    listeners.forEach((l) => l(t));
  }, 40);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function Scramble({
  text,
  startDelayMs = 0,
  letterDelayMs = 45,
  className = "",
}: {
  text: string;
  startDelayMs?: number;
  letterDelayMs?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>({ threshold: 0.1 });
  const [now, setNow] = useState(0);
  const [done, setDone] = useState(false);
  const start = useRef(0);
  const reduced = useRef(false);

  const half = 2 * letterDelayMs;
  const window_ = 2 * half;
  const total = startDelayMs + (text.length - 1) * letterDelayMs + window_;

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) setDone(true);
  }, []);

  useEffect(() => {
    if (!inView || done) return;
    start.current = performance.now();
    return subscribe((t) => {
      setNow(t);
      if (t - start.current >= total) setDone(true);
    });
  }, [inView, done, total]);

  if (done || !inView) {
    return (
      <span ref={ref} className={`scramble ${className}`}>
        {done ? text : text.split("").map((ch, i) => <span key={i} className="sc pending">{ch}</span>)}
      </span>
    );
  }

  const elapsed = Math.max(0, now - (start.current + startDelayMs));
  return (
    <span ref={ref} className={`scramble ${className}`} aria-label={text}>
      {text.split("").map((ch, i) => {
        if (ch === " ") return <span key={i}> </span>;
        const begin = i * letterDelayMs;
        const end = begin + window_;
        if (elapsed < begin) return <span key={i} className="sc pending">{ch}</span>;
        if (elapsed < end) {
          const phase = Math.min(1, Math.floor((elapsed - begin) / half));
          return (
            <span key={i} className={`sc ${phase === 0 ? "hot" : "warm"}`} aria-hidden>
              {rand()}
            </span>
          );
        }
        return <span key={i} className="sc">{ch}</span>;
      })}
    </span>
  );
}
