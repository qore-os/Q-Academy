function splitOutsideQuotes(value: string, separator: "," | ";") {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  if (quoted || escaped) return null;
  parts.push(value.slice(start));
  return parts;
}

function acceptedQuality(parameters: readonly string[]) {
  let quality = 1;
  let qualitySeen = false;

  for (const parameter of parameters) {
    const separator = parameter.indexOf("=");
    if (separator < 0) continue;
    const name = parameter.slice(0, separator).trim().toLowerCase();
    if (name !== "q") continue;
    if (qualitySeen) return 0;
    qualitySeen = true;
    const value = parameter.slice(separator + 1).trim();
    if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value)) return 0;
    quality = Number(value);
  }

  return quality;
}

export function explicitlyAcceptsJson(value: string | null | undefined) {
  if (!value) return false;
  const ranges = splitOutsideQuotes(value, ",");
  if (!ranges) return false;

  return ranges.some((range) => {
    const segments = splitOutsideQuotes(range, ";");
    if (!segments) return false;
    const [mediaType = "", ...parameters] = segments;
    return (
      mediaType.trim().toLowerCase() === "application/json" &&
      acceptedQuality(parameters) > 0
    );
  });
}
