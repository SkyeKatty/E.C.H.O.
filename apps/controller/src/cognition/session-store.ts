import type { ChatMessage } from "@echo/llm";

export type ChatSession = {
  id: string;
  createdAt: string;
  messages: ChatMessage[];
};

export class SessionStore {
  private sessions = new Map<string, ChatSession>();
  private readonly maxMessages: number;

  constructor(maxMessages = 80) {
    this.maxMessages = maxMessages;
  }

  getOrCreate(sessionId?: string): ChatSession {
    if (sessionId && this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    const session: ChatSession = {
      id: sessionId ?? crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      messages: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  append(sessionId: string, ...messages: ChatMessage[]): void {
    const session = this.getOrCreate(sessionId);
    session.messages.push(...messages);
    if (session.messages.length > this.maxMessages) {
      session.messages.splice(0, session.messages.length - this.maxMessages);
    }
  }

  history(sessionId: string): ChatMessage[] {
    return [...this.getOrCreate(sessionId).messages];
  }

  replaceHistory(sessionId: string, messages: ChatMessage[]): void {
    const session = this.getOrCreate(sessionId);
    session.messages = [...messages];
    if (session.messages.length > this.maxMessages) {
      session.messages.splice(0, session.messages.length - this.maxMessages);
    }
  }

  isEmpty(sessionId: string): boolean {
    return this.getOrCreate(sessionId).messages.length === 0;
  }
}
