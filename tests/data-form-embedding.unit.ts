import assert from "node:assert/strict";
import test from "node:test";

import type { HubLayout } from "../src/db/schema";
import {
  hubLayoutFormIds,
  hubLayoutTransitionFormIds,
} from "../src/lib/data-form-embedding-policy";

const firstFormId = "10000000-0000-4000-8000-000000000001";
const secondFormId = "20000000-0000-4000-8000-000000000002";

function layout(...formIds: string[]): HubLayout {
  return [
    {
      id: "row",
      columns: formIds.map((formId, index) => ({
        type: "data_form" as const,
        title: `Formular ${index + 1}`,
        description: "",
        color: "#2bb7a9",
        formId,
      })),
    },
  ];
}

test("hub form transitions lock removed and newly embedded forms", () => {
  assert.deepEqual(hubLayoutFormIds(layout(firstFormId, firstFormId)), [
    firstFormId,
  ]);
  assert.deepEqual(
    hubLayoutTransitionFormIds(
      layout(firstFormId),
      layout(secondFormId),
    ),
    [firstFormId, secondFormId],
  );
  assert.deepEqual(hubLayoutTransitionFormIds(layout(firstFormId), []), [
    firstFormId,
  ]);
});
