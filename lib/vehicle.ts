/**
 * An autonomous-vehicle trip, as evidence.
 *
 * THE PROBLEM THIS MODELS
 * -----------------------
 * When a self-driving car crashes, the questions are: which driving model was
 * in control? Was it updated recently, and who approved that? Did the driver
 * override? What did the sensors see? Today every one of those answers lives
 * in logs the manufacturer controls - and the manufacturer is a party to the
 * dispute. The conflict of interest is the whole problem.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT
 * ----------------------------------
 * The driving policy below is deterministic and deliberately simple. Real
 * perception stacks are neural networks running on in-car silicon, not LLMs,
 * so dressing a chat model up as one would be theatre. What this demonstrates
 * is the EVIDENCE SHAPE: each decision sealed with the exact policy version,
 * every decision in a trip chained under one execution id, and any change to
 * the policy sealed as a governed change with named approvers - before the
 * trip, not reconstructed after the crash.
 *
 * Volume is handled the way it would have to be in production: seal EVENTS -
 * hazards, interventions, overrides, collision windows - not every frame at
 * 30 Hz. The receipt for a routine cruise segment covers a window, not a tick.
 */

export interface SensorFrame {
  t_ms: number;
  speed_kph: number;
  lane: string;
  obstacle: null | { type: string; distance_m: number; closing_kph: number };
  weather: "clear" | "rain" | "fog";
  driver_hands_on: boolean;
  driver_input: null | "brake" | "steer" | "accelerate";
}

export interface DrivingDecision {
  action: "CONTINUE" | "SLOW" | "BRAKE_HARD" | "STEER_AVOID" | "HAND_OVER" | "YIELD_TO_DRIVER";
  target_speed_kph: number;
  reason: string;
  /** True when the human's input took precedence over the policy. */
  driver_override: boolean;
}

export const POLICY = {
  name: "drive-policy",
  /** Bumped by the OTA update the demo can seal before a trip. */
  versions: { current: "4.3.1", previous: "4.2.9" },
};

/**
 * The driving policy. Deliberately legible: a judge should be able to read it
 * and agree that the decision followed from the frame.
 */
export function decide(frame: SensorFrame): DrivingDecision {
  if (frame.driver_input) {
    return {
      action: "YIELD_TO_DRIVER",
      target_speed_kph: frame.driver_input === "brake" ? Math.max(0, frame.speed_kph - 30) : frame.speed_kph,
      reason: `Driver applied ${frame.driver_input}; manual input takes precedence.`,
      driver_override: true,
    };
  }
  if (frame.obstacle) {
    const ttc = frame.obstacle.closing_kph > 0
      ? frame.obstacle.distance_m / (frame.obstacle.closing_kph / 3.6)
      : Infinity;
    if (ttc < 1.5) {
      return { action: "BRAKE_HARD", target_speed_kph: 0, reason: `${frame.obstacle.type} at ${frame.obstacle.distance_m} m, time-to-collision ${ttc.toFixed(1)} s.`, driver_override: false };
    }
    if (ttc < 4) {
      return { action: "SLOW", target_speed_kph: Math.max(20, frame.speed_kph - 25), reason: `${frame.obstacle.type} ahead, time-to-collision ${ttc.toFixed(1)} s.`, driver_override: false };
    }
  }
  if (frame.weather === "fog" && frame.speed_kph > 60) {
    return { action: "SLOW", target_speed_kph: 60, reason: "Fog: capping speed at 60 kph.", driver_override: false };
  }
  if (!frame.driver_hands_on && frame.speed_kph > 100) {
    return { action: "HAND_OVER", target_speed_kph: frame.speed_kph, reason: "Hands-off above 100 kph: requesting driver takeover.", driver_override: false };
  }
  return { action: "CONTINUE", target_speed_kph: frame.speed_kph, reason: "No hazards; maintaining speed.", driver_override: false };
}

/** A trip with a hazard, an override, and a collision window - the interesting case. */
export const SAMPLE_TRIP: SensorFrame[] = [
  { t_ms: 0,     speed_kph: 88,  lane: "L2", obstacle: null, weather: "rain", driver_hands_on: true,  driver_input: null },
  { t_ms: 4200,  speed_kph: 90,  lane: "L2", obstacle: { type: "vehicle", distance_m: 62, closing_kph: 30 }, weather: "rain", driver_hands_on: true, driver_input: null },
  { t_ms: 6100,  speed_kph: 71,  lane: "L2", obstacle: { type: "vehicle", distance_m: 18, closing_kph: 55 }, weather: "rain", driver_hands_on: true, driver_input: null },
  { t_ms: 6900,  speed_kph: 40,  lane: "L2", obstacle: { type: "vehicle", distance_m: 9,  closing_kph: 20 }, weather: "rain", driver_hands_on: true, driver_input: "steer" },
  { t_ms: 7400,  speed_kph: 38,  lane: "L1", obstacle: { type: "barrier", distance_m: 3,  closing_kph: 38 }, weather: "rain", driver_hands_on: true, driver_input: null },
  { t_ms: 9000,  speed_kph: 0,   lane: "L1", obstacle: null, weather: "rain", driver_hands_on: true,  driver_input: null },
];

export const FRAME_LABELS: Record<keyof SensorFrame, string> = {
  t_ms: "t (ms)",
  speed_kph: "speed",
  lane: "lane",
  obstacle: "obstacle",
  weather: "weather",
  driver_hands_on: "hands on",
  driver_input: "driver input",
};
