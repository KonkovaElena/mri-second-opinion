export function nowIso() {
  return new Date().toISOString();
}

export function missingRequiredSequences(sequenceInventory: string[]) {
  return sequenceInventory.includes("T1w") ? [] : ["T1w"];
}