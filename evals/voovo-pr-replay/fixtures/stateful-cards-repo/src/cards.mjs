export function getVisibleStudyCards(cards) {
  return cards.filter((card) => card.ready).map(normalizeCard);
}

function normalizeCard(card) {
  return {
    id: card.id,
    title: card.title,
    state: card.status
  };
}
