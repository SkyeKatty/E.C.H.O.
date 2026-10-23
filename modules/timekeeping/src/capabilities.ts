import { TIME_CAPABILITIES } from "@echo/time-contract";
import {
  timeDateToolSchema,
  timeNowToolSchema,
  timeTimerCancelToolSchema,
  timeTimerCreateToolSchema,
  timeTimerListToolSchema,
} from "@echo/time-contract";

export const capabilityList = [
  {
    id: TIME_CAPABILITIES.HEALTH_GET,
    name: "Timekeeping health",
    description: "Clock module status",
    version: "1.0.0",
    enabled: false,
    supportsStreaming: false,
    supportsCancellation: false,
  },
  {
    id: TIME_CAPABILITIES.NOW_GET,
    name: "Current time",
    description:
      "Get wall-clock time in an IANA timezone (DST-aware). Response includes localTime/localDateTime — not iso (UTC).",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: timeNowToolSchema,
  },
  {
    id: TIME_CAPABILITIES.DATE_GET,
    name: "Current date",
    description: "Get today's calendar date on the timekeeping module host",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: timeDateToolSchema,
  },
  {
    id: TIME_CAPABILITIES.TIMER_CREATE,
    name: "Set timer",
    description:
      "Schedule a timer with a description; when it fires the persona will speak in the active session. Use mentionUsernames or mentionUserIds (via discord_member_resolve) to @ping someone on Discord when the timer fires.",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: timeTimerCreateToolSchema,
  },
  {
    id: TIME_CAPABILITIES.TIMER_LIST,
    name: "List timers",
    description: "List active timers managed by the timekeeping module",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: timeTimerListToolSchema,
  },
  {
    id: TIME_CAPABILITIES.TIMER_CANCEL,
    name: "Cancel timer",
    description: "Cancel a scheduled timer by id",
    version: "1.0.0",
    enabled: true,
    supportsStreaming: false,
    supportsCancellation: false,
    inputSchema: timeTimerCancelToolSchema,
  },
];
