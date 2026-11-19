import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export async function audit(
  db: Queryable,
  event: {
    actorUserId: string | null;
    eventType: string;
    objectType?: string | null;
    objectId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (actor_user_id, event_type, object_type, object_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      event.actorUserId,
      event.eventType,
      event.objectType ?? null,
      event.objectId ?? null,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}
