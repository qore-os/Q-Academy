import assert from "node:assert/strict";
import test from "node:test";

import { renderPrometheusExposition } from "../src/lib/prometheus-exposition";

test("Prometheus exposition emits metadata once and escapes fixed labels", () => {
  const rendered = renderPrometheusExposition([
    {
      name: "q_academy_queue_depth",
      help: "Queue depth.",
      type: "gauge",
      labels: { queue: 'email\\primary"\n' },
      value: 12,
    },
    {
      name: "q_academy_queue_depth",
      help: "Queue depth.",
      type: "gauge",
      labels: { queue: "webhook" },
      value: Number.NaN,
    },
  ]);

  assert.equal(
    rendered.match(/^# HELP q_academy_queue_depth /gm)?.length,
    1,
  );
  assert.match(rendered, /queue="email\\\\primary\\"\\n"} 12/);
  assert.match(rendered, /queue="webhook"} 0/);
  assert.ok(rendered.endsWith("\n"));
});

test("Prometheus exposition rejects invalid metric and label names", () => {
  assert.throws(
    () =>
      renderPrometheusExposition([
        {
          name: "invalid metric",
          help: "Invalid.",
          type: "gauge",
          value: 1,
        },
      ]),
    /Invalid metric name/,
  );
  assert.throws(
    () =>
      renderPrometheusExposition([
        {
          name: "valid_metric",
          help: "Invalid label.",
          type: "gauge",
          labels: { "invalid-label": "value" },
          value: 1,
        },
      ]),
    /Invalid metric label name/,
  );
});
