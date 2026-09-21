// The graphics controller supplies the detail budget. The city maps High to
// a radius of three detailed blocks and other presets to two; a separate
// distant ring keeps the horizon filled at every level.
const DEFAULT = { behind: 3, ahead: 5 };
let resident = DEFAULT;
export const residentWindow = () => resident;
export function setResidentWindow({ behind, ahead } = DEFAULT) {
  resident = { behind, ahead };
}
