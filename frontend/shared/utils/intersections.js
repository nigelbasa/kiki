export const INTERSECTION_LABELS = {
  TL_00: 'NW Corner — Samora Machel x Nyerere',
  TL_01: 'NE Corner — Harare Drive x Nyerere',
  TL_10: 'SW Corner — Samora Machel x Borrowdale',
  TL_11: 'SE Corner — Harare Drive x Borrowdale',
};

export function formatIntersectionName(intersectionId, fallbackName = '') {
  return INTERSECTION_LABELS[intersectionId] || fallbackName || intersectionId;
}
