/** Parse a JSON object from LLM text, tolerating an optional ``` fence wrapper. */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1]! : text);
}
