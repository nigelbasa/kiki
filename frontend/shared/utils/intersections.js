export const INTERSECTION_LABELS = {
  TL_00: 'Samora Machel Ave x Julius Nyerere Way',
  TL_10: 'Harare Drive x Borrowdale Road',
  TL_11: 'Eastern Gateway Junction',
};

export function formatIntersectionName(intersectionId, fallbackName = '') {
  return INTERSECTION_LABELS[intersectionId] || fallbackName || intersectionId;
}
