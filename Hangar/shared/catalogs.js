// The catalogs of music cleared for videos that Find music lists: NCS's and Monstercat's.
// Placeholder until their readers are written.

export const catalogs = {
  ncs: { name: "NCS", base: "https://ncs.io/", note: null, read: async () => ({ problem: "Not read yet." }) },
  monstercat: { name: "Monstercat", base: "https://player.monstercat.app/api/", note: null, read: async () => ({ problem: "Not read yet." }) },
};
