import assert from "node:assert/strict";
import test from "node:test";

import {
  courseModuleReleaseDeliveryId,
  newlyAccessibleModules,
  releasedModuleList,
} from "@/lib/course-module-release-policy";

const moduleAccess = (
  id: string,
  title: string,
  accessible: boolean,
) => ({ module: { id, title }, access: { accessible } });

test("module release comparison only returns newly accessible modules", () => {
  const released = newlyAccessibleModules(
    [
      moduleAccess("already-open", "Bereits offen", true),
      moduleAccess("newly-open", "Jetzt offen", false),
      moduleAccess("still-closed", "Weiter gesperrt", false),
    ],
    [
      moduleAccess("already-open", "Bereits offen", true),
      moduleAccess("newly-open", "Jetzt offen", true),
      moduleAccess("still-closed", "Weiter gesperrt", false),
      moduleAccess("new-module", "Neu publiziert", true),
    ],
  );

  assert.deepEqual(released, [
    { id: "newly-open", title: "Jetzt offen" },
    { id: "new-module", title: "Neu publiziert" },
  ]);
});

test("a date-window clock change without a publication comparison sends nothing", () => {
  const accessAtLastPublication = [
    moduleAccess("scheduled", "Zeitgesteuertes Modul", true),
  ];

  assert.deepEqual(
    newlyAccessibleModules(
      accessAtLastPublication,
      accessAtLastPublication,
    ),
    [],
  );
});

test("first publication treats accessible modules as released", () => {
  assert.deepEqual(
    newlyAccessibleModules(null, [
      moduleAccess("open", "Offen", true),
      moduleAccess("closed", "Gesperrt", false),
    ]),
    [{ id: "open", title: "Offen" }],
  );
});

test("delivery ids are stable per tenant, version and member", () => {
  const input = {
    organizationId: "10000000-0000-4000-8000-000000000001",
    courseVersionId: "10000000-0000-4000-8000-000000000002",
    userId: "10000000-0000-4000-8000-000000000003",
  };
  const deliveryId = courseModuleReleaseDeliveryId(input);

  assert.equal(courseModuleReleaseDeliveryId(input), deliveryId);
  assert.match(
    deliveryId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.notEqual(
    courseModuleReleaseDeliveryId({
      ...input,
      userId: "10000000-0000-4000-8000-000000000004",
    }),
    deliveryId,
  );
});

test("module lists are bounded and report omitted entries", () => {
  assert.equal(
    releasedModuleList(
      [
        { title: " Modul A " },
        { title: "Modul B" },
        { title: "Modul C" },
      ],
      2,
    ),
    "- Modul A\n- Modul B\n- + 1 weitere Module",
  );
});
