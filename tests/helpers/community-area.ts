import type { Sql } from "postgres";

type CommunityAreaFixture = {
  id: string;
  nextSpaceSortOrder: number;
};

export async function ensureCommunityAreaFixture(
  sql: Sql,
  organizationId: string,
): Promise<CommunityAreaFixture> {
  let [area] = await sql<Array<{ id: string }>>`
    select id
    from community_areas
    where organization_id = ${organizationId}
    order by sort_order, id
    limit 1
  `;

  if (!area) {
    [area] = await sql<Array<{ id: string }>>`
      insert into community_areas (
        organization_id, title, slug, sort_order
      ) values (
        ${organizationId}, 'Allgemein', 'allgemein', 0
      )
      returning id
    `;
  }

  const [spacePosition] = await sql<Array<{ sortOrder: number }>>`
    select (coalesce(max(sort_order), -1) + 1)::int as "sortOrder"
    from community_spaces
    where organization_id = ${organizationId}
      and area_id = ${area.id}
  `;

  return {
    id: area.id,
    nextSpaceSortOrder: spacePosition.sortOrder,
  };
}
