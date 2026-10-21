import { createHash } from "node:crypto";

export function discordConnectionFingerprint(cfg: {
  enabled: boolean;
  botToken?: string;
  mentionsOnlyMode?: boolean;
}): string {
  return createHash("sha256")
    .update(
      [cfg.enabled ? "1" : "0", cfg.botToken ?? "", cfg.mentionsOnlyMode ? "1" : "0"].join("\0"),
    )
    .digest("hex");
}
