import type {
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ModelCapabilities,
  StreamEvent,
} from "./types.js";

/** Same provider credentials, different model id per request (OpenRouter task routing). */
export class ModelOverrideProvider implements LLMProvider {
  constructor(
    private readonly base: LLMProvider,
    private readonly overrideModel: string,
  ) {}

  get id(): string {
    return this.base.id;
  }

  get label(): string {
    return this.base.label;
  }

  get model(): string {
    return this.overrideModel;
  }

  getCapabilities(): ModelCapabilities {
    return this.base.getCapabilities();
  }

  complete(request: CompletionRequest): Promise<CompletionResult> {
    return this.base.complete({ ...request, model: request.model ?? this.overrideModel });
  }

  async *stream(request: CompletionRequest): AsyncGenerator<StreamEvent, void, undefined> {
    yield* this.base.stream({ ...request, model: request.model ?? this.overrideModel });
  }
}
