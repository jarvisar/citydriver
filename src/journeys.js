import { CitydriverWorld } from './world/citydriver-world.js';
import { citydriverRoute } from './world/city-grid.js';

// A single connected city, sharing the garage and renderer scene interface.
export const JOURNEYS = {
  city: {
    title: 'Citydriver', label: 'CITYDRIVER', routeNumber: '1',
    World: CitydriverWorld, route: citydriverRoute,
    introduction: 'Every street leads somewhere. Explore an endless city in every direction.',
    sound: 'City, weather and engine sounds on',
    canvas: 'A procedural city with connected streets, river bridges and changing weather. Drive with WASD or arrow keys.',
  },
};
