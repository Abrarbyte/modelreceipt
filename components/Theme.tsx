"use client";

/**
 * Theme mode: light / dark / system.
 *
 * Follows the reference's ThemeModeProvider. An explicit choice stamps
 * data-theme on <html> and persists to localStorage("theme"); "system" removes
 * the attribute and lets prefers-color-scheme decide. The CSS in theme.css is
 * written so both paths resolve to the same tokens.
 *
 * The tiny inline script in layout.tsx applies the stored choice before first
 * paint, so there is no flash of the wrong mode.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  resolved: "light",
  setMode: () => {},
});

function readStored(): ThemeMode {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setModeState(readStored());
    setSystemDark(systemPrefersDark());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      /* private mode, fine */
    }
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  }, []);

  const resolved: "light" | "dark" = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const options: Array<{ id: ThemeMode; label: string; title: string }> = [
    { id: "light", label: "☀", title: "Light" },
    { id: "system", label: "◐", title: "Follow system" },
    { id: "dark", label: "☾", title: "Dark" },
  ];
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {options.map((o) => (
        <button
          key={o.id}
          className={mode === o.id ? "on" : ""}
          onClick={() => setMode(o.id)}
          title={o.title}
          aria-pressed={mode === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Applied before hydration so the first paint is already the right mode.
 * A `?theme=light|dark` query wins over storage and is persisted, so a link can
 * be shared in a specific mode.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("theme");if(q==="light"||q==="dark"){localStorage.setItem("theme",q);}var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;
