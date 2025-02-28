import type { position } from "@server/components/position";
import { Entity } from "@server/utils/ecs";
import { getOrbitPosition } from "@server/utils/getOrbitPosition";
import { matchSorter } from "match-sorter";
import { t } from "@server/init/t";
import { z } from "zod";
import { pubsub } from "@server/init/pubsub";
import {
	getCompletePositionFromOrbit,
	getObjectOffsetPosition,
	getObjectSystem,
} from "@server/utils/position";
import type { DataContext } from "@server/utils/types";
import { defaultDropAnimationSideEffects } from "@dnd-kit/core";

type Waypoint = {
	id: number;
	name: string;
	objectId?: number;
	position: Zod.infer<typeof position>;
	systemPosition: Zod.infer<typeof position> | null;
};

export const navigation = t.router({
	ship: t.procedure
		.filter((publish: { shipId: number } | { clientId: string }, { ctx }) => {
			if (
				publish &&
				(("shipId" in publish && publish.shipId !== ctx.ship?.id) ||
					("clientId" in publish && publish.clientId !== ctx.id))
			)
				return false;

			return true;
		})
		.request(({ ctx }) => {
			if (!ctx.ship) throw new Error("No ship assigned");
			return {
				id: ctx.ship.id,
				name: ctx.ship.components.identity?.name,
				position: ctx.ship.components.position,
				icon: ctx.ship.components.isShip?.assets.logo,
				size: ctx.ship.components.size?.length || 350,
			};
		}),
	object: t.procedure
		.input(z.object({ objectId: z.number().optional() }))
		.filter((publish: { shipId: number }, { ctx }) => {
			if (publish && publish.shipId !== ctx.ship?.id) return false;
			return true;
		})
		.request(({ ctx, input }) => {
			if (!ctx.flight) throw new Error("No flight");

			const shipSystem =
				ctx.flight.ecs.entities.find(
					(entity) => entity.id === ctx.ship?.components.position?.parentId,
				) || null;
			const object = ctx.flight.ecs.getEntityById(input?.objectId || -1);

			if (!object)
				return {
					object: null,
					objectSystem: null,
					shipSystem: shipSystem?.components.position
						? { id: shipSystem?.id, ...shipSystem?.components.position }
						: null,
				};
			const objectSystem = getObjectSystem(object);
			const position =
				object.components.position ||
				(object.components.satellite
					? getOrbitPosition(object.components.satellite)
					: undefined);
			return {
				object: {
					position,
					name: object.components.identity?.name,
					classification: getClassification(),
					type: object.components.isShip
						? "ship"
						: object.components.isPlanet
						  ? "planet"
						  : object.components.isStar
							  ? "star"
							  : object.components.isSolarSystem
								  ? "solarSystem"
								  : "unknown",
					vanity: object.components.isShip?.assets.vanity,
					hue: object.components.isStar?.hue,
					isWhite: object.components.isStar?.isWhite,
					cloudMapAsset: object.components.isPlanet?.cloudMapAsset,
					ringMapAsset: object.components.isPlanet?.ringMapAsset,
					textureMapAsset: object.components.isPlanet?.textureMapAsset,
				},
				objectSystem: objectSystem?.components.position
					? { id: objectSystem?.id, ...objectSystem.components.position }
					: null,
				shipSystem: shipSystem?.components.position
					? { id: shipSystem?.id, ...shipSystem.components.position }
					: null,
			};

			function getClassification() {
				if (!object) return "";
				if (object.components.isPlanet)
					return `Class ${object.components.isPlanet.classification} Planet`;
				if (object.components.isStar)
					return `Class ${object.components.isStar.spectralType} Star`;
				if (object.components.isShip)
					return `${
						object.components.isShip.shipClass
							? `${object.components.isShip.shipClass} Class `
							: ""
					}${object.components.isShip.category}`;
				if (object.components.isSolarSystem) return "Solar System";
				return "";
			}
		}),

	search: t.procedure
		.input(z.object({ query: z.string() }))
		.request(({ ctx, input }) => {
			const { query } = input;

			// Get all of the planet, star, and solar system entities that match the query.
			const matchItems = matchSorter(
				ctx.flight?.ecs.entities
					.filter(
						(e) =>
							e.components.isStar ||
							e.components.isPlanet ||
							e.components.isSolarSystem,
					)
					.map((m) => {
						let position = m.components.position;
						if (!position) {
							const { x, y, z } = getCompletePositionFromOrbit(m);
							const parentId = getObjectSystem(m)?.id || null;
							position = {
								x,
								y,
								z,
								type: m.components.isSolarSystem ? "interstellar" : "solar",
								parentId: m.components.isSolarSystem ? null : parentId,
							};
						}
						return {
							...m,
							type: m.components.isSolarSystem
								? "solar"
								: m.components.isPlanet
								  ? "planet"
								  : m.components.isShip
									  ? "ship"
									  : "star",
							name: m.components.identity!.name,
							description: m.components.identity?.description,
							temperature: m.components.temperature?.temperature,
							spectralType: m.components.isStar?.spectralType,
							classification: m.components.isPlanet?.classification,
							mass:
								m.components.isStar?.solarMass ||
								m.components.isPlanet?.terranMass,
							population: m.components.population?.count,
							position,
						} as const;
					}) || [],
				query,
				{
					keys: [
						"name",
						"description",
						"temperature",
						"spectralType",
						"classification",
						"mass",
						"population",
					],
				},
			).map((m) => ({
				// TODO Aug 1 2022 - Add in a distance calculation.
				id: m.id,
				name: m.name,
				position: m.position,
				type: m.type,
			}));

			return matchItems;
		}),
	stream: t.procedure.dataStream(({ entity, ctx }) => {
		return Boolean(entity?.components.position && entity.id === ctx.ship?.id);
	}),
});

export const waypoints = t.router({
	all: t.procedure
		.input(
			z.object({
				shipId: z.number().optional(),
				systemId: z.union([z.literal("all"), z.number(), z.null()]),
			}),
		)
		.filter((publish: { shipId: number } | null, { ctx, input }) => {
			const shipId = input.shipId ?? ctx.ship?.id;
			if (publish && shipId !== publish.shipId) return false;
			return true;
		})
		.request(({ ctx, input }) => {
			const shipId = input.shipId ?? ctx.ship?.id;
			const waypoints = ctx.flight?.ecs.entities.reduce(
				(prev: Waypoint[], next) => {
					if (
						next.components.isWaypoint?.assignedShipId === shipId &&
						(input.systemId === "all" ||
							next.components.position?.parentId === input.systemId)
					) {
						if (next.components.position) {
							const systemPosition =
								ctx.flight?.ecs.getEntityById(
									next.components.position.parentId || -1,
								)?.components.position || null;
							prev.push({
								id: next.id,
								name: next.components.identity?.name || "",
								objectId: next.components.isWaypoint?.attachedObjectId,
								position: next.components.position,
								systemPosition,
							});
						}
					}
					return prev;
				},
				[],
			);

			return waypoints || [];
		}),
	spawn: t.procedure
		.meta({
			action: (ctx: DataContext) => {
				return {
					position: {
						name: "Position",
						type: "starmapCoordinates",
						helper:
							"A specific point in space to place the waypoint. Use as an alternative to Waypoint Entity.",
					},
					entityId: {
						name: "Waypoint Entity",
						helper:
							"The entity to attach the waypoint to. This option is preferred.",
					},
				};
			},
		})
		.input(
			z.object({
				shipId: z.number().optional(),

				entityId: z.number().optional(),
				position: z
					.object({
						parentId: z
							.union([
								z.number(),
								z.object({ name: z.string(), pluginId: z.string() }),
							])
							.nullable(),
						x: z.number(),
						y: z.number(),
						z: z.number(),
					})
					.optional(),
				tags: z.array(z.string()).optional(),
			}),
		)
		.send(({ ctx, input }) => {
			if (!ctx.flight) throw new Error("No flight in progress");
			const ship = input.shipId
				? ctx.flight.ecs.getEntityById(input.shipId)
				: ctx.ship;
			if (!ship) throw new Error("No ship selected.");
			const shipId = ship.id;
			let position = { x: 0, y: 0, z: 0 };
			let systemId: number | null = null;
			let object: Entity | undefined = undefined;
			if ("entityId" in input) {
				// This waypoint is being attached to a specific object in space.
				object = ctx.flight?.ecs.entities.find((e) => e.id === input.entityId);
				if (!object) throw new Error("No object found.");
				position = getObjectOffsetPosition(object, ship);
				const sys = getObjectSystem(object);
				systemId = sys?.id ?? null;
				if (sys?.id === object.id) systemId = null;
				const maybeWaypoint = ctx.flight.ecs.entities.find(
					(e) =>
						e.components.isWaypoint?.assignedShipId === shipId &&
						e.components.isWaypoint?.attachedObjectId === object?.id,
				);
				if (maybeWaypoint) {
					maybeWaypoint.updateComponent("position", {
						...position,
						type: systemId ? "solar" : "interstellar",
						parentId: systemId,
					});
					if (input.tags && input.tags.length > 0) {
						maybeWaypoint.updateComponent("tags", {
							tags: [
								...(maybeWaypoint.components.tags?.tags || []),
								...input.tags,
							],
						});
					}
					pubsub.publish.waypoints.all({
						shipId,
					});
					// TODO July 30, 2022: It might be necessary to publish to make this appear on the Pilot or Viewscreen.
					return maybeWaypoint;
				}
			} else if ("position" in input && input.position) {
				// This waypoint is just being plopped at some random point in space.
				position = input.position;
				const parentId = input.position.parentId;
				if (parentId && typeof parentId === "object") {
					// This waypoint is probably defined in a timeline action, so we need
					// to find which system matches the name.
					const solarSystems =
						ctx.flight.ecs.componentCache.get("isSolarSystem") || [];
					for (const entity of solarSystems) {
						if (entity.components.identity?.name === parentId.name) {
							systemId = entity.id;
							break;
						}
					}
				} else {
					systemId = parentId;
				}
			} else {
				throw new Error("Either position or entityId are required");
			}

			const newWaypoint = new Entity();
			newWaypoint.addComponent("isWaypoint", {
				assignedShipId: shipId,
				attachedObjectId: object?.id,
			});
			// If we have an object, set the name to the name of that object
			if (object?.components.identity?.name) {
				// TODO: INTL in the server here.
				newWaypoint.addComponent("identity", {
					name: `${object.components.identity.name} Waypoint`,
				});
			} else {
				// Count up the highest waypoint count and use that.
				const waypointNum =
					1 +
					(ctx.flight.ecs.entities || []).reduce((prev, next) => {
						if (next.components.isWaypoint?.assignedShipId === shipId) {
							const nameWords = next.components.identity?.name.split(" ") || [];
							const num = Number.parseInt(nameWords[nameWords.length - 1], 10);
							if (!num || num < prev) return prev;
							return num;
						}
						return prev;
					}, 0);
				newWaypoint.addComponent("identity", {
					name: `Waypoint ${waypointNum}`,
				});
			}
			newWaypoint.addComponent("position", {
				...position,
				parentId: systemId,
				type: systemId ? "solar" : "interstellar",
			});

			if (input.tags && input.tags.length > 0) {
				newWaypoint.addComponent("tags", {
					tags: input.tags,
				});
			}

			ctx.flight.ecs.addEntity(newWaypoint);

			pubsub.publish.waypoints.all({
				shipId,
			});

			return newWaypoint;
		}),
	delete: t.procedure
		.meta({ action: true, event: true })
		.input(z.object({ waypointId: z.number() }))
		.send(({ ctx, input }) => {
			if (!ctx.flight) throw new Error("No flight in progress");
			const ship = ctx.ship;
			if (!ship) throw new Error("No ship selected.");
			const shipId = ship.id;
			const waypoint = ctx.flight.ecs.entities.find(
				(e) => e.id === input.waypointId,
			);
			if (!waypoint) throw new Error("No waypoint found.");
			if (waypoint.components.isWaypoint?.assignedShipId !== shipId)
				throw new Error("Waypoint is not assigned to this ship.");
			ctx.flight.ecs.removeEntity(waypoint);
			pubsub.publish.waypoints.all({
				shipId,
			});
		}),
});
