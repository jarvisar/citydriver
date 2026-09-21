# City generation

Citydriver has one procedural city that expands in both horizontal world axes. Streets form a connected grid, with continuous crossings over river channels. The same road surface and bridge elevations are used by the car and the scenery.

A seed determines the layout, buildings, and neighbourhood details. Nearby cells stream in as the car explores, and distant cells are released to keep the resident world bounded. Buildings need finished facades on all four sides because every street can be approached from either direction.

Weather and lighting are separate from the city layout. Changing the weather must preserve the player's position and the generated neighbourhood. Reset moves the player to a fresh district within the same seeded city.

Traffic travels both street axes and respects timed crossings. Future work can add more district types, activities, and traffic that chooses turns at intersections. New scenery should preserve driveable road connections and avoid placing props in lanes or bridge approaches.
