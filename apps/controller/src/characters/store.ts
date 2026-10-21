import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findMonorepoRoot } from "@echo/llm";
import type { PersonaDefinition } from "../persona/definition.js";
import {
  activeCharacterSchema,
  characterCardInputSchema,
  characterCardSchema,
  characterCardUpdateSchema,
  type CharacterCard,
  type CharacterCardInput,
  type CharacterCardSummary,
} from "./schema.js";

export class CharacterCardStore {
  private readonly charactersDir: string;
  private readonly activePath: string;

  constructor(dataRoot?: string) {
    const root = dataRoot ?? resolve(findMonorepoRoot(process.cwd()), "data");
    this.charactersDir = resolve(root, "characters");
    this.activePath = resolve(root, "active-character.json");
    mkdirSync(this.charactersDir, { recursive: true });
  }

  cardPath(id: string): string {
    return resolve(this.charactersDir, `${id}.json`);
  }

  assetsDir(id: string): string {
    return resolve(this.charactersDir, id, "assets");
  }

  ensureSeeded(fallback: PersonaDefinition): CharacterCard {
    const cards = this.list();
    if (cards.length === 0) {
      const card = this.create({
        name: fallback.name,
        summary: fallback.identity,
        speechStyle: fallback.communicationStyle,
        behavioralRules: "Stay consistent with this character in all responses.",
      });
      this.setActive(card.id);
      return card;
    }
    const active = this.getActiveId();
    if (active) {
      const found = this.get(active);
      if (found) return found;
    }
    const first = this.get(cards[0]!.id);
    if (first) this.setActive(first.id);
    return first!;
  }

  list(): CharacterCardSummary[] {
    if (!existsSync(this.charactersDir)) return [];
    const files = readdirSync(this.charactersDir).filter((f) => f.endsWith(".json"));
    const summaries: CharacterCardSummary[] = [];
    for (const file of files) {
      try {
        const card = this.readCardFile(resolve(this.charactersDir, file));
        summaries.push({
          id: card.id,
          name: card.name,
          tagline: card.tagline,
          updatedAt: card.updatedAt,
        });
      } catch {
        // skip corrupt file
      }
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): CharacterCard | null {
    const path = this.cardPath(id);
    if (!existsSync(path)) return null;
    return this.readCardFile(path);
  }

  getActiveId(): string | null {
    if (!existsSync(this.activePath)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.activePath, "utf8")) as unknown;
      return activeCharacterSchema.parse(raw).activeCharacterId;
    } catch {
      return null;
    }
  }

  getActive(): CharacterCard | null {
    const id = this.getActiveId();
    return id ? this.get(id) : null;
  }

  setActive(id: string | null): CharacterCard | null {
    if (id !== null && !this.get(id)) {
      throw new Error(`Character card not found: ${id}`);
    }
    writeFileSync(
      this.activePath,
      JSON.stringify(activeCharacterSchema.parse({ activeCharacterId: id }), null, 2),
      "utf8",
    );
    return id ? this.get(id) : null;
  }

  create(input: CharacterCardInput): CharacterCard {
    const parsed = characterCardInputSchema.parse(input);
    const now = new Date().toISOString();
    const card = characterCardSchema.parse({
      id: crypto.randomUUID(),
      referenceImages: [],
      ...parsed,
      createdAt: now,
      updatedAt: now,
    });
    this.writeCard(card);
    mkdirSync(this.assetsDir(card.id), { recursive: true });
    return card;
  }

  update(id: string, patch: unknown): CharacterCard {
    const existing = this.get(id);
    if (!existing) throw new Error(`Character card not found: ${id}`);
    const parsed = characterCardUpdateSchema.parse(patch);
    const updated = characterCardSchema.parse({
      ...existing,
      ...parsed,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.writeCard(updated);
    return updated;
  }

  delete(id: string): void {
    const path = this.cardPath(id);
    if (!existsSync(path)) throw new Error(`Character card not found: ${id}`);
    rmSync(path);
    const assetDir = resolve(this.charactersDir, id);
    if (existsSync(assetDir)) rmSync(assetDir, { recursive: true, force: true });
    if (this.getActiveId() === id) this.setActive(null);
  }

  private readCardFile(path: string): CharacterCard {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return characterCardSchema.parse(raw);
  }

  private writeCard(card: CharacterCard): void {
    mkdirSync(dirname(this.cardPath(card.id)), { recursive: true });
    writeFileSync(this.cardPath(card.id), JSON.stringify(card, null, 2), "utf8");
  }
}
