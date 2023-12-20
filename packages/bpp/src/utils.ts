function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object"
}

export function isObjectWithKey<T extends string>(
  value: unknown,
  key: T
): value is Record<T, unknown> {
  return isObject(value) && key in value
}
