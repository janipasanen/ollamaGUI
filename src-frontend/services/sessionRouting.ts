/**
 * Per-Message Provider Selection (G3).
 *
 * Before G3 every conversation shared one app-global model/connection. This
 * module lets a {@link ChatSession} remember the connection it was created with,
 * so switching the app-default model does not hijack an existing conversation's
 * provider.
 *
 * Everything here is pure stateless glue — no React, no side effects — so it
 * can be unit-tested in isolation and reused by both the main send path and
 * sub-agents without drifting.
 */

import type { ChatSession } from './storage';
import type { ConnectedModel, ModelConnection } from './connections';

/** Id of the connection that acts as the app-global default.
 *  A session with no explicit `connectionId` routes here. */
export const DEFAULT_CONNECTION_ID = 'local-ollama';

/**
 * Resolve the connection id a conversation should actually use.
 *
 * - If the session carries its own `connectionId`, that wins.
 * - Otherwise fall back to the default connection (`local-ollama`), or, when
 *   that is absent, the first enabled connection — mirroring the pre-G3
 *   behavior of "the app-global default".
 */
export function getActiveConnectionId(
  session: Pick<ChatSession, 'connectionId'> | null | undefined,
  connections: ModelConnection[],
): string {
  if (session?.connectionId) return session.connectionId;

  const enabled = connections.filter((c) => c.enabled);
  if (enabled.length === 0) return DEFAULT_CONNECTION_ID;

  return enabled.find((c) => c.id === DEFAULT_CONNECTION_ID)?.id ?? enabled[0].id;
}

/**
 * Resolve the actual {@link ModelConnection} for a session.
 * Returns `null` when no enabled connection matches the active id — callers can
 * then fall back to the global default model rather than crashing.
 */
export function resolveConnection(
  session: Pick<ChatSession, 'connectionId'> | null | undefined,
  connections: ModelConnection[],
): ModelConnection | null {
  const id = getActiveConnectionId(session, connections);
  return connections.find((c) => c.id === id && c.enabled) ?? null;
}

/**
 * Derive the connection id that owns a given model id, so changing the model
 * selector for a conversation can follow the model to a different provider.
 *
 * Given the flat `connectedModels` list (each entry carries its `connectionId`),
 * return the owning connection's id when found; otherwise keep the session's
 * active connection.
 */
export function pickConnectionIdForModel(
  session: Pick<ChatSession, 'connectionId'> | null | undefined,
  modelId: string | undefined,
  connections: ModelConnection[],
  connectedModels: Pick<ConnectedModel, 'id' | 'connectionId'>[],
): string {
  if (modelId) {
    const owner = connectedModels.find((m) => m.id === modelId);
    if (owner?.connectionId) return owner.connectionId;
  }
  return getActiveConnectionId(session, connections);
}
