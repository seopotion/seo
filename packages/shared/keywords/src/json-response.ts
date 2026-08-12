/**
 * Parse a JSON body, tolerating a markdown code fence around it. Models wrap
 * their answer in ```json even when asked for raw JSON and told the response
 * format is JSON — measured on claude-haiku-4.5, which returned a complete,
 * correctly-indexed relevance body inside a fence and scored 0 of 340 keywords
 * because JSON.parse choked on the backticks. Stripping it is what makes the
 * per-stage model override usable at all; on an unfenced body it is a no-op
 * (#211).
 */
export function parseJsonResponse(text: string): unknown {
  const body = text
    .trim()
    .replace(/^```(?:json)?[ \t]*\r?\n?/i, '')
    .replace(/\r?\n?[ \t]*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}
