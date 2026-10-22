import { generateDependencyReport } from "@discordjs/voice";
import sodium from "libsodium-wrappers";

/** Required for voice UDP encryption; without it connections often stall in Signalling. */
await sodium.ready;

const report = generateDependencyReport();
if (process.env.DISCORD_VOICE_DEBUG) {
  console.log("[discord/voice] dependency report:\n", report);
} else if (!/libsodium|sodium-native/i.test(report)) {
  console.warn(
    "[discord/voice] no sodium library detected — voice may fail to connect. Install libsodium-wrappers or sodium-native.",
  );
}
