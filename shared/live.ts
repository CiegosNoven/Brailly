import type { DomBlock, PageSnapshot } from "./dom";

export function blockSignature(block: DomBlock) {
  return JSON.stringify([
    block.id,
    block.text,
    block.tag,
    block.href,
    block.role,
    block.region,
    block.context,
    block.live,
  ]);
}

export function snapshotSignature(page: PageSnapshot) {
  return page.blocks.map(blockSignature).sort().join("\n");
}

export function onlyCountdownTicks(previous: PageSnapshot, next: PageSnapshot) {
  if (previous.blocks.length !== next.blocks.length) return false;
  const before = new Map(previous.blocks.map((block) => [block.id, block]));
  let ticked = false;
  const seconds = (value: string) => {
    const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
    return match
      ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      : null;
  };
  for (const block of next.blocks) {
    const old = before.get(block.id);
    if (!old) return false;
    if (blockSignature(old) === blockSignature(block)) continue;
    if (old.live !== "timer" || block.live !== "timer") return false;
    if (blockSignature({ ...old, text: block.text }) !== blockSignature(block))
      return false;
    const from = seconds(old.text),
      to = seconds(block.text);
    // Expiry and minute boundaries still reach Jev; ordinary second ticks do not.
    if (
      from === null ||
      to === null ||
      to <= 0 ||
      from <= to ||
      from - to > 10 ||
      Math.ceil(from / 60) !== Math.ceil(to / 60)
    )
      return false;
    ticked = true;
  }
  return ticked;
}

export function sourceChanges(previous: PageSnapshot, next: PageSnapshot) {
  const before = new Map(previous.blocks.map((block) => [block.id, block]));
  const after = new Map(next.blocks.map((block) => [block.id, block]));
  return {
    changed: next.blocks.filter(
      (block) =>
        before.has(block.id) &&
        blockSignature(before.get(block.id)!) !== blockSignature(block),
    ),
    added: next.blocks.filter((block) => !before.has(block.id)),
    removed: previous.blocks.filter((block) => !after.has(block.id)),
  };
}
