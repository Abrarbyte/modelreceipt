/**
 * Class-name helper expected by Magic UI components.
 *
 * `clsx` resolves conditionals; `tailwind-merge` drops earlier utilities that a
 * later one overrides, so a caller's className always wins over a component's
 * defaults rather than fighting it on specificity.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
