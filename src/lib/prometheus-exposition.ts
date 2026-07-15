export type PrometheusSample = {
  name: string;
  help: string;
  type: "gauge";
  labels?: Readonly<Record<string, string>>;
  value: number;
};

const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function escapeLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function finiteMetricValue(value: number) {
  return Number.isFinite(value) ? value : 0;
}

export function renderPrometheusExposition(samples: readonly PrometheusSample[]) {
  const metadata = new Set<string>();
  const lines: string[] = [];

  for (const sample of samples) {
    if (!METRIC_NAME.test(sample.name)) throw new Error("Invalid metric name.");
    if (!metadata.has(sample.name)) {
      lines.push(`# HELP ${sample.name} ${sample.help.replace(/[\r\n]+/g, " ")}`);
      lines.push(`# TYPE ${sample.name} ${sample.type}`);
      metadata.add(sample.name);
    }
    const labels = Object.entries(sample.labels ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (labels.some(([name]) => !LABEL_NAME.test(name))) {
      throw new Error("Invalid metric label name.");
    }
    const renderedLabels = labels.length
      ? `{${labels.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(",")}}`
      : "";
    lines.push(`${sample.name}${renderedLabels} ${finiteMetricValue(sample.value)}`);
  }

  return `${lines.join("\n")}\n`;
}
