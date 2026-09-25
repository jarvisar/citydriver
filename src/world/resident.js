// Detail radius from the graphics controller: High = three blocks,
// Balanced/Smooth = two, Basic = one. The 3 x 3 collision neighborhood and the
// distant horizon ring are complete at every level.
const DEFAULT = { behind: 3, ahead: 5 };
let resident = DEFAULT;
export const residentWindow = () => resident;
export function setResidentWindow({ behind, ahead } = DEFAULT) {
  resident = { behind, ahead };
}
