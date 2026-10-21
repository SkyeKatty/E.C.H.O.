/** Stable capability ids for the memory module (protocol v1). */
export const MEMORY_CAPABILITIES = {
  HEALTH_GET: "memory.health.get",
  CONVERSATION_APPEND: "memory.conversation.append",
  CONVERSATION_LIST: "memory.conversation.list",
  CONVERSATION_COMPACTION_STATE: "memory.conversation.compaction-state",
  CONTEXT_RETRIEVE: "memory.context.retrieve",
  EPISODE_RECORD: "memory.episode.record",
  SEARCH: "memory.search",
  GET: "memory.get",
  PROPOSE: "memory.propose",
  UPDATE: "memory.update",
  DELETE: "memory.delete",
  JOB_LIST: "memory.job.list",
} as const;

export type MemoryCapabilityId = (typeof MEMORY_CAPABILITIES)[keyof typeof MEMORY_CAPABILITIES];
