import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 1, prepare: false });

after(() => sql.end());

test("event calendar settings and IANA time zones are tenant-bound and constrained", async () => {
  const suffix = `${Date.now()}-${randomUUID()}`;
  const [organization] = await sql<Array<{ id: string }>>`
    insert into organizations (name, slug)
    values (${`Event calendar ${suffix}`}, ${`event-calendar-${suffix}`})
    returning id
  `;
  try {
    const [event] = await sql<Array<{ id: string; timezone: string }>>`
      insert into events (
        organization_id, title, starts_at, ends_at, timezone
      ) values (
        ${organization.id}, 'Global workshop',
        '2031-07-14T14:00:00Z', '2031-07-14T16:00:00Z',
        'America/New_York'
      )
      returning id, timezone
    `;
    assert.equal(event.timezone, "America/New_York");

    const [theme] = await sql<
      Array<{ organization_id: string; density: string; card_radius: number }>
    >`
      insert into event_calendar_settings (
        organization_id, accent_color, density, card_radius
      ) values (${organization.id}, '#167e74', 'compact', 4)
      returning organization_id, density, card_radius
    `;
    assert.deepEqual(theme, {
      organization_id: organization.id,
      density: "compact",
      card_radius: 4,
    });

    await assert.rejects(
      sql`
        update event_calendar_settings set card_radius = 12
        where organization_id = ${organization.id}
      `,
      /event_calendar_settings_radius_check/,
    );
    await assert.rejects(
      sql`
        update events set timezone = 'not a timezone'
        where id = ${event.id}
      `,
      /events_timezone_check/,
    );
  } finally {
    await sql`delete from organizations where id = ${organization.id}`;
  }
});
