/** Quote 15+ digit integers so snowflake IDs are not rounded by JSON.parse. */
export function parseZhihuJson(text: string): unknown {
  const quoted = text.replace(/([\[:,]\s*)(-?\d{15,})(\s*[,\}\]])/g, '$1"$2"$3');
  return JSON.parse(quoted);
}
