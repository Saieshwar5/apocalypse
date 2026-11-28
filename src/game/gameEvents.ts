import type { ReputationEvent } from '../logic/reputation';

export type GameEvent = ReputationEvent;

/**
 * A small notice board for things that happen in many places but matter to
 * one system: contracts, satellite jobs, friendly fire and debris all post
 * here, and the licence listens.
 */
export class GameEvents {
  private readonly listeners: ((event: GameEvent) => void)[] = [];

  on(listener: (event: GameEvent) => void): void {
    this.listeners.push(listener);
  }

  emit(event: GameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
