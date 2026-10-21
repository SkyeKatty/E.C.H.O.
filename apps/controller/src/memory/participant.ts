import { participantSchema, type ParticipantRef } from "@echo/memory-contract";

export type { ParticipantRef };

export function parseParticipant(input: unknown): ParticipantRef | undefined {
  const parsed = participantSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}
