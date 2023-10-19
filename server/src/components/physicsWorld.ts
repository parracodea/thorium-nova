import z from "zod";

import {World} from "@dimforge/rapier3d-compat";

export const physicsWorld = z
  .object({
    enabled: z.boolean().default(true),
    location: z
      .object({
        x: z.number().default(0),
        y: z.number().default(0),
        z: z.number().default(0),
        parentId: z.number().optional(),
      })
      .default({}),
    world: z.instanceof(World).default(new World({x: 0, y: 0, z: 0})),
  })
  .default({});
